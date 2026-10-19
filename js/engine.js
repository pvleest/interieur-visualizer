// Builds a Three.js scene graph from a plan config (see README for the format).
import * as THREE from 'three';
import { CSS2DObject } from '../vendor/addons/CSS2DRenderer.js';
import { B, boxGeo } from './geometry.js';
import { mat, materials, setPlanMaterials } from './materials.js';
import { buildItem } from './items.js';

export const SCALE = 0.01; // config is in cm, world is in metres

function wallBox(group, len, h, t, u0, u1, y0, y1) {
  if (u1 - u0 < 0.1 || y1 - y0 < 0.1) return;
  const M = materials();
  const geo = boxGeo(u1 - u0, y1 - y0, t);
  const m = new THREE.Mesh(geo, [M.wall, M.wall, M.wallCap, M.wall, M.wall, M.wall]);
  m.position.set((u0 + u1) / 2, (y0 + y1) / 2, 0);
  m.castShadow = true; m.receiveShadow = true;
  m.userData.y0 = y0; m.userData.y1 = y1;
  group.add(m);
}

// Lower a wall to height h (cm) for the dollhouse cut-away.
export function setWallHeight(wall, h) {
  wall.curH = h;
  for (const m of wall.solid.children) {
    const { y0, y1 } = m.userData;
    const top = Math.min(y1, h);
    if (top <= y0 + 0.1) { m.visible = false; continue; }
    m.visible = true;
    m.scale.y = (top - y0) / (y1 - y0);
    m.position.y = y0 + (top - y0) / 2;
  }
  wall.fixtures.visible = h >= wall.height - 2;
  for (const g of wall.attached || []) g.visible = wall.fixtures.visible;
}

function frameRect(group, u0, u1, y0, y1, depth, bar, material, z = 0) {
  const w = u1 - u0, h = y1 - y0, cu = (u0 + u1) / 2;
  B(group, w, bar, depth, material, cu, y0, z);
  B(group, w, bar, depth, material, cu, y1 - bar, z);
  B(group, bar, h, depth, material, u0 + bar / 2, y0, z);
  B(group, bar, h, depth, material, u1 - bar / 2, y0, z);
}

function buildOpening(op, wall, t) {
  const g = new THREE.Group();
  const M = materials();
  const u0 = op.offset, u1 = op.offset + op.width;
  const sill = op.sill || 0, top = sill + op.height;
  const cu = (u0 + u1) / 2;
  const type = op.type || 'door';
  if (type === 'window' || type === 'fixed') {
    frameRect(g, u0, u1, sill, top, 7, 5, M.frame);
    const mullions = op.panes ? op.panes - 1 : Math.max(0, Math.round(op.width / 90) - 1);
    for (let i = 1; i <= mullions; i++) B(g, 4, op.height, 6, M.frame, u0 + (op.width * i) / (mullions + 1), sill, 0);
    B(g, op.width - 8, op.height - 8, 0.6, M.glass, cu, sill + 4, 0, { cast: false });
    if (sill > 0) { B(g, op.width + 4, 2, t / 2 + 4, M.composite, cu, sill - 2, op.sillSide === -1 ? -t / 4 - 2 : t / 4 + 2); }
  } else if (type === 'slider' || type === 'glassdoor') {
    const panes = type === 'slider' ? 2 : 1;
    frameRect(g, u0, u1, 0, top, 9, 5, M.frame);
    const pw = (op.width - 10) / panes;
    for (let i = 0; i < panes; i++) {
      const a = u0 + 5 + i * pw, z = panes === 2 ? (i ? 2.2 : -2.2) : 0;
      const ov = panes === 2 ? 4 : 0;
      frameRect(g, a - (i ? ov : 0), a + pw + (i ? 0 : ov), 5, top - 5, 4, 5, M.frame, z);
      B(g, pw - 8, top - 18, 0.5, M.glass, a + pw / 2, 9, z, { cast: false });
    }
    if (type === 'glassdoor') { const hu = (op.hinge ?? 'start') === 'end' ? u0 + 14 : u1 - 14; B(g, 2, 30, 5, M.steel, hu, 90, 3); B(g, 2, 30, 5, M.steel, hu, 90, -3); }
  } else if (type === 'garage') {
    const segs = 5; const sh = op.height / segs;
    for (let i = 0; i < segs; i++) B(g, op.width, sh - 0.6, 4, M.garageDoor, cu, sill + i * sh + 0.3, op.side === -1 ? -t / 2 + 4 : t / 2 - 4);
    frameRect(g, u0 - 2, u1 + 2, 0, top + 2, 6, 4, M.frame, op.side === -1 ? -t / 2 + 4 : t / 2 - 4);
  } else if (type === 'door') {
    // frame
    const fz = 0;
    B(g, 4, op.height, t + 2, M.doorLeaf, u0 + 2, 0, fz);
    B(g, 4, op.height, t + 2, M.doorLeaf, u1 - 2, 0, fz);
    B(g, op.width, 4, t + 2, M.doorLeaf, cu, op.height - 4, fz);
    // leaf, swung open
    const swing = op.swing ?? 1; // +1 = towards wall normal side
    const hingeStart = (op.hinge ?? 'start') === 'start';
    const dir = hingeStart ? 1 : -1;
    const pivot = new THREE.Group();
    pivot.position.set(hingeStart ? u0 + 4 : u1 - 4, 0, swing * (t / 2));
    const lw = op.width - 8;
    const leafMat = op.leafMaterial ? mat(op.leafMaterial) : M.doorLeaf;
    B(pivot, lw, op.height - 5, 4, leafMat, dir * lw / 2, 0, swing * 2);
    B(pivot, 12, 1.5, 1.5, M.black, dir * (lw - 8), 100, swing * 5);
    const open = THREE.MathUtils.degToRad(op.open ?? 85);
    pivot.rotation.y = -swing * dir * open;
    g.add(pivot);
  }
  return g;
}

export function buildWall(w, defaults) {
  const [ax, az] = w.from, [bx, bz] = w.to;
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz);
  const t = w.thickness ?? defaults.wallThickness ?? 20;
  const H = w.height ?? defaults.wallHeight ?? 260;
  const group = new THREE.Group();
  group.position.set(ax, 0, az);
  group.rotation.y = Math.atan2(-dz, dx);
  const solid = new THREE.Group();
  const fixtures = new THREE.Group();
  group.add(solid, fixtures);
  const ops = [...(w.openings || [])].sort((a, b) => a.offset - b.offset);
  let cur = 0;
  for (const op of ops) {
    wallBox(solid, len, H, t, cur, op.offset, 0, H);
    const sill = op.sill || 0;
    wallBox(solid, len, H, t, op.offset, op.offset + op.width, 0, sill);
    wallBox(solid, len, H, t, op.offset, op.offset + op.width, sill + op.height, H);
    fixtures.add(buildOpening(op, w, t));
    cur = op.offset + op.width;
  }
  wallBox(solid, len, H, t, cur, len, 0, H);
  const d = new THREE.Vector2(dx / len, dz / len);
  return {
    group, solid, fixtures, height: H, spec: w,
    a: new THREE.Vector2(ax, az), n: new THREE.Vector2(-d.y, d.x), len, cut: 0, curH: H,
  };
}

function polygonBounds(poly) {
  const xs = poly.map(p => p[0]), zs = poly.map(p => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

export function polygonArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const [x1, z1] = poly[i], [x2, z2] = poly[(i + 1) % poly.length]; a += x1 * z2 - x2 * z1; }
  return Math.abs(a / 2);
}

function makeLabel(html, cls) {
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = html;
  return new CSS2DObject(el);
}

export function buildPlan(plan) {
  setPlanMaterials(plan.palette, plan.materials);
  const defaults = plan.defaults || {};
  const root = new THREE.Group();
  root.scale.setScalar(SCALE);
  const out = { root, rooms: [], walls: [], items: [], ceilings: [], roomLabels: [], itemLabels: [], lights: [] };
  const M = materials();

  // rooms: floors, ceilings, lights, labels
  for (const r of plan.rooms) {
    const poly = r.polygon;
    const bb = polygonBounds(poly);
    const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x / 100, -z / 100)));
    const fgeo = new THREE.ShapeGeometry(shape);
    fgeo.scale(100, 100, 1);
    const floor = new THREE.Mesh(fgeo, mat(r.floor || defaults.floor || 'concrete'));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    floor.userData.room = r.id;
    root.add(floor);
    const H = r.ceilingHeight ?? defaults.ceilingHeight ?? 260;
    const ceil = new THREE.Mesh(fgeo, M.ceiling);
    ceil.rotation.x = -Math.PI / 2; ceil.position.y = H; ceil.visible = false;
    root.add(ceil); out.ceilings.push(ceil);
    const cx = (bb.minX + bb.maxX) / 2, cz = (bb.minZ + bb.maxZ) / 2;
    const lights = r.lights || [{ pos: [cx, cz], intensity: r.lightIntensity ?? 4 }];
    for (const L of lights) {
      const l = new THREE.PointLight(L.color ?? 0xfff1e0, L.intensity ?? 4, L.distance ?? 9, 2);
      l.position.set(L.pos[0], L.height ?? H - 25, L.pos[1]);
      root.add(l); out.lights.push(l);
    }
    const w = Math.round(bb.maxX - bb.minX), d = Math.round(bb.maxZ - bb.minZ);
    const dims = r.dims || `${w} × ${d} cm`;
    if (!r.hidden) {
      const lbl = makeLabel(`<b>${r.name}</b><span>${dims}</span>`, 'room-label');
      lbl.position.set(r.labelPos?.[0] ?? cx, 5, r.labelPos?.[1] ?? cz);
      lbl.userData.room = r.id;
      root.add(lbl); out.roomLabels.push(lbl);
    }
    out.rooms.push({ ...r, bounds: bb, center: [cx, cz], width: w, depth: d, area: polygonArea(poly) / 10000, height: H });
  }

  // walls
  for (const w of plan.walls) {
    const wall = buildWall(w, defaults);
    root.add(wall.group);
    out.walls.push(wall);
  }

  // items
  plan.items.forEach((it, idx) => {
    const g = buildItem(it);
    const [x, z] = it.pos || [0, 0];
    g.position.set(x, it.elev || 0, z);
    g.rotation.y = THREE.MathUtils.degToRad(it.rot || 0);
    g.userData.item = it; g.userData.index = idx;
    g.traverse(o => { if (o.isMesh) o.userData.itemRoot = g; });
    root.add(g);
    out.items.push(g);
    if (it.layer) g.userData.layer = it.layer;
    if (it.label && it.layer) {
      // layer items (e.g. electrical points) get their own label style and are toggled by the app
      const lbl = makeLabel(`<span class="dot"></span>${it.label}${it.elev != null ? ` <em>${it.elev} cm</em>` : ''}`, `item-label layer-label layer-${it.layer}`);
      lbl.position.set(0, (it.labelHeight ?? 14), 0);
      lbl.element.dataset.index = idx;
      lbl.userData.layer = it.layer;
      g.add(lbl); (out.layerLabels ||= []).push(lbl);
    } else if (it.label) {
      const lbl = makeLabel(`<span class="dot"></span>${it.label}`, 'item-label');
      const h = it.labelHeight ?? Math.min((it.size?.[2] ?? 80) + (it.elev || 0) + 12, 250);
      if (it.labelAt) lbl.position.set(it.labelAt[0] - x, h - (it.elev || 0), it.labelAt[1] - z);
      else lbl.position.set(0, h - (it.elev || 0), 0);
      lbl.element.dataset.index = idx;
      g.add(lbl); out.itemLabels.push(lbl);
    }
  });

  // items attached to a wall (e.g. curtains) hide together with its fixtures
  const wallsById = Object.fromEntries(out.walls.map(w => [w.spec.id, w]));
  for (const g of out.items) {
    const id = g.userData.item.attachTo;
    if (id && wallsById[id]) (wallsById[id].attached ||= []).push(g);
  }

  // context: ground plane
  const gb = plan.ground || { minX: -1500, maxX: 2000, minZ: -1200, maxZ: 1800 };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(gb.maxX - gb.minX, gb.maxZ - gb.minZ), M.ground);
  ground.rotation.x = -Math.PI / 2; ground.position.set((gb.minX + gb.maxX) / 2, -0.5, (gb.minZ + gb.maxZ) / 2);
  ground.receiveShadow = true; root.add(ground);
  for (const c of plan.context || []) {
    const shape = new THREE.Shape(c.polygon.map(([x, z]) => new THREE.Vector2(x, -z)));
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat(c.material || '#d9d6cf'));
    m.rotation.x = -Math.PI / 2; m.position.y = -0.2; m.receiveShadow = true; root.add(m);
    if (c.label) {
      const lbl = makeLabel(c.label, 'context-label');
      const bb = polygonBounds(c.polygon);
      lbl.position.set((bb.minX + bb.maxX) / 2, 5, (bb.minZ + bb.maxZ) / 2);
      root.add(lbl); out.roomLabels.push(lbl);
    }
  }
  return out;
}
