import { chromium } from 'playwright-core';
const base = process.argv[2] || 'http://localhost:8765/';
const out = process.argv[3] || '/workspace/interieur/renders';
const only = process.argv[4];
const shots = [
  ['01-overzicht', 'view=overzicht&labels=0'],
  ['02-keuken', 'view=keuken&labels=0'],
  ['03-garage', 'view=garage&labels=0'],
  ['04-bijkeuken', 'view=bijkeuken&labels=0'],
  ['05-slaapkamer', 'view=slaapkamer&labels=0'],
  ['06-plattegrond-labels', 'view=plattegrond&labels=1'],
].filter(s => !only || only.split(',').includes(s[0]));
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const W = Number(process.env.W || 1600), H = Number(process.env.H || 1000);
const dpr = Number(process.env.DPR || 1);
for (const [name, q] of shots) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: dpr });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
  await page.goto(`${base}?ui=0&dpr=${dpr}&${q}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(name, errs.length ? errs : 'ok');
  await page.close();
}
await browser.close();
