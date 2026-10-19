// Interactive edit mode ("Bewerken"): select, drag (mouse + touch), snap, rotate, duplicate, delete,
// resize, recolour and add items from a catalogue. Every change goes through the app's applyEdit()
// (so it is part of the current scenario, undoable, savable and shareable). The layout checks run
// live and only warn; they never block an edit.
import * as THREE from 'three';
import { checkPlan, footprint } from './layout-checks.mjs';

const GRID = 5;          // cm
const SNAP = 10;         // cm: snap distance to walls / neighbours
const NOT_EDITABLE = new Set(['walkway', 'curtain']);
const NO_SNAP_TARGET = new Set(['walkway', 'rug', 'ledStrip', 'pendant', 'curtain', 'wallLight', 'socket']);

// Catalogue. `place`: wall (back against a wall), free (anywhere), socket (on a wall face).
// `from`: copy the look of an existing item of that type when the plan has one.
export const CATALOG = [
  { key: 'hoog60', name: 'Hoge kast 60', icon: '▯', place: 'wall', item: { type: 'tall', size: [60, 60, 235], rows: [{ cols: 1 }, { h: 45, cols: 1 }] }, role: 'tall' },
  { key: 'hoog40', name: 'Hoge kast 40', icon: '▯', place: 'wall', item: { type: 'tall', size: [40, 60, 235], rows: [{ cols: 1 }, { h: 45, cols: 1 }] }, role: 'tall' },
  { key: 'onder', name: 'Onderkast 60', icon: '▭', place: 'wall', item: { type: 'base', size: [60, 60, 88], doors: 1 }, role: 'base' },
  { key: 'boven', name: 'Bovenkast 60', icon: '▔', place: 'wall', item: { type: 'wall', size: [60, 35, 70], elev: 150, doors: 1 }, role: 'upper' },
  { key: 'lade', name: 'Ladekast', icon: '☰', place: 'wall', item: { type: 'base', size: [80, 50, 90], drawers: 4 }, role: 'base' },
  { key: 'schoen', name: 'Schoenenkast', icon: '▤', place: 'wall', item: { type: 'tall', size: [80, 35, 120], rows: [{ cols: 2 }] }, role: 'tall' },
  { key: 'stelling', name: 'Open stelling', icon: '▥', place: 'wall', item: { type: 'openShelf', size: [80, 40, 200] }, role: 'accent' },
  { key: 'koelkast', name: 'Koelkast', icon: '❄', place: 'wall', item: { type: 'fridge', size: [60, 65, 200] }, role: 'tall' },
  { key: 'vriezer', name: 'Vriezer', icon: '❄', place: 'wall', item: { type: 'freezer', size: [60, 65, 185] }, role: 'tall' },
  { key: 'was', name: 'Wasmachine', icon: '◎', place: 'wall', item: { type: 'washer', size: [60, 60, 85] } },
  { key: 'droger', name: 'Droger', icon: '◎', place: 'wall', item: { type: 'dryer', size: [60, 60, 85] } },
  { key: 'fiets', name: 'Fiets', icon: '🚲', place: 'wall', rotOffset: 90, from: 'bike', item: { type: 'bike', size: [190, 64, 110], rack: false, color: '#3b4a52' } },
  { key: 'bank', name: 'Bankje', icon: '▬', place: 'wall', item: { type: 'base', size: [110, 40, 45], drawers: 2, label: 'Bankje' }, role: 'accent' },
  { key: 'bed', name: 'Bed', icon: '🛏', place: 'wall', from: 'bed', item: { type: 'bed', size: [160, 210, 58] }, role: 'accent' },
  { key: 'nacht', name: 'Nachtkastje', icon: '▫', place: 'wall', item: { type: 'nightstand', size: [45, 40, 28], elev: 42 }, role: 'accent' },
  { key: 'tafel', name: 'Tafel', icon: '◯', place: 'free', from: 'table', item: { type: 'table', size: [80, 80, 75] }, role: 'accent' },
  { key: 'stoel', name: 'Stoel', icon: '⑁', place: 'free', from: 'chair', item: { type: 'chair', size: [44, 44, 86] }, role: 'accent' },
  { key: 'kruk', name: 'Kruk', icon: '⊥', place: 'free', from: 'stool', item: { type: 'stool', size: [36, 36, 66] }, role: 'accent' },
  { key: 'plant', name: 'Plant', icon: '❦', place: 'free', from: 'plant', item: { type: 'plant', size: [32, 32, 90], seed: 3 } },
  { key: 'strijk', name: 'Strijkplank', icon: '⏢', place: 'wall', item: { type: 'ironingBoard', size: [38, 8, 135], elev: 15 } },
  { key: 'wcd2', name: 'Dubbele wcd', icon: '⚡', place: 'socket', elektra: true, item: { type: 'socket', layer: 'elektra', kind: 'dubbel', size: [16, 1.6, 8.5], elev: 105, label: 'Nieuwe dubbele wcd' } },
  { key: 'wcd1', name: 'Enkele wcd', icon: '⚡', place: 'socket', elektra: true, item: { type: 'socket', layer: 'elektra', kind: 'enkel', size: [8.5, 1.6, 8.5], elev: 105, label: 'Nieuwe enkele wcd' } },
  { key: 'laad', name: 'Laadpunt', icon: '⚡', place: 'socket', elektra: true, item: { type: 'socket', layer: 'elektra', kind: 'laadpunt', size: [16, 1.6, 8.5], elev: 110, label: 'Nieuw laadpunt', group: 'eigen groep' } },
  { key: 'perilex', name: 'Perilex', icon: '⚡', place: 'socket', elektra: true, item: { type: 'socket', layer: 'elektra', kind: 'perilex', size: [10, 2, 10], elev: 20, label: 'Nieuwe perilex', group: '2 eigen groepen' } },
];
const SOCKET_SIZE = { dubbel: [16, 1.6, 8.5], enkel: [8.5, 1.6, 8.5], perilex: [10, 2, 10], laadpunt: [16, 1.6, 8.5], driver: [22, 4, 8], aansluitpunt: [8.5, 1.6, 8.5] };
const ROLE_BY_ROOM = {
  keuken: { tall: '@frontTall', base: '@frontBase', upper: '@frontUpper' },
  garage: { tall: '@frontGarage', base: '@frontGarage', upper: '@frontGarage' },
  bijkeuken: { tall: '@frontUtility', base: '@frontUtility', upper: '@frontUtility' },
  slaapkamer: { tall: '@wardrobe', base: '@wardrobe', upper: '@wardrobe' },
};

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const round1 = (v) => Math.round(v * 10) / 10;
const normRot = (r) => { r = ((r % 360) + 360) % 360; return r > 180 ? r - 360 : r; };

export function createEditor(ctx) {
  const { camera, controls, renderer, scene, SCALE } = ctx;
  let on = false, selId = null, helper = null, extraHelpers = [];
  let gridOn = true, topOn = true, prevWalls = null;
  let drag = null, tap = null, lastCheck = 0, issues = [];
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  // ---------- helpers ----------
  const plan = () => ctx.getPlan();
  const built = () => ctx.getBuilt();
  const itemById = (id) => plan().items.find((i) => i.id === id);
  const groupById = (id) => built().items.find((g) => g.userData.item.id === id);
  const editable = (it) => it && !NOT_EDITABLE.has(it.type) && !it.attachTo && (it.layer !== 'elektra' || ctx.elektraOn());
  const roomRect = (id) => {
    const r = plan().rooms.find((x) => x.id === id);
    if (!r) return null;
    const xs = r.polygon.map((p) => p[0]), zs = r.polygon.map((p) => p[1]);
    return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
  };
  const roomAtPos = (x, z) => plan().rooms.find((r) => { const b = roomRect(r.id); return x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1; })?.id || null;
  function setNdc(cx, cy) {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }
  function floorAt(cx, cy) {
    setNdc(cx, cy);
    const p = new THREE.Vector3();
    return raycaster.ray.intersectPlane(floor, p) ? [p.x / SCALE, p.z / SCALE] : null;
  }
  // All editable items under the pointer, nearest first (a seat cushion maps to its bench).
  function pickAll(cx, cy) {
    setNdc(cx, cy);
    const out = [];
    for (const h of raycaster.intersectObjects(built().items, true)) {
      let g = h.object.userData.itemRoot;
      if (!g || !h.object.visible || !g.visible || !editable(g.userData.item)) continue;
      const parent = cushionParent(g.userData.item);
      if (parent) g = groupById(parent.id) || g;
      if (!out.includes(g)) out.push(g);
    }
    return out;
  }
  // Items resting on top of an item and inside its footprint (cushion on a bench, sink/hob on a worktop)
  // move, rotate, duplicate and delete together with it.
  function riders(it, depth = 0) {
    if (!it?.size || !it.pos || depth > 2 || it.type === 'socket') return [];
    const f = footprint(it), top = (it.elev || 0) + (it.size[2] || 0);
    const out = [];
    for (const r of plan().items) {
      if (r.id === it.id || !r.pos || !r.size || r.type === 'socket' || r.attachTo) continue;
      const g = footprint(r);
      if (g.x0 < f.x0 - 2 || g.x1 > f.x1 + 2 || g.z0 < f.z0 - 2 || g.z1 > f.z1 + 2) continue;
      if (Math.abs((r.elev || 0) - top) > 3) continue;
      out.push(r, ...riders(r, depth + 1));
    }
    return [...new Map(out.map((r) => [r.id, r])).values()];
  }
  function cushionParent(it) {
    if (!it?.size || it.type === 'socket') return null;
    return plan().items.find((p) => p.id !== it.id && p.size && Math.abs(p.size[0] - it.size[0]) <= 4 && Math.abs((p.size[1] || 0) - (it.size[1] || 0)) <= 4 && riders(p).some((r) => r.id === it.id)) || null;
  }

  // ---------- warnings (existing layout checks, translated per item) ----------
  function opening(wallId, off) {
    const w = plan().walls.find((x) => x.id === wallId);
    return w?.openings?.find((o) => Math.abs(o.offset - Number(off)) < 0.01);
  }
  const OPEN_NAME = { door: 'deur', slider: 'schuifpui', glassdoor: 'glazen deur', garage: 'garagedeur' };
  function describe(msg, id) {
    const nm = (x) => ctx.itemName(itemById(x) || { id: x, type: '' });
    let m;
    if ((m = msg.match(/^overlap: (\S+) × (\S+)$/))) { const o = m[1] === id ? m[2] : m[1]; return [m[1], m[2]].includes(id) && { text: `Overlapt met ${nm(o)}`, other: o }; }
    if ((m = msg.match(/^in wand: (\S+) × (\S+)$/))) return m[1] === id && { text: 'Steekt in een wand' };
    if ((m = msg.match(/^deur (\S+)@([\d.]+) raakt (\S+)$/))) return m[3] === id && { text: 'Staat in de draaicirkel van een deur' };
    if ((m = msg.match(/^blokkeert garagedeur (\S+): (\S+)$/))) return m[2] === id && { text: 'Staat binnen 50 cm voor de garagedeur' };
    if ((m = msg.match(/^blokkeert doorgang (\S+)@([\d.]+): (\S+)$/))) return m[3] === id && { text: `Blokkeert de doorgang van een ${OPEN_NAME[opening(m[1], m[2])?.type || 'door'] || 'deur'} (50 cm vrij houden)` };
    if ((m = msg.match(/^looppad (\S+) geblokkeerd door (\S+)$/))) return m[2] === id && { text: `Staat op het looppad (${nm(m[1])})` };
    if ((m = msg.match(/^te weinig ruimte voor (\S+) \(< (\d+) cm\): (\S+)$/))) {
      if (m[1] === id) return { text: `Voor de deuren/lades is minder dan ${m[2]} cm vrij (door ${nm(m[3])})`, other: m[3] };
      if (m[3] === id) return { text: `Staat binnen ${m[2]} cm voor de kastfront van ${nm(m[1])}`, other: m[1] };
      return false;
    }
    if ((m = msg.match(/^looproute geblokkeerd door (\S+)$/))) return m[1] === id && { text: 'Blokkeert de looproute keuken → slaapkamer' };
    if ((m = msg.match(/^buiten ruimte: (\S+)$/))) return m[1] === id && { text: 'Staat (deels) buiten de ruimte' };
    if (msg.startsWith('elektra:') && msg.includes(id)) return { text: msg.replace(/^elektra: /, 'Elektra: ').replace(id, nm(id)) };
    return false;
  }
  function runChecks(p = plan()) {
    try { issues = checkPlan(p, { route: ctx.getRoute() }); } catch (e) { issues = []; console.warn(e); }
    return issues;
  }
  const itemIssues = (id) => issues.map((m) => describe(m, id)).filter(Boolean);
  const globalIssues = () => issues.filter((m) => m.startsWith('eis:')).map((m) => m.replace(/^eis: /, ''));

  // ---------- selection outline ----------
  function clearHelpers() {
    if (helper) { scene.remove(helper); helper = null; }
    for (const h of extraHelpers) scene.remove(h);
    extraHelpers = [];
  }
  function outline(g, bad, extra = []) {
    clearHelpers();
    if (!g) return;
    helper = new THREE.Box3Helper(new THREE.Box3().setFromObject(g), bad ? 0xd93a2b : 0x1f9d5a);
    helper.material.depthTest = false; helper.renderOrder = 10;
    scene.add(helper);
    for (const id of extra) {
      const o = groupById(id); if (!o) continue;
      const h = new THREE.Box3Helper(new THREE.Box3().setFromObject(o), 0xf08c3a);
      h.material.depthTest = false; h.renderOrder = 9; scene.add(h); extraHelpers.push(h);
    }
  }
  function refreshOutline() {
    const g = selId && groupById(selId);
    if (!g) { clearHelpers(); return; }
    const list = itemIssues(selId);
    outline(g, list.length > 0, list.map((x) => x.other).filter(Boolean));
  }

  // ---------- panel ----------
  function select(g) {
    selId = g ? g.userData.item.id : null;
    runChecks();
    refreshOutline();
    renderBar();
  }
  function renderBar() {
    const bar = $('#editBar');
    const it = selId && itemById(selId);
    renderTools();
    if (!on || !it) { bar.hidden = true; return; }
    bar.hidden = false;
    const s = it.size || [];
    const room = plan().rooms.find((r) => r.id === it.room);
    const list = itemIssues(selId);
    const isSocket = it.type === 'socket';
    const mats = ctx.materialOptions();
    const cur = typeof it.material === 'string' ? it.material : (it.material ? '__inline' : '');
    const opts = [...(cur && !mats.some(([v]) => v === cur) ? [[cur, cur === '__inline' ? 'Eigen materiaal' : cur]] : []), ['', '(standaard)'], ...mats];
    bar.innerHTML = `
      <div class="eb-head"><div><input id="ebName" class="eb-name" value="${esc(ctx.itemName(it))}" aria-label="Naam"><div class="muted small">${esc(ctx.typeName(it))}${room ? ' · ' + esc(room.name) : ''}</div></div>
        <button class="eb-x" id="ebClose" title="Selectie opheffen (Esc)">✕</button></div>
      <div class="eb-actions">
        <button class="btn" id="ebRot" title="Draai 90° (R)">⟳ 90°</button>
        <button class="btn" id="ebDup" title="Dupliceren (Ctrl+D)">❐ Dupliceer</button>
        <button class="btn danger" id="ebDel" title="Verwijderen (Delete)">🗑 Verwijder</button>
      </div>
      <div class="eb-dims">
        ${isSocket ? '' : `<label>B<input type="number" id="ebW" min="1" step="1" value="${s[0] ?? ''}"></label><label>D<input type="number" id="ebD" min="0" step="1" value="${s[1] ?? ''}"></label>${s.length > 2 ? `<label>H<input type="number" id="ebH" min="0" step="1" value="${s[2] ?? ''}"></label>` : ''}`}
        <label>${isSocket ? 'Hoogte (hart)' : 'Vanaf vloer'}<input type="number" id="ebE" min="0" step="1" value="${it.elev || 0}"></label>
      </div>
      ${isSocket ? `<label class="eb-row">Soort<select id="ebKind">${['dubbel', 'enkel', 'laadpunt', 'perilex', 'driver', 'aansluitpunt'].map((k) => `<option ${k === it.kind ? 'selected' : ''}>${k}</option>`).join('')}</select></label>`
        : `<label class="eb-row">Materiaal / kleur<select id="ebMat">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`}
      <div class="eb-pos muted small">Positie x ${round1(it.pos[0])} · z ${round1(it.pos[1])} cm · draaiing ${it.rot || 0}°</div>
      <div class="eb-warn">${list.length ? list.map((x) => `<div class="warn">⚠ ${esc(x.text)}</div>`).join('') : '<div class="ok">✓ Past: geen botsingen, deuren en looppaden vrij</div>'}</div>`;
    $('#ebClose').onclick = () => select(null);
    $('#ebRot').onclick = rotate;
    $('#ebDup').onclick = duplicate;
    $('#ebDel').onclick = remove;
    const num = (sel) => { const v = Number($(sel)?.value); return Number.isFinite(v) ? v : null; };
    const onDims = () => {
      const size = [...(it.size || [])];
      ['#ebW', '#ebD', '#ebH'].forEach((sel, i) => { const v = num(sel); if (v != null && $(sel)) size[i] = Math.max(i === 0 ? 1 : 0, v); });
      if (JSON.stringify(size) !== JSON.stringify(it.size)) edit([{ op: 'resizeItem', id: it.id, size }]);
    };
    ['#ebW', '#ebD', '#ebH'].forEach((sel) => { if ($(sel)) $(sel).onchange = onDims; });
    $('#ebE').onchange = () => { const v = num('#ebE'); if (v != null && v !== (it.elev || 0)) edit([{ op: 'moveItem', id: it.id, elev: Math.max(0, v) }]); };
    if ($('#ebMat')) $('#ebMat').onchange = (e) => { const v = e.target.value; if (v !== '__inline') edit([{ op: 'updateItem', id: it.id, set: { material: v || null } }]); };
    if ($('#ebKind')) $('#ebKind').onchange = (e) => edit([{ op: 'updateItem', id: it.id, set: { kind: e.target.value, size: SOCKET_SIZE[e.target.value] } }]);
    $('#ebName').onchange = (e) => { const v = e.target.value.trim(); edit([{ op: 'updateItem', id: it.id, set: { label: v || null } }]); };
  }
  function renderTools() {
    const t = $('#editTools');
    if (!t) return;
    t.hidden = !on;
    if (!on) return;
    const g = globalIssues();
    const all = issues.length;
    $('#edUndo').disabled = !ctx.canUndo();
    $('#edRedo').disabled = !ctx.canRedo();
    $('#edGrid').classList.toggle('on', gridOn);
    $('#edTop').classList.toggle('on', topOn);
    const w = $('#edWarn');
    w.textContent = all ? `⚠ ${all}` : '✓';
    w.classList.toggle('bad', all > 0);
    w.title = all ? `${all} waarschuwing(en) in dit ontwerp${g.length ? ':\n- ' + g.join('\n- ') : ''}` : 'Geen waarschuwingen';
  }

  // ---------- edits ----------
  function edit(ops, { select: newSel } = {}) {
    const r = ctx.applyEdit(ops);
    if (!r.ok) { ctx.toast(r.error); return r; }
    if (newSel !== undefined) selId = newSel;
    afterShow();
    return r;
  }
  function rotate() {
    const it = selId && itemById(selId); if (!it) return;
    const rot = normRot((it.rot || 0) + 90);
    const ops = [{ op: 'moveItem', id: it.id, rot }];
    for (const r of riders(it)) {
      const dx = r.pos[0] - it.pos[0], dz = r.pos[1] - it.pos[1];
      ops.push({ op: 'moveItem', id: r.id, pos: [round1(it.pos[0] + dz), round1(it.pos[1] - dx)], rot: normRot((r.rot || 0) + 90) });
    }
    edit(ops);
  }
  function remove() {
    const it = selId && itemById(selId); if (!it) return;
    edit([{ op: 'removeItem', id: it.id }, ...riders(it).map((r) => ({ op: 'removeItem', id: r.id }))], { select: null });
    ctx.toast(`${ctx.itemName(it)} verwijderd (Ctrl+Z om terug te zetten)`);
  }
  function uniqueId(base) {
    const ids = new Set(plan().items.map((i) => i.id));
    let id = base, n = 2;
    while (ids.has(id)) id = `${base}-${n++}`;
    return id;
  }
  function duplicate() {
    const it = selId && itemById(selId); if (!it) return;
    const copy = structuredClone(it);
    copy.id = uniqueId(it.id.replace(/-kopie(-\d+)?$/, '') + '-kopie');
    if (copy.label) copy.label = copy.label.replace(/ \(kopie\)$/, '') + ' (kopie)';
    delete copy.serves;
    const a = ((it.rot || 0) * Math.PI) / 180, w = it.size?.[0] || 40;
    const ux = Math.round(Math.cos(a)), uz = -Math.round(Math.sin(a));
    const tryAt = (sgn) => [round1(it.pos[0] + ux * w * sgn), round1(it.pos[1] + uz * w * sgn)];
    copy.pos = tryAt(1);
    const free = (p) => { const c = { ...copy, pos: p }; return spotIssues(c, it.room).length === 0; };
    if (!free(copy.pos) && free(tryAt(-1))) copy.pos = tryAt(-1);
    copy.room = roomAtPos(copy.pos[0], copy.pos[1]) || it.room;
    const ops = [{ op: 'addItem', item: copy }];
    const taken = new Set([copy.id]);
    for (const r of riders(it)) {
      const c = structuredClone(r);
      let id = uniqueId(r.id + '-kopie'), n = 2;
      while (taken.has(id)) id = uniqueId(`${r.id}-kopie-${n++}`);
      taken.add(id); c.id = id; c.room = copy.room; delete c.serves;
      c.pos = [round1(r.pos[0] + copy.pos[0] - it.pos[0]), round1(r.pos[1] + copy.pos[1] - it.pos[1])];
      ops.push({ op: 'addItem', item: c });
    }
    edit(ops, { select: copy.id });
  }

  // ---------- snapping ----------
  function wallFaces() {
    const out = [];
    for (const w of plan().walls) {
      const t = w.thickness ?? plan().defaults?.wallThickness ?? 20;
      const [ax, az] = w.from, [bx, bz] = w.to;
      if (Math.abs(az - bz) < 0.5) out.push({ axis: 'z', at: az + t / 2, dir: 1, lo: Math.min(ax, bx), hi: Math.max(ax, bx) }, { axis: 'z', at: az - t / 2, dir: -1, lo: Math.min(ax, bx), hi: Math.max(ax, bx) });
      else if (Math.abs(ax - bx) < 0.5) out.push({ axis: 'x', at: ax + t / 2, dir: 1, lo: Math.min(az, bz), hi: Math.max(az, bz) }, { axis: 'x', at: ax - t / 2, dir: -1, lo: Math.min(az, bz), hi: Math.max(az, bz) });
    }
    return out;
  }
  // Snap a socket onto the nearest wall face and turn it to face the room.
  function snapSocket(it, x, z) {
    let best = null;
    for (const f of wallFaces()) {
      const along = f.axis === 'z' ? x : z, dist = Math.abs((f.axis === 'z' ? z : x) - f.at);
      if (along < f.lo || along > f.hi || dist > 60) continue;
      if (!best || dist < best.dist) best = { f, dist };
    }
    if (!best) return { x, z, rot: it.rot || 0 };
    const f = best.f, d = (it.size?.[1] || 1.6) / 2;
    if (f.axis === 'z') return { x, z: round1(f.at + f.dir * d), rot: f.dir > 0 ? 0 : 180 };
    return { x: round1(f.at + f.dir * d), z, rot: f.dir > 0 ? 90 : -90 };
  }
  function snapPos(it, x, z) {
    if (gridOn) { x = Math.round(x / GRID) * GRID; z = Math.round(z / GRID) * GRID; }
    if (it.type === 'socket') return snapSocket(it, x, z);
    const f = footprint({ ...it, pos: [x, z] });
    let bx = null, bz = null;
    const cand = (axis, d) => {
      if (Math.abs(d) > SNAP) return;
      if (axis === 'x' && (bx === null || Math.abs(d) < Math.abs(bx))) bx = d;
      if (axis === 'z' && (bz === null || Math.abs(d) < Math.abs(bz))) bz = d;
    };
    for (const w of wallFaces()) {
      if (w.axis === 'z' && f.x1 > w.lo && f.x0 < w.hi) { if (w.dir > 0) cand('z', w.at - f.z0); else cand('z', w.at - f.z1); }
      if (w.axis === 'x' && f.z1 > w.lo && f.z0 < w.hi) { if (w.dir > 0) cand('x', w.at - f.x0); else cand('x', w.at - f.x1); }
    }
    const [v0, v1] = [it.elev || 0, (it.elev || 0) + (it.size?.[2] || 0)];
    for (const o of plan().items) {
      if (o.id === it.id || !o.size || !o.pos || NO_SNAP_TARGET.has(o.type) || o.attachTo) continue;
      const oe = o.elev || 0;
      if (Math.min(v1, oe + (o.size[2] || 0)) - Math.max(v0, oe) <= 0) continue; // different height band
      const g = footprint(o);
      const zOv = Math.min(f.z1, g.z1) - Math.max(f.z0, g.z0), xOv = Math.min(f.x1, g.x1) - Math.max(f.x0, g.x0);
      if (zOv > -2) { cand('x', g.x1 - f.x0); cand('x', g.x0 - f.x1); }
      if (xOv > -2) { cand('z', g.z1 - f.z0); cand('z', g.z0 - f.z1); }
      if (Math.abs(zOv) < 30 || zOv > 0) { cand('x', g.x0 - f.x0); cand('x', g.x1 - f.x1); }   // align ends in a run
      if (Math.abs(xOv) < 30 || xOv > 0) { cand('z', g.z0 - f.z0); cand('z', g.z1 - f.z1); }   // align fronts / backs
    }
    return { x: round1(x + (bx || 0)), z: round1(z + (bz || 0)), rot: it.rot || 0 };
  }

  // ---------- free spot for new items ----------
  function spotIssues(cand, roomId) {
    const p = plan();
    const test = { ...p, items: p.items.filter((i) => i.room === roomId && i.id !== cand.id).concat([cand]) };
    let msgs = [];
    try { msgs = checkPlan(test, {}); } catch { return ['fout']; }
    return msgs.filter((m) => !m.startsWith('eis:') && !m.startsWith('elektra:') && describe(m, cand.id));
  }
  function findSpot(entry, item, roomId) {
    const b = roomRect(roomId);
    if (!b) return null;
    const off = entry.rotOffset || 0;
    const cands = [];
    if (entry.place === 'socket') {
      for (const f of wallFaces()) {
        const inside = f.axis === 'z' ? (f.at >= b.z0 - 1 && f.at <= b.z1 + 1) : (f.at >= b.x0 - 1 && f.at <= b.x1 + 1);
        if (!inside) continue;
        const lo = Math.max(f.lo, f.axis === 'z' ? b.x0 : b.z0) + 20, hi = Math.min(f.hi, f.axis === 'z' ? b.x1 : b.z1) - 20;
        for (let a = lo; a <= hi; a += 20) { const s = snapSocket(item, f.axis === 'z' ? a : f.at, f.axis === 'z' ? f.at : a); cands.push({ pos: [s.x, s.z], rot: s.rot }); }
      }
      // sockets don't collide; prefer one not too close to other points
      const pts = plan().items.filter((i) => i.type === 'socket' && i.room === roomId);
      cands.sort((p, q) => Math.min(...pts.map((s) => -Math.hypot(s.pos[0] - p.pos[0], s.pos[1] - p.pos[1])), 0) - Math.min(...pts.map((s) => -Math.hypot(s.pos[0] - q.pos[0], s.pos[1] - q.pos[1])), 0));
      return cands[0] || null;
    }
    if (entry.place === 'wall') {
      for (const [side, rot0] of [['N', 0], ['W', 90], ['E', -90], ['S', 180]]) {
        const rot = normRot(rot0 + off);
        const f = footprint({ ...item, pos: [0, 0], rot });
        const hx = f.x1, hz = f.z1;
        if (side === 'N' || side === 'S') { const z = side === 'N' ? b.z0 + hz : b.z1 - hz; for (let x = b.x0 + hx; x <= b.x1 - hx; x += 10) cands.push({ pos: [x, z], rot }); }
        else { const x = side === 'W' ? b.x0 + hx : b.x1 - hx; for (let z = b.z0 + hz; z <= b.z1 - hz; z += 10) cands.push({ pos: [x, z], rot }); }
      }
    } else {
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      for (let x = b.x0 + 30; x <= b.x1 - 30; x += 15) for (let z = b.z0 + 30; z <= b.z1 - 30; z += 15) cands.push({ pos: [x, z], rot: off });
      cands.sort((p, q) => Math.hypot(p.pos[0] - cx, p.pos[1] - cz) - Math.hypot(q.pos[0] - cx, q.pos[1] - cz));
    }
    for (const c of cands) {
      c.pos = [round1(Math.round(c.pos[0] * 2) / 2), round1(Math.round(c.pos[1] * 2) / 2)];
      if (!spotIssues({ ...item, ...c }, roomId).length) return c;
    }
    return null;
  }
  function focusRoom() {
    const v = ctx.currentView();
    if (plan().rooms.some((r) => r.id === v)) return v;
    const t = controls.target;
    return roomAtPos(t.x / SCALE, t.z / SCALE) || (selId && itemById(selId)?.room) || plan().rooms[0]?.id;
  }
  function addFromCatalog(key, roomId = focusRoom()) {
    const entry = CATALOG.find((c) => c.key === key);
    if (!entry) return { ok: false, error: 'Onbekend catalogusitem' };
    let item = structuredClone(entry.item);
    const tpl = entry.from && plan().items.find((i) => i.type === entry.from);
    if (tpl) { const { id, pos, rot, room, label, note, labelHeight, serves, ...look } = tpl; item = { ...look, ...item, size: [...tpl.size], ...(tpl.color ? { color: tpl.color } : {}) }; if (entry.from === 'bike') { delete item.ebike; item.rack = false; } }
    if (entry.role && !item.material) item.material = ROLE_BY_ROOM[roomId]?.[entry.role] || (entry.role === 'accent' ? '@accent' : undefined);
    if (!item.material) delete item.material;
    item.room = roomId;
    item.id = uniqueId(`${roomId}-${entry.key}`);
    if (!item.label) item.label = entry.name;
    const spot = findSpot(entry, item, roomId);
    const b = roomRect(roomId);
    if (spot) Object.assign(item, spot);
    else { item.pos = [round1((b.x0 + b.x1) / 2), round1((b.z0 + b.z1) / 2)]; item.rot = entry.rotOffset || 0; ctx.toast('Geen vrije plek gevonden: het item staat in het midden, versleep het zelf'); }
    if (!item.rot) delete item.rot;
    const r = edit([{ op: 'addItem', item }], { select: item.id });
    closeCatalog();
    if (r.ok) ctx.toast(`${entry.name} toegevoegd in ${plan().rooms.find((x) => x.id === roomId)?.name || roomId}`);
    return { ...r, id: item.id };
  }

  // ---------- catalogue popover ----------
  function openCatalog() {
    const c = $('#catalog');
    const room = plan().rooms.find((r) => r.id === focusRoom());
    const list = CATALOG.filter((e) => !e.elektra || ctx.elektraOn());
    c.innerHTML = `<div class="cat-head"><b>Toevoegen</b><span class="muted small">in ${esc(room?.name || '')}</span><button class="eb-x" id="catClose">✕</button></div>
      <div class="cat-grid">${list.map((e) => `<button data-key="${e.key}" class="${e.elektra ? 'el' : ''}"><span>${e.icon}</span>${esc(e.name)}</button>`).join('')}</div>
      <p class="muted small">Het nieuwe item komt op een vrije plek in de ruimte die je bekijkt. ${ctx.elektraOn() ? '' : 'Zet <b>Elektra</b> aan om ook wandcontactdozen toe te voegen.'}</p>`;
    c.hidden = false;
    $('#catClose').onclick = closeCatalog;
    c.querySelectorAll('button[data-key]').forEach((b) => (b.onclick = () => addFromCatalog(b.dataset.key)));
  }
  function closeCatalog() { const c = $('#catalog'); if (c) c.hidden = true; }

  // ---------- top view ----------
  function topView(roomId) {
    const rects = roomId ? [roomRect(roomId)] : plan().rooms.map((r) => roomRect(r.id));
    const b = { x0: Math.min(...rects.map((r) => r.x0)), x1: Math.max(...rects.map((r) => r.x1)), z0: Math.min(...rects.map((r) => r.z0)), z1: Math.max(...rects.map((r) => r.z1)) };
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    // fit the room into the free part of the screen (not under the side panel / toolbars)
    const W = window.innerWidth, H = window.innerHeight, narrow = W <= 820;
    const L = narrow ? 8 : 330, Rr = narrow ? W - 8 : W - 380, T = narrow ? 175 : 90, B = narrow ? H * 0.52 : H - 140; // phone: top half, the item panel slides up below
    const t = Math.tan((camera.fov * Math.PI) / 360);
    const w = (b.x1 - b.x0) + 60, d = (b.z1 - b.z0) + 60;
    const h = Math.max((w * H) / (2 * t * (Rr - L)), (d * H) / (2 * t * (B - T)));
    const Vw = 2 * h * t * (W / H), Vh = 2 * h * t;
    const tx = cx + ((W / 2 - (L + Rr) / 2) / W) * Vw, tz = cz + ((H / 2 - (T + B) / 2) / H) * Vh;
    ctx.flyTo([tx, h, tz + h * 0.01], [tx, 0, tz]);
  }

  // ---------- pointer handling ----------
  function onDown(e) {
    if (!on || ctx.mode() !== 'orbit') return;
    if (drag) { e.stopImmediatePropagation(); return; }   // ignore a second finger while dragging
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
    const stack = pickAll(e.clientX, e.clientY);
    if (!stack.length) { tap = { x: e.clientX, y: e.clientY, t: performance.now() }; return; }
    e.stopImmediatePropagation(); e.preventDefault();
    closeCatalog();
    // keep dragging the selected item when it is under the pointer (also when something hangs above it)
    const g = stack.find((x) => x.userData.item.id === selId) || stack[0];
    const wasSelected = g.userData.item.id === selId;
    const it = g.userData.item;
    if (!wasSelected) select(g);
    const p = floorAt(e.clientX, e.clientY);
    const rid = riders(it).map((r) => ({ r, g: groupById(r.id) })).filter((x) => x.g);
    drag = { stack, wasSelected, riders: rid, id: it.id, g, it, x: e.clientX, y: e.clientY, grab: p ? [p[0] - it.pos[0], p[1] - it.pos[1]] : [0, 0], moved: false, pointerId: e.pointerId, pos: [...it.pos], rot: it.rot || 0 };
    try { renderer.domElement.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
    drag.moved = true;
    renderer.domElement.style.cursor = 'grabbing';
    const p = floorAt(e.clientX, e.clientY);
    if (!p) return;
    const s = snapPos(drag.it, p[0] - drag.grab[0], p[1] - drag.grab[1]);
    drag.pos = [s.x, s.z]; drag.rot = s.rot;
    drag.g.position.x = s.x; drag.g.position.z = s.z;
    drag.g.rotation.y = THREE.MathUtils.degToRad(s.rot);
    for (const { r, g } of drag.riders) { g.position.x = r.pos[0] + s.x - drag.it.pos[0]; g.position.z = r.pos[1] + s.z - drag.it.pos[1]; }
    if (helper) helper.box.setFromObject(drag.g);
    const now = performance.now();
    if (now - lastCheck > 120) {
      lastCheck = now;
      const pl = plan();
      runChecks({ ...pl, items: pl.items.map((i) => (i.id === drag.id ? { ...i, pos: drag.pos, rot: drag.rot } : i)) });
      const list = itemIssues(drag.id);
      if (helper) helper.material.color.set(list.length ? 0xd93a2b : 0x1f9d5a);
      const w = $('#editBar .eb-warn');
      if (w) w.innerHTML = list.length ? list.map((x) => `<div class="warn">⚠ ${esc(x.text)}</div>`).join('') : '<div class="ok">✓ Past</div>';
      const ps = $('#editBar .eb-pos'); if (ps) ps.textContent = `Positie x ${drag.pos[0]} · z ${drag.pos[1]} cm · draaiing ${drag.rot}°`;
    }
  }
  function onUp(e) {
    if (drag && e.pointerId === drag.pointerId) {
      const d = drag; drag = null;
      renderer.domElement.style.cursor = '';
      if (d.moved && (d.pos[0] !== d.it.pos[0] || d.pos[1] !== d.it.pos[1] || d.rot !== (d.it.rot || 0))) {
        const ops = [{ op: 'moveItem', id: d.id, pos: d.pos, ...(d.rot !== (d.it.rot || 0) ? { rot: d.rot } : {}) }];
        const room = roomAtPos(d.pos[0], d.pos[1]);
        if (room && room !== d.it.room) ops.push({ op: 'updateItem', id: d.id, set: { room } });
        const dx = round1(d.pos[0] - d.it.pos[0]), dz = round1(d.pos[1] - d.it.pos[1]);
        for (const { r } of d.riders) {
          ops.push({ op: 'moveItem', id: r.id, pos: [round1(r.pos[0] + dx), round1(r.pos[1] + dz)] });
          if (room && room !== r.room) ops.push({ op: 'updateItem', id: r.id, set: { room } });
        }
        edit(ops);
      } else if (!d.moved && d.wasSelected && d.stack.length > 1) {
        // tap again on a selected item: select the next item at this spot (e.g. the bench under a wall cabinet)
        const next = d.stack[(d.stack.indexOf(d.g) + 1) % d.stack.length];
        select(next);
        ctx.toast(`${ctx.itemName(next.userData.item)} gekozen (tik nogmaals voor het volgende item op deze plek)`);
      }
      return;
    }
    if (tap && on) {
      const moved = Math.hypot(e.clientX - tap.x, e.clientY - tap.y), dt = performance.now() - tap.t;
      tap = null;
      if (moved < 6 && dt < 500) { select(null); closeCatalog(); }
    }
  }
  renderer.domElement.addEventListener('pointerdown', onDown, { capture: true });
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', (e) => { if (drag && e.pointerId === drag.pointerId) { drag = null; afterShow(); } });

  function onKey(e) {
    if (!on || e.target.closest?.('input,textarea,select')) return false;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.code === 'KeyZ') { e.preventDefault(); (e.shiftKey ? doRedo : doUndo)(); return true; }
    if (mod && e.code === 'KeyY') { e.preventDefault(); doRedo(); return true; }
    if (mod && e.code === 'KeyD') { e.preventDefault(); duplicate(); return true; }
    if (mod) return false;
    if (e.code === 'KeyR') { rotate(); return true; }
    if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); remove(); return true; }
    if (e.code === 'Escape') { select(null); closeCatalog(); return true; }
    return false;
  }
  window.addEventListener('keydown', (e) => { if (onKey(e)) e.stopImmediatePropagation(); }, { capture: true });
  async function doUndo() { const r = await ctx.undo(); if (!r.ok) ctx.toast(r.error); afterShow(); }
  async function doRedo() { const r = await ctx.redo(); if (!r.ok) ctx.toast(r.error); afterShow(); }

  // ---------- mode on/off ----------
  function setActive(v) {
    if (v === on) return;
    on = v;
    document.body.classList.toggle('editing', on);
    $('#tEdit')?.classList.toggle('on', on);
    if (on) {
      ctx.stopWalk();
      prevWalls = ctx.setWallsMode('low');
      if (window.innerWidth <= 820) ctx.closePanel();
      if (topOn) topView(focusRoom());
      ctx.toast('Bewerken: tik of klik op een item om het te kiezen, sleep om te verplaatsen');
    } else {
      if (prevWalls) ctx.setWallsMode(prevWalls);
      selId = null; drag = null; clearHelpers(); closeCatalog();
      ctx.goView(ctx.currentView());
    }
    runChecks();
    renderBar();
  }
  function afterShow() {
    if (!on) return;
    runChecks();
    if (selId && !editable(itemById(selId))) selId = null;
    refreshOutline();
    renderBar();
  }
  function initUI() {
    $('#tEdit').onclick = () => setActive(!on);
    $('#edUndo').onclick = doUndo;
    $('#edRedo').onclick = doRedo;
    $('#edGrid').onclick = () => { gridOn = !gridOn; renderTools(); ctx.toast(gridOn ? 'Raster 5 cm aan' : 'Raster uit (alleen vastklikken aan wanden en kasten)'); };
    $('#edTop').onclick = () => { topOn = !topOn; renderTools(); if (topOn) topView(focusRoom()); else ctx.goView(ctx.currentView()); };
    $('#edAdd').onclick = () => ($('#catalog').hidden ? openCatalog() : closeCatalog());
    $('#edWarn').onclick = () => { const g = globalIssues(); ctx.toast(issues.length ? `${issues.length} waarschuwing(en)${g.length ? ': ' + g.join('; ') : '. Kies een rood omlijnd item voor details.'}` : 'Geen waarschuwingen'); };
    $('#edDone').onclick = () => setActive(false);
  }
  initUI();

  return {
    active: () => on, setActive, select: (g) => select(g), afterShow, topOn: () => topOn, topView,
    // test / automation hooks
    selectById: (id) => { const g = groupById(id); select(g || null); return !!g; },
    pickAt: (x, y) => pickAll(x, y).map((g) => g.userData.item.id),
    selected: () => selId, addFromCatalog, rotate, remove, duplicate, warnings: (id = selId) => itemIssues(id).map((x) => x.text),
    setGrid: (v) => { gridOn = !!v; renderTools(); }, catalog: () => CATALOG.map((c) => c.key),
  };
}
