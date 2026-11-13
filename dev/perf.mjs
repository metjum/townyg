// Frame-time benchmark: node perf.mjs <slug> [theme]
import { chromium } from 'playwright'; import path from 'node:path';
const [slug, theme = 'gta5'] = process.argv.slice(2);
const b = await chromium.launch({ args: process.env.GPU ? ['--enable-gpu','--use-angle=metal','--ignore-gpu-blocklist','--enable-gpu-rasterization','--enable-zero-copy'] : [] }); const p = await b.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 2 });
p.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
await p.addInitScript((t) => localStorage.setItem('gta-theme', t), theme);
await p.goto('file://' + path.resolve('mapy', slug, 'index.html')); await p.waitForFunction(() => window.__gta); await p.waitForTimeout(1500);
console.log('stats', JSON.stringify(await p.evaluate(() => window.__gta.stats())));
async function bench(label, view, action) {
  await p.evaluate((v) => { const g = window.__gta; g.view.cx = v[0]; g.view.cy = v[1]; g.view.s = v[2]; g.render(); }, view); await p.waitForTimeout(900);
  await p.evaluate(() => { window.__ft = []; let last = performance.now(); const tick = (t) => { window.__ft.push(t - last); last = t; if (window.__ftOn) requestAnimationFrame(tick); }; window.__ftOn = true; requestAnimationFrame(tick); });
  await action(); await p.evaluate(() => { window.__ftOn = false; }); await p.waitForTimeout(100);
  const r = await p.evaluate(() => { const f = window.__ft.slice(2).sort((a, b) => a - b); const avg = f.reduce((a, b) => a + b, 0) / f.length; return { n: f.length, avg: +avg.toFixed(1), p95: +f[Math.floor(f.length * 0.95)].toFixed(1), max: +f[f.length - 1].toFixed(1) }; });
  console.log(label.padEnd(26), JSON.stringify(r), `≈${(1000 / r.avg).toFixed(0)} fps`);
}
const drag = async () => { await p.mouse.move(500, 450); await p.mouse.down(); for (let i = 0; i < 60; i++) { await p.mouse.move(500 + i * 6, 450 + i * 3); await p.waitForTimeout(8); } await p.mouse.up(); };
const wheel = async () => { await p.mouse.move(600, 450); for (let i = 0; i < 25; i++) { await p.mouse.wheel(0, i < 12 ? -120 : 120); await p.waitForTimeout(20); } };
const idle = async () => { await p.waitForTimeout(1500); };
for (const [name, v] of [['celé město', [0, 0, 0.14]], ['střed zoom 1.0', [0, 0, 1.0]], ['zoom 3 (3D, cedule)', [0, 0, 3.0]]]) { await bench(name + ' idle', v, idle); await bench(name + ' drag', v, drag); await bench(name + ' wheel', v, wheel); }
await b.close();
