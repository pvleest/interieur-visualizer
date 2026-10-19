// Renders edit-mode screenshots (UI visible): selection panel with a warning, and the Toevoegen catalogue.
import { chromium } from 'playwright-core';
const base = process.argv[2] || 'http://localhost:8765/';
const out = process.argv[3] || 'docs/renders';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
async function shot(name, viewport, view, fn, opts = {}) {
  const ctx = await b.newContext({ viewport, deviceScaleFactor: opts.dpr || 1.5, hasTouch: !!opts.touch, isMobile: !!opts.touch });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('ERR', e.message));
  await p.goto(base + '?view=' + view); await p.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  await p.click('#tEdit'); await p.waitForFunction(() => window.viz.idle(), null, { timeout: 90000 });
  await fn(p);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/${name}` });
  console.log('wrote', name);
  await ctx.close();
}
const W = { width: 1440, height: 900 };
await shot('23-bewerken-selectie.png', W, 'garage', async (p) => {
  await p.evaluate(() => window.viz.editor.selectById('garage-schoenenbank'));
  await p.waitForTimeout(500);
  const sp = await p.evaluate(() => window.viz.screenPos('garage-schoenenbank'));
  await p.mouse.move(sp.x, sp.y); await p.mouse.down();
  for (let i = 1; i <= 10; i++) await p.mouse.move(sp.x + i * 6, sp.y - i * 9);
  await p.mouse.up();
  await p.waitForFunction(() => window.viz.idle(), null, { timeout: 60000 });
});
await shot('24-bewerken-toevoegen.png', W, 'keuken', async (p) => {
  await p.click('#edAdd');
});
await shot('25-bewerken-telefoon.png', { width: 390, height: 844 }, 'bijkeuken', async (p) => {
  const ids = await p.evaluate(() => window.viz.getPlan().items.filter((i) => i.room === 'bijkeuken' && /kast/.test(i.id)).map((i) => i.id));
  await p.evaluate((id) => window.viz.editor.selectById(id), ids[0]);
}, { touch: true, dpr: 2 });
await b.close();
