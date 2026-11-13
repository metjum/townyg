/* GTA-style map renderer (canvas). Data: window.MAPDATA from make.py */
(() => {
'use strict';
const D = window.MAPDATA;
const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const FONT = '"Oswald","Arial Narrow",Impact,sans-serif';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash1 = (i) => ((Math.imul(i + 1, 2654435761) >>> 0) % 10000) / 10000;

/* ------------------------------------------------------------------ colour utils */
function hex2rgb(h) { h = h.replace('#', ''); if (h.length === 3) h = h.replace(/./g, (c) => c + c); const n = parseInt(h, 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function rgb2hex(r) { return '#' + r.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join(''); }
const mixCache = new Map();
function mix(a, b, t) { const k = a + b + t; let r = mixCache.get(k); if (r) return r; const A = hex2rgb(a), B = hex2rgb(b); r = rgb2hex(A.map((v, i) => v + (B[i] - v) * t)); mixCache.set(k, r); return r; }

/* ------------------------------------------------------------------ spatial grid */
class Grid {
  constructor(cell, n) { this.cell = cell; this.m = new Map(); this.seen = new Int32Array(n || 1); this.q = 0; }
  k(ix, iy) { return (ix + 4096) * 8192 + (iy + 4096); }
  add(i, x0, y0, x1, y1) { const c = this.cell, ax = Math.floor(x0 / c), bx = Math.floor(x1 / c), ay = Math.floor(y0 / c), by = Math.floor(y1 / c); for (let iy = ay; iy <= by; iy++) for (let ix = ax; ix <= bx; ix++) { const k = this.k(ix, iy); let a = this.m.get(k); if (!a) this.m.set(k, (a = [])); a.push(i); } }
  query(x0, y0, x1, y1, out) { out.length = 0; const c = this.cell, q = ++this.q, ax = Math.floor(x0 / c), bx = Math.floor(x1 / c), ay = Math.floor(y0 / c), by = Math.floor(y1 / c); for (let iy = ay; iy <= by; iy++) for (let ix = ax; ix <= bx; ix++) { const a = this.m.get(this.k(ix, iy)); if (!a) continue; for (let j = 0; j < a.length; j++) { const i = a[j]; if (this.seen[i] !== q) { this.seen[i] = q; out.push(i); } } } return out; }
}

/* ------------------------------------------------------------------ themes (one per game) */
const ROAD = { path: [1.3, 0.9], track: [2.6, 1.1], service: [3.8, 1.3], minor: [6, 2.0], tert: [7.5, 2.4], second: [9, 2.8], major: [11, 3.4] };
const ROAD_ORDER = ['path', 'track', 'service', 'minor', 'tert', 'second', 'major'];
const THEMES = {
  gta5: {
    name: 'GTA V', desc: 'Atlas', outside: '#9db8cf', land: '#e6dcc2', farm: '#ece3c4', grass: '#d3dba9', orchard: '#cdd8a0', scrub: '#bfcf9b',
    wetland: '#b9d1b0', forest: '#a8c38a', town: '#dcd2bb', industrial: '#cfcac2', quarry: '#d6c8ae', rock: '#c9bfae', park: '#b6d398',
    cemetery: '#c1cfad', sport: '#c3dba6', parking: '#d9d5cc', water: '#7aa8d0', waterLine: '#5f93be', waterText: '#35628f',
    roof: '#d2c8b1', side: '#aea48f', sideDark: '#8f8671', bstroke: '#948b77', church: '#e0b86a', shadow: 'rgba(70,55,30,.25)',
    major: '#f7c765', majorCase: '#a8782a', second: '#fff1c4', secondCase: '#a79c80', tert: '#ffffff', tertCase: '#aaa28c',
    minor: '#fdfaf0', minorCase: '#b9b19c', service: '#f4f0e4', serviceCase: '#c9c1ae', track: '#c9b27c', path: '#a98f62',
    rail: '#7b7b7b', text: '#3a372f', halo: 'rgba(255,255,255,.88)', place: '#4a463c', placeHalo: 'rgba(255,255,255,.85)', reserve: '#5d9a45', reliefA: 0.62,
    centerLine: 'rgba(200,150,40,.9)', route: '#e04fd3', ext: 1, nightA: 0.62, nightC: [10, 18, 52], busColor: '#f2c230', busLine: '#3f7de0',
    cars: ['#d8d8d8', '#2b2f36', '#b53a32', '#3a5f9b', '#e9e5da', '#6f7a85', '#2f6f4f'], tree: 'round', shore: '#d6ecf7', coast: '#3d5870', wave: 'rgba(255,255,255,.14)',
    placeFont: '700 {px}px Oswald', fx: { vig: 0.28, grain: 0.05 },
    ui: { accent: '#f1c232', ink: '#000', display: "'Anton'", panel: 'rgba(12,14,18,.92)', skew: '-6deg', fill: '#fff' },
  },
  radar: {
    name: 'GTA V', desc: 'Radar (night)', dark: true, outside: '#0a0d12', land: '#222a36', farm: '#262e3a', grass: '#27342f', orchard: '#2a3830', scrub: '#243630',
    wetland: '#22363a', forest: '#1f3b35', town: '#2c3342', industrial: '#2d323c', quarry: '#323640', rock: '#343944', park: '#27413a',
    cemetery: '#27382f', sport: '#2a4540', parking: '#2f3441', water: '#1c4468', waterLine: '#2a5f8c', waterText: '#78b3e3',
    roof: '#3b4457', side: '#2b3243', sideDark: '#1d2330', bstroke: '#4a5469', church: '#7a6a3d', shadow: 'rgba(0,0,0,.4)',
    major: '#b88a3c', majorCase: '#0c0e12', second: '#7d8aa3', secondCase: '#0c0e12', tert: '#68758d', tertCase: '#0c0e12',
    minor: '#56627a', minorCase: '#0c0e12', service: '#454f64', serviceCase: '#0c0e12', track: '#59513c', path: '#6a6048',
    rail: '#8890a0', text: '#d3dbe8', halo: 'rgba(10,13,18,.85)', place: '#c3cddd', placeHalo: 'rgba(8,10,14,.85)', reserve: '#4fa07f', reliefA: 0.5,
    centerLine: 'rgba(235,200,110,.75)', route: '#ff5de6', ext: 0.8, nightA: 0.28, nightC: [4, 8, 30], busColor: '#d9a830', busLine: '#6fa2ff',
    cars: ['#c9ced8', '#8a93a6', '#c0453c', '#5b86c9', '#d9d2b8'], tree: 'round', shore: '#1d3b57', coast: '#3a6a96', wave: 'rgba(120,170,220,.08)',
    placeFont: '700 {px}px Oswald', fx: { vig: 0.4, grain: 0.04 },
    ui: { accent: '#f1c232', ink: '#000', display: "'Anton'", panel: 'rgba(12,14,18,.92)', skew: '-6deg', fill: '#fff' },
  },
  sat: {
    name: 'GTA V', desc: 'Satellite', outside: '#1d3a52', land: '#9a9468', farm: '#b1a661', grass: '#86a057', orchard: '#7d9a4f', scrub: '#6b8a4a',
    wetland: '#5f8460', forest: '#476b3b', town: '#8d8776', industrial: '#8a867d', quarry: '#a09474', rock: '#968d7c', park: '#6f9a4e',
    cemetery: '#6d8a58', sport: '#7bab55', parking: '#8c8a84', water: '#3d7095', waterLine: '#2f6288', waterText: '#cfe6f6',
    roof: '#b2765f', side: '#8a5a49', sideDark: '#6a4337', bstroke: '#6e4a3d', church: '#d7c58a', shadow: 'rgba(15,20,10,.38)',
    major: '#b9b6ad', majorCase: '#4e4c47', second: '#a9a69d', secondCase: '#4e4c47', tert: '#9c9990', tertCase: '#55534e',
    minor: '#93908a', minorCase: '#5b5954', service: '#85827c', serviceCase: '#625f5a', track: '#bfae7a', path: '#c9b98a',
    rail: '#4a4a4a', text: '#ffffff', halo: 'rgba(15,25,12,.78)', place: '#ffffff', placeHalo: 'rgba(10,18,8,.8)', reserve: '#cdeba0', reliefA: 0.8,
    centerLine: 'rgba(240,240,225,.75)', route: '#ff5de6', ext: 1, nightA: 0.6, nightC: [6, 12, 36], busColor: '#e9d64a', busLine: '#7fb2ff',
    cars: ['#e5e5e5', '#202327', '#a8332c', '#2f5b9b', '#cfc9b8'], tree: 'round', shore: '#2c5a7a', coast: '#0f2231', wave: 'rgba(160,210,240,.07)',
    roofs: ['#b2765f', '#a86a55', '#8f8a82', '#b88a6a', '#9a6a58'], placeFont: '700 {px}px Oswald', fx: { vig: 0.38, grain: 0.07 },
    ui: { accent: '#f1c232', ink: '#000', display: "'Anton'", panel: 'rgba(12,14,18,.92)', skew: '-6deg', fill: '#fff' },
  },
  sa: {
    name: 'San Andreas', desc: 'Radar', pixel: 0.5, outside: '#587fad', land: '#cdbf94', farm: '#d3c88f', grass: '#a3b46d', orchard: '#98ad65', scrub: '#8aa35f',
    wetland: '#86a676', forest: '#6a8b52', town: '#b9ab85', industrial: '#aaa191', quarry: '#b9a982', rock: '#a79d86', park: '#8fb25f',
    cemetery: '#91a876', sport: '#9bbd68', parking: '#aaa596', water: '#5f8ab8', waterLine: '#456f9c', waterText: '#eaf2fa',
    roof: '#8d8672', side: '#6f6a59', sideDark: '#59554a', bstroke: '#3f3b30', church: '#c4a05a', shadow: 'rgba(30,25,10,.38)',
    major: '#f0dc79', majorCase: '#2c2a20', second: '#f4f1e6', secondCase: '#2c2a20', tert: '#f4f1e6', tertCase: '#2c2a20',
    minor: '#e9e5d6', minorCase: '#3a372c', service: '#d9d4c2', serviceCase: '#4a4638', track: '#a8955f', path: '#8a7549',
    rail: '#333', text: '#1f1b10', halo: 'rgba(245,235,200,.9)', place: '#ffffff', placeHalo: '#000000', reserve: '#3f7a2a', reliefA: 0.3,
    centerLine: 'rgba(120,100,40,.6)', route: '#ff3b3b', ext: 0, nightA: 0.5, nightC: [30, 20, 50], busColor: '#e8c13a', busLine: '#3a63b8',
    cars: ['#f0ead8', '#2a2a2a', '#c4372c', '#3e63ab', '#e8b53a', '#3f8a52'], tree: 'round', shore: '#86a8cf', coast: '#1d3350', wave: 'rgba(255,255,255,.18)',
    placeFont: "400 {px}px 'Lilita One'", fx: { vig: 0.12, grain: 0 }, outlinePlace: true,
    ui: { accent: '#f0a500', ink: '#000', display: "'Lilita One'", panel: 'rgba(26,18,8,.93)', skew: '-4deg', fill: '#f6c93e' },
  },
  gta4: {
    name: 'GTA IV', desc: 'Liberty', outside: '#738a9a', land: '#b8b9b0', farm: '#bfc0b2', grass: '#a4b09a', orchard: '#9eab94', scrub: '#94a38b',
    wetland: '#8fa598', forest: '#8a9f80', town: '#a9aaa3', industrial: '#9c9d98', quarry: '#aaa89a', rock: '#a09f95', park: '#9bb08e',
    cemetery: '#9aa992', sport: '#a2b996', parking: '#a0a19d', water: '#7b97ad', waterLine: '#62829b', waterText: '#2e4a5f',
    roof: '#9a9c9a', side: '#7c7e7c', sideDark: '#5f6160', bstroke: '#5b5d5c', church: '#b49a62', shadow: 'rgba(20,22,25,.34)',
    major: '#e0a94a', majorCase: '#5a4a25', second: '#e8e8e2', secondCase: '#5f615e', tert: '#ececE6', tertCase: '#6b6d69',
    minor: '#dfdfd9', minorCase: '#74766f', service: '#cfcfc8', serviceCase: '#85877f', track: '#a29b80', path: '#8c8467',
    rail: '#555', text: '#1d1f21', halo: 'rgba(235,236,230,.88)', place: '#25282b', placeHalo: 'rgba(230,232,226,.85)', reserve: '#5a8250', reliefA: 0.5,
    centerLine: 'rgba(210,170,70,.8)', route: '#ff5a36', ext: 1.5, nightA: 0.6, nightC: [10, 14, 30], busColor: '#d8b640', busLine: '#3b6fb5',
    cars: ['#c9cbc9', '#25282b', '#8e332d', '#2e4f7f', '#b8b4a4'], tree: 'round', shore: '#a7bbc9', coast: '#30404c', wave: 'rgba(255,255,255,.1)',
    placeFont: '400 {px}px "Bebas Neue"', fx: { vig: 0.42, grain: 0.1 },
    ui: { accent: '#dcdcdc', ink: '#000', display: "'Bebas Neue'", panel: 'rgba(18,20,22,.94)', skew: '0deg', fill: '#fff' },
  },
  vc: {
    name: 'Vice City', desc: 'Neon', pixel: 0.75, outside: '#2bb6c4', land: '#f7dcc9', farm: '#fbe6c8', grass: '#d4ebc0', orchard: '#c3e6b8', scrub: '#b8e2bc',
    wetland: '#a9e0d0', forest: '#79d3c0', town: '#f2c9c4', industrial: '#e3cdd2', quarry: '#efd4b8', rock: '#e0cbc3', park: '#a6e6c0',
    cemetery: '#c3e3c4', sport: '#9fe8c4', parking: '#e8d4d6', water: '#4fc9d3', waterLine: '#2aa9b8', waterText: '#0e6a78',
    roof: '#f6b1c6', side: '#d98aa4', sideDark: '#b96b88', bstroke: '#b05f80', church: '#ffe08a', shadow: 'rgba(120,40,90,.3)',
    major: '#ffe27a', majorCase: '#d4568b', second: '#ffffff', secondCase: '#e07aa5', tert: '#ffffff', tertCase: '#e58db0',
    minor: '#fff7fb', minorCase: '#eba4c0', service: '#fdeaf2', serviceCase: '#f0b8cc', track: '#e6b98a', path: '#d49b6a',
    rail: '#9b6b8a', text: '#9a1f5b', halo: 'rgba(255,255,255,.92)', place: '#e0307a', placeHalo: 'rgba(255,255,255,.95)', reserve: '#1e9a6a', reliefA: 0.3,
    centerLine: 'rgba(255,120,170,.8)', route: '#00c8ff', ext: 0.9, nightA: 0.55, nightC: [44, 8, 70], busColor: '#7ff2ff', busLine: '#e0378a',
    cars: ['#ff7ac6', '#7ff2ff', '#ffffff', '#ffd45a', '#a98cff', '#ff9d6b'], tree: 'palm', shore: '#8defe6', coast: '#d4568b', wave: 'rgba(255,255,255,.28)',
    roofs: ['#f6b1c6', '#8fe0dc', '#ffe08a', '#c9b3f0', '#ffc2a0'], placeFont: "400 {px}px 'Pacifico'", fx: { vig: 0.18, grain: 0 },
    ui: { accent: '#ff4fa3', ink: '#fff', display: "'Pacifico'", panel: 'rgba(36,10,44,.93)', skew: '0deg', fill: '#fff' },
  },
};
THEMES.radar.signBg = '#10161f'; THEMES.radar.signInk = '#e9eff8'; THEMES.sa.signBg = '#fff0a8'; THEMES.vc.signInk = '#9a1f5b'; THEMES.sat.signBg = 'rgba(255,255,255,.93)';
const THEME_ORDER = ['gta5', 'radar', 'sat', 'sa', 'gta4', 'vc'];
const SEASONS = { spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter' };
const WEATHERS = { clear: 'Clear', rain: 'Rain', snow: 'Snow', fog: 'Fog' };
const derived = {};
function deriveTheme(base, season) {
  const key = base.name + base.desc + season; if (derived[key]) return derived[key];
  const t = { ...base, name: key }; const M = (k, c, a) => { t[k] = mix(t[k], c, a); };
  if (season === 'spring') { for (const k of ['forest', 'grass', 'park', 'orchard', 'scrub', 'sport']) M(k, '#9fe05a', 0.16); M('farm', '#c9d96a', 0.12); }
  if (season === 'autumn') { M('forest', '#c26a1c', 0.5); M('grass', '#c8a23a', 0.4); M('park', '#cf8a2e', 0.38); M('orchard', '#d09a38', 0.35); M('scrub', '#b0702a', 0.45); M('farm', '#b99a55', 0.3); M('sport', '#9db04a', 0.2); M('wetland', '#a89a5a', 0.3); M('cemetery', '#a89a58', 0.25); }
  if (season === 'winter') {
    const a = base.dark ? 0.34 : 0.72;
    for (const k of ['land', 'farm', 'grass', 'orchard', 'scrub', 'wetland', 'park', 'cemetery', 'sport', 'town', 'industrial', 'rock', 'quarry', 'parking']) M(k, '#f2f6fa', a);
    M('forest', '#dfe9f0', base.dark ? 0.25 : 0.5); M('water', '#cfe2ee', 0.4); M('waterLine', '#9fc0d6', 0.4); M('roof', '#ffffff', base.dark ? 0.2 : 0.55);
    if (t.roofs) t.roofs = t.roofs.map((r) => mix(r, '#ffffff', 0.55)); t.reliefA = Math.min(1, t.reliefA * 1.15);
  }
  return (derived[key] = t);
}

/* ------------------------------------------------------------------ blip kinds */
const KINDS = {
  radnice: { label: 'Town hall / office', color: '#3f7de0', g: 'star', imp: 3 },
  policie: { label: 'Police', color: '#2f6fe4', g: 'star', imp: 3 },
  hasici: { label: 'Fire station', color: '#e5392f', g: 'flame', imp: 3 },
  zdravi: { label: 'Health', color: '#e5392f', g: 'cross', imp: 2 },
  lekarna: { label: 'Pharmacy', color: '#3cb371', g: 'cross', imp: 1 },
  skola: { label: 'School', color: '#f0a63a', g: 'S', imp: 2 },
  knihovna: { label: 'Library', color: '#f0a63a', g: 'B', imp: 1 },
  posta: { label: 'Post office', color: '#ececec', g: 'mail', imp: 3, dark: true },
  banka: { label: 'Bank / ATM', color: '#3ca55c', g: '$', imp: 1 },
  benzina: { label: 'Gas station', color: '#f08a24', g: 'pump', imp: 3 },
  jidlo: { label: 'Food & drink', color: '#e8702a', g: 'fork', imp: 2 },
  obchod: { label: 'Shop', color: '#3ca55c', g: '$', imp: 2 },
  kostel: { label: 'Church', color: '#9a74d6', g: 'church', imp: 3 },
  zricenina: { label: 'Castle / ruins', color: '#f2c230', g: 'castle', imp: 4, dark: true },
  vyhlidka: { label: 'Viewpoint', color: '#2fb6c9', g: 'eye', imp: 2 },
  ubytovani: { label: 'Lodging', color: '#c26bd8', g: 'H', imp: 2 },
  muzeum: { label: 'Museum', color: '#f2c230', g: 'M', imp: 2, dark: true },
  zajimavost: { label: 'Attraction', color: '#f2c230', g: 'star', imp: 2, dark: true },
  pamatka: { label: 'Monument', color: '#9aa3ad', g: 'dot', imp: 1 },
  sport: { label: 'Sports', color: '#3cb371', g: 'ball', imp: 1 },
  vrchol: { label: 'Peak', color: '#a9754a', g: 'peak', imp: 2 },
  vlak: { label: 'Station', color: '#3f7de0', g: 'T', imp: 3 },
  kancelar: { label: 'Company / office', color: '#6e7fd1', g: 'F', imp: 1 },
  remeslo: { label: 'Trade / services', color: '#d1893f', g: 'R', imp: 1 },
  bus: { label: 'Bus stop', color: '#3f7de0', g: 'bus', imp: 1 },
};
function glyph(ctx, g, r, dark) {
  const f = dark ? '#111' : '#fff';
  ctx.fillStyle = f; ctx.strokeStyle = f; ctx.lineWidth = r * 0.22; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const u = r * 0.58;
  switch (g) {
    case 'star': { ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? u * 0.45 : u * 1.15; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); ctx.fill(); break; }
    case 'cross': { const w = u * 0.42; ctx.fillRect(-w, -u, w * 2, u * 2); ctx.fillRect(-u, -w, u * 2, w * 2); break; }
    case 'church': { const w = u * 0.3; ctx.fillRect(-w, -u * 1.15, w * 2, u * 2.3); ctx.fillRect(-u * 0.8, -u * 0.5, u * 1.6, w * 2); break; }
    case 'flame': { ctx.beginPath(); ctx.moveTo(0, -u * 1.2); ctx.bezierCurveTo(u * 1.1, -u * 0.2, u * 0.9, u * 1.1, 0, u * 1.1); ctx.bezierCurveTo(-u * 0.9, u * 1.1, -u * 1.1, -u * 0.1, 0, -u * 1.2); ctx.fill(); break; }
    case 'pump': { ctx.fillRect(-u * 0.8, -u, u * 1.1, u * 2); ctx.beginPath(); ctx.moveTo(u * 0.4, -u * 0.5); ctx.lineTo(u * 0.95, -u * 0.1); ctx.lineTo(u * 0.95, u * 0.7); ctx.stroke(); break; }
    case 'fork': { ctx.beginPath(); ctx.moveTo(-u * 0.5, -u); ctx.lineTo(-u * 0.5, u); ctx.moveTo(u * 0.5, -u); ctx.lineTo(u * 0.5, u); ctx.moveTo(-u * 0.5, -u * 0.2); ctx.lineTo(u * 0.5, -u * 0.2); ctx.stroke(); break; }
    case 'castle': { ctx.beginPath(); ctx.moveTo(-u, u); ctx.lineTo(-u, -u * 0.7); ctx.lineTo(-u * 0.5, -u * 0.7); ctx.lineTo(-u * 0.5, -u * 0.25); ctx.lineTo(-u * 0.15, -u * 0.25); ctx.lineTo(-u * 0.15, -u * 0.7); ctx.lineTo(u * 0.15, -u * 0.7); ctx.lineTo(u * 0.15, -u * 0.25); ctx.lineTo(u * 0.5, -u * 0.25); ctx.lineTo(u * 0.5, -u * 0.7); ctx.lineTo(u, -u * 0.7); ctx.lineTo(u, u); ctx.closePath(); ctx.fill(); break; }
    case 'eye': { ctx.beginPath(); ctx.ellipse(0, 0, u * 1.15, u * 0.7, 0, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, u * 0.32, 0, Math.PI * 2); ctx.fill(); break; }
    case 'peak': { ctx.beginPath(); ctx.moveTo(-u * 1.1, u * 0.8); ctx.lineTo(-u * 0.2, -u * 0.9); ctx.lineTo(u * 0.35, -u * 0.05); ctx.lineTo(u * 0.7, -u * 0.5); ctx.lineTo(u * 1.2, u * 0.8); ctx.closePath(); ctx.fill(); break; }
    case 'mail': { ctx.strokeRect(-u, -u * 0.7, u * 2, u * 1.4); ctx.beginPath(); ctx.moveTo(-u, -u * 0.7); ctx.lineTo(0, u * 0.1); ctx.lineTo(u, -u * 0.7); ctx.stroke(); break; }
    case 'bus': { ctx.fillRect(-u, -u * 0.8, u * 2, u * 1.4); ctx.beginPath(); ctx.arc(-u * 0.5, u * 0.75, u * 0.25, 0, 7); ctx.arc(u * 0.5, u * 0.75, u * 0.25, 0, 7); ctx.fill(); break; }
    case 'ball': { ctx.beginPath(); ctx.arc(0, 0, u * 0.95, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-u * 0.95, 0); ctx.lineTo(u * 0.95, 0); ctx.stroke(); break; }
    case 'dot': { ctx.beginPath(); ctx.arc(0, 0, u * 0.5, 0, 7); ctx.fill(); break; }
    default: { ctx.font = `700 ${r * 1.25}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(g, 0, r * 0.06); }
  }
}
function blip(ctx, kind, x, y, r, extra) {
  const K = KINDS[kind] || KINDS.zajimavost;
  ctx.save(); ctx.translate(x, y);
  if (extra && extra.pulse) { ctx.beginPath(); ctx.arc(0, 0, r * (1.4 + extra.pulse * 1.6), 0, 7); ctx.strokeStyle = `rgba(255,255,255,${0.9 * (1 - extra.pulse)})`; ctx.lineWidth = 2.5; ctx.stroke(); }
  ctx.beginPath(); ctx.arc(0, 0, r + 1.8, 0, 7); ctx.fillStyle = '#0b0c0f'; ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fillStyle = K.color; ctx.fill();
  glyph(ctx, K.g, r, K.dark);
  ctx.restore();
}

/* ------------------------------------------------------------------ geometry / extents */
const HW = D.halfW || D.half, HH = D.halfH || D.half;
const REL = D.relief;
function ringsBBox(rings) { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const r of rings) for (let k = 0; k < r.length; k += 2) { if (r[k] < x0) x0 = r[k]; if (r[k] > x1) x1 = r[k]; if (r[k + 1] < y0) y0 = r[k + 1]; if (r[k + 1] > y1) y1 = r[k + 1]; } return [x0, y0, x1, y1]; }
function inRings(x, y, rings) { let inside = false; for (const r of rings) for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) { const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside; } return inside; }
const polyArea = (p) => { let a = 0; for (let k = 0; k < p.length; k += 2) { const k2 = (k + 2) % p.length; a += p[k] * p[k2 + 1] - p[k2] * p[k + 1]; } return Math.abs(a) / 2; };

/* rasters: city mask + land-cover class map (cheap point lookups for huge polygons) */
const RCELL = Math.max(3, Math.ceil(Math.max(2 * HW, 2 * HH) / 3000)), RW = Math.ceil(2 * HW / RCELL) + 1, RH = Math.ceil(2 * HH / RCELL) + 1;
function makeRaster(draw) { const c = document.createElement('canvas'); c.width = RW; c.height = RH; const x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingEnabled = false; x.setTransform(1 / RCELL, 0, 0, -1 / RCELL, HW / RCELL, HH / RCELL); draw(x); return x.getImageData(0, 0, RW, RH).data; }
const CITY = D.boundary && D.boundary.length ? makeRaster((x) => { x.fillStyle = '#000'; x.beginPath(); for (const r of D.boundary) { x.moveTo(r[0], r[1]); for (let k = 2; k < r.length; k += 2) x.lineTo(r[k], r[k + 1]); x.closePath(); } x.fill(); }) : null;
const inCity = (x, y) => { if (!CITY) return Math.abs(x) <= HW && Math.abs(y) <= HH; const ix = Math.floor((x + HW) / RCELL), iy = Math.floor((HH - y) / RCELL); if (ix < 0 || iy < 0 || ix >= RW || iy >= RH) return false; return CITY[(iy * RW + ix) * 4 + 3] > 40; };
const COVER = ['forest', 'park', 'orchard', 'scrub', 'cemetery'];
const COVERMAP = makeRaster((x) => { COVER.forEach((cls, i) => { x.fillStyle = `rgb(${i + 1},0,0)`; for (const poly of (D.areas[cls] || [])) { x.beginPath(); for (const r of poly.p) { x.moveTo(r[0], r[1]); for (let k = 2; k < r.length; k += 2) x.lineTo(r[k], r[k + 1]); x.closePath(); } x.fill('evenodd'); } }); });
const coverAt = (x, y) => { const ix = Math.floor((x + HW) / RCELL), iy = Math.floor((HH - y) / RCELL); if (ix < 0 || iy < 0 || ix >= RW || iy >= RH) return 0; return COVERMAP[(iy * RW + ix) * 4]; };

function elevAt(x, y) {
  if (!REL) return null; const Gd = REL.hgrid; const gx = (x - REL.x0) / Gd.step, gy = (REL.y0 - y) / Gd.step;
  if (gx < 0 || gy < 0 || gx > Gd.w - 1 || gy > Gd.h - 1) return null;
  const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy, v = (a, b) => Gd.v[Math.min(b, Gd.h - 1) * Gd.w + Math.min(a, Gd.w - 1)];
  return v(ix, iy) * (1 - fx) * (1 - fy) + v(ix + 1, iy) * fx * (1 - fy) + v(ix, iy + 1) * (1 - fx) * fy + v(ix + 1, iy + 1) * fx * fy;
}

/* ------------------------------------------------------------------ data prep (indexes) */
const AREAS = D.areas; const AB = {}, GA = {};
for (const k of Object.keys(AREAS)) { AB[k] = AREAS[k].map((poly) => { const b = ringsBBox(poly.p); return { p: poly.p, x0: b[0], y0: b[1], x1: b[2], y1: b[3] }; }); GA[k] = new Grid(300, AB[k].length); AB[k].forEach((a, i) => GA[k].add(i, a.x0, a.y0, a.x1, a.y1)); }
const bboxed = (list) => list.map((o) => { const b = ringsBBox([o.p]); o.x0 = b[0]; o.y0 = b[1]; o.x1 = b[2]; o.y1 = b[3]; return o; });
const WATERS = bboxed(D.waters), CLIFFS = bboxed(D.cliffs), POWER = bboxed(D.power), RAILS = bboxed(D.rails), RESERVES = bboxed(D.reserves), TREEROWS = bboxed(D.treerows);
const BUILD = D.buildings.map((b, i) => {
  const p = b.p; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, cx = 0, cy = 0; const n = p.length / 2;
  for (let k = 0; k < p.length; k += 2) { if (p[k] < x0) x0 = p[k]; if (p[k] > x1) x1 = p[k]; if (p[k + 1] < y0) y0 = p[k + 1]; if (p[k + 1] > y1) y1 = p[k + 1]; cx += p[k]; cy += p[k + 1]; }
  return { p, h: b.h, c: b.c, n: b.n, t: b.t, a: b.a, l: b.l, x0, y0, x1, y1, cx: cx / n, cy: cy / n, v: hash1(i), id: i, area: 0 };
}).filter((b) => inCity(b.cx, b.cy)).sort((a, b) => b.cy - a.cy);
BUILD.forEach((b, i) => { b.id = i; });
const GB = new Grid(150, BUILD.length); BUILD.forEach((b, i) => GB.add(i, b.x0, b.y0, b.x1, b.y1));
const ROADS = D.roads.map((r, i) => {
  const p = r.p; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, len = 0;
  for (let k = 0; k < p.length; k += 2) { if (p[k] < x0) x0 = p[k]; if (p[k] > x1) x1 = p[k]; if (p[k + 1] < y0) y0 = p[k + 1]; if (p[k + 1] > y1) y1 = p[k + 1]; if (k) len += Math.hypot(p[k] - p[k - 2], p[k + 1] - p[k - 1]); }
  return { ...r, x0, y0, x1, y1, len, id: i };
});
const GR = new Grid(250, ROADS.length); ROADS.forEach((r, i) => GR.add(i, r.x0, r.y0, r.x1, r.y1));
const NAMED_ROADS = ROADS.filter((r) => r.n && r.len > 40 && ['major', 'second', 'tert', 'minor', 'service'].includes(r.c)).sort((a, b) => b.len - a.len);
const BNAMED = BUILD.filter((b) => b.n);
const POIS = D.pois.map((p, i) => ({ ...p, id: i })).filter((p) => inCity(p.x, p.y));
for (const p of POIS) { const c = []; GB.query(p.x - 1, p.y - 1, p.x + 1, p.y + 1, c); p.bld = null; for (const i of c) { const b = BUILD[i]; if (p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1 && inRings(p.x, p.y, [b.p])) { p.bld = b; break; } } }
const SIGN = { jidlo: 1, obchod: 1, benzina: 1, banka: 1, ubytovani: 1, kancelar: 1, remeslo: 1, posta: 1, lekarna: 1, zdravi: 1, skola: 1, knihovna: 1, muzeum: 1, radnice: 1, policie: 1, hasici: 1 };
const PEAKS = D.peaks, PLACES = D.places;
const reliefImg = new Image();
if (REL) { reliefImg.onload = () => { invalidate(); }; reliefImg.src = REL.img; }

/* building density (lamps + traffic concentration) */
const BG = new Map(); for (const b of BUILD) { const k = Math.floor(b.cx / 60) * 8192 + Math.floor(b.cy / 60); BG.set(k, (BG.get(k) || 0) + 1); }
const nearB = (x, y) => { let n = 0; const ix = Math.floor(x / 60), iy = Math.floor(y / 60); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) n += BG.get((ix + a) * 8192 + iy + b) || 0; return n; };

/* trees: generated lazily per cell from the land-cover raster */
const TCELL = 150, TCACHE = new Map();
const TSPEC = [[12, 0, 4.2], [13, 1, 3.6], [9, 2, 2.6], [10, 3, 2.2], [16, 1, 3.2]]; // per COVER index: spacing, kind, size
function treeCell(ix, iy) {
  const key = (ix + 4096) * 8192 + (iy + 4096); let t = TCACHE.get(key); if (t) return t; const out = [], r = rng((ix * 73856093) ^ (iy * 19349663));
  for (let ci = 0; ci < COVER.length; ci++) {
    const [sp, kind, size] = TSPEC[ci]; if (!(D.areas[COVER[ci]] || []).length) continue;
    for (let gy = iy * TCELL; gy < (iy + 1) * TCELL; gy += sp) for (let gx = ix * TCELL; gx < (ix + 1) * TCELL; gx += sp) {
      const jx = kind === 2 ? 0 : (r() - 0.5) * sp * 0.8, jy = kind === 2 ? 0 : (r() - 0.5) * sp * 0.8, x = gx + jx, y = gy + jy;
      if (coverAt(x, y) !== ci + 1 || !inCity(x, y)) continue; out.push(x, y, kind, size * (0.75 + r() * 0.6));
    }
  }
  TCACHE.set(key, (t = Float32Array.from(out))); if (TCACHE.size > 3000) TCACHE.delete(TCACHE.keys().next().value); return t;
}

/* street lamps + parked cars (point grids) */
const LAMPS = [], PARKED = [];
const GL = new Grid(200, 1), GP = new Grid(200, 1);
(function genRoadProps() {
  const r = rng(11), kinds = ['hatch', 'hatch', 'sedan', 'sedan', 'suv', 'van', 'pickup'];
  for (const rd of ROADS) {
    const lamp = ['major', 'second', 'tert', 'minor'].includes(rd.c) && !rd.t, park = ['minor', 'service', 'tert'].includes(rd.c) && !rd.t; if (!lamp && !park) continue;
    const hw = ROAD[rd.c][0] / 2 + 1.25; let accL = 18, accP = 4, side = 1;
    for (let k = 2; k < rd.p.length; k += 2) {
      const ax = rd.p[k - 2], ay = rd.p[k - 1], bx = rd.p[k], by = rd.p[k + 1], L = Math.hypot(bx - ax, by - ay); if (!L) continue; const dx = (bx - ax) / L, dy = (by - ay) / L;
      if (lamp) { for (; accL < L; accL += 38) { const x = ax + dx * accL, y = ay + dy * accL; if (LAMPS.length < 120000 && nearB(x, y) >= 4) LAMPS.push(x + dy * 5.2 * side, y - dx * 5.2 * side); side = -side; } accL -= L; }
      if (park) { for (; accP < L; accP += 6.4) { const x = ax + dx * accP, y = ay + dy * accP; if (PARKED.length > 30000 || nearB(x, y) < 5 || r() > 0.17) continue; const sd = r() < 0.5 ? 1 : -1; PARKED.push({ x: x + dy * hw * sd, y: y - dx * hw * sd, dx: dx * sd, dy: dy * sd, type: kinds[Math.floor(r() * kinds.length)], k: r() }); } accP -= L; }
    }
  }
  GL.seen = new Int32Array(LAMPS.length / 2 + 1); for (let i = 0; i < LAMPS.length; i += 2) GL.add(i / 2, LAMPS[i], LAMPS[i + 1], LAMPS[i], LAMPS[i + 1]);
  GP.seen = new Int32Array(PARKED.length + 1); PARKED.forEach((p, i) => GP.add(i, p.x, p.y, p.x, p.y));
})();

/* ------------------------------------------------------------------ road graph (GPS + traffic) */
const SPEED = { major: 22, second: 18, tert: 15, minor: 10, service: 6, track: 4 };
const SIMW = { major: 3, second: 2.5, tert: 2, minor: 1, service: 0.35 };
const SIMV = { major: 19, second: 16, tert: 13, minor: 9, service: 5.5 };
const G = { map: new Map(), xy: [], adj: [], grid: new Map() };
function nid(x, y) { const ix = Math.round(x * 2), iy = Math.round(y * 2), k = (ix + 65536) * 131072 + (iy + 65536); let i = G.map.get(k); if (i === undefined) { i = G.xy.length; G.map.set(k, i); G.xy.push([x, y]); G.adj.push([]); const ck = Math.floor(x / 100) * 8192 + Math.floor(y / 100); let a = G.grid.get(ck); if (!a) G.grid.set(ck, (a = [])); a.push(i); } return i; }
const E = [], OUT = [];
for (const r of ROADS) {
  if (!SPEED[r.c] || r.x) continue;
  for (let k = 2; k < r.p.length; k += 2) {
    const a = nid(r.p[k - 2], r.p[k - 1]), b = nid(r.p[k], r.p[k + 1]); if (a === b) continue; const len = Math.hypot(r.p[k] - r.p[k - 2], r.p[k + 1] - r.p[k - 1]);
    G.adj[a].push([b, len / SPEED[r.c], len, r.c]); if (!r.o) G.adj[b].push([a, len / SPEED[r.c], len, r.c]);
  }
}
for (let i = 0; i < G.xy.length; i++) OUT.push([]);
const GE = new Grid(200, 1);
G.adj.forEach((list, a) => { for (const [b, , len, cls] of list) { if (!SIMW[cls]) continue; const [ax, ay] = G.xy[a], [bx, by] = G.xy[b]; if (!inCity(ax, ay)) continue; OUT[a].push(E.length); E.push({ a, b, cls, len, ax, ay, dx: (bx - ax) / len, dy: (by - ay) / len, cars: [], w: 0 }); } });
GE.seen = new Int32Array(E.length + 1); E.forEach((e, i) => { e.w = e.len * SIMW[e.cls] * (1 + 7 * Math.min(1, nearB(e.ax + e.dx * e.len / 2, e.ay + e.dy * e.len / 2) / 8)); const mx = e.ax + e.dx * e.len / 2, my = e.ay + e.dy * e.len / 2; GE.add(i, mx, my, mx, my); });
function nearestNode(x, y, maxD) { let best = -1, bd = maxD * maxD; const R = Math.ceil(maxD / 100); const ix = Math.floor(x / 100), iy = Math.floor(y / 100); for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) { const l = G.grid.get((ix + a) * 8192 + iy + b); if (!l) continue; for (const i of l) { const dx = G.xy[i][0] - x, dy = G.xy[i][1] - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } } } return best; }
function sssp(s, costIdx, allow, target) {
  const n = G.xy.length, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1); const heap = [[0, s]]; dist[s] = 0;
  const push = (it) => { heap.push(it); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) { const [d, u] = pop(); if (d > dist[u]) continue; if (u === target) break; for (const ed of G.adj[u]) { if (allow && !allow(ed[3])) continue; const nd = d + ed[costIdx]; if (nd < dist[ed[0]]) { dist[ed[0]] = nd; prev[ed[0]] = u; push([nd, ed[0]]); } } }
  return { dist, prev };
}
const pathTo = (prev, t) => { const p = []; for (let u = t; u !== -1; u = prev[u]) p.push(u); return p.reverse().map((i) => G.xy[i]); };

/* ------------------------------------------------------------------ vehicles: types + sprites */
const VT = { hatch: [3.9, 1.74], sedan: [4.6, 1.82], suv: [4.7, 1.95], van: [5.4, 2.0], pickup: [5.3, 1.95], truck: [8.2, 2.45], taxi: [4.6, 1.82], police: [4.7, 1.86], bus: [11.5, 2.6] };
const TYPE_W = [['hatch', 0.36], ['sedan', 0.26], ['suv', 0.16], ['van', 0.08], ['pickup', 0.05], ['truck', 0.04], ['taxi', 0.03], ['police', 0.02]];
function pickType(r) { let q = r; for (const [t, w] of TYPE_W) { q -= w; if (q <= 0) return t; } return 'hatch'; }
const spriteCache = new Map();
function rr2(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }
function vehSprite(type, col) {
  const key = type + '|' + col; let c = spriteCache.get(key); if (c) return c;
  const [len, wid] = VT[type], sc = 24, pad = 4, L = len * sc, Wd = wid * sc;
  c = document.createElement('canvas'); c.width = Math.ceil(L + pad * 2); c.height = Math.ceil(Wd + pad * 2); const x = c.getContext('2d'); x.translate(pad, pad);
  const light = mix(col, '#ffffff', 0.24), deep = mix(col, '#000000', 0.32);
  const glass = (poly) => { const g = x.createLinearGradient(0, Wd * 0.1, 0, Wd * 0.9); g.addColorStop(0, '#41566b'); g.addColorStop(0.5, '#1b2631'); g.addColorStop(1, '#2d3f50'); x.beginPath(); poly.forEach(([px, py], i) => (i ? x.lineTo(px * L, py * Wd) : x.moveTo(px * L, py * Wd))); x.closePath(); x.fillStyle = g; x.fill(); x.strokeStyle = 'rgba(0,0,0,.55)'; x.lineWidth = 0.8; x.stroke(); };
  const wheel = (cx) => { x.fillStyle = '#0c0e11'; x.fillRect(cx - L * 0.075, -1.8, L * 0.15, 3.6); x.fillRect(cx - L * 0.075, Wd - 1.8, L * 0.15, 3.6); };
  const body = (rad, fill) => { const bg = x.createLinearGradient(0, 0, 0, Wd); bg.addColorStop(0, light); bg.addColorStop(0.5, col); bg.addColorStop(1, deep); rr2(x, 0, 0, L, Wd, rad); x.fillStyle = fill || bg; x.fill(); x.strokeStyle = 'rgba(0,0,0,.62)'; x.lineWidth = 1.4; x.stroke(); };
  const roofP = (x0, x1, fill) => { const g = x.createLinearGradient(0, Wd * 0.1, 0, Wd * 0.9); g.addColorStop(0, mix(fill || col, '#fff', 0.3)); g.addColorStop(1, mix(fill || col, '#000', 0.12)); rr2(x, L * x0, Wd * 0.1, L * (x1 - x0), Wd * 0.8, 5); x.fillStyle = g; x.fill(); x.strokeStyle = 'rgba(0,0,0,.4)'; x.lineWidth = 1; x.stroke(); };
  const lamps = () => { x.fillStyle = '#fff4c8'; x.fillRect(L - 3.4, Wd * 0.1, 3.4, Wd * 0.2); x.fillRect(L - 3.4, Wd * 0.7, 3.4, Wd * 0.2); x.fillStyle = '#b3201b'; x.fillRect(0, Wd * 0.1, 2.8, Wd * 0.2); x.fillRect(0, Wd * 0.7, 2.8, Wd * 0.2); };
  const mirrors = (px) => { x.fillStyle = deep; x.fillRect(L * px, -2.2, 5, 3.6); x.fillRect(L * px, Wd - 1.4, 5, 3.6); };
  if (type === 'bus') {
    wheel(L * 0.2); wheel(L * 0.78); body(Wd * 0.2); roofP(0.03, 0.9, mix(col, '#ffffff', 0.15));
    x.fillStyle = '#e9eef3'; x.strokeStyle = 'rgba(0,0,0,.5)'; x.lineWidth = 0.8; for (const q of [0.2, 0.48, 0.7]) { rr2(x, L * q, Wd * 0.3, L * 0.1, Wd * 0.4, 2); x.fill(); x.stroke(); }
    glass([[0.92, 0.12], [0.985, 0.2], [0.985, 0.8], [0.92, 0.88]]); glass([[0.01, 0.2], [0.03, 0.2], [0.03, 0.8], [0.01, 0.8]]);
    x.fillStyle = 'rgba(15,20,26,.85)'; x.fillRect(L * 0.76, Wd - 2.2, L * 0.07, 2.6); x.fillRect(L * 0.38, Wd - 2.2, L * 0.07, 2.6); lamps(); mirrors(0.9);
  } else if (type === 'truck') {
    wheel(L * 0.16); wheel(L * 0.32); wheel(L * 0.86);
    rr2(x, 0, 0, L * 0.76, Wd, 3); const bg = x.createLinearGradient(0, 0, 0, Wd); bg.addColorStop(0, '#f4f5f6'); bg.addColorStop(1, '#bfc4ca'); x.fillStyle = bg; x.fill(); x.strokeStyle = 'rgba(0,0,0,.55)'; x.lineWidth = 1.3; x.stroke();
    x.strokeStyle = 'rgba(0,0,0,.18)'; x.lineWidth = 1; for (let q = 0.06; q < 0.74; q += 0.07) { x.beginPath(); x.moveTo(L * q, Wd * 0.08); x.lineTo(L * q, Wd * 0.92); x.stroke(); }
    rr2(x, L * 0.77, Wd * 0.04, L * 0.23, Wd * 0.92, 5); const cg = x.createLinearGradient(0, 0, 0, Wd); cg.addColorStop(0, light); cg.addColorStop(1, deep); x.fillStyle = cg; x.fill(); x.strokeStyle = 'rgba(0,0,0,.6)'; x.stroke();
    glass([[0.9, 0.16], [0.97, 0.22], [0.97, 0.78], [0.9, 0.84]]); x.fillStyle = '#fff4c8'; x.fillRect(L - 3, Wd * 0.12, 3, Wd * 0.16); x.fillRect(L - 3, Wd * 0.72, 3, Wd * 0.16); x.fillStyle = '#b3201b'; x.fillRect(0, Wd * 0.1, 2.6, Wd * 0.2); x.fillRect(0, Wd * 0.7, 2.6, Wd * 0.2); mirrors(0.84);
  } else if (type === 'van') {
    wheel(L * 0.2); wheel(L * 0.78); body(Wd * 0.22); roofP(0.04, 0.76, mix(col, '#ffffff', 0.12));
    x.strokeStyle = 'rgba(0,0,0,.15)'; x.lineWidth = 1; for (let q = 0.14; q < 0.7; q += 0.12) { x.beginPath(); x.moveTo(L * q, Wd * 0.16); x.lineTo(L * q, Wd * 0.84); x.stroke(); }
    glass([[0.76, 0.1], [0.9, 0.2], [0.9, 0.8], [0.76, 0.9]]); lamps(); mirrors(0.78);
  } else if (type === 'pickup') {
    wheel(L * 0.2); wheel(L * 0.8); body(Wd * 0.26); rr2(x, L * 0.03, Wd * 0.1, L * 0.34, Wd * 0.8, 3); x.fillStyle = '#1d2126'; x.fill(); x.strokeStyle = deep; x.lineWidth = 1.2; x.stroke();
    x.strokeStyle = 'rgba(255,255,255,.1)'; for (let q = 0.08; q < 0.36; q += 0.05) { x.beginPath(); x.moveTo(L * q, Wd * 0.14); x.lineTo(L * q, Wd * 0.86); x.stroke(); }
    roofP(0.43, 0.6); glass([[0.6, 0.1], [0.71, 0.19], [0.71, 0.81], [0.6, 0.9]]); glass([[0.43, 0.15], [0.39, 0.2], [0.39, 0.8], [0.43, 0.85]]); lamps(); mirrors(0.62);
  } else {
    const cfg = { hatch: [0.2, 0.6, 0.1, 0.07], sedan: [0.3, 0.58, 0.11, 0.09], suv: [0.14, 0.62, 0.1, 0.06], taxi: [0.3, 0.58, 0.11, 0.09], police: [0.3, 0.58, 0.11, 0.09] }[type];
    const [r0, r1, ws, rs] = cfg; wheel(L * 0.2); wheel(L * 0.78); body(Wd * (type === 'suv' ? 0.24 : 0.3));
    if (type === 'police') { x.fillStyle = '#1a2646'; x.fillRect(L * 0.1, 0, L * 0.52, Wd); x.fillRect(L * 0.76, Wd * 0.04, L * 0.2, Wd * 0.92); x.strokeStyle = 'rgba(0,0,0,.55)'; x.strokeRect(0, 0, L, Wd); }
    x.strokeStyle = 'rgba(0,0,0,.24)'; x.lineWidth = 1; rr2(x, L * 0.72, Wd * 0.13, L * 0.2, Wd * 0.74, 3); x.stroke(); rr2(x, L * 0.05, Wd * 0.13, L * 0.14, Wd * 0.74, 3); x.stroke();
    glass([[r1, 0.1], [r1 + ws, 0.18], [r1 + ws, 0.82], [r1, 0.9]]); glass([[r0, 0.1], [r0 - rs, 0.17], [r0 - rs, 0.83], [r0, 0.9]]);
    roofP(r0, r1, type === 'police' ? '#f3f5f7' : col);
    if (type === 'suv') { x.strokeStyle = 'rgba(0,0,0,.45)'; x.lineWidth = 1.2; for (const yy of [0.2, 0.8]) { x.beginPath(); x.moveTo(L * (r0 + 0.02), Wd * yy); x.lineTo(L * (r1 - 0.02), Wd * yy); x.stroke(); } }
    if (type === 'taxi') { rr2(x, L * 0.4, Wd * 0.36, L * 0.11, Wd * 0.28, 2); x.fillStyle = '#fff'; x.fill(); x.strokeStyle = '#222'; x.lineWidth = 1; x.stroke(); }
    if (type === 'police') { x.fillStyle = '#d11'; x.fillRect(L * 0.4, Wd * 0.22, L * 0.07, Wd * 0.28); x.fillStyle = '#1559ff'; x.fillRect(L * 0.4, Wd * 0.5, L * 0.07, Wd * 0.28); }
    lamps(); mirrors(r1 + ws * 0.4);
  }
  spriteCache.set(key, c); return c;
}
const vehCol = (th, type, k) => (type === 'taxi' ? '#f3c623' : type === 'police' ? '#e9edf1' : type === 'truck' ? ['#3d6fb4', '#b8322b', '#2f7a57', '#d9a22a'][Math.floor(k * 4) % 4] : th.cars[Math.floor(k * th.cars.length) % th.cars.length]);
function drawVeh(c, s, th, X, Y, wx, wy, dx, dy, type, col, o) {
  const sx = X(wx), sy = Y(wy); const [len, wid] = VT[type], big = type === 'bus' || type === 'truck'; const k = Math.max(s * 1.18, (big ? 17 : 8.5) / len), L = len * k, Wd = wid * k * 1.05;
  if (sx < -L || sx > o.w + L || sy < -L || sy > o.h + L) return; const ang = Math.atan2(-dy, dx), lift = th.ext ? Math.min(2.6, k * 0.4) : 0, spr = vehSprite(type, col), f = k / 24;
  c.save(); c.translate(sx + 1.4 + lift * 0.5, sy + 1.8 + lift * 0.4); c.rotate(ang); rr2(c, -L / 2, -Wd / 2, L, Wd, Wd * 0.3); c.fillStyle = 'rgba(0,0,0,.3)'; c.fill(); c.restore();
  c.save(); c.translate(sx, sy - lift); c.rotate(ang);
  if (o.night > 0.25 && !o.parked && s > 0.4) { const g = c.createLinearGradient(L / 2, 0, L / 2 + L * 3, 0); g.addColorStop(0, `rgba(255,240,190,${0.55 * o.night})`); g.addColorStop(1, 'rgba(255,240,190,0)'); c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = g; c.beginPath(); c.moveTo(L / 2, -Wd * 0.35); c.lineTo(L / 2 + L * 3, -Wd * 1.7); c.lineTo(L / 2 + L * 3, Wd * 1.7); c.lineTo(L / 2, Wd * 0.35); c.closePath(); c.fill(); c.restore(); }
  c.drawImage(spr, -spr.width * f / 2, -spr.height * f / 2, spr.width * f, spr.height * f);
  if (o.brake) { c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = 'rgba(255,40,30,.95)'; c.fillRect(-L / 2 - 0.5, -Wd * 0.4, Math.max(2, L * 0.07), Wd * 0.22); c.fillRect(-L / 2 - 0.5, Wd * 0.18, Math.max(2, L * 0.07), Wd * 0.22); c.restore(); }
  if (type === 'police' && !o.parked && L > 9) { const ph = Math.floor(performance.now() / 170) % 2; c.save(); c.globalCompositeOperation = 'lighter'; const g = c.createRadialGradient(0, 0, 0, 0, 0, L * 0.9); const col2 = ph ? '255,40,40' : '40,110,255'; g.addColorStop(0, `rgba(${col2},.85)`); g.addColorStop(1, `rgba(${col2},0)`); c.fillStyle = g; c.beginPath(); c.arc(0, 0, L * 0.9, 0, 7); c.fill(); c.restore(); }
  c.restore();
}

/* ------------------------------------------------------------------ traffic simulation (streams around the camera) */
const sim = { cars: [], buses: [], r: rng(42), lines: [], estimated: false, pool: 0, active: 0, vEdges: [], vW: [], vSum: 0, vKey: '' };
function pickNext(e) { let c = OUT[e.b].filter((i) => E[i].b !== e.a); if (!c.length) c = OUT[e.b]; if (!c.length) return -1; let tot = 0; for (const i of c) tot += SIMW[E[i].cls]; let q = sim.r() * tot; for (const i of c) { q -= SIMW[E[i].cls]; if (q <= 0) return i; } return c[0]; }
function newCar(e) { let type = pickType(sim.r()); if ((type === 'truck' || type === 'van') && E[e].cls === 'service') type = 'hatch'; return { e, s: sim.r() * E[e].len, v: 0, k: 0.8 + sim.r() * 0.35, col: sim.r(), type, len: VT[type][0], brake: false }; }
function refreshViewEdges(force) {
  const key = `${Math.round(view.cx / (W / view.s * 0.2))}|${Math.round(view.cy / (H / view.s * 0.2))}|${view.s.toFixed(2)}`; if (!force && key === sim.vKey) return; sim.vKey = key;
  const hw = W / view.s * 0.9, hh = H / view.s * 0.9, ids = GE.query(view.cx - hw, view.cy - hh, view.cx + hw, view.cy + hh, []); sim.vEdges = ids; sim.vW = new Float64Array(ids.length); let sum = 0, plain = 0;
  for (let i = 0; i < ids.length; i++) { sum += E[ids[i]].w; sim.vW[i] = sum; plain += E[ids[i]].len * SIMW[E[ids[i]].cls]; } sim.vSum = sum;
  sim.active = E.length ? clamp(Math.round(plain / 300), 14, sim.pool) : 0;
}
function pickViewEdge(preferRing) {
  if (!sim.vEdges.length) return -1; for (let tries = 0; tries < (preferRing ? 8 : 1); tries++) { const q = sim.r() * sim.vSum; let lo = 0, hi = sim.vW.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (sim.vW[m] < q) lo = m + 1; else hi = m; } const e = sim.vEdges[lo]; if (!preferRing) return e; const ed = E[e], sx = (ed.ax - view.cx) * view.s + W / 2, sy = H / 2 - (ed.ay - view.cy) * view.s; if (sx < -30 || sx > W + 30 || sy < -30 || sy > H + 30) return e; }
  return sim.vEdges[Math.floor(sim.r() * sim.vEdges.length)];
}
function busAt(L, d) { const cum = L.cum; let lo = 1, hi = cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < d) lo = m + 1; else hi = m; } const a = L.pts[lo - 1], b = L.pts[lo], seg = cum[lo] - cum[lo - 1] || 1, t = clamp((d - cum[lo - 1]) / seg, 0, 1); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (b[0] - a[0]) / seg, (b[1] - a[1]) / seg]; }
function projectStop(L, sx, sy) { let best = null, bd = 1e12; for (let i = 1; i < L.pts.length; i++) { const a = L.pts[i - 1], b = L.pts[i], vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy || 1; const t = clamp(((sx - a[0]) * vx + (sy - a[1]) * vy) / l2, 0, 1), px = a[0] + vx * t, py = a[1] + vy * t, d = (px - sx) ** 2 + (py - sy) ** 2; if (d < bd) { bd = d; best = L.cum[i - 1] + Math.sqrt(l2) * t; } } return bd < 110 * 110 ? best : null; }
function makeLine(pts, ref, name, stopsXY, real) {
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = { pts, cum, len: cum[cum.length - 1], ref, name, real, stops: [] }; if (L.len < 80) return null;
  for (const s of stopsXY) { const d = projectStop(L, s.x, s.y); if (d !== null && !L.stops.some((q) => Math.abs(q.d - d) < 25)) L.stops.push({ d, n: s.n }); }
  L.stops.sort((a, b) => a.d - b.d); return L;
}
(function buildBusLines() {
  const stops = POIS.filter((p) => p.k === 'bus');
  if (D.busRoutes && D.busRoutes.length) {
    for (const r of D.busRoutes) { const pts = []; for (let k = 0; k < r.p.length; k += 2) pts.push([r.p[k], r.p[k + 1]]); const L = makeLine(pts, r.ref, r.n, r.stops.concat(stops), true); if (L && L.stops.length >= 2) sim.lines.push(L); }
  } else if (stops.length && G.xy.length) {
    sim.estimated = true; const A = nearestNode(stops[0].x, stops[0].y, 300); if (A < 0) return;
    let allow = (c) => c === 'major' || c === 'second' || c === 'tert'; let r1 = sssp(A, 2, allow);
    const reach = (r) => r.dist.reduce((n, d) => n + (isFinite(d) ? 1 : 0), 0); if (reach(r1) < 25) { allow = null; r1 = sssp(A, 2, null); }
    const far = (r) => { let bi = -1, bd = -1; r.dist.forEach((d, i) => { if (isFinite(d) && d > bd && d < 7000) { bd = d; bi = i; } }); return bi; };
    const T1 = far(r1); if (T1 < 0) return; const r2 = sssp(T1, 2, allow); const T2 = far(r2); if (T2 < 0 || T1 === T2) return;
    const L = makeLine(pathTo(r2.prev, T2), '1', 'Bus (estimated route)', stops, false); if (L) sim.lines.push(L);
  }
  for (const L of sim.lines) { const n = L.len > 3000 ? 3 : 2; for (let i = 0; i < n; i++) sim.buses.push({ L, d: (L.len * i) / n, dir: i % 2 ? -1 : 1, v: 0, dwell: 2 + i * 3, last: null }); }
})();
sim.pool = E.length ? 280 : 0; let touched = [];
function stepTraffic(dt) {
  if (!sim.pool) return; refreshViewEdges(false);
  while (sim.cars.length < sim.pool) { const e = pickViewEdge(false); if (e < 0) break; sim.cars.push(newCar(e)); }
  for (const e of touched) e.cars.length = 0; touched = [];
  for (let i = 0; i < sim.active && i < sim.cars.length; i++) { const c = sim.cars[i], e = E[c.e]; if (!e.cars.length) touched.push(e); e.cars.push(c); }
  const hw = W / view.s * 1.0, hh = H / view.s * 1.0; let respawned = 0;
  for (const e of touched) {
    if (e.cars.length > 1) e.cars.sort((a, b) => b.s - a.s);
    for (let i = 0; i < e.cars.length; i++) {
      const c = e.cars[i], lead = i ? e.cars[i - 1] : null; let vmax = SIMV[e.cls] * c.k; const rem = e.len - c.s;
      if (lead) { const gap = lead.s - lead.len - c.s; if (gap < 14) vmax = Math.min(vmax, Math.max(0, (gap - 2.5) * 1.4)); }
      if (rem < 7) vmax = Math.min(vmax, 5);
      c.brake = vmax < c.v - 0.5; c.v += clamp(vmax - c.v, -10 * dt, 3.2 * dt); c.s += c.v * dt;
      if (c.s >= e.len) {
        const n = pickNext(e);
        if (n < 0) { const ne = pickViewEdge(true); if (ne >= 0) { c.e = ne; c.s = 0; c.v = 0; } } else { c.s -= e.len; c.e = n; }
        const ce = E[c.e], dx = Math.abs(ce.ax - view.cx), dy = Math.abs(ce.ay - view.cy);
        if ((dx > hw * 1.5 || dy > hh * 1.5) && respawned < 24) { const ne = pickViewEdge(true); if (ne >= 0) { c.e = ne; c.s = sim.r() * E[ne].len * 0.3; c.v = 0; respawned++; } }
      }
    }
  }
  for (const b of sim.buses) {
    const L = b.L; if (b.dwell > 0) { b.dwell -= dt; continue; }
    let vmax = 11, ds = Infinity, st = null;
    for (const s of L.stops) { const dd = (s.d - b.d) * b.dir; if (dd > 0.5 && dd < ds && !(b.last === s && dd < 25)) { ds = dd; st = s; } }
    const endd = b.dir > 0 ? L.len - b.d : b.d;
    if (st && ds < 70) vmax = Math.min(vmax, Math.sqrt(2 * 1.6 * ds) + 0.9);
    if (endd < 45) vmax = Math.min(vmax, Math.sqrt(2 * 1.6 * endd) + 0.9);
    b.v += clamp(vmax - b.v, -2.4 * dt, 1.5 * dt); const step = b.v * dt;
    if (st && ds <= step + 0.5) { b.d = st.d; b.v = 0; b.dwell = 6 + sim.r() * 4; b.last = st; continue; }
    b.d += b.dir * step;
    if (b.d >= L.len) { b.d = L.len; b.dir = -1; b.dwell = 8; b.v = 0; b.last = null; } else if (b.d <= 0) { b.d = 0; b.dir = 1; b.dwell = 8; b.v = 0; b.last = null; }
  }
}

/* ------------------------------------------------------------------ state */
const canvas = $('#map'), ctx = canvas.getContext('2d');
let W = 0, H = 0, dpr = 1;
const state = {
  theme: localStorage.getItem('gta-theme') || 'gta5', season: 'summer', weather: 'clear', hour: 14, timeRun: false,
  flags: { extrude: true, relief: true, labels: true, roads: true, traffic: true, lines: true, trees: true },
  hidden: new Set(), pulse: null, hover: null, selected: null,
};
if (!THEMES[state.theme] || (D.styles && !D.styles[state.theme])) state.theme = (D.styles && Object.keys(D.styles)[0]) || 'gta5';
const curTheme = () => deriveTheme(THEMES[state.theme], state.season);
const view = { cx: 0, cy: 0, s: 0.4 };
const home = POIS.find((p) => p.k === 'radnice') || { x: 0, y: 0 };
const player = { x: home.x, y: home.y, ang: Math.PI / 2 };
let waypoint = null, route = null, driving = null, follow = false, anim = null;
let MIN_S = 0.05; const MAX_S = 6;
const fitView = () => { const f = Math.min(W / (2 * HW), H / (2 * HH)) * 0.9; return { cx: 0, cy: 0, s: clamp(f, 0.02, 1.2) }; };
const w2s = (x, y, v = view, w = W, h = H) => [(x - v.cx) * v.s + w / 2, h / 2 - (y - v.cy) * v.s];
const s2w = (px, py) => [(px - W / 2) / view.s + view.cx, view.cy - (py - H / 2) / view.s];
function nightOf(h) { if (h >= 7 && h <= 18) return 0; if (h <= 5 || h >= 20) return 1; return h < 7 ? (7 - h) / 2 : (h - 18) / 2; }
const extOf = (th, flags, s) => (flags.extrude ? s * 0.55 * th.ext : 0);

/* ------------------------------------------------------------------ patterns */
const patCache = {};
function patterns(th) {
  if (patCache[th.name]) return patCache[th.name];
  const mk = (size, fn) => { const c = document.createElement('canvas'); c.width = c.height = size; fn(c.getContext('2d'), size); return ctx.createPattern(c, 'repeat'); };
  const r = rng(99);
  return (patCache[th.name] = {
    forest: mk(64, (c, S) => { for (let i = 0; i < 16; i++) { const x = r() * S, y = r() * S, rr = 1.6 + r() * 2.4; c.fillStyle = mix(th.forest, '#000', 0.11); c.beginPath(); c.arc(x, y, rr, 0, 7); c.fill(); c.fillStyle = mix(th.forest, '#fff', 0.1); c.beginPath(); c.arc(x - 0.8, y - 0.8, rr * 0.55, 0, 7); c.fill(); } }),
    farm: mk(14, (c, S) => { c.strokeStyle = mix(th.farm, '#000', 0.07); c.lineWidth = 1; for (let i = -S; i < S * 2; i += 5) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + S, S); c.stroke(); } }),
    grass: mk(18, (c, S) => { c.strokeStyle = mix(th.grass, '#000', 0.12); c.lineWidth = 1; for (let i = 0; i < 5; i++) { const x = r() * S, y = r() * S; c.beginPath(); c.moveTo(x, y); c.lineTo(x + 1, y - 3); c.moveTo(x + 2, y); c.lineTo(x + 3, y - 2); c.stroke(); } }),
    orchard: mk(12, (c, S) => { c.fillStyle = mix(th.orchard, '#000', 0.2); c.beginPath(); c.arc(S / 2, S / 2, 2.2, 0, 7); c.fill(); }),
    scrub: mk(16, (c) => { c.fillStyle = mix(th.scrub, '#000', 0.16); for (let i = 0; i < 4; i++) { c.beginPath(); c.arc(r() * 16, r() * 16, 1.6, 0, 7); c.fill(); } }),
    sea: mk(48, (c, S) => { c.strokeStyle = th.wave; c.lineWidth = 1.4; c.lineCap = 'round'; for (let y = 8; y < S; y += 24) for (let x = (y / 24 % 2) * 24; x < S + 24; x += 48) { c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 6, y - 4, x + 12, y); c.quadraticCurveTo(x + 18, y + 4, x + 24, y); c.stroke(); } }),
  });
}

/* ------------------------------------------------------------------ text helpers */
function haloText(c, t, x, y, fill, halo, w = 3.2) { c.lineJoin = 'round'; c.lineWidth = w; c.strokeStyle = halo; c.strokeText(t, x, y); c.fillStyle = fill; c.fillText(t, x, y); }
function spacedWidth(c, t, sp) { let w = 0; for (const ch of t) w += c.measureText(ch).width + sp; return w - sp; }
function spacedText(c, t, cx, cy, sp, fill, halo, hw) { const w = spacedWidth(c, t, sp); let x = cx - w / 2; c.textAlign = 'left'; for (const ch of t) { haloText(c, ch, x, cy, fill, halo, hw); x += c.measureText(ch).width + sp; } return w; }
function pathText(c, text, pts, fill, halo, hw) {
  const seg = []; let tot = 0; for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(l); tot += l; }
  const tw = c.measureText(text).width; if (tot < tw * 1.12) return null;
  const ang0 = Math.atan2(pts[pts.length - 1][1] - pts[0][1], pts[pts.length - 1][0] - pts[0][0]);
  if (Math.abs(ang0) > Math.PI / 2) { pts = pts.slice().reverse(); seg.reverse(); }
  const at = (d) => { let i = 0; while (i < seg.length - 1 && d > seg[i]) { d -= seg[i]; i++; } const t = seg[i] ? d / seg[i] : 0; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t, Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0])]; };
  let d = (tot - tw) / 2; const first = at(d), last = at(d + tw); let amin = 9, amax = -9; const placed = [];
  for (const ch of text) { const w = c.measureText(ch).width, p = at(d + w / 2); placed.push([ch, p]); amin = Math.min(amin, p[2]); amax = Math.max(amax, p[2]); d += w; }
  if (amax - amin > 0.9) return null;
  c.textAlign = 'center'; for (const [ch, p] of placed) { c.save(); c.translate(p[0], p[1]); c.rotate(p[2]); haloText(c, ch, 0, 0, fill, halo, hw); c.restore(); }
  return [Math.min(first[0], last[0]) - 6, Math.min(first[1], last[1]) - 10, Math.max(first[0], last[0]) + 6, Math.max(first[1], last[1]) + 10];
}
function pathTextBox(c, text, pts) {
  let tot = 0; for (let i = 1; i < pts.length; i++) tot += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const tw = c.measureText(text).width; if (tot < tw * 1.12) return null;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); const mx = (Math.min(...xs) + Math.max(...xs)) / 2, my = (Math.min(...ys) + Math.max(...ys)) / 2, r = Math.min(tw / 2, tot / 2);
  return [mx - r * 0.9, my - 9 - r * 0.25, mx + r * 0.9, my + 9 + r * 0.25];
}
function rrect(c, x, y, w, h, r) { if (c.roundRect) { c.beginPath(); c.roundRect(x, y, w, h, r); } else { c.beginPath(); c.rect(x, y, w, h); } }

/* ------------------------------------------------------------------ light sprites */
const glow = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,224,150,.95)'); g.addColorStop(0.25, 'rgba(255,200,110,.45)'); g.addColorStop(1, 'rgba(255,190,90,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return c; })();

/* ------------------------------------------------------------------ scene: terrain, trees, roads, buildings, night */
function cityPath(c, X, Y) { c.beginPath(); if (D.boundary && D.boundary.length) { for (const r of D.boundary) { c.moveTo(X(r[0]), Y(r[1])); for (let k = 2; k < r.length; k += 2) c.lineTo(X(r[k]), Y(r[k + 1])); c.closePath(); } } else c.rect(X(-HW), Y(HH), X(HW) - X(-HW), Y(-HH) - Y(HH)); }
const PROF = {};
function paintScene(c, w, h, v, th, o) {
  let _t = performance.now(); const lap = (k) => { const n = performance.now(); PROF[k] = +(n - _t).toFixed(1); _t = n; };
  const s = v.s, P = patterns(th), X = (x) => (x - v.cx) * s + w / 2, Y = (y) => h / 2 - (y - v.cy) * s;
  const wx0 = v.cx - w / 2 / s - 10, wx1 = v.cx + w / 2 / s + 10, wy0 = v.cy - h / 2 / s - 10, wy1 = v.cy + h / 2 / s + 10;
  const vis = (b, m = 0) => b.x1 >= wx0 - m && b.x0 <= wx1 + m && b.y1 >= wy0 - m && b.y0 <= wy1 + m;
  c.save(); c.setLineDash([]); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.lineJoin = 'round'; c.lineCap = 'round';
  c.fillStyle = th.outside; c.fillRect(0, 0, w, h);
  if (P.sea) { P.sea.setTransform(new DOMMatrix().translate(X(0) % 48, Y(0) % 48)); c.fillStyle = P.sea; c.fillRect(0, 0, w, h); }
  c.save(); c.beginPath(); c.rect(-50, -50, w + 100, h + 100); const sp0 = c; cityPathAppend(c, X, Y); c.clip('evenodd'); cityPath(c, X, Y); c.strokeStyle = th.shore;
  for (const [lw, al] of [[Math.max(60, 150 * s), 0.1], [Math.max(34, 80 * s), 0.16], [Math.max(16, 36 * s), 0.26], [Math.max(7, 14 * s), 0.4]]) { c.lineWidth = lw; c.globalAlpha = al; c.stroke(); } c.restore();
  lap('sea+shore'); c.save(); cityPath(c, X, Y); c.clip(); c.fillStyle = th.land; c.fillRect(0, 0, w, h);
  const ring = (f) => { c.moveTo(X(f[0]), Y(f[1])); for (let k = 2; k < f.length; k += 2) c.lineTo(X(f[k]), Y(f[k + 1])); c.closePath(); };
  const fillPoly = (a) => { c.beginPath(); for (const r of a.p) ring(r); c.fill('evenodd'); };
  const minPx = 1.3 / s; const visA = {};
  for (const k of D.areaOrder) { const list = AB[k], idx = GA[k].query(wx0, wy0, wx1, wy1, []), out = []; for (const i of idx) { const a = list[i]; if (a.x1 - a.x0 < minPx && a.y1 - a.y0 < minPx) continue; out.push(a); } visA[k] = out; }
  lap('areas-query');
  const pat = (name, alpha) => { if (!P[name] || s < 0.35 || !visA[name]) return; P[name].setTransform(new DOMMatrix().translate(X(0) % 64, Y(0) % 64)); c.save(); c.globalAlpha = alpha; c.fillStyle = P[name]; for (const a of visA[name]) fillPoly(a); c.restore(); };
  for (const k of D.areaOrder) {
    if (k === 'water') continue; c.fillStyle = th[k] || th.land; for (const a of visA[k]) fillPoly(a);
    if (k === 'forest' && s > 0.15) { c.strokeStyle = mix(th.forest, '#000', 0.2); c.lineWidth = 1; c.beginPath(); for (const a of visA[k]) for (const r of a.p) ring(r); c.stroke(); }
    if (k === 'farm') pat('farm', 0.9); if (k === 'grass') pat('grass', 0.8); if (k === 'forest') pat('forest', o.trees && s > 0.8 ? 0.3 : 0.6); if (k === 'orchard') pat('orchard', 0.8); if (k === 'scrub') pat('scrub', 0.8);
  }
  lap('areas-fill');
  if (o.relief && REL && reliefImg.complete && reliefImg.naturalWidth) { c.save(); c.globalAlpha = th.reliefA; c.globalCompositeOperation = 'overlay'; c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'low'; c.drawImage(reliefImg, X(REL.x0), Y(REL.y0), REL.w * REL.step * s, REL.h * REL.step * s); c.restore(); }
  lap('relief'); c.fillStyle = th.water; for (const a of visA.water || []) fillPoly(a);
  if (visA.water && visA.water.length) { c.strokeStyle = th.waterLine; c.lineWidth = Math.max(1, s * 0.9); c.beginPath(); for (const a of visA.water) for (const r of a.p) ring(r); c.stroke(); }
  for (const wt of WATERS) { if (!vis(wt)) continue; c.lineWidth = Math.max(1.2, wt.w * s); c.strokeStyle = wt.w > 3 ? th.water : th.waterLine; c.beginPath(); for (let k = 0; k < wt.p.length; k += 2) k ? c.lineTo(X(wt.p[k]), Y(wt.p[k + 1])) : c.moveTo(X(wt.p[0]), Y(wt.p[1])); c.stroke(); }
  if (RESERVES.length) { c.save(); c.strokeStyle = th.reserve; c.globalAlpha = 0.9; c.lineWidth = 2; c.setLineDash([9, 5]); for (const r of RESERVES) { if (!vis(r)) continue; c.beginPath(); for (let k = 0; k < r.p.length; k += 2) k ? c.lineTo(X(r.p[k]), Y(r.p[k + 1])) : c.moveTo(X(r.p[0]), Y(r.p[1])); c.stroke(); } c.restore(); }
  c.strokeStyle = mix(th.land, '#000', 0.4); c.lineWidth = 1.3; for (const cl of CLIFFS) { if (!vis(cl)) continue; c.beginPath(); for (let k = 0; k < cl.p.length; k += 2) k ? c.lineTo(X(cl.p[k]), Y(cl.p[k + 1])) : c.moveTo(X(cl.p[0]), Y(cl.p[1])); c.stroke(); }
  if (s > 0.3) { c.save(); c.strokeStyle = mix(th.text, th.land, 0.5); c.lineWidth = 1; c.setLineDash([2, 6]); for (const pl of POWER) { if (!vis(pl)) continue; c.beginPath(); for (let k = 0; k < pl.p.length; k += 2) k ? c.lineTo(X(pl.p[k]), Y(pl.p[k + 1])) : c.moveTo(X(pl.p[0]), Y(pl.p[1])); c.stroke(); } c.restore(); }
  for (const rl of RAILS) { if (!vis(rl)) continue; c.strokeStyle = th.rail; c.lineWidth = Math.max(1.5, 3 * s); c.beginPath(); for (let k = 0; k < rl.p.length; k += 2) k ? c.lineTo(X(rl.p[k]), Y(rl.p[k + 1])) : c.moveTo(X(rl.p[0]), Y(rl.p[1])); c.stroke(); }

  lap('water+lines');
  if (o.trees && s > 0.8) {
    const ix0 = Math.floor(wx0 / TCELL), ix1 = Math.floor(wx1 / TCELL), iy0 = Math.floor(wy0 / TCELL), iy1 = Math.floor(wy1 / TCELL), thin = s < 1.4;
    const base = [mix(th.forest, '#000', 0.26), mix(th.park, '#000', 0.2), mix(th.orchard, '#000', 0.26), mix(th.scrub, '#000', 0.2)], lite = [mix(th.forest, '#fff', 0.1), mix(th.park, '#fff', 0.12), mix(th.orchard, '#fff', 0.12), mix(th.scrub, '#fff', 0.1)];
    const list = []; for (let a = ix0; a <= ix1; a++) for (let b = iy0; b <= iy1; b++) { const t = treeCell(a, b); for (let i = 0; i < t.length; i += 4) list.push(t[i], t[i + 1], t[i + 2], t[i + 3]); }
    for (const tr of TREEROWS) { if (!vis(tr)) continue; for (let k = 0; k < tr.p.length; k += 2) list.push(tr.p[k], tr.p[k + 1], 1, 3.4); }
    const n = list.length / 4, order = new Array(n); for (let i = 0; i < n; i++) order[i] = i; order.sort((p, q) => list[q * 4 + 1] - list[p * 4 + 1]);
    for (const i of order) {
      if (thin && i % 2) continue; const x = X(list[i * 4]), y = Y(list[i * 4 + 1]), r = Math.max(2.2, list[i * 4 + 3] * s); if (x < -r || x > w + r || y < -r || y > h + r) continue; const k = list[i * 4 + 2];
      c.fillStyle = th.shadow; c.beginPath(); c.ellipse(x + r * 0.45, y + r * 0.4, r * 0.95, r * 0.7, 0, 0, 7); c.fill();
      if (th.tree === 'palm') { c.strokeStyle = base[k]; c.lineWidth = Math.max(1.2, r * 0.32); for (let q = 0; q < 7; q++) { const a = q * Math.PI * 2 / 7 + i; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7 - r * 0.4, x + Math.cos(a) * r * 1.35, y + Math.sin(a) * r * 1.35); c.stroke(); } c.fillStyle = lite[k]; c.beginPath(); c.arc(x, y, r * 0.22, 0, 7); c.fill(); }
      else { c.fillStyle = base[k]; c.beginPath(); c.arc(x, y - r * 0.15, r, 0, 7); c.fill(); c.fillStyle = lite[k]; c.beginPath(); c.arc(x - r * 0.3, y - r * 0.5, r * 0.55, 0, 7); c.fill(); }
    }
  }

  lap('trees'); const rid = GR.query(wx0 - 20, wy0 - 20, wx1 + 20, wy1 + 20, []); const byCls = {}, bridges = [], tunnels = [];
  for (const i of rid) { const r = ROADS[i]; if (r.t) { tunnels.push(r); continue; } (byCls[r.c] || (byCls[r.c] = [])).push(r); if (r.b) bridges.push(r); }
  const batch = (list) => { c.beginPath(); for (const r of list) { c.moveTo(X(r.p[0]), Y(r.p[1])); for (let k = 2; k < r.p.length; k += 2) c.lineTo(X(r.p[k]), Y(r.p[k + 1])); } };
  const wpx = (cls) => Math.max(ROAD[cls][1], ROAD[cls][0] * s);
  const showCls = (cls) => !(s < 0.2 && (cls === 'path' || cls === 'track' || cls === 'service')) && !(s < 0.1 && cls === 'minor');
  for (const cls of ROAD_ORDER) { if (cls === 'path' || cls === 'track' || !byCls[cls] || !showCls(cls)) continue; c.strokeStyle = th[cls + 'Case']; const add = Math.max(1.4, 1.7 * Math.min(1, s * 1.6 + 0.3)); c.lineWidth = wpx(cls) + add * 2; batch(byCls[cls]); c.stroke(); }
  if (bridges.length) { for (const cls of ROAD_ORDER) { const bl = bridges.filter((r) => r.c === cls); if (!bl.length || cls === 'path' || cls === 'track') continue; c.strokeStyle = th[cls + 'Case']; c.lineWidth = wpx(cls) + 5.6; batch(bl); c.stroke(); } }
  for (const cls of ['track', 'path']) { if (!byCls[cls] || !showCls(cls)) continue; c.strokeStyle = th[cls]; c.lineWidth = wpx(cls); c.setLineDash(cls === 'track' ? [7, 4] : [2.5, 3.5]); c.lineCap = 'butt'; batch(byCls[cls]); c.stroke(); c.setLineDash([]); c.lineCap = 'round'; }
  for (const cls of ROAD_ORDER) { if (cls === 'path' || cls === 'track' || !byCls[cls] || !showCls(cls)) continue; c.strokeStyle = th[cls]; c.lineWidth = wpx(cls); batch(byCls[cls]); c.stroke(); }
  if (tunnels.length) { c.save(); c.globalAlpha = 0.55; c.setLineDash([6, 5]); for (const cls of ROAD_ORDER) { const tl = tunnels.filter((r) => r.c === cls); if (!tl.length || cls === 'path' || cls === 'track') continue; c.strokeStyle = th[cls]; c.lineWidth = wpx(cls); batch(tl); c.stroke(); } c.restore(); }
  if (s > 1.1) { c.save(); c.strokeStyle = th.centerLine; c.lineWidth = 1; c.setLineDash([9, 8]); c.lineCap = 'butt'; for (const cls of ['major', 'second', 'tert']) { if (!byCls[cls] || wpx(cls) <= 8) continue; batch(byCls[cls].filter((r) => !r.o)); c.stroke(); } c.restore(); }
  lap('roads'); if (s > 1.3) { c.fillStyle = mix(th.text, th.land, 0.35); const li = GL.query(wx0, wy0, wx1, wy1, []); const rad = Math.max(1.1, s * 0.5); c.beginPath(); for (const i of li) { const x = X(LAMPS[i * 2]), y = Y(LAMPS[i * 2 + 1]); c.moveTo(x + rad, y); c.arc(x, y, rad, 0, 7); } c.fill(); }
  if (o.traffic && s >= 1.0) { const pi = GP.query(wx0, wy0, wx1, wy1, []), oo = { w, h, night: 0, parked: true }; for (const i of pi) { const p = PARKED[i]; drawVeh(c, s, th, X, Y, p.x, p.y, p.dx, p.dy, p.type, vehCol(th, p.type, p.k), oo); } }

  lap('props'); const bi = GB.query(wx0 - 20, wy0 - 20, wx1 + 20, wy1 + 60, []).sort((a, b) => a - b); const e = extOf(th, o, s), flatMode = !(e && e * 4 > 1.2), vb = bi.map((i) => BUILD[i]);
  const lit = [];
  if (s < 0.5) {   // LOD: batched fills in chunks (one giant path is very slow to rasterise)
    const CH = 250, chunked = (fillStyle, pass, off) => { c.fillStyle = fillStyle; let n = 0; c.beginPath(); for (const b of vb) { if (pass >= 0 && (b.v > 0.5 ? 1 : 0) !== pass) continue; if (!off && (b.x1 - b.x0) * s < 0.8 && (b.y1 - b.y0) * s < 0.8) continue; const ox = off, oy = off; c.moveTo(X(b.p[0]) + ox, Y(b.p[1]) + oy); for (let k = 2; k < b.p.length; k += 2) c.lineTo(X(b.p[k]) + ox, Y(b.p[k + 1]) + oy); c.closePath(); if (++n >= CH) { c.fill(); c.beginPath(); n = 0; } } c.fill(); };
    if (s >= 0.22) chunked(th.shadow, -1, 1);
    chunked(th.roofs ? th.roofs[0] : th.roof, 0, 0); chunked(th.roofs ? th.roofs[1] : mix(th.roof, '#000', 0.06), 1, 0);
  } else {
    c.fillStyle = th.shadow;
    for (const b of vb) { const eh = flatMode ? Math.min(2.5, 0.5 + s * 1.6) : b.h * e, dx = flatMode ? eh : eh * 0.7, dy = flatMode ? eh : eh * 0.28, steps = flatMode ? 1 : 3; for (let q = 1; q <= steps; q++) { const f = q / steps; c.beginPath(); for (let k = 0; k < b.p.length; k += 2) { const x = X(b.p[k]) + dx * f, y = Y(b.p[k + 1]) + dy * f; k ? c.lineTo(x, y) : c.moveTo(x, y); } c.closePath(); c.fill(); } }
    for (const b of vb) {
      const eh = flatMode ? 0 : b.h * e; let roof; if (b.c) roof = th.church; else if (th.roofs) roof = th.roofs[Math.floor(b.v * th.roofs.length) % th.roofs.length]; else roof = mix(th.roof, b.v > 0.5 ? '#fff' : '#000', 0.06 * Math.abs(b.v - 0.5) * 4);
      const side = th.roofs ? mix(roof, '#000', 0.22) : th.side, sideD = th.roofs ? mix(roof, '#000', 0.42) : th.sideDark;
      if (eh > 0.6) {
        const n = b.p.length / 2;
        for (let k = 0; k < n; k++) {
          const k2 = (k + 1) % n, ax = b.p[k * 2], ay = b.p[k * 2 + 1], bx = b.p[k2 * 2], by = b.p[k2 * 2 + 1], nx = by - ay, ny = -(bx - ax); if (ny >= 0) continue;
          const L = Math.hypot(nx, ny) || 1, ll = 0.5 - (nx / L) * 0.5; c.fillStyle = mix(side, sideD, 1 - ll);
          c.beginPath(); c.moveTo(X(ax), Y(ay)); c.lineTo(X(bx), Y(by)); c.lineTo(X(bx), Y(by) - eh); c.lineTo(X(ax), Y(ay) - eh); c.closePath(); c.fill(); c.strokeStyle = th.bstroke; c.globalAlpha = 0.5; c.lineWidth = 1; c.stroke(); c.globalAlpha = 1;
          if (eh > 9 && s > 1.4 && o.night > 0.05) lit.push([X(ax), Y(ay), X(bx), Y(by), eh, b.id * 31 + k, Math.hypot(bx - ax, by - ay)]);
        }
      }
      c.beginPath(); for (let k = 0; k < b.p.length; k += 2) { const x = X(b.p[k]), y = Y(b.p[k + 1]) - eh; k ? c.lineTo(x, y) : c.moveTo(x, y); } c.closePath();
      c.fillStyle = roof; c.fill(); c.strokeStyle = th.bstroke; c.lineWidth = flatMode && th.ext === 0 ? 1.2 : 0.9; c.stroke();
    }
  }
  lap('buildings'); c.restore();
  c.save(); cityPath(c, X, Y); c.strokeStyle = th.coast; c.lineWidth = clamp(2.5 * Math.sqrt(s * 4), 1.5, 4); c.globalAlpha = 0.85; c.stroke(); c.restore();

  if (o.weather === 'rain') { c.fillStyle = 'rgba(40,52,72,.2)'; c.fillRect(0, 0, w, h); }
  if (o.weather === 'snow') { c.fillStyle = 'rgba(235,240,248,.08)'; c.fillRect(0, 0, w, h); }
  const n = o.night;
  if (n > 0.02) {
    const [r, g, b] = th.nightC; c.fillStyle = `rgba(${r},${g},${b},${n * th.nightA})`; c.fillRect(0, 0, w, h);
    c.save(); c.globalCompositeOperation = 'lighter';
    if (s > 0.9) { const gr = clamp(26 * s, 14, 46); c.globalAlpha = Math.min(1, n * 1.1); const li = GL.query(wx0, wy0, wx1, wy1, []); for (const i of li) { const x = X(LAMPS[i * 2]), y = Y(LAMPS[i * 2 + 1]); c.drawImage(glow, x - gr, y - gr, gr * 2, gr * 2); } }
    c.globalAlpha = Math.min(1, n * 1.2);
    for (const [ax, ay, bx, by, eh, seed, wl] of lit) { const cols = Math.max(1, Math.floor(wl / 3.4)), rows = Math.max(1, Math.floor(eh / (3 * s * 0.55))), rr = Math.min(rows, 6); for (let i = 0; i < cols; i++) for (let j = 0; j < rr; j++) { if (hash1(seed * 13 + i * 7 + j) < 0.45) continue; const t = (i + 0.5) / cols, x = ax + (bx - ax) * t, y = ay + (by - ay) * t - eh * ((j + 0.7) / (rr + 0.4)); c.fillStyle = hash1(seed + i * 3 + j) > 0.7 ? 'rgba(160,210,255,.75)' : 'rgba(255,205,120,.85)'; c.fillRect(x - 1.1, y - 1.1, 2.2 * Math.min(2, s), 2.2 * Math.min(2, s)); } }
    c.restore();
  }
  c.restore();
}
function cityPathAppend(c, X, Y) { if (D.boundary && D.boundary.length) { for (const r of D.boundary) { c.moveTo(X(r[0]), Y(r[1])); for (let k = 2; k < r.length; k += 2) c.lineTo(X(r[k]), Y(r[k + 1])); c.closePath(); } } else c.rect(X(-HW), Y(HH), X(HW) - X(-HW), Y(-HH) - Y(HH)); }

/* ------------------------------------------------------------------ traffic drawing (live every frame) */
function paintTraffic(c, w, h, v, th, o) {
  const s = v.s; if (s < 0.26) return;
  const X = (x) => (x - v.cx) * s + w / 2, Y = (y) => h / 2 - (y - v.cy) * s, oo = { w, h, night: o.night };
  const n = Math.min(sim.active || sim.cars.length, sim.cars.length);
  for (let i = 0; i < n; i++) { const car = sim.cars[i], e = E[car.e], off = Math.max(1.2, ROAD[e.cls][0] * 0.25); drawVeh(c, s, th, X, Y, e.ax + e.dx * car.s + e.dy * off, e.ay + e.dy * car.s - e.dx * off, e.dx, e.dy, car.type, vehCol(th, car.type, car.col), { ...oo, brake: car.brake }); }
  for (const b of sim.buses) { const [x, y, dx, dy] = busAt(b.L, b.d), d = b.dir, ddx = dx * d, ddy = dy * d; drawVeh(c, s, th, X, Y, x + ddy * 1.7, y - ddx * 1.7, ddx, ddy, 'bus', th.busColor, { ...oo, brake: b.v < 0.3 && b.dwell > 0 }); }
}

const minImp = (s) => (s >= 1.0 ? 1 : s >= 0.6 ? 2 : s >= 0.3 ? 3 : 4);
/* blips: priority order + de-clutter (one blip per cell); signed POIs are shown as sign plates instead */
const POIS_BY_IMP = POIS.slice().sort((a, b) => KINDS[b.k].imp - KINDS[a.k].imp);
let signedIds = new Set();
function pickBlips(v, w, h, skipSigned) {
  const s = v.s; if (s < 0.16) return []; const rr = clamp(7 + s * 2.4, 8.5, 13), cell = rr * 1.7, taken = new Set(), out = [];
  const X = (x) => (x - v.cx) * s + w / 2, Y = (y) => h / 2 - (y - v.cy) * s;
  for (const p of POIS_BY_IMP) {
    if (state.hidden.has(p.k)) continue; if (KINDS[p.k].imp < minImp(s)) continue; if (skipSigned && signedIds.has(p.id) && !(state.pulse && state.pulse.id === p.id)) continue;
    const x = X(p.x), y = Y(p.y); if (x < -20 || x > w + 20 || y < -20 || y > h + 20) continue; const key = Math.floor(x / cell) * 4096 + Math.floor(y / cell); if (taken.has(key)) continue; taken.add(key); out.push(p);
  }
  return out;
}

/* ------------------------------------------------------------------ labels layer */
function paintLabels(c, w, h, v, th, o) {
  const s = v.s, X = (x) => (x - v.cx) * s + w / 2, Y = (y) => h / 2 - (y - v.cy) * s;
  const wx0 = v.cx - w / 2 / s, wx1 = v.cx + w / 2 / s, wy0 = v.cy - h / 2 / s, wy1 = v.cy + h / 2 / s;
  const occ = [], hit = (b) => occ.some((q) => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]), take = (b) => { occ.push(b); return true; };
  const onscreen = (x, y, m = 30) => x > -m && x < w + m && y > -m && y < h + m;
  c.save(); c.textBaseline = 'middle';
  if (o.lines && s >= 0.3) for (const L of sim.lines) {
    c.save(); c.strokeStyle = th.busLine; c.globalAlpha = 0.75; c.lineWidth = clamp(3.2 * s + 1.4, 2, 5); c.setLineDash([10, 6]); c.lineJoin = 'round'; c.beginPath(); L.pts.forEach((p, i) => (i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1])))); c.stroke(); c.restore();
    const [mx, my] = busAt(L, L.len * 0.5), px = X(mx), py = Y(my); if (onscreen(px, py)) { c.fillStyle = th.busLine; rrect(c, px - 11, py - 8, 22, 16, 5); c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.stroke(); c.fillStyle = '#fff'; c.font = `700 11px ${FONT}`; c.textAlign = 'center'; c.fillText(L.ref || 'BUS', px, py + 0.5); }
  }
  if (!o.labels) { c.restore(); return; }
  const rr = clamp(7 + s * 2.4, 8.5, 13);
  const shown = s < 0.16 ? [] : POIS.filter((p) => !state.hidden.has(p.k) && p.x > wx0 - 100 && p.x < wx1 + 100 && p.y > wy0 - 100 && p.y < wy1 + 100 && KINDS[p.k].imp >= minImp(s));
  const signed = new Set(), signNames = new Set();
  if (s >= 1.3) {
    const e = extOf(th, o, s), ex = e && e * 4 > 1.2; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const p of shown) {
      if (!p.n || !SIGN[p.k]) continue; const b = p.bld, ax = b ? b.cx : p.x, ay = b ? b.cy : p.y, eh = b && ex ? b.h * e : 0; const x = X(ax); let y = Y(ay) - eh; if (!onscreen(x, y, 100)) continue;
      c.font = `600 ${clamp(10 + s * 1.5, 11, 14)}px ${FONT}`; const tw = c.measureText(p.n).width, bw = tw + 18, bh = clamp(15 + s * 2, 17, 22);
      let box = [x - bw / 2, y - bh / 2, x + bw / 2, y + bh / 2]; if (hit(box)) { y -= bh + 4; box = [x - bw / 2, y - bh / 2, x + bw / 2, y + bh / 2]; if (hit(box)) continue; } take(box);
      c.save(); c.shadowColor = 'rgba(0,0,0,.4)'; c.shadowBlur = 5; c.shadowOffsetY = 2; rrect(c, x - bw / 2, y - bh / 2, bw, bh, 4); c.fillStyle = KINDS[p.k].color; c.fill(); c.restore();
      rrect(c, x - bw / 2 + 6, y - bh / 2, bw - 6, bh, 4); c.fillStyle = th.signBg || 'rgba(255,255,255,.95)'; c.fill(); c.fillRect(x - bw / 2 + 6, y - bh / 2 + 1, 4, bh - 2);
      c.lineWidth = 1; c.strokeStyle = 'rgba(0,0,0,.55)'; rrect(c, x - bw / 2, y - bh / 2, bw, bh, 4); c.stroke();
      c.fillStyle = th.signInk || '#1d1f23'; c.fillText(p.n, x + 3, y + 0.5); signed.add(p.id); signNames.add(p.n);
    }
    if (s >= 2.2) { c.font = `italic 500 ${clamp(9 + s * 1.2, 10, 13)}px ${FONT}`; for (const b of BNAMED) { if (signNames.has(b.n) || b.cx < wx0 || b.cx > wx1 || b.cy < wy0 || b.cy > wy1) continue; const x = X(b.cx), y = Y(b.cy) - (ex ? b.h * e : 0); const tw = c.measureText(b.n).width, box = [x - tw / 2, y - 7, x + tw / 2, y + 7]; if (hit(box)) continue; take(box); haloText(c, b.n, x, y, th.text, th.halo, 3); } }
    c.textAlign = 'left';
  }
  signedIds = signed;
  for (const p of pickBlips(v, w, h, true)) { const x = X(p.x), y = Y(p.y); occ.push([x - rr - 2, y - rr - 2, x + rr + 2, y + rr + 2]); }
  const prio = { city: 0, town: 1, village: 2, suburb: 3, quarter: 3, borough: 3, neighbourhood: 4, hamlet: 5, locality: 6, isolated_dwelling: 7 };
  const places = PLACES.filter((p) => inCity(p.x, p.y) || p.t === 'town' || p.t === 'city').sort((a, b) => (prio[a.t] ?? 9) - (prio[b.t] ?? 9));
  const pf = (px) => th.placeFont.replace('{px}', px.toFixed(1));
  for (const p of places) {
    const x = X(p.x), y = Y(p.y); if (!onscreen(x, y, 120)) continue;
    const kind = p.t === 'city' ? 'city' : p.t === 'town' || p.t === 'village' ? 'town' : (p.t === 'suburb' || p.t === 'quarter' || p.t === 'borough' || p.t === 'neighbourhood') ? 'district' : 'small';
    if (kind === 'district' && (s > 2.6 || s < 0.12)) continue; if (kind === 'small' && s < 0.2) continue;
    const px = kind === 'city' ? clamp(22 + s * 60, 26, 64) : kind === 'town' ? clamp(15 + s * 26, 20, 44) : kind === 'district' ? clamp(14 + s * 14, 15, 30) : clamp(11 + s * 6, 12, 17);
    c.font = pf(px); const name = kind === 'small' ? p.n : p.n.toUpperCase(), sp = kind === 'city' ? px * 0.3 : kind === 'district' ? px * 0.34 : kind === 'town' ? px * 0.22 : px * 0.1;
    const ww = spacedWidth(c, name, sp); let yy = y, box = null;
    for (const off of kind === 'city' || kind === 'town' ? [-1.1, 1.2, -2.3, 2.4, 0] : [0]) { yy = y + off * px; box = [x - ww / 2 - 4, yy - px / 2, x + ww / 2 + 4, yy + px / 2]; if (!hit(box) || ((kind === 'town' || kind === 'city') && off === 0)) break; }
    if (hit(box) && kind !== 'town' && kind !== 'city') continue; take(box);
    c.globalAlpha = kind === 'district' ? 0.72 : 0.88; const hw = th.outlinePlace ? Math.max(3, px * 0.16) : kind === 'district' ? 3 : 4.5;
    spacedText(c, name, x, yy, sp, th.place, th.placeHalo, hw); c.globalAlpha = 1;
  }
  for (const p of PEAKS) {
    const x = X(p.x), y = Y(p.y); if (!onscreen(x, y, 60) || s < 0.2) continue;
    c.fillStyle = '#7a5a3a'; c.strokeStyle = th.halo; c.lineWidth = 2; c.beginPath(); c.moveTo(x, y - 7); c.lineTo(x + 6, y + 4); c.lineTo(x - 6, y + 4); c.closePath(); c.stroke(); c.fill();
    const ele = p.e || (elevAt(p.x, p.y) ? Math.round(elevAt(p.x, p.y)) : ''); c.font = `600 ${clamp(11 + s * 2, 12, 14)}px ${FONT}`; c.textAlign = 'left';
    const label = p.n + (ele ? ` · ${ele} m` : ''), ww = c.measureText(label).width, box = [x + 9, y - 8, x + 12 + ww, y + 8]; if (!hit(box)) { take(box); haloText(c, label, x + 11, y, th.text, th.halo); }
  }
  c.font = `500 ${clamp(11 + s * 2.2, 12, 15)}px ${FONT}`; c.textAlign = 'left';
  for (const p of shown) { if (!p.n || s < 0.55 || signed.has(p.id)) continue; const x = X(p.x), y = Y(p.y); if (!onscreen(x, y)) continue; const ww = c.measureText(p.n).width, box = [x + rr + 4, y - 8, x + rr + 8 + ww, y + 8]; if (hit(box)) continue; take(box); haloText(c, p.n, x + rr + 6, y, th.text, th.halo); }
  c.textAlign = 'center';
  for (const a of D.areaNames) {
    if (!a.n || !(a.c === 'water' || a.c === 'town' || a.c === 'forest') || a.x < wx0 || a.x > wx1 || a.y < wy0 || a.y > wy1) continue;
    const x = X(a.x), y = Y(a.y), size = Math.sqrt(a.a) * s; if (size < 70) continue; const wat = a.c === 'water'; c.font = `${wat ? 'italic 500' : '500'} ${wat ? 13 : 12}px ${FONT}`;
    const name = wat ? a.n : a.n.toUpperCase(), ww = c.measureText(name).width + (wat ? 0 : name.length * 3), box = [x - ww / 2, y - 8, x + ww / 2, y + 8]; if (hit(box) || ww > size * 1.3) continue; take(box);
    if (wat) haloText(c, name, x, y, th.waterText, th.halo, 3); else { c.globalAlpha = 0.8; spacedText(c, name, x, y, 3, th.place, th.halo, 3); c.globalAlpha = 1; }
  }
  for (const r of RESERVES) {
    if (!r.n || s < 0.28 || !(r.x1 > wx0 && r.x0 < wx1 && r.y1 > wy0 && r.y0 < wy1)) continue; const x = X((r.x0 + r.x1) / 2), y = Y((r.y0 + r.y1) / 2); if (!onscreen(x, y, 80)) continue;
    c.font = `italic 500 12px ${FONT}`; const ww = c.measureText(r.n).width, box = [x - ww / 2, y - 8, x + ww / 2, y + 8]; if (hit(box) || ww > (r.x1 - r.x0) * s) continue; take(box);
    c.globalAlpha = 0.9; haloText(c, r.n, x, y, mix(th.reserve, th.text, 0.45), th.halo, 3); c.globalAlpha = 1;
  }
  if (o.roads && s >= 0.5) {
    const placedBy = {}; let count = 0;
    for (const r of NAMED_ROADS) {
      if (r.len * s < 70 || r.x1 < wx0 || r.x0 > wx1 || r.y1 < wy0 || r.y0 > wy1) continue; if (++count > 700) break;
      const pts = []; for (let k = 0; k < r.p.length; k += 2) pts.push([X(r.p[k]), Y(r.p[k + 1])]); let run = [], best = [];
      for (const p of pts) { if (onscreen(p[0], p[1], 0)) run.push(p); else { if (run.length > best.length) best = run; run = []; } } if (run.length > best.length) best = run; if (best.length < 2) continue;
      const px = r.c === 'major' || r.c === 'second' ? 13 : 12; c.font = `600 ${clamp(px * (0.7 + s * 0.35), 11, 15)}px ${FONT}`;
      const mp = best[best.length >> 1], prevs = placedBy[r.n] || []; if (prevs.some((q) => Math.hypot(q[0] - mp[0], q[1] - mp[1]) < 260)) continue;
      const tmpb = pathTextBox(c, r.n, best); if (!tmpb || hit(tmpb)) continue; c.textBaseline = 'middle';
      const res = pathText(c, r.n, best, th.text, th.halo, 3.4); if (res) { take(res); (placedBy[r.n] = prevs).push(mp); }
    }
  }
  c.restore();
}

/* ------------------------------------------------------------------ dynamic overlay: route, blips, player, selection */
function paintDynamic(c, w, h, v, th, o) {
  const s = v.s, X = (x) => (x - v.cx) * s + w / 2, Y = (y) => h / 2 - (y - v.cy) * s, onscreen = (x, y, m = 30) => x > -m && x < w + m && y > -m && y < h + m;
  if (route) {
    c.save(); c.lineJoin = 'round'; c.lineCap = 'round'; const path = () => { c.beginPath(); route.pts.forEach((p, i) => (i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1])))); };
    path(); c.strokeStyle = 'rgba(0,0,0,.7)'; c.lineWidth = Math.max(5, 9 * Math.min(1, s * 1.5 + 0.2)); c.stroke(); path(); c.strokeStyle = th.route; c.lineWidth = Math.max(3, 6 * Math.min(1, s * 1.5 + 0.2)); c.stroke();
    c.fillStyle = '#fff'; let acc = 0; const step = 46;
    for (let i = 1; i < route.pts.length; i++) { const ax = X(route.pts[i - 1][0]), ay = Y(route.pts[i - 1][1]), bx = X(route.pts[i][0]), by = Y(route.pts[i][1]), L = Math.hypot(bx - ax, by - ay); if (!L) continue; const ang = Math.atan2(by - ay, bx - ax); let d = step - (acc % step); if (acc % step === 0) d = step; for (; d < L; d += step) { const px = ax + (bx - ax) * d / L, py = ay + (by - ay) * d / L; if (!onscreen(px, py, 10)) continue; c.save(); c.translate(px, py); c.rotate(ang); c.beginPath(); c.moveTo(3.5, 0); c.lineTo(-2.5, -3.2); c.lineTo(-2.5, 3.2); c.closePath(); c.fill(); c.restore(); } acc += L; }
    c.restore();
  }
  if (state.selected) {
    const b = state.selected, e = extOf(th, state.flags, s), eh = e && e * 4 > 1.2 ? b.h * e : 0; c.save(); c.beginPath(); for (let k = 0; k < b.p.length; k += 2) { const x = X(b.p[k]), y = Y(b.p[k + 1]) - eh; k ? c.lineTo(x, y) : c.moveTo(x, y); } c.closePath();
    c.fillStyle = 'rgba(255,255,255,.28)'; c.fill(); c.lineWidth = 4; c.strokeStyle = '#0b0c0f'; c.stroke(); c.lineWidth = 2; c.strokeStyle = th.ui ? th.ui.accent : '#f1c232'; c.stroke(); c.restore();
  }
  const rr = clamp(7 + s * 2.4, 8.5, 13), now = performance.now();
  for (const p of pickBlips(v, w, h, s >= 1.3)) {
    const x = X(p.x), y = Y(p.y); let pulse = 0; if (state.pulse && state.pulse.id === p.id) { const t = (now - state.pulse.t) / 1600; if (t < 1) pulse = t % 1; }
    blip(c, p.k, x, y, rr * (state.hover && state.hover.id === p.id && state.hover.type === 'poi' ? 1.2 : 1), { pulse });
  }
  if (waypoint) { const x = X(waypoint.x), y = Y(waypoint.y); c.save(); c.translate(x, y); c.beginPath(); c.moveTo(0, 0); c.bezierCurveTo(-13, -14, -11, -30, 0, -30); c.bezierCurveTo(11, -30, 13, -14, 0, 0); c.fillStyle = th.route; c.strokeStyle = '#fff'; c.lineWidth = 2.5; c.stroke(); c.fill(); c.beginPath(); c.arc(0, -19, 4.5, 0, 7); c.fillStyle = '#fff'; c.fill(); c.restore(); }
  { const x = X(player.x), y = Y(player.y); c.save(); c.translate(x, y); c.beginPath(); c.arc(0, 0, 13, 0, 7); c.fillStyle = 'rgba(255,255,255,.28)'; c.fill(); c.rotate(-player.ang + Math.PI / 2); c.beginPath(); c.moveTo(0, -10); c.lineTo(8, 8); c.lineTo(0, 4); c.lineTo(-8, 8); c.closePath(); c.fillStyle = '#fff'; c.strokeStyle = '#0b0c0f'; c.lineWidth = 2.4; c.lineJoin = 'round'; c.stroke(); c.fill(); c.restore(); }
}

/* ------------------------------------------------------------------ weather + screen fx */
const parts = []; let partKind = '';
function resetParticles() { parts.length = 0; partKind = state.weather; if (state.weather !== 'rain' && state.weather !== 'snow') return; const n = Math.round((state.weather === 'rain' ? 320 : 240) * (W * H) / (1500 * 900)); for (let i = 0; i < n; i++) parts.push({ x: Math.random() * W, y: Math.random() * H, z: 0.5 + Math.random() }); }
function paintWeather(c, w, h, dt) {
  if (state.weather === 'fog') { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(226,231,236,.55)'); g.addColorStop(1, 'rgba(226,231,236,.38)'); c.fillStyle = g; c.fillRect(0, 0, w, h); return; }
  if (partKind !== state.weather) resetParticles(); if (!parts.length) return;
  if (state.weather === 'rain') { c.strokeStyle = 'rgba(190,210,235,.55)'; c.lineWidth = 1.1; c.beginPath(); for (const p of parts) { p.y += 900 * p.z * dt; p.x -= 160 * p.z * dt; if (p.y > h) { p.y = -20; p.x = Math.random() * (w + 100); } c.moveTo(p.x, p.y); c.lineTo(p.x + 3 * p.z, p.y - 13 * p.z); } c.stroke(); }
  else { c.fillStyle = 'rgba(255,255,255,.9)'; for (const p of parts) { p.y += 60 * p.z * dt; p.x += Math.sin(p.y / 40 + p.z * 9) * 14 * dt; if (p.y > h) { p.y = -5; p.x = Math.random() * w; } c.beginPath(); c.arc(p.x, p.y, 1.1 + p.z * 1.2, 0, 7); c.fill(); } }
}
const grainPat = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'), d = x.createImageData(128, 128), r = rng(5); for (let i = 0; i < d.data.length; i += 4) { const v = r() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; } x.putImageData(d, 0, 0); return c; })();
function paintFx(c, w, h, th) {
  const fx = th.fx || {}; if (fx.grain) { c.save(); c.globalAlpha = fx.grain; c.globalCompositeOperation = 'overlay'; c.fillStyle = c.createPattern(grainPat, 'repeat'); c.fillRect(0, 0, w, h); c.restore(); }
  if (fx.vig) { const g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.max(w, h) * 0.78); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${fx.vig})`); c.fillStyle = g; c.fillRect(0, 0, w, h); }
}

/* ------------------------------------------------------------------ cached layers (smooth pan/zoom) */
function mkLayer() { const c = document.createElement('canvas'); return { c, x: c.getContext('2d'), v: null, w: 0, h: 0, sc: 1, dirty: true, force: true }; }
const layers = { base: mkLayer(), lab: mkLayer() };
let lastInteract = 0;
const sceneOpts = () => ({ ...state.flags, night: nightOf(state.hour), weather: state.weather });
function invalidate() { layers.base.dirty = layers.lab.dirty = true; layers.base.force = layers.lab.force = true; }
function allocLayers() {
  const mx = W * 0.25, my = H * 0.25; const th = THEMES[state.theme];
  for (const [k, L] of Object.entries(layers)) { L.w = W + 2 * mx; L.h = H + 2 * my; L.sc = k === 'base' ? Math.min(dpr, 1.5) * (th.pixel || 1) : Math.min(dpr, 2); L.c.width = Math.round(L.w * L.sc); L.c.height = Math.round(L.h * L.sc); L.v = null; L.dirty = true; L.force = true; }
}
function renderLayer(k) {
  const L = layers[k], th = curTheme(), o = sceneOpts(); L.v = { cx: view.cx, cy: view.cy, s: view.s }; L.dirty = false; L.force = false;
  L.x.setTransform(1, 0, 0, 1, 0, 0); if (k === 'lab') L.x.clearRect(0, 0, L.c.width, L.c.height);
  L.x.setTransform(L.c.width / L.w, 0, 0, L.c.height / L.h, 0, 0);
  if (k === 'base') paintScene(L.x, L.w, L.h, L.v, th, o); else paintLabels(L.x, L.w, L.h, L.v, th, o);
}
function layerOk(L) { if (!L.v) return false; const r = view.s / L.v.s; if (r < 0.55 || r > 1.8) return false; const px = (L.v.cx - view.cx) * view.s + W / 2, py = H / 2 - (L.v.cy - view.cy) * view.s; return px - L.w * r / 2 <= 2 && px + L.w * r / 2 >= W - 2 && py - L.h * r / 2 <= 2 && py + L.h * r / 2 >= H - 2; }
function layerStale(L) { if (!L.v) return true; return Math.abs(view.s / L.v.s - 1) > 0.002 || Math.abs(L.v.cx - view.cx) * view.s > 3 || Math.abs(L.v.cy - view.cy) * view.s > 3; }
function present(L, smooth) {
  // copy only the visible part of the cached layer (cheaper than blitting the whole oversized bitmap)
  const r = view.s / L.v.s, dx = (L.v.cx - view.cx) * view.s + W / 2 - L.w * r / 2, dy = H / 2 - (L.v.cy - view.cy) * view.s - L.h * r / 2, dw = L.w * r, dh = L.h * r;
  const x0 = Math.max(0, dx), y0 = Math.max(0, dy), x1 = Math.min(W, dx + dw), y1 = Math.min(H, dy + dh); if (x1 <= x0 || y1 <= y0) return;
  const kx = L.c.width / dw, ky = L.c.height / dh; ctx.imageSmoothingEnabled = smooth;
  ctx.drawImage(L.c, (x0 - dx) * kx, (y0 - dy) * ky, (x1 - x0) * kx, (y1 - y0) * ky, x0, y0, x1 - x0, y1 - y0);
}

/* ------------------------------------------------------------------ frame loop */
function applyUi(th) {
  const u = th.ui, r = document.documentElement.style; document.body.dataset.style = state.theme;
  r.setProperty('--accent', u.accent); r.setProperty('--accent-ink', u.ink); r.setProperty('--display', `${u.display},'Oswald',Impact,sans-serif`); r.setProperty('--panel', u.panel); r.setProperty('--title-skew', u.skew); r.setProperty('--title-fill', u.fill); r.setProperty('--pink', state.theme === 'vc' ? '#33e0ff' : '#e04fd3');
}
function resize() {
  const r = $('#stage').getBoundingClientRect(); dpr = Math.min(window.devicePixelRatio || 1, 2); W = r.width; H = r.height; canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  MIN_S = Math.min(W / (2 * HW), H / (2 * HH)) * 0.45; allocLayers(); resetParticles(); sim.vKey = '';
}
let lastT = 0, hourPainted = -1;
function frame(t) {
  requestAnimationFrame(frame); const dt = Math.min(0.05, (t - (lastT || t)) / 1000); lastT = t;
  if (state.timeRun) { state.hour = (state.hour + dt * 0.25) % 24; if (Math.abs(state.hour - hourPainted) > 0.06 || state.hour < hourPainted) { hourPainted = state.hour; invalidate(); updateClock(); $('#hour').value = state.hour; $('#hourLbl').textContent = fmtHour(state.hour); } }
  if (state.flags.traffic) stepTraffic(dt);
  if (driving) {
    const d2 = Math.min(0.05, (t - driving.last) / 1000); driving.last = t; const remain = route.len - driving.d, target = remain < 60 ? Math.max(6, remain / 3) : 24;
    driving.v += (target - driving.v) * Math.min(1, d2 * 1.8); driving.d = Math.min(route.len, driving.d + driving.v * d2); const [x, y, ang] = routeAt(driving.d); player.x = x; player.y = y; player.ang = ang;
    if (follow) { view.cx += (x - view.cx) * Math.min(1, d2 * 4); view.cy += (y - view.cy) * Math.min(1, d2 * 4); lastInteract = t; }
    if (driving.d >= route.len - 0.5) { driving = null; $('#drive').textContent = '▶ Drive'; toast('You have arrived'); route = null; waypoint = null; $('#gps').classList.remove('on'); }
  }
  if (anim) { const k = clamp((t - anim.t0) / anim.dur, 0, 1), e = 1 - Math.pow(1 - k, 3); view.cx = anim.a.cx + (anim.b.cx - anim.a.cx) * e; view.cy = anim.a.cy + (anim.b.cy - anim.a.cy) * e; view.s = Math.exp(Math.log(anim.a.s) + (Math.log(anim.b.s) - Math.log(anim.a.s)) * e); if (k >= 1) anim = null; lastInteract = t; }
  const th = curTheme(), o = sceneOpts(), idle = t - lastInteract > 110 && !ptrs.size && !anim;
  let rendered = false;
  for (const k of ['base', 'lab']) { const L = layers[k]; if (rendered) break; if (L.force || !L.v || !layerOk(L) || (L.dirty && idle) || (idle && layerStale(L))) { renderLayer(k); rendered = true; } }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); present(layers.base, !th.pixel);
  if (state.flags.traffic) paintTraffic(ctx, W, H, view, th, o);
  if (layers.lab.v) present(layers.lab, true);
  paintDynamic(ctx, W, H, view, th, o); paintWeather(ctx, W, H, dt); paintFx(ctx, W, H, th);
}
function flyTo(cx, cy, s) { anim = { a: { ...view }, b: { cx, cy, s: clamp(s, MIN_S, MAX_S) }, t0: performance.now(), dur: 650 }; }
const touch = () => { lastInteract = performance.now(); };

/* ------------------------------------------------------------------ routing UI */
function routeAt(d) { const cum = route.cum; let i = 1; while (i < cum.length - 1 && cum[i] < d) i++; const a = route.pts[i - 1], b = route.pts[i], L = cum[i] - cum[i - 1] || 1, t = clamp((d - cum[i - 1]) / L, 0, 1); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Math.atan2(b[1] - a[1], b[0] - a[0])]; }
function setWaypoint(x, y) {
  const a = nearestNode(player.x, player.y, 400), b = nearestNode(x, y, 250); if (driving) { driving = null; $('#drive').textContent = '▶ Drive'; }
  if (a < 0 || b < 0) { toast('No road here'); return; }
  const r = sssp(a, 1, null, b); if (!isFinite(r.dist[b])) { toast('Route not found'); return; } const pts = pathTo(r.prev, b);
  const full = [[player.x, player.y], ...pts], cum = [0]; for (let i = 1; i < full.length; i++) cum.push(cum[i - 1] + Math.hypot(full[i][0] - full[i - 1][0], full[i][1] - full[i - 1][1]));
  const L = cum[cum.length - 1], time = L / 13.5; waypoint = { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] }; route = { pts: full, cum, len: L };
  $('#gpsInfo').textContent = `${L >= 1000 ? (L / 1000).toFixed(1).replace('.', ',') + ' km' : Math.round(L) + ' m'} · ${Math.max(1, Math.round(time / 60))} min`; $('#gps').classList.add('on');
}
function clearRoute() { if (driving) { driving = null; $('#drive').textContent = '▶ Drive'; } route = null; waypoint = null; $('#gps').classList.remove('on'); }
$('#drive').onclick = () => { if (!route) return; if (driving) { driving = null; $('#drive').textContent = '▶ Drive'; return; } driving = { d: 0, v: 0, last: performance.now() }; follow = true; $('#drive').textContent = '❚❚ Stop'; flyTo(player.x, player.y, Math.max(view.s, 0.9)); };
$('#clear').onclick = clearRoute;

/* ------------------------------------------------------------------ building info + hit tests */
function buildingAt(wx, wy) {
  const th = curTheme(), e = extOf(th, state.flags, view.s), ex = e && e * 4 > 1.2, ext = ex ? 60 * e / view.s : 0; const ids = GB.query(wx - 2, wy - 2, wx + 2, wy + ext + 2, []).sort((a, b) => b - a);
  for (const i of ids) { const b = BUILD[i], eh = ex ? b.h * e / view.s : 0; if (wx < b.x0 - 1 || wx > b.x1 + 1 || wy < b.y0 - 1 || wy > b.y1 + eh + 1) continue; if (inRings(wx, wy - eh, [b.p]) || inRings(wx, wy, [b.p])) return b; }
  return null;
}
function showCard(b) {
  state.selected = b; const card = $('#card'); if (!b) { card.classList.remove('on'); return; }
  if (!b.area) b.area = polyArea(b.p);
  $('#cardT').textContent = b.t || 'Building'; $('#cardH').textContent = b.n || b.a || b.t || 'Building';
  const rows = []; if (b.a) rows.push(['Address', b.a]); rows.push(['Height', `~${Math.round(b.h)} m`]); if (b.l) rows.push(['Floors', b.l]); rows.push(['Footprint', `${Math.round(b.area)} m²`]);
  const [lat, lon] = [D.lat0 + b.cy / D.ky, D.lon0 + b.cx / D.kx]; rows.push(['Location', `${lat.toFixed(5)}, ${lon.toFixed(5)}`]);
  $('#cardD').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join(''); card.classList.add('on');
}
$('#cardX').onclick = () => showCard(null);

/* ------------------------------------------------------------------ input */
const stage = $('#stage'); const ptrs = new Map(); let lastPinch = 0, moved = 0;
stage.addEventListener('pointerdown', (e) => { if (e.target.closest('.btn,#panel,#gps,#card,#search')) return; stage.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); stage.classList.add('drag'); moved = 0; anim = null; follow = false; touch(); });
stage.addEventListener('pointermove', (e) => {
  const rect = stage.getBoundingClientRect(), px = e.clientX - rect.left, py = e.clientY - rect.top;
  if (ptrs.has(e.pointerId)) {
    touch(); const p = ptrs.get(e.pointerId); if (ptrs.size === 1) { view.cx -= (e.clientX - p[0]) / view.s; view.cy += (e.clientY - p[1]) / view.s; moved += Math.abs(e.clientX - p[0]) + Math.abs(e.clientY - p[1]); }
    ptrs.set(e.pointerId, [e.clientX, e.clientY]); if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (lastPinch) zoomAt(d / lastPinch, (a[0] + b[0]) / 2 - rect.left, (a[1] + b[1]) / 2 - rect.top); lastPinch = d; moved += 10; }
  } else hoverAt(px, py);
  const [wx, wy] = s2w(px, py), el = elevAt(wx, wy);
  $('#coords').textContent = `${(D.lat0 + wy / D.ky).toFixed(5)}°N  ${(D.lon0 + wx / D.kx).toFixed(5)}°E${el ? '  ·  ' + Math.round(el) + ' m n. m.' : ''}`;
});
stage.addEventListener('pointerup', (e) => {
  const wasClick = ptrs.has(e.pointerId) && ptrs.size === 1 && moved < 6; ptrs.delete(e.pointerId); lastPinch = 0; if (!ptrs.size) stage.classList.remove('drag'); touch();
  if (wasClick && !e.target.closest('.btn,#panel,#gps,#card,#search')) { const r = stage.getBoundingClientRect(), [wx, wy] = s2w(e.clientX - r.left, e.clientY - r.top); showCard(buildingAt(wx, wy)); }
});
stage.addEventListener('pointercancel', (e) => { ptrs.delete(e.pointerId); lastPinch = 0; stage.classList.remove('drag'); });
stage.addEventListener('wheel', (e) => { e.preventDefault(); const r = stage.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
stage.addEventListener('dblclick', (e) => { if (e.target.closest('.btn,#panel,#gps,#card,#search')) return; const r = stage.getBoundingClientRect(), [x, y] = s2w(e.clientX - r.left, e.clientY - r.top); setWaypoint(x, y); });
function zoomAt(f, px, py) { const [wx, wy] = s2w(px, py); view.s = clamp(view.s * f, MIN_S, MAX_S); view.cx = wx - (px - W / 2) / view.s; view.cy = wy + (py - H / 2) / view.s; touch(); }
$('#zin').onclick = () => zoomAt(1.6, W / 2, H / 2); $('#zout').onclick = () => zoomAt(1 / 1.6, W / 2, H / 2);
$('#home').onclick = () => { const h = fitView(); flyTo(h.cx, h.cy, h.s); };
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
  if (e.key === '/') { e.preventDefault(); $('#q').focus(); } if (e.key === '+' || e.key === '=') zoomAt(1.4, W / 2, H / 2); if (e.key === '-') zoomAt(1 / 1.4, W / 2, H / 2); if (e.key === 'Escape') { clearRoute(); showCard(null); }
});
window.addEventListener('resize', resize);
$('#togglePanel').onclick = () => $('#panel').classList.toggle('open');
function hoverAt(px, py) {
  let best = null, bd = 1e9; const rr = clamp(7 + view.s * 2.4, 8.5, 13);
  if (view.s >= 0.16) for (const p of POIS) { if (state.hidden.has(p.k)) continue; const [x, y] = w2s(p.x, p.y), d = (x - px) ** 2 + (y - py) ** 2; if (d < (rr + 6) ** 2 && d < bd) { bd = d; best = { type: 'poi', id: p.id, o: p }; } }
  const tip = $('#tip');
  if (best) { const o = best.o, K = KINDS[o.k], rows = []; if (o.a) rows.push(o.a); if (o.e) rows.push(o.e + ' m n. m.'); if (o.oh) rows.push(o.oh); tip.innerHTML = `<b>${esc(o.n || K.label)}</b><span>${esc(K.label)}${rows.length ? ' · ' + esc(rows.join(' · ')) : ''}</span>`; const r = stage.getBoundingClientRect(); tip.style.display = 'block'; tip.style.left = Math.min(r.width - 270, px + 16) + 'px'; tip.style.top = Math.max(8, py - 12) + 'px'; stage.style.cursor = 'pointer'; }
  else { tip.style.display = 'none'; stage.style.cursor = ''; }
  state.hover = best;
}
let toastT; function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2200); }

/* ------------------------------------------------------------------ search */
const SEARCH = [];
(function buildIndex() {
  for (const p of POIS) if (p.n) SEARCH.push({ n: p.n, sub: KINDS[p.k].label, x: p.x, y: p.y, z: 1.8, k: p.k, id: p.id });
  for (const p of PLACES) SEARCH.push({ n: p.n, sub: 'Place', x: p.x, y: p.y, z: 0.9 });
  for (const p of PEAKS) SEARCH.push({ n: p.n, sub: 'Peak', x: p.x, y: p.y, z: 1.2, k: 'vrchol' });
  const st = new Map(); for (const r of ROADS) if (r.n && r.len > 20 && (!st.has(r.n) || st.get(r.n).len < r.len)) st.set(r.n, r);
  for (const [n, r] of st) { const m = r.p.length / 4 | 0; SEARCH.push({ n, sub: 'Street', x: r.p[m * 2], y: r.p[m * 2 + 1], z: 1.2 }); }
  for (const b of BUILD) if (b.n || b.a) SEARCH.push({ n: b.n || b.a, sub: b.n && b.a ? b.a : b.t, x: b.cx, y: b.cy, z: 3.2, b });
  for (const s of SEARCH) s.q = norm(s.n + ' ' + (s.b && s.b.a || ''));
})();
let resSel = 0, resList = [];
function runSearch() {
  const q = norm($('#q').value.trim()), box = $('#results'); if (!q) { box.style.display = 'none'; return; }
  resList = SEARCH.map((s) => ({ s, sc: s.q.startsWith(q) ? 0 : s.q.includes(' ' + q) ? 1 : s.q.includes(q) ? 2 : 9 })).filter((r) => r.sc < 9).sort((a, b) => a.sc - b.sc || a.s.n.length - b.s.n.length).slice(0, 8).map((r) => r.s); resSel = 0;
  box.innerHTML = resList.length ? resList.map((r, i) => `<div data-i="${i}" class="${i ? '' : 'sel'}">${esc(r.n)}<small>${esc(r.sub)}</small></div>`).join('') : '<div style="color:#9aa3ad">Nic nenalezeno</div>'; box.style.display = 'block';
  box.querySelectorAll('div[data-i]').forEach((d) => { d.onclick = () => pick(resList[+d.dataset.i]); });
}
function pick(r) { if (!r) return; $('#results').style.display = 'none'; $('#q').value = r.n; $('#q').blur(); flyTo(r.x, r.y, Math.max(r.z, 0.9)); if (r.id !== undefined) state.pulse = { id: r.id, t: performance.now() }; showCard(r.b || null); }
$('#q').addEventListener('input', runSearch);
$('#q').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') pick(resList[resSel]); else if (e.key === 'Escape') { $('#results').style.display = 'none'; $('#q').blur(); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); resSel = (resSel + (e.key === 'ArrowDown' ? 1 : -1) + resList.length) % Math.max(1, resList.length); $('#results').querySelectorAll('div[data-i]').forEach((d, i) => d.classList.toggle('sel', i === resSel)); }
});

/* ------------------------------------------------------------------ legend / UI */
const ROAD_LABEL = { major: 'Primary road', second: 'Secondary road', tert: 'Tertiary road', minor: 'Street', service: 'Service road', track: 'Track', path: 'Path' };
const AREA_LABEL = { forest: 'Forest', grass: 'Meadow', farm: 'Farmland', town: 'Built-up', park: 'Park / gardens', water: 'Water', cemetery: 'Cemetery', sport: 'Sports' };
const fmtHour = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
function updateClock() { const n = nightOf(state.hour), wi = { rain: '☂', snow: '❄', fog: '≋', clear: '' }[state.weather]; $('#cTime').textContent = fmtHour(state.hour); $('#cIco').textContent = wi || (n > 0.5 ? '☾' : '☀'); }
function kindIcon(k) { const c = document.createElement('canvas'); c.width = c.height = 52; const x = c.getContext('2d'); x.scale(2, 2); blip(x, k, 13, 13, 10.5); return c; }
const seg = (host, map, get, set) => { host.innerHTML = ''; for (const [k, l] of Object.entries(map)) { const b = document.createElement('button'); b.className = 'btn' + (get() === k ? ' on' : ''); b.textContent = l; b.onclick = () => { set(k); [...host.children].forEach((x) => x.classList.toggle('on', x === b)); invalidate(); }; host.appendChild(b); } };
function setTheme(k) { state.theme = k; try { localStorage.setItem('gta-theme', k); } catch (e) {} applyUi(THEMES[k]); buildSwatches(); allocLayers(); }
function buildLegend() {
  $('#tName').textContent = D.name; $('#tSub').textContent = D.sub || ''; document.title = `${D.name} · townyg`; $('#lSub').textContent = `${D.name} · ${POIS.length} places · ${BUILD.length} buildings`;
  const tw = $('#themes'); tw.innerHTML = ''; for (const k of THEME_ORDER) { if (D.styles && !D.styles[k]) continue; const b = document.createElement('button'); b.className = 'btn' + (k === state.theme ? ' on' : ''); b.innerHTML = `${THEMES[k].name}<br><small style="opacity:.7;letter-spacing:.06em">${THEMES[k].desc}</small>`; b.onclick = () => { setTheme(k); [...tw.children].forEach((x) => x.classList.toggle('on', x === b)); }; tw.appendChild(b); }
  const tg = $('#toggles'); tg.innerHTML = ''; for (const [k, l] of [['extrude', '3D buildings'], ['relief', 'Relief'], ['trees', 'Trees'], ['labels', 'Labels'], ['roads', 'Street names']]) { const b = document.createElement('button'); b.className = 'btn' + (state.flags[k] ? ' on' : ''); b.textContent = l; b.onclick = () => { state.flags[k] = !state.flags[k]; b.classList.toggle('on', state.flags[k]); invalidate(); }; tg.appendChild(b); }
  seg($('#seasons'), SEASONS, () => state.season, (k) => { state.season = k; buildSwatches(); });
  seg($('#weather'), WEATHERS, () => state.weather, (k) => { state.weather = k; resetParticles(); updateClock(); });
  const tt = $('#trafficTog'); tt.innerHTML = ''; for (const [k, l] of [['traffic', 'Cars & buses'], ['lines', 'Bus lines']]) { const b = document.createElement('button'); b.className = 'btn' + (state.flags[k] ? ' on' : ''); b.textContent = l; b.onclick = () => { state.flags[k] = !state.flags[k]; b.classList.toggle('on', state.flags[k]); invalidate(); }; tt.appendChild(b); }
  $('#trafficNote').textContent = `Traffic is simulated around the view (up to ${sim.pool} cars) · buses: ${sim.buses.length} · stops: ${POIS.filter((p) => p.k === 'bus').length}.` + (sim.estimated ? ' OpenStreetMap has no bus lines here, so the route is estimated along main roads through real stops.' : '');
  const hr = $('#hour'); hr.oninput = () => { state.hour = +hr.value; state.timeRun = false; $('#tplay').classList.remove('on'); $('#hourLbl').textContent = fmtHour(state.hour); updateClock(); invalidate(); };
  $('#tplay').onclick = () => { state.timeRun = !state.timeRun; $('#tplay').classList.toggle('on', state.timeRun); $('#tplay').textContent = state.timeRun ? '❚❚ Pause' : '▶ Run time'; };
  $('#tnow').onclick = () => { const d = new Date(); state.hour = d.getHours() + d.getMinutes() / 60; hr.value = state.hour; $('#hourLbl').textContent = fmtHour(state.hour); updateClock(); invalidate(); };
  const groups = {}; for (const p of POIS) (groups[p.k] = groups[p.k] || []).push(p); const host = $('#kinds'); host.innerHTML = '';
  for (const k of Object.keys(KINDS).filter((k) => groups[k])) {
    const row = document.createElement('div'); row.className = 'kind'; row.appendChild(kindIcon(k)); row.insertAdjacentHTML('beforeend', `<span class="t">${KINDS[k].label}</span><span class="c">${groups[k].length}</span><span class="chev">▾</span>`);
    const list = document.createElement('div'); list.className = 'places'; let filled = false;
    const fill = () => { if (filled) return; filled = true; for (const p of groups[k].sort((a, b) => (a.n || '').localeCompare(b.n || '', 'cs')).slice(0, 400)) { const it = document.createElement('div'); it.className = 'place'; it.innerHTML = `<span>${esc(p.n || KINDS[k].label)}</span><em>GPS</em>`; it.onclick = (e) => { if (e.target.tagName === 'EM') setWaypoint(p.x, p.y); flyTo(p.x, p.y, Math.max(view.s, 1.3)); state.pulse = { id: p.id, t: performance.now() }; if (window.innerWidth <= 820) $('#panel').classList.remove('open'); }; list.appendChild(it); } };
    row.onclick = (e) => { if (e.target.classList.contains('chev') || e.target.classList.contains('t')) { fill(); list.classList.toggle('open'); return; } state.hidden.has(k) ? state.hidden.delete(k) : state.hidden.add(k); row.classList.toggle('off', state.hidden.has(k)); invalidate(); };
    row.title = 'Click icon = show/hide, click name = list places'; host.append(row, list);
  }
  if (PEAKS.length) { const row = document.createElement('div'); row.className = 'kind'; row.appendChild(kindIcon('vrchol')); row.insertAdjacentHTML('beforeend', `<span class="t">Vrcholy</span><span class="c">${PEAKS.length}</span><span class="chev"></span>`); row.onclick = () => flyTo(PEAKS[0].x, PEAKS[0].y, 1); host.appendChild(row); }
  buildSwatches(); updateClock();
}
function buildSwatches() {
  const th = curTheme(), sw = $('#swatches'); sw.innerHTML = '';
  for (const k of ['forest', 'grass', 'farm', 'town', 'park', 'water', 'cemetery', 'sport']) { if (k !== 'water' && !AREAS[k]) continue; sw.insertAdjacentHTML('beforeend', `<div><i style="background:${th[k]}"></i>${AREA_LABEL[k]}</div>`); }
  sw.insertAdjacentHTML('beforeend', `<div><i style="background:${th.roof}"></i>Building</div><div><i style="background:transparent;border:1.5px dashed ${th.reserve}"></i>Protected area</div>`);
  const rk = $('#roadkey'); rk.innerHTML = '';
  for (const cls of ['major', 'second', 'tert', 'minor', 'service', 'track', 'path']) {
    if (!ROADS.some((r) => r.c === cls)) continue; const c = document.createElement('canvas'); c.width = 88; c.height = 28; const x = c.getContext('2d'); x.scale(2, 2); x.lineCap = 'round'; const w = Math.max(2, ROAD[cls][0] * 0.75);
    if (cls === 'path' || cls === 'track') { x.strokeStyle = th[cls]; x.lineWidth = w; x.setLineDash(cls === 'track' ? [7, 4] : [2.5, 3.5]); x.lineCap = 'butt'; } else { x.strokeStyle = th[cls + 'Case']; x.lineWidth = w + 3; x.beginPath(); x.moveTo(4, 7); x.lineTo(40, 7); x.stroke(); x.strokeStyle = th[cls]; x.lineWidth = w; }
    x.beginPath(); x.moveTo(4, 7); x.lineTo(40, 7); x.stroke(); const d = document.createElement('div'); d.appendChild(c); d.append(ROAD_LABEL[cls]); rk.appendChild(d);
  }
}

/* ------------------------------------------------------------------ poster export */
const TITLE_FONT = { gta5: 'Anton', radar: 'Anton', sat: 'Anton', sa: 'Lilita One', gta4: 'Bebas Neue', vc: 'Pacifico' };
async function loadFonts() { if (!document.fonts) return; await Promise.all(["400 40px Anton", "400 40px 'Lilita One'", "400 40px 'Bebas Neue'", "400 40px Pacifico", "500 20px Oswald", "700 20px Oswald", "600 20px Oswald"].map((f) => document.fonts.load(f).catch(() => {}))); }
async function poster(key, opts = {}) {
  await loadFonts(); const base = THEMES[key], th = deriveTheme(base, opts.season || 'summer'); const S = 4096, asp = HH / HW; const cw = asp > 1 ? S / asp : S, chh = asp > 1 ? S : S * asp;
  const L = 2600, lw = asp > 1 ? L / asp : L, lh = asp > 1 ? L : L * asp, k = cw / lw; const c = document.createElement('canvas'); c.width = Math.round(cw); c.height = Math.round(chh); const x = c.getContext('2d'); x.scale(k, k);
  const v = { cx: 0, cy: 0, s: lw / (2 * HW) }, o = { ...state.flags, extrude: false, labels: true, roads: true, trees: true, night: opts.hour !== undefined ? nightOf(opts.hour) : 0, weather: 'clear' };
  paintScene(x, lw, lh, v, th, o); paintTraffic(x, lw, lh, v, th, o); paintLabels(x, lw, lh, v, th, o); const sv = state.hover, sp = state.pulse, ss = state.selected; state.hover = state.pulse = state.selected = null; paintDynamic(x, lw, lh, v, th, o); state.hover = sv; state.pulse = sp; state.selected = ss; paintFx(x, lw, lh, th);
  const g = x.createLinearGradient(0, 0, 0, lh * 0.3); g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, lw, lh * 0.3);
  const u = base.ui, fam = TITLE_FONT[key], U = Math.min(lw, lh); const t = key === 'vc' ? D.name : D.name.toUpperCase(), fs = U * (key === 'vc' ? 0.12 : 0.085);
  x.save(); x.transform(1, 0, key === 'gta4' || key === 'vc' ? 0 : -0.1, 1, 0, 0); x.font = `400 ${fs}px "${fam}"`; x.textBaseline = 'top'; x.textAlign = 'left'; x.lineJoin = 'round';
  if (key === 'vc') { const gr = x.createLinearGradient(0, U * 0.03, 0, U * 0.03 + fs); gr.addColorStop(0.2, '#ff7ac6'); gr.addColorStop(0.8, '#7ff2ff'); x.shadowColor = 'rgba(255,79,163,.9)'; x.shadowBlur = U * 0.015; x.lineWidth = U * 0.008; x.strokeStyle = '#5a0a55'; x.strokeText(t, U * 0.06, U * 0.03); x.fillStyle = gr; x.fillText(t, U * 0.06, U * 0.03); }
  else { x.lineWidth = U * 0.012; x.strokeStyle = '#000'; x.strokeText(t, U * 0.06, U * 0.04); x.fillStyle = u.fill; x.fillText(t, U * 0.06, U * 0.04); }
  x.restore();
  x.textAlign = 'left'; x.textBaseline = 'top'; x.font = `500 ${U * 0.014}px Oswald`; x.fillStyle = '#fff'; x.fillText((D.sub || '').toUpperCase(), U * 0.062, U * (key === 'vc' ? 0.15 : 0.135));
  const kinds = [...new Set(POIS.map((p) => p.k))].filter((q) => KINDS[q]); x.font = `600 ${U * 0.0125}px Oswald`; x.textBaseline = 'middle';
  const r = U * 0.0095, gap = U * 0.02, maxX = lw * 0.80, items = kinds.map((q) => { const lab = KINDS[q].label.toUpperCase(); return { q, lab, w: r * 2 + U * 0.006 + x.measureText(lab).width }; });
  const rows = [[]]; let rx = U * 0.025; for (const it of items) { if (rx + it.w > maxX && rows[rows.length - 1].length) { rows.push([]); rx = U * 0.025; } rows[rows.length - 1].push(it); rx += it.w + gap; }
  const rh = U * 0.036, bh = rh * rows.length + U * 0.012, by = lh - bh; x.fillStyle = 'rgba(8,10,14,.84)'; x.fillRect(0, by, lw, bh); x.fillStyle = u.accent; x.fillRect(0, by, lw, U * 0.003);
  rows.forEach((row, ri) => { let px = U * 0.025; const cy = by + U * 0.008 + rh * ri + rh / 2; for (const it of row) { blip(x, it.q, px + r, cy, r); x.fillStyle = '#fff'; x.textAlign = 'left'; x.fillText(it.lab, px + r * 2 + U * 0.006, cy); px += it.w + gap; } });
  x.textAlign = 'right'; x.fillStyle = u.accent; x.font = `600 ${U * 0.0145}px Oswald`; x.fillText(`${(D.styles && D.styles[key]) || base.name + ' · ' + base.desc}`.toUpperCase(), lw - U * 0.015, by + U * 0.022);
  x.font = `400 ${U * 0.0085}px Oswald`; x.fillStyle = 'rgba(255,255,255,.8)'; x.fillText('© OpenStreetMap contributors (ODbL) · relief Mapzen Terrarium / AWS', lw - U * 0.015, lh - U * 0.012);
  return c;
}
async function exportPoster() { const c = await poster(state.theme, { season: state.season, hour: state.hour }); c.toBlob((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `gta-mapa-${norm(D.name).replace(/[^a-z]/g, '')}-${state.theme}.png`; a.click(); }, 'image/png'); }
$('#export').onclick = exportPoster;

/* ------------------------------------------------------------------ boot */
applyUi(THEMES[state.theme]); buildLegend(); resize();
{ const h = fitView(); view.cx = h.cx; view.cy = h.cy; view.s = h.s; }
if (document.fonts) loadFonts().then(() => invalidate());
requestAnimationFrame(frame);
window.__gta = { prof: PROF, view, state, setWaypoint, flyTo, poster, sim, THEMES, setTheme, render: () => invalidate(), posterData: async (k, o) => (await poster(k, o)).toDataURL('image/png'), get route() { return route; }, player, stats: () => ({ buildings: BUILD.length, roads: ROADS.length, edges: E.length, pois: POIS.length, lamps: LAMPS.length / 2, parked: PARKED.length }) };
})();
