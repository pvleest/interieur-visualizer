// Headless smoke + walk + scenario tests.
// Usage: node tools/test.mjs [baseUrl]   (needs playwright-core + Chrome; CHROME env to override path)
import { chromium } from 'playwright-core';
import { checkPlan } from './layout-checks.mjs';
const base = process.argv[2] || 'http://localhost:8765/';
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failures = 0;
const check = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failures++; };

async function open(url, vp = { viewport: { width: 1280, height: 800 } }) {
  const page = await browser.newPage(vp);
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errs.push('HTTP ' + r.status() + ' ' + r.url()); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  return { page, errs };
}

// Walk a path of waypoints with the same collision code the keyboard uses.
const WALK = async (page, start, path) => page.evaluate(({ start, path }) => {
  const v = window.viz;
  v.startWalk('keuken');
  v.setPose(start[0], start[1]);
  const visited = [];
  const note = () => { const r = v.position().room; if (r && visited[visited.length - 1] !== r) visited.push(r); };
  note();
  for (const [tx, tz] of path) {
    for (let i = 0; i < 400; i++) {
      const p = v.position();
      const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
      if (d < 3) break;
      const s = Math.min(4, d);
      v.tryMove((dx / d) * s, (dz / d) * s);
      note();
    }
  }
  return { visited, end: v.position() };
}, { start, path });

{
  const { page, errs } = await open(base);
  // 1. scripted walk keuken -> garage -> bijkeuken -> slaapkamer
  const r = await WALK(page, [475, 610], [[280, 460], [280, 250], [100, 252], [-100, 252], [-200, 322], [-420, 322], [-560, 250]]);
  console.log('  visited:', r.visited.join(' -> '), ' end:', JSON.stringify(r.end));
  check(JSON.stringify(r.visited) === JSON.stringify(['keuken', 'garage', 'bijkeuken', 'slaapkamer']), 'walk path visits keuken -> garage -> bijkeuken -> slaapkamer');
  check(Math.hypot(r.end.x + 560, r.end.z - 250) < 5, 'walk reaches the target point in the bedroom');
  // and back again
  const back = await WALK(page, [-560, 250], [[-420, 322], [-200, 322], [-100, 252], [100, 252], [280, 250], [280, 460], [475, 610]]);
  check(JSON.stringify(back.visited) === JSON.stringify(['slaapkamer', 'bijkeuken', 'garage', 'keuken']), 'walk back slaapkamer -> keuken (' + back.visited.join(' -> ') + ')');
  // 2. exterior / living-room openings
  const living = await WALK(page, [590, 600], [[590, 760]]);
  check(living.end.z > 740, 'keuken -> woonkamer opening is walkable');
  const slider = await WALK(page, [-150, 330], [[-150, 480]]);
  check(slider.end.z > 460, 'bijkeuken schuifpui is walkable');
  const gdoor = await WALK(page, [-440, 330], [[-440, 480]]);
  check(gdoor.end.z > 460, 'slaapkamer tuindeur is walkable');
  const entree = await WALK(page, [75, 250], [[75, 380]]);
  check(entree.end.z > 360, 'entreedeur garage (90 cm) is walkable');
  const raam = await WALK(page, [-616, 330], [[-616, 480]]);
  check(raam.end.z < 380, 'slaapkamer raam tot de vloer blocks (z=' + raam.end.z.toFixed(0) + ')');
  // 3. walls still block
  const wall = await WALK(page, [400, 200], [[400, -200]]);
  check(wall.end.z > 0, 'garage north wall blocks (z=' + wall.end.z.toFixed(0) + ')');
  const wall2 = await WALK(page, [480, 450], [[480, 200]]);
  check(wall2.end.z > 330, 'kitchen-garage wall blocks outside the door (z=' + wall2.end.z.toFixed(0) + ')');
  // 4. real keyboard: from the kitchen, facing north (yaw 0), hold W
  // A/D strafe: facing north (yaw 0), A must go west (-x) and D east (+x)
  for (const [key, sign, label] of [['KeyA', -1, 'A strafes left'], ['KeyD', 1, 'D strafes right']]) {
    await page.evaluate(() => window.viz.setPose(-560, 250, 0));
    await page.keyboard.down(key);
    await page.waitForFunction(() => Math.abs(window.viz.position().x + 560) > 15, null, { timeout: 20000 }).catch(() => {});
    await page.keyboard.up(key);
    const p = await page.evaluate(() => window.viz.position());
    check(Math.sign(p.x + 560) === sign && Math.abs(p.z - 250) < 3, `${label} (dx=${(p.x + 560).toFixed(0)}, dz=${(p.z - 250).toFixed(0)})`);
  }
  // facing east (yaw -90): A must go north (-z)
  await page.evaluate(() => window.viz.setPose(-560, 250, -90));
  await page.keyboard.down('KeyA');
  await page.waitForFunction(() => Math.abs(window.viz.position().z - 250) > 15, null, { timeout: 20000 }).catch(() => {});
  await page.keyboard.up('KeyA');
  const pe = await page.evaluate(() => window.viz.position());
  check(pe.z < 250 && Math.abs(pe.x + 560) < 3, 'facing east, A strafes north/left (dz=' + (pe.z - 250).toFixed(0) + ')');
  // on-screen pad: ⟲ turns left (yaw increases => forward rotates towards west)
  await page.evaluate(() => window.viz.setPose(-560, 250, 0));
  await page.dispatchEvent('#walkpad button[data-k="left"]', 'pointerdown');
  await page.waitForTimeout(800);
  await page.dispatchEvent('#walkpad button[data-k="left"]', 'pointerup');
  const yl = await page.evaluate(() => window.viz.position().yaw);
  check(yl > 5, 'pad ⟲ turns left (yaw=' + yl.toFixed(0) + ')');
  await page.evaluate(() => window.viz.setPose(-560, 250, 0));
  await page.dispatchEvent('#walkpad button[data-k="fwd"]', 'pointerdown');
  await page.waitForFunction(() => window.viz.position().z < 235, null, { timeout: 20000 }).catch(() => {});
  await page.dispatchEvent('#walkpad button[data-k="fwd"]', 'pointerup');
  const pf = await page.evaluate(() => window.viz.position());
  check(pf.z < 240, 'pad ▲ walks forward (dz=' + (pf.z - 250).toFixed(0) + ')');

  await page.evaluate(() => window.viz.setPose(280, 470, 0));
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.viz.position().room === 'garage' && window.viz.position().z < 280, null, { timeout: 30000 }).catch(() => {});
  await page.keyboard.up('KeyW');
  const kp = await page.evaluate(() => window.viz.position());
  check(kp.room === 'garage', 'keyboard W walks from kitchen into garage (room=' + kp.room + ', z=' + kp.z.toFixed(0) + ')');
  await page.evaluate(() => window.viz.stopWalk());

  // 4b. layout checks for the base plan and every scenario: inside rooms, no intersections, no furniture in walls,
  // door leaves and doorways clear, garage walkway >= 120 cm and free, hard requirements, and a walkable route
  // keuken -> garage -> bijkeuken -> slaapkamer that also keeps 50 cm clear of furniture.
  const DEFAULT_ROUTE = [[300, 450], [280, 380], [280, 250], [100, 252], [-100, 252], [-200, 305], [-420, 322], [-420, 330], [-500, 330], [-500, 240]];
  const idx = await (await fetch(new URL('scenarios/index.json', base))).json();
  const routes = { base: DEFAULT_ROUTE };
  for (const e of idx.scenarios) routes['repo:' + e.id] = (await (await fetch(new URL(e.file, base))).json()).checks?.route || DEFAULT_ROUTE;
  const keys = await page.evaluate(() => window.viz.listScenarios().map((s) => [s.key, s.name]));
  check(keys.length === idx.scenarios.length + 1, `all ${idx.scenarios.length} repo scenarios listed (${keys.map((k) => k[1]).join(', ')})`);
  for (const [key, name] of keys) {
    await page.evaluate((k) => window.viz.loadScenario(k), key);
    const plan = await page.evaluate(() => window.viz.getPlan());
    const route = routes[key] || DEFAULT_ROUTE;
    const issues = checkPlan(plan, { route });
    check(issues.length === 0, `layout ${name}: inside rooms, no intersections, doors/walkway clear, requirements met` + (issues.length ? ' ' + JSON.stringify(issues) : ''));
    const w = await WALK(page, route[0], route.slice(1));
    const end = route[route.length - 1];
    check(JSON.stringify(w.visited) === JSON.stringify(['keuken', 'garage', 'bijkeuken', 'slaapkamer']) && Math.hypot(w.end.x - end[0], w.end.z - end[1]) < 5,
      `walk ${name}: ${w.visited.join(' -> ')} reaches (${end})`);
    await page.evaluate(() => window.viz.stopWalk());
  }
  // the walk-in partition is a real wall: walking through it from the bed side is blocked
  await page.evaluate(() => window.viz.loadScenario('repo:slaapkamer-inloopkast'));
  const part = await WALK(page, [-560, 200], [[-680, 200]]);
  check(part.end.x > -600, 'inloopkast: new partition wall blocks walking (x=' + part.end.x.toFixed(0) + ')');
  await page.evaluate(() => window.viz.stopWalk());
  // the checker itself catches mistakes
  const basePlan = await page.evaluate(async () => { await window.viz.loadScenario('base'); return window.viz.getPlan(); });
  const broken = structuredClone(basePlan);
  broken.items.find((i) => i.id === 'keuken-ronde-tafel-80').pos = [405, 380];
  broken.items.find((i) => i.id === 'bijkeuken-wasmachine').pos = [-317, 260];
  broken.items.find((i) => i.id === 'garage-open-stelling-kratten').pos = [200, 250];
  const caught = checkPlan(broken, { route: DEFAULT_ROUTE });
  check(caught.some((m) => m.startsWith('overlap')) && caught.some((m) => m.includes('slaapkamerwand')) && caught.some((m) => m.includes('looppad')), 'layout checker detects overlap, machine against bedroom wall and blocked walkway (' + caught.length + ' issues)');

  // 5. scenarios + edit API
  const list = await page.evaluate(() => window.viz.listScenarios().map((s) => s.name));
  check(list.includes('Basisontwerp') && list.includes('Licht & warm') && list.includes('Donker & strak'), 'scenario list: ' + list.join(', '));
  await page.evaluate(() => window.viz.loadScenario('repo:donker-strak'));
  const pal = await page.evaluate(() => window.viz.getPlan().palette);
  check(pal.frontBase === 'antraciet' && pal.worktop === 'zwartComposiet' && pal.floorExtension === 'betonDonker', 'Donker & strak palette applied');
  const e1 = await page.evaluate(() => window.viz.applyEdit({ op: 'moveItem', id: 'keuken-ronde-tafel-80', by: [0, -20] }));
  const tpos = await page.evaluate(() => window.viz.getPlan().items.find((i) => i.id === 'keuken-ronde-tafel-80').pos);
  check(e1.ok && tpos[1] === 555, 'applyEdit moveItem works (pos ' + tpos + ')');
  const e2 = await page.evaluate(() => window.viz.applyEdit([{ op: 'removeItem', id: 'bijkeuken-plant' }, { op: 'addItem', item: { id: 'slaapkamer-plant', type: 'plant', room: 'slaapkamer', pos: [-740, 365], size: [40, 40, 110] } }, { op: 'updateOpening', wall: 'keuken-gevel', index: 0, set: { sill: 60 } }]));
  check(e2.ok, 'applyEdit batch (remove/add item, update opening)');
  const e3 = await page.evaluate(() => window.viz.applyEdit({ op: 'explode' }));
  check(!e3.ok && /onbekende operatie/.test(e3.error), 'invalid op is rejected: ' + e3.error.slice(0, 60));
  const share = await page.evaluate(() => window.viz.shareUrl());
  const before = await page.evaluate(() => JSON.stringify(window.viz.getPlan()));
  await page.evaluate(() => window.viz.undo());
  const undone = await page.evaluate(() => window.viz.getPlan().items.some((i) => i.id === 'bijkeuken-plant'));
  check(undone, 'undo restores removed item');
  check(errs.length === 0, 'no JS errors on main page ' + (errs.length ? JSON.stringify(errs) : ''));
  await page.close();

  // 6. share link opens identically on a "different device" (fresh context)
  console.log('  share url length:', share.length);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p2 = await ctx.newPage();
  const errs2 = []; p2.on('pageerror', (e) => errs2.push(e.message)); p2.on('console', (m) => { if (m.type() === 'error') errs2.push(m.text()); });
  await p2.goto(share.replace(/^[^#]*#/, base.replace(/#.*$/, '') + '#'), { waitUntil: 'load' });
  await p2.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  const after = await p2.evaluate(() => JSON.stringify(window.viz.getPlan()));
  check(after === before, 'shared link reproduces the exact plan on another device');
  check(errs2.length === 0, 'no JS errors on shared-link page ' + (errs2.length ? JSON.stringify(errs2) : ''));
  await ctx.close();
}
await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
