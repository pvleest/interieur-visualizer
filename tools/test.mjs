// Headless smoke + walk + scenario tests.
// Usage: node tools/test.mjs [baseUrl]   (needs playwright-core + Chrome; CHROME env to override path)
import { chromium } from 'playwright-core';
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
  const r = await WALK(page, [430, 610], [[235, 460], [235, 250], [100, 212], [-100, 212], [-200, 248], [-420, 248], [-560, 200]]);
  console.log('  visited:', r.visited.join(' -> '), ' end:', JSON.stringify(r.end));
  check(JSON.stringify(r.visited) === JSON.stringify(['keuken', 'garage', 'bijkeuken', 'slaapkamer']), 'walk path visits keuken -> garage -> bijkeuken -> slaapkamer');
  check(Math.hypot(r.end.x + 560, r.end.z - 200) < 5, 'walk reaches the target point in the bedroom');
  // and back again
  const back = await WALK(page, [-560, 200], [[-420, 248], [-200, 248], [-100, 212], [100, 212], [235, 250], [235, 460], [430, 610]]);
  check(JSON.stringify(back.visited) === JSON.stringify(['slaapkamer', 'bijkeuken', 'garage', 'keuken']), 'walk back slaapkamer -> keuken (' + back.visited.join(' -> ') + ')');
  // 2. exterior / living-room openings
  const living = await WALK(page, [520, 600], [[520, 760]]);
  check(living.end.z > 740, 'keuken -> woonkamer opening is walkable');
  const slider = await WALK(page, [-170, 250], [[-170, 420]]);
  check(slider.end.z > 400, 'bijkeuken schuifpui is walkable');
  const gdoor = await WALK(page, [-485, 250], [[-485, 420]]);
  check(gdoor.end.z > 400, 'slaapkamer tuindeur is walkable');
  // 3. walls still block
  const wall = await WALK(page, [400, 200], [[400, -200]]);
  check(wall.end.z > 0, 'garage north wall blocks (z=' + wall.end.z.toFixed(0) + ')');
  const wall2 = await WALK(page, [450, 450], [[450, 200]]);
  check(wall2.end.z > 330, 'kitchen-garage wall blocks outside the door (z=' + wall2.end.z.toFixed(0) + ')');
  // 4. real keyboard: from the kitchen, facing north (yaw 0), hold W
  await page.evaluate(() => window.viz.setPose(235, 470, 0));
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.viz.position().room === 'garage' && window.viz.position().z < 280, null, { timeout: 30000 }).catch(() => {});
  await page.keyboard.up('KeyW');
  const kp = await page.evaluate(() => window.viz.position());
  check(kp.room === 'garage', 'keyboard W walks from kitchen into garage (room=' + kp.room + ', z=' + kp.z.toFixed(0) + ')');
  await page.evaluate(() => window.viz.stopWalk());

  // 5. scenarios + edit API
  const list = await page.evaluate(() => window.viz.listScenarios().map((s) => s.name));
  check(list.includes('Basisontwerp') && list.includes('Licht & warm') && list.includes('Donker & strak'), 'scenario list: ' + list.join(', '));
  await page.evaluate(() => window.viz.loadScenario('repo:donker-strak'));
  const pal = await page.evaluate(() => window.viz.getPlan().palette);
  check(pal.frontBase === 'antraciet' && pal.worktop === 'zwartComposiet' && pal.floorExtension === 'betonDonker', 'Donker & strak palette applied');
  const e1 = await page.evaluate(() => window.viz.applyEdit({ op: 'moveItem', id: 'keuken-ronde-tafel-80', by: [0, -20] }));
  const tpos = await page.evaluate(() => window.viz.getPlan().items.find((i) => i.id === 'keuken-ronde-tafel-80').pos);
  check(e1.ok && tpos[1] === 555, 'applyEdit moveItem works (pos ' + tpos + ')');
  const e2 = await page.evaluate(() => window.viz.applyEdit([{ op: 'removeItem', id: 'bijkeuken-plant' }, { op: 'addItem', item: { id: 'slaapkamer-plant', type: 'plant', room: 'slaapkamer', pos: [-740, 290], size: [40, 40, 110] } }, { op: 'updateOpening', wall: 'keuken-gevel', index: 0, set: { sill: 60 } }]));
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
