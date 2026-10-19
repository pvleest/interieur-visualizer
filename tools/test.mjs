// Headless smoke + walk + scenario tests.
// Usage: node tools/test.mjs [baseUrl]   (needs playwright-core + Chrome; CHROME env to override path)
import { chromium } from 'playwright-core';
import { checkPlan } from './layout-checks.mjs';
const base = process.argv[2] || 'http://localhost:8765/';
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failures = 0;
// key-order independent JSON (compacted patches may add keys in another order)
const canon = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));
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
  const r = await WALK(page, [475, 610], [[280, 460], [280, 250], [100, 185], [-100, 178], [-200, 247], [-420, 247], [-560, 175]]);
  console.log('  visited:', r.visited.join(' -> '), ' end:', JSON.stringify(r.end));
  check(JSON.stringify(r.visited) === JSON.stringify(['keuken', 'garage', 'bijkeuken', 'slaapkamer']), 'walk path visits keuken -> garage -> bijkeuken -> slaapkamer');
  check(Math.hypot(r.end.x + 560, r.end.z - 175) < 5, 'walk reaches the target point in the bedroom');
  // and back again
  const back = await WALK(page, [-560, 175], [[-420, 247], [-200, 247], [-100, 178], [100, 185], [280, 250], [280, 460], [475, 610]]);
  check(JSON.stringify(back.visited) === JSON.stringify(['slaapkamer', 'bijkeuken', 'garage', 'keuken']), 'walk back slaapkamer -> keuken (' + back.visited.join(' -> ') + ')');
  // 2. exterior / living-room openings
  const living = await WALK(page, [590, 600], [[590, 760]]);
  check(living.end.z > 740, 'keuken -> woonkamer opening is walkable');
  const slider = await WALK(page, [-150, 255], [[-150, 405]]);
  check(slider.end.z > 385, 'bijkeuken schuifpui is walkable');
  const gdoor = await WALK(page, [-440, 255], [[-440, 405]]);
  check(gdoor.end.z > 385, 'slaapkamer tuindeur is walkable');
  const entree = await WALK(page, [60, 250], [[60, 380]]);
  check(entree.end.z > 360, 'glazen entreedeur garage (90 cm) is walkable');
  const kslider = await WALK(page, [290, 600], [[290, 720]]);
  check(kslider.end.z > 700, 'keuken schuifpui (292 cm) is walkable (z=' + kslider.end.z.toFixed(0) + ')');
  const kwall = await WALK(page, [530, 600], [[530, 720]]);
  check(kwall.end.z < 645, 'keuken gevel next to the schuifpui blocks (z=' + kwall.end.z.toFixed(0) + ')');
  const ops = await page.evaluate(() => Object.fromEntries(window.viz.getPlan().walls.flatMap((w) => (w.openings || []).filter((o) => o.id).map((o) => [o.id, o.type + '/' + (o.sill || 0) + '/' + o.height]))));
  check(ops['entree-deur'] === 'glassdoor/0/211' && ops['keuken-schuifpui'] === 'slider/0/215', 'entreedeur is a glass door, keukenraam is now a schuifpui to the floor (' + ops['entree-deur'] + ', ' + ops['keuken-schuifpui'] + ')');
  const raam = await WALK(page, [-616, 255], [[-616, 405]]);
  check(raam.end.z < 305, 'slaapkamer raam tot de vloer blocks (z=' + raam.end.z.toFixed(0) + ')');
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
  const DEFAULT_ROUTE = [[300, 450], [280, 380], [280, 250], [100, 190], [-100, 178], [-200, 230.4], [-420, 247.4], [-420, 255.4], [-500, 255.4], [-500, 165.4]];
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
  const part = await WALK(page, [-560, 125], [[-680, 125]]);
  check(part.end.x > -600, 'inloopkast: new partition wall blocks walking (x=' + part.end.x.toFixed(0) + ')');
  await page.evaluate(() => window.viz.stopWalk());
  // the checker itself catches mistakes
  const basePlan = await page.evaluate(async () => { await window.viz.loadScenario('base'); return window.viz.getPlan(); });
  const broken = structuredClone(basePlan);
  broken.items.find((i) => i.id === 'keuken-ronde-tafel-80').pos = [405, 380];
  broken.items.find((i) => i.id === 'bijkeuken-wasmachine').pos = [-317, 260];
  broken.items.find((i) => i.id === 'garage-schoenenbank').pos = [200, 200];
  broken.items = broken.items.filter((i) => i.id !== 'garage-fiets-2');
  broken.items.find((i) => i.id === 'el-garage-laadpunt-1').pos = [400, 1];
  broken.items = broken.items.filter((i) => i.id !== 'el-bijkeuken-droger');
  const caught = checkPlan(broken, { route: DEFAULT_ROUTE });
  check(caught.some((m) => m.startsWith('overlap')) && caught.some((m) => m.includes('slaapkamerwand')) && caught.some((m) => m.includes('looppad')) && caught.some((m) => m.includes('fietsen')) && caught.some((m) => m.includes('stopcontact') || m.includes('te ver van garage-fiets-5')) && caught.some((m) => m.includes('geen aansluiting voor bijkeuken-droger')), 'layout checker detects overlap, machine against bedroom wall, blocked walkway, missing bike, e-bike far from socket and missing dryer socket (' + caught.length + ' issues)' + (caught.some((m) => m.includes('geen aansluiting voor bijkeuken-droger')) ? '' : JSON.stringify(caught)));

  // Elektra layer: hidden by default, toggle shows markers + labels, panel lists every point per room
  const el0 = await page.evaluate(() => window.viz.elektra());
  check(!el0.on && el0.visible === 0 && el0.total >= 20, `elektra markers hidden by default (${el0.total} points)`);
  await page.evaluate(() => { document.querySelector('#tPanel:not(.on)')?.click(); });
  await page.bringToFront();
  await page.evaluate(() => window.viz.goView('garage'));
  await page.click('#tElektra');
  const shownLabels = () => [...document.querySelectorAll('.layer-label')].filter((e) => e.style.display !== 'none').length;
  await page.waitForFunction(shownLabels, null, { timeout: 20000 }).catch(() => {}); // swiftshader renders slowly
  const el1 = await page.evaluate(() => ({ s: window.viz.elektra(), rows: document.querySelectorAll('#tab-elektra tr[data-item]').length, rooms: [...document.querySelectorAll('#tab-elektra .el-room h3')].map((h) => h.firstChild.textContent.trim()), shown: [...document.querySelectorAll('.layer-label')].filter((e) => e.style.display !== 'none').length }));
  check(el1.s.on && el1.s.visible === el1.s.total && el1.rows === el1.s.total && el1.shown > 0, `elektra toggle shows ${el1.s.visible} markers, ${el1.shown} labels in view; panel lists ${el1.rows} points in ${el1.rooms.join(', ')}`);
  await page.click('#tElektra');
  const el2 = await page.evaluate(() => ({ s: window.viz.elektra(), shown: [...document.querySelectorAll('.layer-label')].filter((e) => e.style.display !== 'none').length }));
  await page.waitForFunction(() => [...document.querySelectorAll('.layer-label')].every((e) => e.style.display === 'none'), null, { timeout: 20000 }).catch(() => {});
  const el3 = await page.evaluate(() => [...document.querySelectorAll('.layer-label')].filter((e) => e.style.display !== 'none').length);
  check(!el2.s.on && el2.s.visible === 0 && el3 === 0, 'elektra toggle off hides markers and labels again');

  // checker: slider clear zone and cabinet front clearance
  const broken2 = structuredClone(basePlan);
  broken2.items.find((i) => i.id === 'keuken-ronde-tafel-80').pos = [290, 600];
  broken2.items.push({ id: 'test-strijkkast', type: 'ironingCabinet', room: 'bijkeuken', pos: [-317, 100], rot: 90, size: [60, 60, 240] });
  const caught2 = checkPlan(broken2, {});
  check(caught2.some((m) => m.includes('keuken-gevel') && m.includes('keuken-ronde-tafel-80')) && caught2.some((m) => m.includes('ruimte voor bijkeuken-schoonmaakkast')), 'layout checker detects a table in front of the kitchen schuifpui and a blocked cleaning cabinet (' + caught2.join('; ') + ')');

  // 5. scenarios + edit API
  const list = await page.evaluate(() => window.viz.listScenarios().map((s) => s.name));
  check(list.includes('Basisontwerp') && list.includes('Licht & warm') && list.includes('Donker & strak'), 'scenario list: ' + list.join(', '));
  await page.evaluate(() => window.viz.loadScenario('repo:donker-strak'));
  const pal = await page.evaluate(() => window.viz.getPlan().palette);
  check(pal.frontBase === 'antraciet' && pal.worktop === 'zwartComposiet' && pal.floorExtension === 'betonDonker', 'Donker & strak palette applied');
  const e1 = await page.evaluate(() => window.viz.applyEdit({ op: 'moveItem', id: 'keuken-ronde-tafel-80', by: [0, -20] }));
  const tpos = await page.evaluate(() => window.viz.getPlan().items.find((i) => i.id === 'keuken-ronde-tafel-80').pos);
  check(e1.ok && tpos[1] === 505, 'applyEdit moveItem works (pos ' + tpos + ')');
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
  check(canon(JSON.parse(after)) === canon(JSON.parse(before)), 'shared link reproduces the exact plan on another device');
  check(errs2.length === 0, 'no JS errors on shared-link page ' + (errs2.length ? JSON.stringify(errs2) : ''));
  await ctx.close();
}

// 7. interactive edit mode: select, drag (mouse), rotate, delete, add from the catalogue, undo/redo,
//    save as scenario, share link in a fresh context, touch drag on a phone
{
  const { page, errs } = await open(base + '?view=garage');
  const item = (id) => page.evaluate((id) => window.viz.getPlan().items.find((i) => i.id === id) || null, id);
  const idle = () => page.waitForFunction(() => window.viz.idle(), null, { timeout: 60000 });
  await page.click('#tEdit');
  await idle();
  check(await page.evaluate(() => window.viz.editor.active() && !document.querySelector('#editTools').hidden), 'edit mode: Bewerken toggles the edit toolbar');
  const bench0 = await item('garage-schoenenbank'), cushion0 = await item('garage-bankkussen');
  const sp = await page.evaluate(() => window.viz.screenPos('garage-schoenenbank'));
  // first click selects the top item at that spot (the hat shelf hangs above the bench); clicking again cycles down
  const picked = [];
  for (let k = 0; k < 4; k++) {
    await page.mouse.click(sp.x, sp.y); await page.waitForTimeout(150);
    picked.push(await page.evaluate(() => window.viz.editor.selected()));
    if (picked.at(-1) === 'garage-schoenenbank') break;
  }
  check(picked.at(-1) === 'garage-schoenenbank', 'edit mode: click selects, clicking again cycles through stacked items: ' + picked.join(' → '));
  await page.mouse.move(sp.x, sp.y); await page.mouse.down();
  await page.mouse.move(sp.x + 30, sp.y - 45, { steps: 10 }); await page.mouse.up();
  await page.waitForFunction(() => window.viz.getPlan().items.find((i) => i.id === 'garage-schoenenbank').pos[1] !== 291, null, { timeout: 20000 }).catch(() => {});
  const bench1 = await item('garage-schoenenbank'), cushion1 = await item('garage-bankkussen');
  const sel1 = await page.evaluate(() => window.viz.editor.selected());
  const moved = bench1.pos[0] !== bench0.pos[0] || bench1.pos[1] !== bench0.pos[1];
  const sameDelta = Math.abs((cushion1.pos[0] - cushion0.pos[0]) - (bench1.pos[0] - bench0.pos[0])) < 0.2 && Math.abs((cushion1.pos[1] - cushion0.pos[1]) - (bench1.pos[1] - bench0.pos[1])) < 0.2;
  check(sel1 === 'garage-schoenenbank' && moved && sameDelta, `edit mode: mouse drag selects + moves the bench (${bench0.pos} → ${bench1.pos}), its cushion moves along`);
  const warn1 = await page.evaluate(() => ({ w: window.viz.editor.warnings(), bad: document.querySelector('#edWarn').classList.contains('bad'), panel: document.querySelector('#editBar .eb-warn').textContent }));
  check(warn1.w.length > 0 && warn1.bad && /looppad|doorgang/.test(warn1.panel), 'edit mode: live warning in Dutch when the bench lands on the walkway: ' + warn1.w.join(' | '));
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(300);
  const bench2 = await item('garage-schoenenbank'), cushion2 = await item('garage-bankkussen');
  check(bench2.rot === -90 && cushion2.rot === -90, `edit mode: R rotates 90° (bench ${bench0.rot} → ${bench2.rot}, cushion ${cushion2.rot})`);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(300);
  check(!(await item('garage-schoenenbank')) && !(await item('garage-bankkussen')) && !(await page.evaluate(() => window.viz.editor.selected())), 'edit mode: Delete removes the bench and its cushion');
  await page.click('#edAdd');
  await page.click('#catalog button[data-key="hoog60"]');
  await page.waitForTimeout(300);
  const added = await page.evaluate(() => { const id = window.viz.editor.selected(); return { id, it: window.viz.getPlan().items.find((i) => i.id === id), w: window.viz.editor.warnings() }; });
  check(added.it && added.it.type === 'tall' && added.it.room === 'garage' && added.w.length === 0, `edit mode: catalogue adds "Hoge kast 60" in the viewed room on a free spot (${added.id} @ ${added.it?.pos}, rot ${added.it?.rot || 0}, ${added.w.length} warnings)`);
  const keys = await page.evaluate(() => window.viz.editor.catalog());
  const fits = [];
  for (const k of keys.filter((k) => !['wcd2', 'wcd1', 'laad', 'perilex'].includes(k))) {
    const r = await page.evaluate((k) => { const r = window.viz.editor.addFromCatalog(k, 'slaapkamer'); return { ok: r.ok, w: window.viz.editor.warnings(r.id) }; }, k);
    fits.push(k + (r.ok ? (r.w.length ? '⚠' : '') : '✗'));
    await page.evaluate(() => window.viz.undo());
  }
  check(fits.every((f) => !f.includes('✗')), 'edit mode: every catalogue item can be added (slaapkamer): ' + fits.join(' '));
  await page.keyboard.press('Control+KeyZ'); await page.waitForTimeout(300);
  const afterUndo = await item(added.id);
  await page.keyboard.press('Control+Shift+KeyZ'); await page.waitForTimeout(300);
  const afterRedo = await item(added.id);
  await page.keyboard.press('Control+KeyZ'); await page.waitForTimeout(300);
  check(!afterUndo && afterRedo && !(await item(added.id)), 'edit mode: Ctrl+Z / Ctrl+Shift+Z undo and redo the catalogue item');
  // add it again via the toolbar + duplicate, then save as scenario and share
  await page.click('#edAdd');
  await page.click('#catalog button[data-key="fiets"]');
  await page.waitForTimeout(300);
  const bikeId = await page.evaluate(() => window.viz.editor.selected());
  await page.keyboard.press('Control+KeyD'); await page.waitForTimeout(300);
  const dupId = await page.evaluate(() => window.viz.editor.selected());
  check(bikeId && dupId && dupId !== bikeId && (await item(dupId))?.type === 'bike', `edit mode: Ctrl+D duplicates (${bikeId} → ${dupId})`);
  // resize + material from the panel
  await page.fill('#ebW', '200'); await page.press('#ebW', 'Enter'); await page.waitForTimeout(300);
  check((await item(dupId)).size[0] === 200, 'edit mode: width input resizes the item');
  const nPatches = await page.evaluate(() => window.viz.getScenario().patches.length);
  page.once('dialog', (d) => d.accept('Test bewerken'));
  await page.evaluate(() => document.querySelector('#scenSaveNew').click());
  await page.waitForTimeout(300);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('interieur-visualizer.scenarios.v1') || '[]').find((s) => s.name === 'Test bewerken'));
  check(saved && saved.patches.length === nPatches, `edit mode: "Opslaan als nieuw scenario" stores the edits (${saved?.patches.length} compacted patches)`);
  await page.evaluate(() => document.querySelector('#scenShare').click());
  await page.waitForTimeout(300);
  const url = await page.evaluate(() => document.querySelector('#scenShareUrl').value);
  const planA = await page.evaluate(() => window.viz.getPlan());
  check(url.includes('#s=') && url.length < 2500, `edit mode: share link length ${url.length} chars`);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p3 = await ctx.newPage();
  const errs3 = []; p3.on('pageerror', (e) => errs3.push(e.message));
  await p3.goto(base.replace(/#.*$/, '') + url.slice(url.indexOf('#')), { waitUntil: 'load' });
  await p3.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  const planB = await p3.evaluate(() => window.viz.getPlan());
  check(canon(planA) === canon(planB) && errs3.length === 0, 'edit mode: share link reproduces the edited plan in a fresh browser context');
  await ctx.close();
  // compaction keeps the plan identical
  const cmp = await page.evaluate(async () => {
    const m = await import('./js/scenarios.js');
    const s = window.viz.getScenario();
    const raw = [{ op: 'moveItem', id: 'garage-fiets-1', pos: [500, 90] }, { op: 'moveItem', id: 'garage-fiets-1', pos: [505, 95], rot: 90 }, { op: 'addItem', item: { id: 'x-kast', type: 'tall', room: 'garage', pos: [100, 100], size: [60, 60, 200] } }, { op: 'moveItem', id: 'x-kast', pos: [120, 100] }, { op: 'resizeItem', id: 'x-kast', size: [40, 60, 200] }, { op: 'addItem', item: { id: 'y', type: 'plant', room: 'garage', pos: [50, 50], size: [30, 30, 80] } }, { op: 'removeItem', id: 'y' }, { op: 'updateItem', id: 'garage-fiets-2', set: { color: '#111' } }, { op: 'updateItem', id: 'garage-fiets-2', set: { label: 'X' } }];
    const c = m.compactPatches(raw);
    return { n: raw.length, c: c.length };
  });
  check(cmp.c === 3, `patch compaction folds edits (${cmp.n} → ${cmp.c} ops)`);
  check(errs.length === 0, 'no JS errors in edit mode ' + (errs.length ? JSON.stringify(errs) : ''));
  await page.close();

  // phone: touch drag
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const pp = await pctx.newPage();
  const perrs = []; pp.on('pageerror', (e) => perrs.push(e.message));
  await pp.goto(base + '?view=garage', { waitUntil: 'load' });
  await pp.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  await pp.tap('#tEdit');
  await pp.waitForFunction(() => window.viz.idle(), null, { timeout: 60000 });
  const id = 'garage-schoenenkast';
  const t0 = await pp.evaluate((id) => window.viz.getPlan().items.find((i) => i.id === id).pos, id);
  const tp = await pp.evaluate((id) => window.viz.screenPos(id), id);
  const cdp = await pctx.newCDPSession(pp);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await touch('touchStart', tp.x, tp.y);
  for (let k = 1; k <= 10; k++) { await touch('touchMove', tp.x + k * 4, tp.y + k * 2); await pp.waitForTimeout(30); }
  await touch('touchEnd');
  await pp.waitForTimeout(500);
  const t1 = await pp.evaluate((id) => ({ pos: window.viz.getPlan().items.find((i) => i.id === id).pos, sel: window.viz.editor.selected(), bar: !document.querySelector('#editBar').hidden }), id);
  check(t1.sel === id && (t1.pos[0] !== t0[0] || t1.pos[1] !== t0[1]) && t1.bar, `edit mode (phone): touch drag selects and moves the shoe cabinet (${t0} → ${t1.pos})`);
  check(perrs.length === 0, 'no JS errors in phone edit mode ' + (perrs.length ? JSON.stringify(perrs) : ''));
  await pctx.close();
}
await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
