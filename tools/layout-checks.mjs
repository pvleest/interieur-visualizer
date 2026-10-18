// Pure layout checks on a resolved plan (base plan + scenario patches applied).
// Used by tools/test.mjs for the base design and every scenario.
// All coordinates in cm; x = east, z = south; item rot 0 = front faces +z.

const SKIP = new Set(['rug', 'walkway', 'ledStrip', 'wallLight', 'pendant', 'curtain', 'sink', 'hob']);
const ALLOWED_PAIRS = [['table', 'chair'], ['table', 'stool']];
const TOL = 1.01;

export function footprint(it) {
  const a = ((it.rot || 0) * Math.PI) / 180, w = it.size[0], d = it.size[1] || 0;
  const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const hw = (c * w + s * d) / 2, hd = (s * w + c * d) / 2;
  let [x, z] = it.pos;
  if (it.type === 'rail') { x += (Math.sin(a) * d) / 2; z += (Math.cos(a) * d) / 2; } // origin at the wall
  return { x0: x - hw, x1: x + hw, z0: z - hd, z1: z + hd };
}
export function vertical(it) {
  const e = it.elev || 0;
  if (it.type === 'rail') return [e - 70, e];
  return [e, e + (it.size[2] || 0)];
}
const solid = (it) => it.size && it.pos && !SKIP.has(it.type) && !it.attachTo;
const ov = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);
const rectOv = (a, b, tol = TOL) => ov(a.x0, a.x1, b.x0, b.x1) > tol && ov(a.z0, a.z1, b.z0, b.z1) > tol;
const inRect = (r, x, z, m = 0) => x > r.x0 + m && x < r.x1 - m && z > r.z0 + m && z < r.z1 - m;
const distRect = (r, x, z) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));

function wallFrame(w, defaults) {
  const [ax, az] = w.from, [bx, bz] = w.to, dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
  const u = [dx / len, dz / len], n = [-u[1], u[0]], t = w.thickness ?? defaults.wallThickness ?? 20;
  const P = (s, q) => [ax + u[0] * s + n[0] * q, az + u[1] * s + n[1] * q];
  return { u, n, t, len, P, H: w.height ?? defaults.wallHeight ?? 260 };
}
const rectOf = (pts) => ({ x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), z0: Math.min(...pts.map((p) => p[1])), z1: Math.max(...pts.map((p) => p[1])) });

export function checkPlan(plan, opts = {}) {
  const out = [];
  const defaults = plan.defaults || {};
  const items = plan.items.filter(solid);
  const fp = new Map(items.map((it) => [it.id, footprint(it)]));
  // 1. inside its room
  for (const it of plan.items) {
    if (!it.room || !it.size || it.type === 'walkway' || it.type === 'wallLight') continue;
    const r = plan.rooms.find((x) => x.id === it.room);
    if (!r) { out.push(`${it.id}: onbekende ruimte ${it.room}`); continue; }
    const b = rectOf(r.polygon), f = footprint(it);
    if (f.x0 < b.x0 - 2.5 || f.x1 > b.x1 + 2.5 || f.z0 < b.z0 - 2.5 || f.z1 > b.z1 + 2.5) out.push(`buiten ruimte: ${it.id}`);
  }
  // 2. no intersections between furniture
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if (ALLOWED_PAIRS.some(([p, q]) => (a.type === p && b.type === q) || (a.type === q && b.type === p))) continue;
    if (!rectOv(fp.get(a.id), fp.get(b.id))) continue;
    const [a0, a1] = vertical(a), [b0, b1] = vertical(b);
    if (ov(a0, a1, b0, b1) > 0.5) out.push(`overlap: ${a.id} × ${b.id}`);
  }
  // 3. furniture vs walls (incl. scenario partitions), 4. door leaves, 5. door approach zones
  for (const w of plan.walls) {
    const F = wallFrame(w, defaults);
    const wr = rectOf([F.P(0, -F.t / 2), F.P(F.len, -F.t / 2), F.P(0, F.t / 2), F.P(F.len, F.t / 2)]);
    for (const it of items) {
      const f = fp.get(it.id), [v0] = vertical(it);
      if (v0 >= F.H || !rectOv(f, wr)) continue;
      // inside an opening's clear span is fine for elevated items only (windows); otherwise a wall hit
      const s0 = Math.min(...[[f.x0, f.z0], [f.x1, f.z1]].map(([x, z]) => (x - w.from[0]) * F.u[0] + (z - w.from[1]) * F.u[1]));
      const s1 = Math.max(...[[f.x0, f.z0], [f.x1, f.z1]].map(([x, z]) => (x - w.from[0]) * F.u[0] + (z - w.from[1]) * F.u[1]));
      if (s1 - 1 <= 0 || s0 + 1 >= F.len) continue; // only touching the wall end
      out.push(`in wand: ${it.id} × ${w.id}`);
    }
    for (const op of w.openings || []) {
      const type = op.type || 'door';
      if (type === 'door') {
        const swing = op.swing ?? 1, hs = (op.hinge ?? 'start') === 'start', dir = hs ? 1 : -1, lw = op.width - 8;
        const hu = hs ? op.offset + 4 : op.offset + op.width - 4, hq = swing * (F.t / 2);
        const open = op.open ?? 85;
        const hit = new Set();
        for (let deg = 0; deg <= open; deg += 5) {
          const r = (deg * Math.PI) / 180;
          for (let s = 4; s <= lw; s += 3) {
            const [x, z] = F.P(hu + dir * s * Math.cos(r), hq + swing * s * Math.sin(r));
            for (const it of items) {
              const [v0] = vertical(it);
              if (v0 < (op.height || 211) && inRect(fp.get(it.id), x, z, 1)) hit.add(it.id);
            }
          }
        }
        for (const id of hit) out.push(`deur ${w.id}@${op.offset} raakt ${id}`);
      }
      if (type === 'door' || type === 'glassdoor' || type === 'slider') {
        const m = type === 'slider' ? 25 : 0;
        for (const side of [-1, 1]) {
          const zone = rectOf([F.P(op.offset + m, side * F.t / 2), F.P(op.offset + op.width - m, side * (F.t / 2 + 50))]);
          for (const it of items) {
            const [v0] = vertical(it);
            if (v0 < 200 && rectOv(fp.get(it.id), zone)) out.push(`blokkeert doorgang ${w.id}@${op.offset}: ${it.id}`);
          }
        }
      }
    }
  }
  // 6. walkways: >= 120 wide and empty
  for (const wk of plan.items.filter((i) => i.type === 'walkway')) {
    const r = rectOf(wk.polygon);
    if (Math.min(r.x1 - r.x0, r.z1 - r.z0) < 120) out.push(`looppad ${wk.id} smaller dan 120 cm`);
    for (const it of items) if (it.room === wk.room && vertical(it)[0] < 200 && rectOv(fp.get(it.id), r)) out.push(`looppad ${wk.id} geblokkeerd door ${it.id}`);
  }
  // 7. hard requirements
  const has = (pred) => plan.items.some(pred);
  if (!has((i) => i.type === 'fridge' && (i.size?.[2] || 0) >= 200)) out.push('eis: grote koelkast ontbreekt');
  if (!has((i) => i.type === 'freezer')) out.push('eis: vriezer ontbreekt');
  if (!has((i) => i.type === 'washer') || !has((i) => i.type === 'dryer')) out.push('eis: wasmachine + droger ontbreken');
  if (!has((i) => i.type === 'basketDrawers')) out.push('eis: wasopslag (wasmandlades) ontbreekt');
  if (!has((i) => i.type === 'ironingCabinet')) out.push('eis: strijkvoorziening ontbreekt');
  const gStore = plan.items.filter((i) => i.room === 'garage' && ['tall', 'wardrobe'].includes(i.type) && (i.size?.[2] || 0) >= 200).reduce((s, i) => s + i.size[0], 0);
  if (gStore < 300) out.push(`eis: hoge garagekasten slechts ${gStore} cm`);
  if (!has((i) => i.type === 'walkway' && i.room === 'garage')) out.push('eis: looppad garage ontbreekt');
  const bw = plan.walls.find((w) => w.id === 'bijkeuken-slaapkamer');
  if (bw) {
    const F = wallFrame(bw, defaults);
    for (const m of plan.items.filter((i) => i.type === 'washer' || i.type === 'dryer')) {
      const f = footprint(m);
      let dmin = Infinity;
      for (let s = 0; s <= F.len; s += 5) { const [x, z] = F.P(s, 0); dmin = Math.min(dmin, distRect(f, x, z) - F.t / 2); }
      if (dmin < 30) out.push(`eis: ${m.id} staat tegen de slaapkamerwand (${dmin.toFixed(0)} cm)`);
      if (m.room !== 'bijkeuken') out.push(`eis: ${m.id} staat niet in de bijkeuken`);
    }
  }
  // 8. walking route stays clear of furniture (radius = half passage width)
  if (opts.route) {
    const r = opts.radius ?? 25;
    const hits = new Set();
    for (let k = 0; k < opts.route.length - 1; k++) {
      const [ax, az] = opts.route[k], [bx, bz] = opts.route[k + 1], L = Math.hypot(bx - ax, bz - az);
      for (let s = 0; s <= L; s += 4) {
        const x = ax + ((bx - ax) * s) / L, z = az + ((bz - az) * s) / L;
        for (const it of items) if (vertical(it)[0] < 150 && distRect(fp.get(it.id), x, z) < r) hits.add(it.id);
      }
    }
    for (const id of hits) out.push(`looproute geblokkeerd door ${id}`);
  }
  return out;
}
