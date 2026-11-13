// Screenshot helper: node shot.mjs <city-slug> out.png '{"theme":"vc","hour":22,"season":"winter","weather":"snow","view":[cx,cy,s],"wait":2500,"click":[wx,wy]}'
import { chromium } from 'playwright';
import path from 'node:path';
const [slug, out, json = '{}'] = process.argv.slice(2);
const o = JSON.parse(json);
const b = await chromium.launch({ args: ['--enable-gpu','--use-angle=metal','--ignore-gpu-blocklist','--enable-gpu-rasterization'] });
const p = await b.newPage({ viewport: { width: o.w || 1500, height: o.h || 900 } });
p.on('console', (m) => m.type() === 'error' && console.log('console error:', m.text()));
p.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
await p.addInitScript((t) => localStorage.setItem('gta-theme', t), o.theme || 'gta5');
await p.goto('file://' + path.resolve(process.env.HOME, 'Townyg', 'maps', slug, 'index.html'));
await p.waitForFunction(() => window.__gta);
await p.waitForTimeout(1200);
await p.evaluate((o) => {
  const g = window.__gta;
  if (o.season) { g.state.season = o.season; }
  if (o.weather) g.state.weather = o.weather;
  if (o.hour !== undefined) g.state.hour = o.hour;
  if (o.view) { g.view.cx = o.view[0]; g.view.cy = o.view[1]; g.view.s = o.view[2]; }
  g.render();
}, o);
if (o.click) {
  const pos = await p.evaluate(([wx, wy]) => { const g = window.__gta, r = document.querySelector('#stage').getBoundingClientRect(); return [(wx - g.view.cx) * g.view.s + r.width / 2, r.height / 2 - (wy - g.view.cy) * g.view.s]; }, o.click);
  await p.mouse.click(pos[0], pos[1]);
}
await p.waitForTimeout(o.wait || 2500);
await p.screenshot({ path: out });
console.log('sim:', JSON.stringify(await p.evaluate(() => ({ cars: window.__gta.sim.cars.length, buses: window.__gta.sim.buses.length, lines: window.__gta.sim.lines.map((l) => ({ len: Math.round(l.len), stops: l.stops.length })) }))));
await b.close();
