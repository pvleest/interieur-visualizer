// Procedural textures + material library. All textures represent 1 m x 1 m
// (geometry UVs are generated in metres, see geometry.js).
import * as THREE from 'three';

let maxAniso = 4;
export function setMaxAnisotropy(a) { maxAniso = a; }

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function canvasTex(size, draw, { repeat = 1, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = maxAniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function noiseLayer(g, size, r, count, minR, maxR, color, alpha) {
  for (let i = 0; i < count; i++) {
    const x = r() * size, y = r() * size, rad = minR + r() * (maxR - minR);
    const a = (alpha * r()).toFixed(3);
    // draw wrapped copies so the texture tiles seamlessly
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      const px = x + ox, py = y + oy;
      if (px + rad < 0 || px - rad > size || py + rad < 0 || py - rad > size) continue;
      const grd = g.createRadialGradient(px, py, 0, px, py, rad);
      grd.addColorStop(0, color.replace('A', a));
      grd.addColorStop(1, color.replace('A', '0'));
      g.fillStyle = grd;
      g.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    }
  }
}

function speckle(g, size, r, count, colors, maxSize = 2) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    const s = 0.5 + r() * maxSize;
    g.fillRect(r() * size, r() * size, s, s);
  }
}

// Vertical wood grain (oak), tileable horizontally.
function woodGrain(g, size, r, base, dark, light, density = 70) {
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  for (let i = 0; i < density; i++) {
    const x0 = r() * size, w = 0.6 + r() * 2.4, amp = 2 + r() * 8, freq = 0.5 + r() * 2;
    g.strokeStyle = r() > 0.5 ? dark : light;
    g.globalAlpha = 0.12 + r() * 0.28;
    g.lineWidth = w;
    for (const off of [0, size, -size]) {
      g.beginPath();
      for (let y = 0; y <= size; y += 8) {
        const x = x0 + off + Math.sin((y / size) * Math.PI * 2 * freq + i) * amp;
        y === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();
    }
  }
  g.globalAlpha = 1;
  // a few rays / flecks typical for oak
  for (let i = 0; i < 160; i++) {
    g.fillStyle = r() > 0.5 ? light : dark;
    g.globalAlpha = 0.08 + r() * 0.12;
    g.fillRect(r() * size, r() * size, 1 + r() * 2, 4 + r() * 14);
  }
  g.globalAlpha = 1;
}

const T = {};
export function textures() {
  if (T.ready) return T;
  T.oak = canvasTex(512, (g, s) => woodGrain(g, s, rng(7), '#c9a57c', '#8a6440', '#e3c79f'), { repeat: 1.6 });
  T.oakDark = canvasTex(512, (g, s) => woodGrain(g, s, rng(9), '#9c7652', '#5e4129', '#c49c72'), { repeat: 1.6 });
  T.planks = canvasTex(1024, (g, s) => {
    const r = rng(11);
    const rows = 5; const h = s / rows; // 20 cm wide planks, 1 m texture
    const tones = [[206, 172, 132], [199, 164, 124], [212, 180, 142], [194, 158, 118], [203, 170, 128]];
    for (let i = 0; i < rows; i++) {
      let x = -r() * s * 0.8;
      while (x < s) {
        const len = s * (0.8 + r() * 0.7);
        const [cr, cg, cb] = tones[Math.floor(r() * tones.length)];
        for (const off of [0, -s]) {
          const px = x + off;
          g.fillStyle = `rgb(${cr},${cg},${cb})`; g.fillRect(px, i * h, len, h);
          for (let k = 0; k < 26; k++) {
            const y = i * h + r() * h, a = 0.05 + r() * 0.12, amp = 1 + r() * 3;
            g.strokeStyle = r() > 0.5 ? `rgba(120,85,50,${a})` : `rgba(240,215,180,${a})`;
            g.lineWidth = 0.6 + r() * 1.6;
            g.beginPath(); g.moveTo(px, y);
            for (let t = 0; t <= len; t += 40) g.lineTo(px + t, y + Math.sin(t / (60 + k * 7) + k) * amp);
            g.stroke();
          }
          g.fillStyle = 'rgba(80,58,36,0.55)'; g.fillRect(px, i * h, 2, h);
        }
        x += len;
      }
      g.fillStyle = 'rgba(80,58,36,0.6)'; g.fillRect(0, i * h, s, 2);
    }
  }, { repeat: 1 });
  T.concrete = canvasTex(1024, (g, s) => {
    const r = rng(21);
    g.fillStyle = '#a3a19c'; g.fillRect(0, 0, s, s);
    noiseLayer(g, s, r, 220, 40, 220, 'rgba(120,118,112,A)', 0.35);
    noiseLayer(g, s, r, 220, 40, 220, 'rgba(190,188,182,A)', 0.30);
    speckle(g, s, r, 9000, ['rgba(80,80,78,0.35)', 'rgba(210,208,200,0.4)'], 1.6);
  }, { repeat: 0.5 });
  T.epoxy = canvasTex(1024, (g, s) => {
    const r = rng(23);
    g.fillStyle = '#7d8084'; g.fillRect(0, 0, s, s);
    noiseLayer(g, s, r, 120, 60, 260, 'rgba(100,104,108,A)', 0.3);
    speckle(g, s, r, 16000, ['rgba(40,40,42,0.55)', 'rgba(230,230,230,0.5)', 'rgba(150,150,150,0.5)'], 1.8);
  }, { repeat: 0.5 });
  T.composite = canvasTex(512, (g, s) => {
    const r = rng(31);
    g.fillStyle = '#ece8e1'; g.fillRect(0, 0, s, s);
    noiseLayer(g, s, r, 60, 30, 120, 'rgba(215,208,198,A)', 0.4);
    speckle(g, s, r, 3500, ['rgba(160,150,140,0.35)', 'rgba(255,255,255,0.6)'], 1.2);
  }, { repeat: 1.5 });
  T.tile = canvasTex(512, (g, s) => {
    const r = rng(41);
    const cols = 8, rows = 4; const tw = s / cols, th = s / rows; // 12.5 x 25 cm vertical tiles... rotated: 7.5 x 30 look
    g.fillStyle = '#d7d0c4'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const v = 200 + Math.floor(r() * 30);
      g.fillStyle = `rgb(${v + 12},${v + 6},${v - 6})`;
      g.fillRect(i * tw + 2, j * th + 2, tw - 4, th - 4);
      noiseLayer(g, s, r, 2, 10, 40, 'rgba(255,255,255,A)', 0.25);
    }
  }, { repeat: 2 });
  // Large-format floor tiles, 120 × 60 cm in a half-offset bond, warm grey concrete look.
  // The canvas covers 240 × 240 cm (repeat 1/2.4 because floor UVs are in metres).
  T.tileLarge = canvasTex(1024, (g, s) => {
    const r = rng(83);
    const tw = s / 2, th = s / 4, grout = 2;
    g.fillStyle = '#625d57'; g.fillRect(0, 0, s, s);
    for (let j = 0; j < 4; j++) {
      const off = j % 2 ? tw / 2 : 0;
      for (let i = -1; i < 2; i++) {
        const x = i * tw + off, y = j * th;
        const v = Math.floor(r() * 14) - 7;
        g.fillStyle = `rgb(${108 + v},${102 + v},${95 + v})`;
        g.fillRect(x + grout / 2, y + grout / 2, tw - grout, th - grout);
      }
    }
    noiseLayer(g, s, r, 160, 40, 200, 'rgba(118,112,104,A)', 0.22);
    noiseLayer(g, s, r, 120, 40, 200, 'rgba(170,164,154,A)', 0.18);
    speckle(g, s, r, 7000, ['rgba(110,104,96,0.25)', 'rgba(225,220,210,0.3)'], 1.3);
    // redraw grout lines on top so the noise does not hide them
    g.fillStyle = 'rgba(92,88,82,0.9)';
    for (let j = 0; j <= 4; j++) g.fillRect(0, j * th - grout / 2, s, grout);
    for (let j = 0; j < 4; j++) { const off = j % 2 ? tw / 2 : 0; for (let i = 0; i < 3; i++) g.fillRect(((i * tw + off) % s) - grout / 2, j * th, grout, th); }
  }, { repeat: 1 / 2.4 });
  T.pegboard = canvasTex(512, (g, s) => {
    g.fillStyle = '#2b2b2b'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#111';
    const n = 40; const step = s / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.beginPath(); g.arc(i * step + step / 2, j * step + step / 2, step * 0.18, 0, 7); g.fill(); }
  }, { repeat: 1, srgb: true });
  T.linen = canvasTex(256, (g, s) => {
    const r = rng(51);
    g.fillStyle = '#ddd4c6'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < s; i += 2) {
      g.fillStyle = `rgba(${150 + r() * 60},${140 + r() * 50},${120 + r() * 40},0.18)`; g.fillRect(0, i, s, 1);
      g.fillStyle = `rgba(255,255,255,${0.05 + r() * 0.1})`; g.fillRect(i, 0, 1, s);
    }
  }, { repeat: 4 });
  T.rug = canvasTex(512, (g, s) => {
    const r = rng(61);
    g.fillStyle = '#d9d0c0'; g.fillRect(0, 0, s, s);
    speckle(g, s, r, 22000, ['rgba(170,160,145,0.4)', 'rgba(240,235,225,0.5)', 'rgba(140,128,112,0.25)'], 1.5);
  }, { repeat: 1 });
  T.felt = canvasTex(256, (g, s) => { const r = rng(71); g.fillStyle = '#1f1f1f'; g.fillRect(0, 0, s, s); speckle(g, s, r, 4000, ['rgba(60,60,60,0.5)'], 1); });
  T.ready = true;
  return T;
}

const M = {};
export function materials() {
  if (M.ready) return M;
  const t = textures();
  const std = (o) => new THREE.MeshStandardMaterial(o);
  M.wall = std({ color: 0xf2efe9, roughness: 0.95 });
  M.wallCap = std({ color: 0x45474a, roughness: 0.9 });
  M.ceiling = std({ color: 0xfbfaf7, roughness: 1, side: THREE.DoubleSide });
  M.oak = std({ map: t.oak, color: 0xffffff, roughness: 0.72 });
  M.oakDark = std({ map: t.oakDark, roughness: 0.7 });
  M.greige = std({ color: 0xbcae9b, roughness: 0.88 });
  M.greigeLight = std({ color: 0xd8cdbd, roughness: 0.9 });
  M.black = std({ color: 0x1b1b1b, roughness: 0.55, metalness: 0.2 });
  M.carcass = std({ color: 0x24211e, roughness: 0.9 });
  M.steel = std({ color: 0xc4c4c2, roughness: 0.32, metalness: 0.9 });
  M.blackGlass = new THREE.MeshPhysicalMaterial({ color: 0x0c0c0d, roughness: 0.08, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05 });
  M.glass = new THREE.MeshPhysicalMaterial({ color: 0xcfe2e8, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false });
  M.composite = std({ map: t.composite, roughness: 0.42 });
  M.tile = std({ map: t.tile, roughness: 0.35 });
  M.appliance = std({ color: 0xf4f4f2, roughness: 0.32 });
  M.applianceGrey = std({ color: 0x9a9da0, roughness: 0.35, metalness: 0.5 });
  M.linen = std({ map: t.linen, color: 0xe7ddcd, roughness: 1, side: THREE.DoubleSide });
  M.curtain = std({ map: t.linen, color: 0xcfc3b0, roughness: 1, side: THREE.DoubleSide });
  M.sheet = std({ map: t.linen, color: 0xfbf9f4, roughness: 0.95 });
  M.duvet = std({ map: t.linen, color: 0xece6db, roughness: 0.95 });
  M.throw = std({ map: t.linen, color: 0x8d6e52, roughness: 1 });
  M.pillowAccent = std({ map: t.linen, color: 0x9aa38e, roughness: 1 });
  M.rug = std({ map: t.rug, roughness: 1 });
  M.pegboard = std({ map: t.pegboard, roughness: 0.8 });
  M.felt = std({ map: t.felt, roughness: 1 });
  M.crate = std({ color: 0x3a3f45, roughness: 0.7 });
  M.crateLight = std({ color: 0x8d949b, roughness: 0.7 });
  M.plant = std({ color: 0x4f6b3c, roughness: 0.8 });
  M.plantDark = std({ color: 0x35502b, roughness: 0.8 });
  M.pot = std({ color: 0xcdc4b6, roughness: 0.9 });
  M.led = std({ color: 0xffffff, emissive: 0xfff3dd, emissiveIntensity: 3, roughness: 0.5 });
  M.bulb = std({ color: 0xffffff, emissive: 0xffd9a0, emissiveIntensity: 4 });
  M.frame = std({ color: 0x232323, roughness: 0.45, metalness: 0.4 });
  M.garageDoor = std({ color: 0x3c3f42, roughness: 0.6, metalness: 0.2 });
  M.doorLeaf = std({ color: 0xf6f4ef, roughness: 0.6 });
  M.shirtA = std({ color: 0xf2f2f2, roughness: 1 });
  M.shirtB = std({ color: 0x5f7d95, roughness: 1 });
  M.shirtC = std({ color: 0xb98d6c, roughness: 1 });
  M.ground = std({ color: 0xdfe2d9, roughness: 1 });
  M.floor = {
    oak: std({ map: t.planks, roughness: 0.6 }),
    concrete: std({ map: t.concrete, roughness: 0.55 }),
    epoxy: std({ map: t.epoxy, roughness: 0.45 }),
    tile: std({ map: t.tile, roughness: 0.4 }),
    tileLarge: std({ map: t.tileLarge, roughness: 0.62 }),
  };
  M.walkway = new THREE.MeshBasicMaterial({ color: 0x1db954, transparent: true, opacity: 0.18, depthWrite: false });
  M.ready = true;
  return M;
}

// Human-readable names (Dutch) for the built-in materials, used in pickers.
export const BUILTIN_LABELS = {
  oak: 'Mat eiken', oakDark: 'Donker eiken', greige: 'Warm greige', greigeLight: 'Licht greige', black: 'Zwart',
  composite: 'Licht composiet', tile: 'Greige tegel', steel: 'RVS', linen: 'Linnen',
  planks: 'Eiken plankenvloer', concrete: 'Grijze gietvloer', epoxy: 'Epoxy grijs', tileLarge: 'Tegel 60×120 warm grijs',
};

// Per-plan material context: palette roles ("@frontBase" -> "greige") and
// custom material definitions ({ color, roughness, metalness, texture, label }).
let palette = {}, customDefs = {};
const customCache = new Map();
export function setPlanMaterials(pal = {}, defs = {}) { palette = pal || {}; customDefs = defs || {}; }

function customMaterial(name, def) {
  const key = name + JSON.stringify(def);
  if (customCache.has(key)) return customCache.get(key);
  const t = textures();
  const o = { color: def.color || '#cccccc', roughness: def.roughness ?? 0.8, metalness: def.metalness ?? 0 };
  if (def.texture) {
    const tex = def.texture === 'planks' ? t.planks : t[def.texture];
    if (tex) o.map = tex;
  }
  const m = new THREE.MeshStandardMaterial(o);
  m.name = name;
  customCache.set(key, m);
  return m;
}

export function resolveName(name, depth = 0) {
  if (typeof name === 'string' && name.startsWith('@') && depth < 5) {
    const v = palette[name.slice(1)];
    if (v === undefined) { console.warn('Unknown palette role', name); return null; }
    return resolveName(v, depth + 1);
  }
  return name;
}

export function mat(nameIn) {
  const m = materials();
  const name = resolveName(nameIn);
  if (!name) return m.greige;
  if (typeof name === 'object') return customMaterial('_inline', name);
  if (customDefs[name]) return customMaterial(name, customDefs[name]);
  if (name === 'planks') return m.floor.oak;
  if (m[name] && m[name].isMaterial) return m[name];
  if (m.floor[name]) return m.floor[name];
  if (typeof name === 'string' && name.startsWith('#')) {
    if (!m['_' + name]) m['_' + name] = new THREE.MeshStandardMaterial({ color: name, roughness: 0.8 });
    return m['_' + name];
  }
  console.warn('Unknown material', name);
  return m.greige;
}

// Swatch colour for UI pickers.
export function swatchColor(nameIn) {
  const name = resolveName(nameIn);
  if (customDefs[name]) return customDefs[name].color || '#ccc';
  return { oak: '#c9a57c', oakDark: '#9c7652', greige: '#bcae9b', greigeLight: '#d8cdbd', black: '#1b1b1b', composite: '#ece8e1', tile: '#d7d0c4',
    steel: '#c4c4c2', tileLarge: '#aca59b', linen: '#ddd4c6', planks: '#cfae86', concrete: '#a3a19c', epoxy: '#7d8084' }[name] || (String(name).startsWith('#') ? name : '#ccc');
}
