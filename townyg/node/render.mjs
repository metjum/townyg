// Renders one poster PNG per style: node render.mjs <mapy/city dir> style1,style2,...
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const [dir, list] = process.argv.slice(2);
const styles = list.split(',');
const out = path.join(dir, 'plakaty');
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
p.on('pageerror', (e) => console.log('chyba stránky:', e.message));
await p.goto('file://' + path.resolve(dir, 'index.html'));
await p.waitForFunction(() => window.__gta, null, { timeout: 30000 });
await p.waitForTimeout(1500);
let i = 0;
for (const s of styles) {
  i++;
  const t0 = Date.now();
  try {
    const data = await p.evaluate((s) => window.__gta.posterData(s, { season: 'summer', hour: 14 }), s);
    const file = path.join(out, `${s}.png`);
    fs.writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
    console.log(`plakát ${i}/${styles.length}: ${s} ✓ ${(fs.statSync(file).size / 1e6).toFixed(1)} MB (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (e) { console.log(`plakát ${s} selhal: ${e.message}`); }
}
await b.close();
