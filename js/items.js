// Furniture & fixture builders. Every builder returns a THREE.Group authored in
// centimetres with its origin at the centre of the footprint, on the floor
// (before `elev` is applied). The front of an item faces local +z.
import * as THREE from 'three';
import { B, cyl, boxGeo } from './geometry.js';
import { mat, materials } from './materials.js';

const GAP = 0.4;      // gap between fronts (cm)
const FRONT_T = 1.9;  // front thickness (cm)

function labelTexture(text, dot) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0)'; g.fillRect(0, 0, 256, 64);
  g.fillStyle = dot; g.beginPath(); g.arc(30, 32, 16, 0, 7); g.fill();
  g.strokeStyle = '#222'; g.lineWidth = 2; g.stroke();
  g.fillStyle = '#1b1b1b'; g.font = 'bold 34px system-ui, sans-serif'; g.textBaseline = 'middle';
  g.fillText(text, 58, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Generic handleless cabinet.
// rows: [{h, cols, kind}] from bottom to top; kind: front|oven|micro|open|glass|none
function cabinet(spec, defaults = {}) {
  const g = new THREE.Group();
  const [w, d, h] = spec.size;
  const plinth = spec.plinth ?? defaults.plinth ?? 0;
  const gola = spec.gola ?? defaults.gola ?? 0;
  const fm = mat(spec.material || defaults.material || 'greige');
  const M = materials();
  // carcass: visible sides/top in the front material, black behind the fronts
  const car = B(g, w, h - plinth, d - FRONT_T, M.carcass, 0, plinth, -FRONT_T / 2);
  car.material = [fm, fm, fm, M.carcass, M.carcass, fm];
  // recessed plinth on adjustable feet
  if (plinth) B(g, w - 0.5, plinth, 2, M.black, 0, 0, d / 2 - 7, { cast: false });
  // gola recess (black strip under worktop)
  if (gola) B(g, w, gola, 1, M.black, 0, h - gola, d / 2 - FRONT_T - 0.5, { cast: false });
  const zf = d / 2 - FRONT_T / 2;
  let rows = spec.rows || defaults.rows || [{ cols: spec.doors || 1 }];
  const avail = h - plinth - gola;
  const fixed = rows.reduce((s, r) => s + (r.h || 0), 0);
  const nAuto = rows.filter(r => !r.h).length;
  let y = plinth;
  for (const r of rows) {
    const rh = r.h || (avail - fixed) / Math.max(1, nAuto);
    const cols = r.cols || 1;
    const kind = r.kind || 'front';
    const cw = w / cols;
    for (let c = 0; c < cols; c++) {
      const x0 = -w / 2 + c * cw;
      const cx = x0 + cw / 2;
      if (kind === 'front') {
        B(g, cw - GAP, rh - GAP, FRONT_T, r.material ? mat(r.material) : fm, cx, y + GAP / 2, zf);
      } else if (kind === 'oven') {
        B(g, cw - GAP, rh - GAP, FRONT_T, M.blackGlass, cx, y + GAP / 2, zf);
        B(g, cw * 0.7, 1.6, 2.2, M.steel, cx, y + rh - 8, zf + 1.6);
        B(g, cw * 0.5, 2.5, 0.3, mat('#1e3d2a'), cx, y + rh - 4.5, zf + 1.0, { cast: false });
      } else if (kind === 'micro') {
        B(g, cw - GAP, rh - GAP, FRONT_T, M.blackGlass, cx, y + GAP / 2, zf);
        B(g, cw * 0.62, rh * 0.62, 0.3, mat('#26282a'), cx - cw * 0.12, y + rh * 0.2, zf + 1.0, { cast: false });
        B(g, 1.4, rh * 0.6, 2, M.steel, cx + cw * 0.36, y + rh * 0.2, zf + 1.4);
      } else if (kind === 'open') {
        B(g, cw - 2, 1.8, d - 4, fm, cx, y, 0);
      }
    }
    y += rh;
  }
  return g;
}

function worktop(spec) {
  const g = new THREE.Group();
  const [w, d, h] = spec.size;
  B(g, w, h || 4, d, mat(spec.material || 'composite'), 0, 0, 0);
  return g;
}

function sink(spec) {
  const g = new THREE.Group();
  const M = materials();
  const [w, d] = spec.size;
  B(g, w, 0.4, d, M.black, 0, 0, 0, { cast: false });
  B(g, w - 4, 0.42, d - 4, mat('#0a0a0a'), 0, 0.02, 0, { cast: false });
  // tap
  const tz = -d / 2 - 4;
  cyl(g, 1.6, 1.8, 3, M.black, 0, 0, tz);
  cyl(g, 1.1, 1.1, 26, M.black, 0, 0, tz);
  const arc = new THREE.Mesh(new THREE.TorusGeometry(8, 1.1, 10, 24, Math.PI), M.black);
  arc.rotation.y = Math.PI / 2; arc.position.set(0, 26, tz + 8); arc.castShadow = true; g.add(arc);
  cyl(g, 1.1, 1.1, 5, M.black, 0, 21, tz + 16);
  B(g, 1.2, 8, 1.2, M.black, 3, 14, tz, { cast: false });
  return g;
}

function hob(spec) {
  const g = new THREE.Group();
  const M = materials();
  const [w, d] = spec.size;
  B(g, w, 0.6, d, M.blackGlass, 0, 0, 0);
  const ringM = new THREE.MeshBasicMaterial({ color: 0x555555 });
  const pos = [[-w / 4, -d / 5, 10], [w / 4, -d / 5, 8], [-w / 4, d / 4.5, 8], [w / 4, d / 4.5, 10]];
  for (const [x, z, r] of pos) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.4, r, 40), ringM);
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.62, z); g.add(ring);
  }
  return g;
}

function panel(spec) {
  const g = new THREE.Group();
  const [w, d, h] = spec.size;
  B(g, w, h, d, mat(spec.material || 'tile'), 0, 0, 0, { cast: false });
  return g;
}

function appliance(spec, kind) {
  const g = new THREE.Group();
  const M = materials();
  const [w, d, h] = spec.size;
  B(g, w - 0.4, h, d - 2, M.appliance, 0, 0, -1, { rounded: 1.5 });
  B(g, w - 0.6, 10, 0.5, kind === 'dryer' ? mat('#e8e8e6') : mat('#ededeb'), 0, h - 11, d / 2 - 1.8, { cast: false });
  cyl(g, 2.6, 2.6, 1.6, M.applianceGrey, w * 0.28, h - 8.5, d / 2 - 1).rotation.x = Math.PI / 2;
  g.children[g.children.length - 1].position.set(w * 0.28, h - 6, d / 2 - 1);
  B(g, 10, 2.6, 0.4, mat('#1a2a33'), -w * 0.02, h - 7.5, d / 2 - 1.4, { cast: false });
  if (kind === 'washer') B(g, 14, 4, 0.6, mat('#dcdcda'), -w * 0.3, h - 9, d / 2 - 1.5, { cast: false });
  else B(g, 14, 4, 0.6, mat('#dcdcda'), -w * 0.3, h - 9, d / 2 - 1.5, { cast: false });
  const cy = h * 0.47;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(17, 2.6, 16, 48), kind === 'dryer' ? M.appliance : M.applianceGrey);
  ring.position.set(0, cy, d / 2 - 0.5); ring.castShadow = true; g.add(ring);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(15.5, 40), kind === 'dryer' ? mat('#2b3136') : M.blackGlass);
  glass.position.set(0, cy, d / 2 - 0.3); g.add(glass);
  B(g, 2, 8, 1.5, M.applianceGrey, 15, cy - 4, d / 2 + 0.6);
  return g;
}

function basketDrawers(spec) {
  const g = cabinet({ ...spec, rows: [{ cols: 3 }] }, { plinth: 10, gola: 3 });
  const [w, d, h] = spec.size;
  const labels = spec.labels || [['WIT', '#ffffff'], ['BONT', '#d9824a'], ['DONKER', '#2d2d2d']];
  const cw = w / 3;
  labels.forEach(([t, c], i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(cw * 0.6, cw * 0.15), new THREE.MeshBasicMaterial({ map: labelTexture(t, c), transparent: true }));
    m.position.set(-w / 2 + cw * (i + 0.5), h - 12, d / 2 + 0.05); g.add(m);
  });
  return g;
}

function crate(g, w, h, d, x, y, z, light) {
  const M = materials();
  B(g, w, h, d, light ? M.crateLight : M.crate, x, y, z, { rounded: 1 });
  B(g, w - 2, 0.3, d - 2, mat('#1a1c1e'), x, y + h - 0.2, z, { cast: false });
  B(g, w * 0.3, 3, 0.4, mat('#15171a'), x, y + h - 7, z + d / 2 + 0.05, { cast: false });
}

function openShelf(spec) {
  const g = new THREE.Group();
  const [w, d, h] = spec.size;
  const sm = mat(spec.material || 'oak');
  const M = materials();
  const plinth = spec.plinth ?? 10;
  B(g, w, plinth, 2, M.black, 0, 0, d / 2 - 7, { cast: false });
  B(g, w, h - plinth, 1.8, M.carcass, 0, plinth, -d / 2 + 1);
  B(g, 1.8, h - plinth, d, sm, -w / 2 + 0.9, plinth, 0);
  B(g, 1.8, h - plinth, d, sm, w / 2 - 0.9, plinth, 0);
  const n = spec.shelves || 5;
  const step = (h - plinth) / n;
  for (let i = 0; i <= n; i++) {
    const y = plinth + i * step - (i === n ? 1.8 : 0);
    B(g, w - 3.6, 1.8, d - 2, sm, 0, y, 0);
    if (i < n && spec.crates !== false) {
      const cw = (w - 8) / 2;
      const ch = Math.min(30, step - 6);
      crate(g, cw, ch, d - 12, -cw / 2 - 1, y + 1.8, 2, i % 2 === 0);
      if (i !== 2) crate(g, cw, ch, d - 12, cw / 2 + 1, y + 1.8, 2, i % 2 === 1);
    }
  }
  return g;
}

function workbench(spec) {
  const g = new THREE.Group();
  const [w, d, h] = spec.size;
  const M = materials();
  const fm = mat(spec.material || 'greige');
  const base = cabinet({ size: [w, d, 88], material: spec.material || 'greige', rows: [{ cols: 2 }, { cols: 2 }, { cols: 2 }, { cols: 2 }] }, { plinth: 10 });
  g.add(base);
  B(g, w + 1, 4, d + 1, M.oakDark, 0, 88, 0.5);
  // pegboard back
  B(g, w, 100, 1.5, M.pegboard, 0, 92, -d / 2 + 0.75, { cast: false });
  // tools
  const tools = [
    [-w * 0.38, 150, 3, 28, M.oakDark], [-w * 0.32, 160, 9, 3, M.steel], [-w * 0.25, 140, 2, 22, M.steel], [-w * 0.2, 140, 2, 18, M.steel], [-w * 0.15, 140, 2, 15, M.steel],
    [-w * 0.02, 130, 26, 2, M.black], [0.0, 155, 18, 14, mat('#c0392b')], [w * 0.15, 120, 4, 24, M.black], [w * 0.22, 118, 4, 28, mat('#e6b422')], [w * 0.32, 150, 22, 30, mat('#2f6f9f')],
  ];
  for (const [x, y, tw, th, m] of tools) B(g, tw, th, 3, m, x, y, -d / 2 + 3);
  // small shelf on pegboard
  B(g, w * 0.5, 1.5, 15, M.oak, -w * 0.1, 175, -d / 2 + 9);
  for (let i = 0; i < 5; i++) B(g, 9, 10, 9, i % 2 ? mat('#e6b422') : mat('#3a3f45'), -w * 0.3 + i * 11, 176.5, -d / 2 + 8);
  // upper cabinet
  const up = cabinet({ size: [w, 40, h - 195], material: spec.material || 'greige', rows: [{ cols: 2 }] });
  up.position.set(0, 195, -d / 2 + 20);
  g.add(up);
  B(g, w - 4, 0.8, 2, M.led, 0, 194.2, -d / 2 + 36, { cast: false });
  return g;
}

function tall(spec, defaults) {
  return cabinet(spec, { plinth: 10, ...defaults });
}

function fridgeColumn(spec, kind) {
  // integrated appliance column: fronts like the tall cabinets + small vent
  const [, , h] = spec.size;
  const rows = kind === 'fridge'
    ? [{ h: 178, cols: 1 }, { cols: 1 }]
    : [{ h: 72, cols: 1 }, { h: 106, cols: 1 }, { cols: 1 }];
  const g = cabinet({ ...spec, rows }, { plinth: 10, material: 'oak' });
  const M = materials();
  const [w, d] = spec.size;
  // vertical black grip groove
  B(g, 1.2, 160, 0.5, M.black, w / 2 - 3, 20, d / 2 + 0.1, { cast: false });
  if (kind === 'freezer') B(g, 1.2, 60, 0.5, M.black, w / 2 - 3, 14, d / 2 + 0.1, { cast: false });
  return g;
}

function ovenColumn(spec) {
  return cabinet({ ...spec, rows: [{ h: 36, cols: 1 }, { h: 36, cols: 1 }, { h: 60, kind: 'oven' }, { h: 40, kind: 'micro' }, { cols: 1 }] }, { plinth: 10, material: spec.material || 'oak' });
}

function hood(spec) {
  const g = new THREE.Group();
  const [w, d, h] = spec.size;
  B(g, w, h || 6, d, materials().black, 0, 0, 0);
  B(g, w - 10, 0.4, d - 12, mat('#3a3a3a'), 0, -0.3, 0, { cast: false });
  return g;
}

function ledStrip(spec) {
  const g = new THREE.Group();
  const [w, d] = spec.size;
  B(g, w, 1, d || 2, materials().led, 0, 0, 0, { cast: false, receive: false });
  return g;
}

function walkway(spec) {
  const g = new THREE.Group();
  const pts = spec.polygon; // absolute coords, handled by engine (pos = 0)
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), materials().walkway);
  m.rotation.x = -Math.PI / 2; m.position.y = 0.3; m.renderOrder = 2;
  g.add(m);
  const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts.map(([x, z]) => new THREE.Vector3(x, 0.4, z))), new THREE.LineDashedMaterial({ color: 0x14833b, dashSize: 10, gapSize: 6 }));
  edge.computeLineDistances(); g.add(edge);
  return g;
}

function bed(spec) {
  const g = new THREE.Group();
  const [w, d] = spec.size; // w = width, d = length; head at -z
  const M = materials();
  const fm = mat(spec.material || 'oak');
  // floating-look base
  B(g, w - 16, 12, d - 20, M.black, 0, 0, 0, { cast: false });
  B(g, w, 20, d, fm, 0, 12, 0, { rounded: 1 });
  // mattress
  B(g, w - 4, 22, d - 6, M.sheet, 0, 32, 1, { rounded: 4 });
  // duvet
  const dl = d * 0.72;
  B(g, w + 2, 6, dl, M.duvet, 0, 51, d / 2 - dl / 2 + 1, { rounded: 3 });
  B(g, w + 2, 6, 22, M.duvet, 0, 54, d / 2 - dl - 6, { rounded: 3 }); // fold
  // throw at foot
  B(g, w + 4, 2.5, 50, M.throw, 0, 56.5, d / 2 - 28, { rounded: 1.2 });
  // pillows
  const pw = (w - 16) / 2;
  for (const s of [-1, 1]) {
    const p = B(g, pw, 14, 42, M.sheet, s * (pw / 2 + 3), 53, -d / 2 + 28, { rounded: 6 });
    p.rotation.x = -0.25;
  }
  B(g, 50, 12, 14, M.pillowAccent, 0, 54, -d / 2 + 52, { rounded: 5 });
  return g;
}

function floatingBox(spec) {
  const g = new THREE.Group();
  const [w, d, h] = spec.size;
  B(g, w, h, d, mat(spec.material || 'oak'), 0, 0, 0, { rounded: 0.8 });
  B(g, w - 6, 0.8, 0.4, materials().black, 0, h * 0.62, d / 2 + 0.1, { cast: false });
  if (spec.decor !== false) {
    // small book + lamp-less decor
    B(g, 18, 3, 13, mat('#6d7b6a'), -3, h, -2);
    B(g, 16, 2, 12, mat('#c9b79c'), -3, h + 3, -2);
    cyl(g, 4, 3, 10, materials().pot, w / 2 - 9, h, -4);
  }
  return g;
}

function wallLight(spec) {
  const g = new THREE.Group();
  const M = materials();
  B(g, 6, 12, 2, M.black, 0, 0, -1);
  B(g, 1.2, 1.2, 18, M.black, 0, 6, 8);
  const shade = new THREE.Mesh(new THREE.ConeGeometry(7, 11, 32, 1, true), M.black);
  shade.material = M.black; shade.position.set(0, 2, 18); shade.castShadow = true; g.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(2.6, 16, 12), M.bulb);
  bulb.position.set(0, -2, 18); g.add(bulb);
  if (spec.light !== false) {
    const l = new THREE.PointLight(0xffc98a, spec.intensity ?? 1.6, 4, 2);
    l.position.set(0, -6, 18); g.add(l);
  }
  return g;
}

function pendant(spec) {
  const g = new THREE.Group();
  const M = materials();
  const drop = spec.drop ?? 80;
  const top = spec.ceiling ?? 260;
  B(g, 0.4, drop, 0.4, M.black, 0, top - drop, 0, { cast: false });
  const shade = new THREE.Mesh(new THREE.SphereGeometry(18, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), M.black);
  shade.material = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, side: THREE.DoubleSide, roughness: 0.5 });
  shade.position.set(0, top - drop - 14, 0); shade.castShadow = true; g.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(4, 16, 12), M.bulb);
  bulb.position.set(0, top - drop - 13, 0); g.add(bulb);
  const l = new THREE.PointLight(0xffd2a0, spec.intensity ?? 3, 5, 2);
  l.position.set(0, top - drop - 22, 0); g.add(l);
  return g;
}

function rug(spec) {
  const g = new THREE.Group();
  const [w, d] = spec.size;
  B(g, w, 1, d, mat(spec.material || 'rug'), 0, 0, 0, { cast: false, rounded: 0.4 });
  B(g, w - 16, 0.15, d - 16, mat('#c7bcaa'), 0, 1, 0, { cast: false });
  B(g, w - 20, 0.2, d - 20, mat(spec.material || 'rug'), 0, 1, 0, { cast: false });
  return g;
}

function curtain(spec) {
  const g = new THREE.Group();
  const [w, d, h] = spec.size;
  const folds = Math.max(3, Math.round(w / 9));
  const geo = new THREE.PlaneGeometry(w, h, folds * 6, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    pos.setZ(i, Math.sin((x / w) * folds * Math.PI * 2) * (d / 2));
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat(spec.material || 'curtain'));
  m.position.y = h / 2 + 1; m.castShadow = true; m.receiveShadow = true;
  g.add(m);
  if (spec.track) B(g, spec.track, 2, 3, materials().black, spec.trackOffset || 0, h + 1, 0, { cast: false });
  return g;
}

function slatPanel(spec) {
  const g = new THREE.Group();
  const [w, d, h] = spec.size;
  const M = materials();
  B(g, w, h, 1, M.felt, 0, 0, -d / 2 + 0.5, { cast: false });
  const slat = 2.8, gap = 1.6;
  const n = Math.floor(w / (slat + gap));
  const start = -((n - 1) * (slat + gap)) / 2;
  for (let i = 0; i < n; i++) B(g, slat, h, d - 1, mat(spec.material || 'oak'), start + i * (slat + gap), 0, 0.5, { cast: false });
  return g;
}

function table(spec) {
  const g = new THREE.Group();
  const [w, , h] = spec.size;
  const M = materials();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, 3, 48), mat(spec.material || 'oak'));
  top.position.y = h - 1.5; top.castShadow = top.receiveShadow = true; g.add(top);
  cyl(g, 3, 3, h - 3, M.black, 0, 0, 0);
  cyl(g, 22, 24, 2, M.black, 0, 0, 0, 32);
  return g;
}

function chair(spec) {
  const g = new THREE.Group();
  const M = materials();
  const s = mat(spec.material || 'oak');
  for (const [x, z] of [[-18, -18], [18, -18], [-18, 18], [18, 18]]) cyl(g, 1.2, 1.2, 45, M.black, x, 0, z, 8);
  B(g, 44, 4, 44, s, 0, 45, 0, { rounded: 1.5 });
  B(g, 44, 34, 4, s, 0, 52, -21, { rounded: 1.5 });
  return g;
}

function plant(spec) {
  const g = new THREE.Group();
  const M = materials();
  const h = spec.size?.[2] ?? 120;
  cyl(g, 16, 13, 34, M.pot, 0, 0, 0, 32);
  cyl(g, 1.2, 1.5, h * 0.55, mat('#5b4632'), 0, 34, 0, 8);
  const r = (s => () => (s = (s * 9301 + 49297) % 233280) / 233280)(spec.seed || 3);
  for (let i = 0; i < 22; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(8 + r() * 7, 10, 8), r() > 0.5 ? M.plant : M.plantDark);
    leaf.scale.set(1, 0.55, 1.4);
    leaf.position.set((r() - 0.5) * 50, 34 + h * 0.4 + r() * h * 0.55, (r() - 0.5) * 50);
    leaf.rotation.set(r(), r() * 3, r()); leaf.castShadow = true; g.add(leaf);
  }
  return g;
}

function rail(spec) {
  const g = new THREE.Group();
  const M = materials();
  const [w, d] = spec.size;
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, w, 12), M.black);
  bar.rotation.z = Math.PI / 2; bar.position.set(0, 0, d / 2); bar.castShadow = true; g.add(bar);
  for (const x of [-w / 2 + 2, w / 2 - 2]) B(g, 1.5, 1.5, d / 2 + 1, M.black, x, -0.75, d / 4 - 0.5);
  const shirts = [M.shirtA, M.shirtB, M.shirtC, M.shirtA, M.shirtB];
  const n = spec.hangers ?? 5;
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + 12 + i * ((w - 24) / Math.max(1, n - 1));
    const s = B(g, 2.5, 62, 40, shirts[i % shirts.length], x, -66, d / 2, { rounded: 1 });
    s.rotation.y = i % 2 ? 0.08 : -0.06;
    B(g, 0.6, 4, 0.6, M.black, x, -4, d / 2, { cast: false });
  }
  return g;
}

// Freestanding ironing board, folded and hung flat against the wall on a holder (size: [w, d, h], front faces +z).
function ironingBoard(spec) {
  const g = new THREE.Group();
  const M = materials();
  const [w, d, h] = spec.size || [38, 8, 135];
  // wall holder: back plate + two hooks near the top
  B(g, w * 0.8, 6, 1.2, M.steel, 0, h - 22, -d / 2 + 0.6);
  for (const x of [-w * 0.3, w * 0.3]) B(g, 1.6, 1.6, d - 1, M.steel, x, h - 22, 0);
  // folded legs (two crossing steel tubes right behind the board)
  for (const s of [-1, 1]) { const leg = B(g, 1.8, h * 0.82, 1.8, M.steel, s * w * 0.28, 4, -d / 2 + 3); leg.rotation.z = s * 0.05; }
  // board: covered top, tapering to a nose at the top
  const cover = mat(spec.material || { label: 'Strijkhoes', color: '#9fb3bf', roughness: 0.95 });
  B(g, w, h * 0.72, 2.6, cover, 0, 6, d / 2 - 2, { rounded: 1 });
  B(g, w * 0.72, h * 0.16, 2.6, cover, 0, 6 + h * 0.72, d / 2 - 2, { rounded: 1 });
  B(g, w * 0.4, h * 0.08, 2.6, cover, 0, 6 + h * 0.88, d / 2 - 2, { rounded: 1 });
  // iron rest (end plate) at the bottom
  B(g, w * 0.7, 4, 3, M.steel, 0, 0, d / 2 - 2.5);
  return g;
}

function ironingCabinet(spec) {
  const g = new THREE.Group();
  const [w, d, h] = spec.size;
  const M = materials();
  const fm = mat(spec.material || 'greige');
  // open carcass with light interior
  B(g, w, h - 10, 1.8, M.oak, 0, 10, -d / 2 + 0.9);
  B(g, 1.8, h - 10, d - FRONT_T, M.oak, -w / 2 + 0.9, 10, -FRONT_T / 2);
  B(g, 1.8, h - 10, d - FRONT_T, M.oak, w / 2 - 0.9, 10, -FRONT_T / 2);
  B(g, w, 1.8, d - FRONT_T, M.oak, 0, h - 1.8, -FRONT_T / 2);
  B(g, w, 1.8, d - FRONT_T, M.oak, 0, 10, -FRONT_T / 2);
  B(g, w - 0.5, 10, 2, M.black, 0, 0, d / 2 - 7, { cast: false });
  B(g, w - 3.6, 1.8, d - 4, M.oak, 0, 175, -2);
  // iron + basket on shelf
  B(g, 12, 9, 24, mat('#ececec'), 10, 176.8, -6, { rounded: 3 });
  B(g, 30, 22, 30, mat('#cdbfa8'), -5, 10 + 1.8, 0, { rounded: 2 });
  // door, opened ~105 degrees on the left hinge
  const pivot = new THREE.Group(); pivot.position.set(-w / 2, 0, d / 2); g.add(pivot);
  B(pivot, w - GAP, h - 10 - GAP, FRONT_T, fm, (w - GAP) / 2, 10, FRONT_T / 2);
  pivot.rotation.y = -(spec.doorOpen ?? 2.95);
  // ironing board folded out
  const L = spec.boardLength ?? 110;
  const shape = new THREE.Shape();
  shape.moveTo(-17, 0); shape.lineTo(17, 0); shape.lineTo(17, L - 25); shape.quadraticCurveTo(17, L, 0, L); shape.quadraticCurveTo(-17, L, -17, L - 25); shape.lineTo(-17, 0);
  const bg = new THREE.ExtrudeGeometry(shape, { depth: 2.5, bevelEnabled: false });
  const bm = new THREE.Mesh(bg, mat('#8f9aa3')); bm.rotation.x = Math.PI / 2; bm.position.y = 2.5; bm.castShadow = true; g.add(bm);
  bm.position.set(0, 90.5, d / 2 - 6);
  B(g, 2, 3, 30, M.black, 0, 85, d / 2 + 6);
  return g;
}

// Bicycle, parked along its length (size: [length, handlebar width, height]); front wheel at +x.
function bike(spec) {
  const g = new THREE.Group();
  const M = materials();
  const [l, w, h] = spec.size;
  const r = Math.min(34, h * 0.33);
  const frameM = mat(spec.color || '#2f3b35');
  const wb = l - 2 * r - 6; // wheelbase
  for (const x of [-wb / 2, wb / 2]) {
    const tyre = new THREE.Mesh(new THREE.TorusGeometry(r, 2.2, 10, 40), M.black);
    tyre.position.set(x, r + 2, 0); tyre.castShadow = true; g.add(tyre);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 6, 12), M.steel);
    hub.rotation.x = Math.PI / 2; hub.position.set(x, r + 2, 0); g.add(hub);
  }
  const bar = (x1, y1, x2, y2, rad = 1.6, m = frameM) => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, len, 8), m);
    c.position.set((x1 + x2) / 2, (y1 + y2) / 2, 0); c.rotation.z = Math.atan2(y2 - y1, x2 - x1) - Math.PI / 2; c.castShadow = true; g.add(c);
  };
  const ay = r + 2, bbx = -wb * 0.08, bby = ay - 4, seatX = -wb * 0.2, seatY = h - 14, headX = wb * 0.32, headY = h - 12;
  bar(-wb / 2, ay, bbx, bby); bar(-wb / 2, ay, seatX, seatY); bar(bbx, bby, seatX, seatY);
  bar(bbx, bby, headX, headY - 8); bar(seatX, seatY - 6, headX, headY - 6); bar(headX, headY, wb / 2, ay);
  B(g, 24, 4, 12, M.black, seatX - 2, seatY, 0, { rounded: 1.5 });
  const hb = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, w - 4, 8), M.black);
  hb.rotation.x = Math.PI / 2; hb.position.set(headX - 4, headY + 4, 0); g.add(hb);
  if (spec.rack !== false) { B(g, 4, 30, 4, M.black, -wb / 2 - r - 4, 60, -w / 2 + 6); } // wall hook/rack post
  return g;
}

// Bar stool: round seat on four black legs (size: [diameter, diameter, seat height]).
function stool(spec) {
  const g = new THREE.Group();
  const M = materials();
  const [w, , h] = spec.size;
  const seat = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2 - 1, 4, 28), mat(spec.material || 'oak'));
  seat.position.y = h - 2; seat.castShadow = true; g.add(seat);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, h - 4, 8), M.black);
    leg.position.set(sx * w * 0.3, (h - 4) / 2, sz * w * 0.3); leg.rotation.z = -sx * 0.05; leg.rotation.x = sz * 0.05; leg.castShadow = true; g.add(leg);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(w * 0.31, 0.8, 6, 24), M.black);
  ring.rotation.x = Math.PI / 2; ring.position.y = h * 0.38; g.add(ring);
  return g;
}

// Staggered floor bike rack (high/low wheel slots). size: [length, depth, height]; `slots` positions along x.
function bikeRack(spec) {
  const g = new THREE.Group();
  const M = materials();
  const [w, d, h] = spec.size;
  B(g, w, 3, 4, M.black, 0, 0, -d / 2 + 6);
  B(g, w, 3, 4, M.black, 0, 0, d / 2 - 6);
  const slots = spec.slots || [];
  slots.forEach((x, i) => {
    const hi = i % 2 ? h : h * 0.55;
    B(g, 2, hi, 2, M.black, x - 4, 0, -d / 2 + 8);
    B(g, 2, hi, 2, M.black, x + 4, 0, -d / 2 + 8);
    B(g, 10, 2, d - 12, M.steel, x, hi * 0.35, 0, { cast: false });
  });
  return g;
}

// Electrical point (wall plate), centred on its height (elev = centre height in cm). Front faces +z.
// kind: dubbel | enkel | perilex | laadpunt | driver | aansluitpunt
export const SOCKET_KINDS = {
  dubbel: { size: [16, 1.6, 8.5], label: 'Dubbele wandcontactdoos' },
  enkel: { size: [8.5, 1.6, 8.5], label: 'Enkele wandcontactdoos' },
  perilex: { size: [10, 2, 10], label: 'Perilex-aansluiting (kookplaat)' },
  laadpunt: { size: [16, 1.6, 8.5], label: 'Laadpunt (dubbele wcd, eigen groep)' },
  driver: { size: [22, 4, 8], label: 'Aansluitpunt LED-driver' },
  aansluitpunt: { size: [8.5, 1.6, 8.5], label: 'Aansluitpunt verlichting' },
};
function socket(spec) {
  const g = new THREE.Group();
  const M = materials();
  const kind = SOCKET_KINDS[spec.kind] ? spec.kind : 'enkel';
  const [w, d, h] = spec.size || SOCKET_KINDS[kind].size;
  const plate = mat('#f6f6f3');
  B(g, w, h, d, plate, 0, -h / 2, 0, { rounded: 0.6, cast: false });
  const holes = kind === 'dubbel' || kind === 'laadpunt' ? [-w / 4, w / 4] : kind === 'enkel' ? [0] : [];
  for (const x of holes) {
    const c = cyl(g, 2.6, 2.6, 0.5, mat('#e2e2de'), x, 0, d / 2); c.rotation.x = Math.PI / 2; c.position.set(x, 0, d / 2 + 0.2);
    for (const dx of [-1, 1]) { const pin = cyl(g, 0.35, 0.35, 0.6, M.black, x + dx * 0.95, 0, 0); pin.rotation.x = Math.PI / 2; pin.position.set(x + dx * 0.95, 0, d / 2 + 0.5); }
  }
  if (kind === 'perilex') { const c = cyl(g, 3.6, 3.6, 0.6, mat('#d5d5d0'), 0, 0, 0); c.rotation.x = Math.PI / 2; c.position.set(0, 0, d / 2 + 0.3); }
  if (kind === 'laadpunt') B(g, w * 0.5, 1, 0.4, mat('#2fbf5b'), 0, h / 2 - 1.6, d / 2 + 0.1, { cast: false });
  if (kind === 'driver') B(g, w * 0.3, 1, 0.4, mat('#f0b429'), 0, -0.5, d / 2 + 0.1, { cast: false });
  if (kind === 'aansluitpunt') B(g, w * 0.5, w * 0.5, 0.4, mat('#cfcfca'), 0, -w * 0.25, d / 2 + 0.1, { cast: false });
  return g;
}

function garageCar(spec) { // optional ghost car volume
  const g = new THREE.Group();
  const [w, d, h] = spec.size;
  const m = new THREE.MeshStandardMaterial({ color: 0x7a8794, transparent: true, opacity: 0.25, depthWrite: false });
  B(g, w, h * 0.55, d, m, 0, 12, 0, { cast: false, rounded: 10 });
  B(g, w * 0.86, h * 0.4, d * 0.5, m, 0, 12 + h * 0.55, -d * 0.05, { cast: false, rounded: 12 });
  return g;
}

export const BUILDERS = {
  base: (s) => cabinet(s, { plinth: 10, gola: 3, rows: s.drawers ? Array.from({ length: s.drawers }, () => ({ cols: s.cols || 1 })) : [{ cols: s.doors || 1 }] }),
  tall: (s) => tall(s, { material: s.material || 'oak' }),
  wall: (s) => cabinet(s, { plinth: 0, rows: [{ cols: s.doors || 2 }] }),
  wardrobe: (s) => tall(s, { material: s.material || 'oak' }),
  plinth: (s) => cabinet({ ...s, rows: [{ cols: 1 }] }, { plinth: 8 }),
  fridge: (s) => fridgeColumn(s, 'fridge'),
  freezer: (s) => fridgeColumn(s, 'freezer'),
  ovenColumn,
  dishwasher: (s) => cabinet({ ...s, rows: [{ cols: 1 }] }, { plinth: 10, gola: 3 }),
  worktop, sink, hob, hood, panel,
  washer: (s) => appliance(s, 'washer'),
  dryer: (s) => appliance(s, 'dryer'),
  basketDrawers, openShelf, workbench, ironingCabinet, ironingBoard,
  ledStrip, walkway, bed,
  nightstand: floatingBox, wallLight, pendant, rug, curtain, slatPanel, table, chair, plant, rail,
  car: garageCar, bike, stool, bikeRack, socket,
};

export function buildItem(spec) {
  const fn = BUILDERS[spec.type];
  if (!fn) { console.warn('Unknown item type', spec.type); return new THREE.Group(); }
  return fn(spec);
}
