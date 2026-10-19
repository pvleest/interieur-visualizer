import * as THREE from 'three';
import { OrbitControls } from '../vendor/addons/OrbitControls.js';
import { RoomEnvironment } from '../vendor/addons/RoomEnvironment.js';
import { CSS2DRenderer } from '../vendor/addons/CSS2DRenderer.js';
import { buildPlan, SCALE, setWallHeight } from './engine.js';
import { setMaxAnisotropy, BUILTIN_LABELS, swatchColor, setPlanMaterials } from './materials.js';
import { applyPatches, normalizePatch, encodeShare, decodeShare, validateScenario, toScenarioFile, loadLocal, saveLocal, OPS } from './scenarios.js';

const params = new URLSearchParams(location.search);
const PLAN_URL = params.get('plan') || 'plans/vleugel.json';
const RENDER_MODE = params.get('ui') === '0';
const TYPE_NAMES = {
  base: 'Onderkast', tall: 'Hoge kast', wall: 'Bovenkast', wardrobe: 'Inbouwkast', plinth: 'Verhoging', fridge: 'Koelkast', freezer: 'Vriezer',
  ovenColumn: 'Oven-kolom', dishwasher: 'Vaatwasser', worktop: 'Werkblad', sink: 'Spoelbak', hob: 'Kookplaat', hood: 'Afzuigkap', panel: 'Paneel',
  washer: 'Wasmachine', dryer: 'Droger', basketDrawers: 'Wasmandlades', openShelf: 'Open stelling', workbench: 'Werkplek', ironingCabinet: 'Strijkkast', bike: 'Fiets', bikeRack: 'Fietsenrek', socket: 'Stopcontact', stool: 'Barkruk',
  ledStrip: 'LED-strip', walkway: 'Looppad', bed: 'Bed', nightstand: 'Nachtkastje', wallLight: 'Wandlamp', pendant: 'Hanglamp', rug: 'Vloerkleed',
  curtain: 'Gordijn', slatPanel: 'Lamellenwand', table: 'Tafel', chair: 'Stoel', plant: 'Plant', rail: 'Kledingroede', car: 'Auto',
};

const $ = (s) => document.querySelector(s);
const app = $('#app');
if (RENDER_MODE) document.body.classList.add('render-mode');
if (params.get('labels') === '0') app.classList.add('hide-labels');

// ---------- renderer / scene ----------
const W = () => window.innerWidth, H = () => window.innerHeight;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: RENDER_MODE });
const dpr = Number(params.get('dpr')) || Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(dpr);
renderer.setSize(W(), H());
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
$('#viewport').appendChild(renderer.domElement);
setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(W(), H());
Object.assign(labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
$('#viewport').appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeef0ee);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;

const camera = new THREE.PerspectiveCamera(40, W() / H(), 0.05, 300);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.49; controls.minDistance = 1.5; controls.maxDistance = 45;
controls.screenSpacePanning = false;

const hemi = new THREE.HemisphereLight(0xfaf7f0, 0xb9b3a8, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2df, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 4;
scene.add(sun, sun.target);

// ---------- state ----------
let plan, built;
let mode = 'orbit';           // orbit | walk
let wallsMode = 'auto';       // auto | low | high
let currentView = 'overzicht';
let selected = null, selHelper = null;
let tween = null;
const walk = { yaw: 0, pitch: -0.08, keys: {}, eye: 1.62 };

function cm(v) { return new THREE.Vector3(v[0] * SCALE, v[1] * SCALE, v[2] * SCALE); }

const planCache = new Map();
async function fetchPlan(url) {
  if (!planCache.has(url)) planCache.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); }));
  return structuredClone(await planCache.get(url));
}

function fitSun() {
  const bb = new THREE.Box3();
  for (const r of built.rooms) { bb.expandByPoint(new THREE.Vector3(r.bounds.minX, 0, r.bounds.minZ)); bb.expandByPoint(new THREE.Vector3(r.bounds.maxX, 0, r.bounds.maxZ)); }
  const c = bb.getCenter(new THREE.Vector3()).multiplyScalar(SCALE);
  const size = bb.getSize(new THREE.Vector3()).multiplyScalar(SCALE);
  const ext = Math.max(size.x, size.z) * 0.75 + 2;
  sun.position.set(c.x - 6, 14, c.z + 9);
  sun.target.position.copy(c);
  Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 50 });
  sun.shadow.camera.updateProjectionMatrix();
}

async function init() {
  buildUIStatic();
  await loadRepoScenarios();
  let first = { key: 'base', name: 'Basisontwerp', description: '', base: PLAN_URL, patches: [] };
  const hash = new URLSearchParams(location.hash.slice(1));
  try {
    if (hash.get('s')) first = { ...decodeShare(hash.get('s')), key: 'shared', shared: true };
    else if (params.get('scenario')) first = scenarioByKey('repo:' + params.get('scenario')) || first;
  } catch (e) { toast('Gedeelde link kon niet worden geopend: ' + e.message); }
  await loadScenario(first, { initial: true });
  fitSun();
  const v = params.get('view') || 'overzicht';
  if (v === 'walk') startWalk(params.get('room') || 'keuken', true);
  else goView(v, true);
  if (params.get('select')) selectItem(built.items[Number(params.get('select'))]);
  renderer.setAnimationLoop(loop);
  setTimeout(() => $('#loading').classList.add('done'), 150);
  let frames = 0;
  const ready = () => { if (++frames > 12) { window.__ready = true; } else requestAnimationFrame(ready); };
  requestAnimationFrame(ready);
  window.addEventListener('hashchange', () => {
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get('s') && h.get('s') !== lastShareHash) {
      try { loadScenario({ ...decodeShare(h.get('s')), key: 'shared', shared: true }); } catch (e) { toast(e.message); }
    }
  });
}

// ---------- scenario state ----------
let repoScenarios = [];      // [{key, id, name, description, base, patches}]
let current = null;          // active scenario (with its full patch list)
let compareWith = null;      // scenario object for A/B toggle
let history = [];            // undo stack: number of ops per applyEdit batch
let dirty = false;
let lastShareHash = '';
const builtCache = new Map(); // plan JSON -> built scene (max 3)

async function loadRepoScenarios() {
  try {
    const idx = await (await fetch('scenarios/index.json')).json();
    const files = await Promise.all(idx.scenarios.map((e) => fetch(e.file).then((r) => r.json()).then((o) => ({ ...validateScenario(o), id: e.id, group: e.group || 'Ontwerpen' }))));
    repoScenarios = files.map((sc) => ({ ...sc, key: 'repo:' + sc.id, base: sc.base || PLAN_URL }));
  } catch (e) { console.warn('Geen scenario-index', e); repoScenarios = []; }
}

function localScenarios() { return loadLocal().map((sc) => ({ ...sc, key: 'local:' + sc.id })); }

function scenarioByKey(key) {
  if (key === 'base') return { key: 'base', name: 'Basisontwerp', description: 'Het ontwerp zoals afgesproken (mat eiken + warm greige).', base: PLAN_URL, patches: [] };
  return repoScenarios.find((s) => s.key === key) || localScenarios().find((s) => s.key === key) || (current?.key === key ? current : null) || (compareWith?.key === key ? compareWith : null);
}

function disposeBuilt(b) {
  b.root.traverse((o) => { if (o.isCSS2DObject) o.element.remove(); });
}

function showPlan(newPlan) {
  const key = JSON.stringify(newPlan);
  let b = builtCache.get(key);
  if (!b) {
    b = buildPlan(newPlan);
    builtCache.set(key, b);
    while (builtCache.size > 3) {
      const [k, old] = builtCache.entries().next().value;
      if (old === b) break;
      builtCache.delete(k);
      if (old !== built) disposeBuilt(old);
    }
  } else { builtCache.delete(key); builtCache.set(key, b); }
  if (built && built !== b) {
    scene.remove(built.root);
    built.root.traverse((o) => { if (o.isCSS2DObject) o.element.style.display = 'none'; });
    if (![...builtCache.values()].includes(built)) disposeBuilt(built);
  }
  plan = newPlan;
  built = b;
  setPlanMaterials(plan.palette, plan.materials);
  scene.add(built.root);
  for (const c of built.ceilings) c.visible = mode === 'walk';
  selectItem(null);
  labelRoom = undefined;
  setActiveNav(mode === 'walk' ? (roomAt(camera.position.x / SCALE, camera.position.z / SCALE) || currentView) : currentView);
  updateWalls(0, true);
  refreshPanels();
}

async function loadScenario(sc, { initial = false } = {}) {
  const base = await fetchPlan(sc.base || PLAN_URL);
  const newPlan = applyPatches(base, sc.patches || []);
  current = { ...sc, patches: [...(sc.patches || [])] };
  history = []; dirty = false;
  if (compareWith && compareWith.key === current.key) compareWith = null;
  showPlan(newPlan);
  if (!initial && !RENDER_MODE) toast(`Scenario: ${current.name}`);
}

// ---------- edit API ----------
// applyEdit(patch): patch = one operation, an array of operations or {ops:[...]}
// (format: see README "Patch format"). Applies live; returns {ok, error?}.
function applyEdit(patch) {
  const ops = normalizePatch(typeof patch === 'string' ? JSON.parse(patch) : patch);
  if (!ops.length) return { ok: false, error: 'Lege patch' };
  let next;
  try { next = applyPatches(plan, ops); } catch (e) { return { ok: false, error: e.message }; }
  current.patches.push(...structuredClone(ops));
  history.push(ops.length);
  dirty = true;
  showPlan(next);
  return { ok: true, ops: ops.length };
}

async function undoEdit() {
  if (!history.length) return { ok: false, error: 'Niets om ongedaan te maken' };
  const n = history.pop();
  current.patches.splice(current.patches.length - n, n);
  const base = await fetchPlan(current.base || PLAN_URL);
  showPlan(applyPatches(base, current.patches));
  dirty = history.length > 0;
  refreshPanels();
  return { ok: true };
}

// ---------- UI ----------
function buildNav() {
  const nav = $('#views');
  nav.innerHTML = '';
  for (const [id, v] of Object.entries(plan.views || {})) {
    const b = document.createElement('button');
    b.textContent = v.label || id; b.dataset.view = id;
    b.onclick = () => { if (mode === 'walk') stopWalk(); goView(id); };
    nav.appendChild(b);
  }
  const wb = document.createElement('button');
  wb.className = 'walk'; wb.textContent = 'Rondlopen'; wb.dataset.view = 'walk';
  wb.onclick = () => (mode === 'walk' ? stopWalk(true) : startWalk(currentView in roomsById() ? currentView : 'keuken'));
  nav.appendChild(wb);
  if (mode === 'walk') wb.textContent = 'Stop rondlopen';
  setActiveNav(currentView);
}

function buildUIStatic() {
  $('#tLabels').onclick = (e) => { app.classList.toggle('hide-labels'); e.target.classList.toggle('on', !app.classList.contains('hide-labels')); };
  if (app.classList.contains('hide-labels')) $('#tLabels').classList.remove('on');
  $('#tWalls').onclick = (e) => {
    wallsMode = { auto: 'low', low: 'high', high: 'auto' }[wallsMode];
    e.target.textContent = 'Wanden: ' + { auto: 'auto', low: 'laag', high: 'hoog' }[wallsMode];
  };
  $('#tPanel').onclick = () => { app.classList.toggle('panel-open'); $('#tPanel').classList.toggle('on', app.classList.contains('panel-open')); };
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
  $('#tScenario').onclick = () => { showTab('scen'); if (window.innerWidth <= 820 && !app.classList.contains('panel-open')) $('#tPanel').click(); };
  initScenarioUI();
  if (window.innerWidth <= 820) showTab('design');
}

function refreshPanels() {
  buildNav();
  document.title = `${plan.meta?.title || 'Interieur'} · 3D-ontwerp`;
  $('#title').textContent = plan.meta?.title || 'Interieurontwerp';
  $('#subtitle').textContent = plan.meta?.subtitle || '';
  $('#tScenario').textContent = '◫ ' + current.name + (dirty ? ' •' : '');
  const pal = plan.palette || {};
  const swatchRoles = [['frontBase', 'fronten'], ['frontTall', 'hoge kasten'], ['worktop', 'werkblad'], ['floorExtension', 'vloer aanbouw'], ['accent', 'accent']];
  const sws = swatchRoles.filter(([r]) => pal[r]).map(([r, l]) => `<span class="sw"><i style="background:${swatchColor('@' + r)}"></i>${l}: ${materialLabel(pal[r])}</span>`).join('');
  // design tab
  const scen = `<div class="scen-banner"><span class="muted small">Scenario</span><b>${esc(current.name)}${dirty ? ' <em>(gewijzigd)</em>' : ''}</b>${current.description ? `<span class="small">${esc(current.description)}</span>` : ''}</div>`;
  const st = scen + (plan.meta?.style ? `<div class="style-card"><b>Stijl</b><br>${plan.meta.style}
    <div class="swatches">${sws}</div></div>` : '');
  $('#tab-design').innerHTML = st + built.rooms.filter(r => r.notes).map(r => `
    <div class="room-block" data-room="${r.id}"><h2>${r.name} <small>${r.dims || ''}</small></h2>
    <ul>${r.notes.map(n => `<li>${n}</li>`).join('')}</ul></div>`).join('');
  // rooms / dimensions tab
  $('#tab-rooms').innerHTML = `<table class="dims"><tr><th>Ruimte</th><th>Binnenmaat</th><th>m²</th><th>Plafond</th></tr>
    ${built.rooms.map(r => `<tr class="clickable" data-view="${r.id}"><td>${r.name}</td><td>${r.dims || r.width + ' × ' + r.depth}</td><td>${r.area.toFixed(1)}</td><td>${r.height}</td></tr>`).join('')}</table>
    <h3>Elementen</h3><table class="dims"><tr><th>Element</th><th>b × d × h (cm)</th></tr>
    ${built.items.map((g, i) => ({ it: g.userData.item, i })).filter(o => o.it.label).map(o => `<tr class="clickable" data-item="${o.i}"><td>${o.it.label}</td><td>${dimsText(o.it)}</td></tr>`).join('')}</table>`;
  $('#tab-rooms').querySelectorAll('tr[data-view]').forEach(tr => tr.onclick = () => { if (mode === 'walk') stopWalk(); goView(tr.dataset.view); });
  $('#tab-rooms').querySelectorAll('tr[data-item]').forEach(tr => tr.onclick = () => { const g = built.items[Number(tr.dataset.item)]; selectItem(g); focusItem(g); });

  // label clicks
  for (const l of built.itemLabels) {
    l.element.addEventListener('pointerdown', (e) => e.stopPropagation());
    l.element.addEventListener('click', (e) => { e.stopPropagation(); selectItem(built.items[Number(l.element.dataset.index)]); });
  }
  refreshScenarioUI();
}

function roomsById() { return Object.fromEntries(built.rooms.map(r => [r.id, r])); }

function showTab(t) {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('.tab').forEach(s => s.classList.toggle('on', s.id === 'tab-' + t));
}

function dimsText(it) {
  const s = it.size || [];
  if (it.type === 'walkway') return '120 breed';
  if (s.length >= 3 && s[2]) return `${s[0]} × ${s[1]} × ${s[2]}`;
  if (s.length >= 2) return `${s[0]} × ${s[1]}`;
  return '—';
}

// Item labels only for the room in focus (overview: room labels only) to avoid clutter.
let labelRoom = undefined;
function setLabelRoom(roomId) {
  if (roomId === labelRoom) return;
  labelRoom = roomId;
  for (const l of built.itemLabels) {
    const g = built.items[Number(l.element.dataset.index)];
    l.visible = !!roomId && (roomId === '*' || g.userData.item.room === roomId);
  }
}
function roomAt(x, z) {
  const r = built.rooms.find(r => x >= r.bounds.minX && x <= r.bounds.maxX && z >= r.bounds.minZ && z <= r.bounds.maxZ);
  return r ? r.id : null;
}

function setActiveNav(id) {
  if (built) setLabelRoom(params.get('labelroom') || plan.views?.[id]?.labels || (id in roomsById() ? id : null));
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === id && id !== 'walk'));
  document.querySelector('#views button.walk')?.classList.toggle('on', mode === 'walk');
  document.querySelectorAll('.room-block').forEach(b => b.classList.toggle('active', b.dataset.room === id));
  const blk = document.querySelector(`.room-block[data-room="${id}"]`);
  if (blk && !RENDER_MODE) blk.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ---------- camera views ----------
function goView(id, instant = false) {
  const v = plan.views?.[id] || plan.views?.overzicht;
  if (!v) return;
  currentView = id;
  const toPos = cm(v.pos), toTarget = cm(v.target);
  // portrait screens (phones): step back so the whole view still fits
  const aspect = W() / H();
  if (aspect < 1.2) toPos.sub(toTarget).multiplyScalar(Math.min(2.3, Math.pow(1.2 / aspect, 0.85))).add(toTarget);
  if (instant) { camera.position.copy(toPos); controls.target.copy(toTarget); controls.update(); }
  else tween = { t: 0, dur: 0.9, fromPos: camera.position.clone(), fromT: controls.target.clone(), toPos, toTarget };
  setActiveNav(id);
}

function focusItem(g) {
  if (mode === 'walk') stopWalk();
  const box = new THREE.Box3().setFromObject(g);
  const c = box.getCenter(new THREE.Vector3());
  const dir = camera.position.clone().sub(controls.target).normalize();
  const dist = Math.max(2.4, box.getSize(new THREE.Vector3()).length() * 2.2);
  tween = { t: 0, dur: 0.8, fromPos: camera.position.clone(), fromT: controls.target.clone(), toPos: c.clone().add(dir.multiplyScalar(dist)), toTarget: c };
}

// ---------- selection ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
function pick(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(built.items, true);
  for (const h of hits) {
    if (!h.object.visible) continue;
    const root = h.object.userData.itemRoot;
    if (root && root.userData.item.type !== 'walkway' && root.userData.item.type !== 'rug') return root;
    if (root) return root;
  }
  return null;
}

function itemName(it) { return it.label || TYPE_NAMES[it.type] || it.type; }

function selectItem(g) {
  selected = g;
  if (selHelper) { scene.remove(selHelper); selHelper = null; }
  document.querySelectorAll('.item-label.sel').forEach(e => e.classList.remove('sel'));
  if (!g) return;
  const box = new THREE.Box3().setFromObject(g);
  selHelper = new THREE.Box3Helper(box, 0x1f9d5a);
  scene.add(selHelper);
  const it = g.userData.item;
  const room = built.rooms.find(r => r.id === it.room);
  g.traverse(o => { if (o.element?.classList?.contains('item-label')) o.element.classList.add('sel'); });
  const s = it.size || [];
  $('#tab-details').innerHTML = `
    <div class="muted small">${room ? room.name : ''}</div>
    <div class="detail-title">${itemName(it)}</div>
    <div class="kv">
      <span>Type</span><span>${TYPE_NAMES[it.type] || it.type}</span>
      ${s[0] ? `<span>Breedte</span><span>${s[0]} cm</span>` : ''}
      ${s[1] ? `<span>Diepte</span><span>${s[1]} cm</span>` : ''}
      ${s[2] ? `<span>Hoogte</span><span>${s[2]} cm</span>` : ''}
      ${it.elev ? `<span>Vanaf vloer</span><span>${it.elev} cm</span>` : ''}
      ${it.material ? `<span>Materiaal</span><span>${it.material}</span>` : ''}
    </div>
    ${it.note ? `<p>${it.note}</p>` : ''}`;
  showTab('details');
  if (window.innerWidth <= 820 && !app.classList.contains('panel-open')) $('#tPanel').click();
}

let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY, performance.now()]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
  if (moved < 6 && performance.now() - downAt[2] < 500) {
    const g = pick(e.clientX, e.clientY);
    selectItem(g);
  }
  downAt = null;
});
const tooltip = $('#tooltip');
let hoverRaf = 0;
renderer.domElement.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || hoverRaf) return;
  hoverRaf = requestAnimationFrame(() => {
    hoverRaf = 0;
    if (e.buttons) { tooltip.style.display = 'none'; return; }
    const g = pick(e.clientX, e.clientY);
    if (g) {
      const it = g.userData.item;
      tooltip.textContent = `${itemName(it)} · ${dimsText(it)}${it.size?.[2] ? ' cm' : ''}`;
      tooltip.style.display = 'block';
      tooltip.style.left = e.clientX + 14 + 'px'; tooltip.style.top = e.clientY + 14 + 'px';
      renderer.domElement.style.cursor = 'pointer';
    } else { tooltip.style.display = 'none'; renderer.domElement.style.cursor = mode === 'walk' ? 'grab' : 'default'; }
  });
});
renderer.domElement.addEventListener('pointerleave', () => { tooltip.style.display = 'none'; });

// ---------- walk mode ----------
// Walk collision: free movement inside the ground area, blocked by wall
// segments except where a passable opening (door, slider, glass door, open
// passage) is. Body radius WALK_R (cm).
const WALK_R = 18;
const PASSABLE = new Set(['door', 'slider', 'glassdoor', 'opening', 'passage']);
function blockingWall(x, z) {
  const defT = plan.defaults?.wallThickness ?? 20;
  for (const w of built.walls) {
    const t = w.spec.thickness ?? defT;
    const rx = x - w.a.x, rz = z - w.a.y;
    const u = rx * w.n.y - rz * w.n.x;      // along the wall (from -> to)
    const v = rx * w.n.x + rz * w.n.y;      // across the wall
    if (Math.abs(v) >= t / 2 + WALK_R || u <= -WALK_R || u >= w.len + WALK_R) continue;
    const inOpening = (w.spec.openings || []).some((op) => PASSABLE.has(op.type || 'door')
      && u > op.offset + WALK_R * 0.5 && u < op.offset + op.width - WALK_R * 0.5);
    if (!inOpening) return w;
  }
  return null;
}
function walkable(x, z) {
  const g = plan.ground || { minX: -1500, maxX: 2000, minZ: -1200, maxZ: 1800 };
  if (x < g.minX || x > g.maxX || z < g.minZ || z > g.maxZ) return false;
  return !blockingWall(x, z);
}
// Move the walking camera by (dx, dz) cm with wall sliding. Returns true if it moved.
function tryMove(dx, dz) {
  const cx = camera.position.x / SCALE, cz = camera.position.z / SCALE;
  let nx = cx, nz = cz;
  if (walkable(cx + dx, cz + dz)) { nx = cx + dx; nz = cz + dz; }
  else if (walkable(cx + dx, cz)) nx = cx + dx;
  else if (walkable(cx, cz + dz)) nz = cz + dz;
  camera.position.x = nx * SCALE; camera.position.z = nz * SCALE;
  return nx !== cx || nz !== cz;
}

function startWalk(roomId, instant) {
  const v = plan.views?.[roomId]?.walk || plan.views?.keuken?.walk;
  if (!v) return;
  mode = 'walk'; app.classList.add('walking');
  controls.enabled = false; tween = null;
  camera.position.set(v.pos[0] * SCALE, walk.eye, v.pos[1] * SCALE);
  walk.yaw = THREE.MathUtils.degToRad(v.yaw || 0); walk.pitch = -0.1;
  camera.fov = 62; camera.updateProjectionMatrix();
  for (const c of built.ceilings) c.visible = true;
  renderer.domElement.style.cursor = 'grab';
  setActiveNav(roomId);
  document.querySelector('#views button.walk').textContent = 'Stop rondlopen';
}

function stopWalk(backToView) {
  mode = 'orbit'; app.classList.remove('walking');
  controls.enabled = true;
  camera.fov = 40; camera.updateProjectionMatrix();
  for (const c of built.ceilings) c.visible = false;
  renderer.domElement.style.cursor = 'default';
  document.querySelector('#views button.walk').textContent = 'Rondlopen';
  if (backToView) goView(currentView in roomsById() ? currentView : 'overzicht');
}

let drag = null;
renderer.domElement.addEventListener('pointerdown', (e) => { if (mode === 'walk') { drag = { x: e.clientX, y: e.clientY, yaw: walk.yaw, pitch: walk.pitch }; renderer.domElement.setPointerCapture(e.pointerId); } });
renderer.domElement.addEventListener('pointermove', (e) => {
  if (mode !== 'walk' || !drag) return;
  walk.yaw = drag.yaw + (e.clientX - drag.x) * 0.005;
  walk.pitch = THREE.MathUtils.clamp(drag.pitch + (e.clientY - drag.y) * 0.004, -1.1, 0.9);
});
window.addEventListener('pointerup', () => { drag = null; });
const KEYMAP = { KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back', KeyA: 'sl', KeyD: 'sr', ArrowLeft: 'left', ArrowRight: 'right', KeyQ: 'left', KeyE: 'right' };
window.addEventListener('keydown', (e) => { if (KEYMAP[e.code]) { walk.keys[KEYMAP[e.code]] = true; if (mode === 'walk') e.preventDefault(); } });
window.addEventListener('keyup', (e) => { if (KEYMAP[e.code]) walk.keys[KEYMAP[e.code]] = false; });
document.querySelectorAll('#walkpad button').forEach(b => {
  const k = b.dataset.k;
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); walk.keys[k] = true; });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => { walk.keys[k] = false; });
});

function updateWalk(dt) {
  const k = walk.keys;
  if (k.left) walk.yaw += dt * 1.6;
  if (k.right) walk.yaw -= dt * 1.6;
  const speed = 1.6 * dt;
  const fwd = new THREE.Vector2(-Math.sin(walk.yaw), -Math.cos(walk.yaw));
  const side = new THREE.Vector2(-fwd.y, fwd.x);
  const mv = new THREE.Vector2();
  if (k.fwd) mv.add(fwd); if (k.back) mv.sub(fwd);
  // side = camera's right-hand direction: D (sr) strafes right, A (sl) strafes left
  if (k.sr) mv.add(side); if (k.sl) mv.sub(side);
  if (mv.lengthSq() > 0) {
    mv.normalize().multiplyScalar(speed / SCALE);
    // sub-step so fast frames cannot tunnel through thin walls
    const steps = Math.max(1, Math.ceil(mv.length() / 5));
    for (let i = 0; i < steps; i++) tryMove(mv.x / steps, mv.y / steps);
  }
  camera.position.y = walk.eye;
  camera.rotation.set(walk.pitch, walk.yaw, 0, 'YXZ');
  const rid = roomAt(camera.position.x / SCALE, camera.position.z / SCALE);
  if (rid) setLabelRoom(rid);
}

// ---------- wall cutaway ----------
const tmpC = new THREE.Vector2(), tmpT = new THREE.Vector2();
function updateWalls(dt, instant) {
  const cutH = 95;
  tmpC.set(camera.position.x / SCALE, camera.position.z / SCALE);
  tmpT.set(controls.target.x / SCALE, controls.target.z / SCALE);
  for (const w of built.walls) {
    let cut;
    if (mode === 'walk' || wallsMode === 'high') cut = false;
    else if (wallsMode === 'low') cut = true;
    else {
      const sC = w.n.dot(tmpC.clone().sub(w.a)), sT = w.n.dot(tmpT.clone().sub(w.a));
      cut = Math.sign(sC) !== Math.sign(sT) && Math.abs(sC) > 10;
    }
    const target = cut ? Math.min(cutH, w.height) : w.height;
    const cur = w.curH;
    if (Math.abs(cur - target) < 0.5 && !instant) continue;
    const next = instant ? target : cur + (target - cur) * Math.min(1, dt * 8);
    setWallHeight(w, Math.abs(next - target) < 0.5 ? target : next);
  }
}

// ---------- loop ----------
const clock = new THREE.Clock();
let first = true;
function loop() {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (mode === 'walk') updateWalk(dt);
  else {
    if (tween) {
      tween.t += dt / tween.dur;
      const k = tween.t >= 1 ? 1 : 1 - Math.pow(1 - tween.t, 3);
      camera.position.lerpVectors(tween.fromPos, tween.toPos, k);
      controls.target.lerpVectors(tween.fromT, tween.toTarget, k);
      if (tween.t >= 1) tween = null;
    }
    controls.update();
  }
  updateWalls(dt, first || RENDER_MODE);
  first = false;
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = W() / H(); camera.updateProjectionMatrix();
  renderer.setSize(W(), H()); labelRenderer.setSize(W(), H());
});


// ---------- scenario UI ----------
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function materialLabel(name) {
  if (typeof name !== 'string') return 'eigen kleur';
  return plan.materials?.[name]?.label || BUILTIN_LABELS[name] || name;
}
let toastTimer = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

const PALETTE_ROLES = [
  ['frontBase', 'Onderkasten keuken'], ['frontTall', 'Hoge kasten keuken'], ['frontUpper', 'Bovenkasten'],
  ['frontGarage', 'Kastenwand garage'], ['frontUtility', 'Kasten bijkeuken'], ['wardrobe', 'Inbouwkast slaapkamer'],
  ['accent', 'Accenten (bed, stelling, tafel)'], ['worktop', 'Werkblad'], ['backsplash', 'Achterwand keuken'],
  ['floorKitchen', 'Vloer keuken'], ['floorExtension', 'Vloer aanbouw'], ['floorGarage', 'Vloer garage'],
];
const BUILTIN_CHOICES = ['oak', 'oakDark', 'greige', 'greigeLight', 'black', 'composite', 'tile', 'planks', 'concrete', 'epoxy', 'tileLarge'];

function scenarioOptionsHtml(selectedKey, excludeKey) {
  const opt = (sc) => sc.key === excludeKey ? '' : `<option value="${esc(sc.key)}" ${sc.key === selectedKey ? 'selected' : ''}>${esc(sc.name)}</option>`;
  const local = localScenarios();
  let h = opt(scenarioByKey('base'));
  const groups = [...new Set(repoScenarios.map((sc) => sc.group || 'Ontwerpen'))];
  for (const g of groups) h += `<optgroup label="${esc(g)}">${repoScenarios.filter((sc) => (sc.group || 'Ontwerpen') === g).map(opt).join('')}</optgroup>`;
  if (local.length) h += `<optgroup label="Mijn scenario's">${local.map(opt).join('')}</optgroup>`;
  const extra = [current, compareWith].filter((sc) => sc && (sc.key === 'shared' || sc.key === 'unsaved'));
  if (extra.length) h += `<optgroup label="Gedeeld / niet opgeslagen">${extra.map(opt).join('')}</optgroup>`;
  return h;
}

function initScenarioUI() {
  const t = $('#tab-scen');
  t.innerHTML = `
    <label class="field"><span>Scenario's</span><select id="scenSelect"></select></label>
    <p id="scenDesc" class="small muted"></p>
    <p id="scenDirty" class="small warn" hidden>Je hebt niet-opgeslagen wijzigingen in dit scenario.</p>
    <div class="btnrow">
      <button id="scenSave" class="btn" hidden>Opslaan</button>
      <button id="scenSaveNew" class="btn primary">Opslaan als nieuw scenario</button>
      <button id="scenShare" class="btn">Deel link</button>
      <button id="scenExport" class="btn">Exporteer JSON</button>
      <button id="scenImport" class="btn">Importeer JSON</button>
      <button id="scenDelete" class="btn danger" hidden>Verwijder</button>
    </div>
    <input id="scenShareUrl" class="shareurl" readonly hidden>
    <h3>Vergelijken</h3>
    <div class="cmprow"><select id="cmpSelect"><option value="">Kies een scenario…</option></select>
      <button id="cmpSwap" class="btn" disabled title="Sneltoets: C">Wissel A ⇄ B</button></div>
    <p id="cmpInfo" class="small muted"></p>
    <details id="editPanel">
      <summary>Ontwerp aanpassen</summary>
      <p class="small muted">Kies materialen per onderdeel. Wijzigingen worden live getoond en horen bij het huidige scenario; sla ze op als nieuw scenario om ze te bewaren.</p>
      <div id="paletteGrid" class="palette"></div>
      <h3>Patch (JSON)</h3>
      <textarea id="patchText" rows="5" spellcheck="false" placeholder='{"op":"moveItem","id":"keuken-ronde-tafel-80","by":[0,-20]}'></textarea>
      <div class="btnrow"><button id="patchApply" class="btn primary">Toepassen</button><button id="patchUndo" class="btn">Ongedaan maken</button></div>
      <p id="patchStatus" class="small muted"></p>
      <div class="chatstub"><input disabled placeholder="Binnenkort: beschrijf je wens in gewone taal…"><button class="btn" disabled>Stuur</button></div>
    </details>`;
  $('#scenSelect').onchange = (e) => {
    if (dirty && !confirm('Niet-opgeslagen wijzigingen gaan verloren. Doorgaan?')) { e.target.value = current.key; return; }
    const sc = scenarioByKey(e.target.value); if (sc) loadScenario(sc);
  };
  $('#scenSaveNew').onclick = saveAsNew;
  $('#scenSave').onclick = saveCurrentLocal;
  $('#scenShare').onclick = shareLink;
  $('#scenExport').onclick = exportJson;
  $('#scenImport').onclick = () => $('#importFile').click();
  $('#importFile').onchange = importJson;
  $('#scenDelete').onclick = deleteLocal;
  $('#cmpSelect').onchange = (e) => { compareWith = e.target.value ? scenarioByKey(e.target.value) : null; refreshScenarioUI(); };
  $('#cmpSwap').onclick = swapCompare;
  window.addEventListener('keydown', (e) => { if (e.code === 'KeyC' && !e.target.closest?.('input,textarea,select') && compareWith) swapCompare(); });
  $('#patchApply').onclick = () => {
    let r;
    try { r = applyEdit(JSON.parse($('#patchText').value)); } catch (e) { r = { ok: false, error: 'Ongeldige JSON: ' + e.message }; }
    $('#patchStatus').textContent = r.ok ? `Toegepast (${r.ops} operatie${r.ops > 1 ? 's' : ''}).` : r.error;
    $('#patchStatus').className = 'small ' + (r.ok ? 'ok' : 'warn');
  };
  $('#patchUndo').onclick = async () => { const r = await undoEdit(); $('#patchStatus').textContent = r.ok ? 'Laatste wijziging ongedaan gemaakt.' : r.error; };
}

function refreshScenarioUI() {
  if (!$('#scenSelect')) return;
  $('#scenSelect').innerHTML = scenarioOptionsHtml(current.key);
  $('#scenDesc').textContent = current.description || '';
  $('#scenDirty').hidden = !dirty;
  const isLocal = current.key.startsWith('local:');
  $('#scenSave').hidden = !(isLocal && dirty);
  $('#scenDelete').hidden = !isLocal;
  $('#cmpSelect').innerHTML = '<option value="">Kies een scenario…</option>' + scenarioOptionsHtml(compareWith?.key, current.key);
  $('#cmpSwap').disabled = !compareWith;
  $('#cmpInfo').textContent = compareWith ? `A: ${current.name}  ·  B: ${compareWith.name}. De camera blijft staan als je wisselt.` : '';
  // palette pickers
  const choices = [...BUILTIN_CHOICES, ...Object.keys(plan.materials || {})];
  const pal = plan.palette || {};
  $('#paletteGrid').innerHTML = PALETTE_ROLES.filter(([r]) => r in pal).map(([r, l]) => `
    <label><i style="background:${swatchColor('@' + r)}"></i><span>${l}</span>
    <select data-role="${r}">${choices.map((c) => `<option value="${c}" ${pal[r] === c ? 'selected' : ''}>${esc(materialLabel(c))}</option>`).join('')}</select></label>`).join('');
  $('#paletteGrid').querySelectorAll('select').forEach((sel) => sel.onchange = () => {
    const r = applyEdit({ op: 'palette', set: { [sel.dataset.role]: sel.value } });
    if (!r.ok) toast(r.error);
  });
}

function saveAsNew() {
  const name = prompt('Naam van het nieuwe scenario:', current.key === 'base' ? 'Mijn variant' : `${current.name} (variant)`);
  if (!name || !name.trim()) return;
  const list = loadLocal();
  const sc = { id: 's' + Date.now().toString(36), name: name.trim(), description: current.description || '', base: current.base || PLAN_URL, patches: structuredClone(current.patches), savedAt: new Date().toISOString() };
  list.push(sc); saveLocal(list);
  current = { ...sc, key: 'local:' + sc.id, patches: structuredClone(sc.patches) };
  dirty = false; history = [];
  refreshPanels();
  toast(`Opgeslagen als "${sc.name}" (op dit apparaat). Gebruik "Deel link" voor een ander apparaat.`);
}

function saveCurrentLocal() {
  const list = loadLocal();
  const i = list.findIndex((x) => 'local:' + x.id === current.key);
  if (i < 0) return saveAsNew();
  list[i] = { ...list[i], patches: structuredClone(current.patches), savedAt: new Date().toISOString() };
  saveLocal(list); dirty = false; history = []; refreshPanels(); toast('Scenario opgeslagen');
}

function deleteLocal() {
  if (!confirm(`Scenario "${current.name}" verwijderen van dit apparaat?`)) return;
  saveLocal(loadLocal().filter((x) => 'local:' + x.id !== current.key));
  loadScenario(scenarioByKey('base'));
}

async function shareLink() {
  const code = encodeShare(current);
  lastShareHash = code;
  const url = `${location.origin}${location.pathname}#s=${code}`;
  history_replace(url);
  const box = $('#scenShareUrl'); box.hidden = false; box.value = url; box.select();
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) { await navigator.share({ title: `Interieur: ${current.name}`, url }); return; }
    await navigator.clipboard.writeText(url);
    toast('Link gekopieerd: open hem op een ander apparaat');
  } catch { toast('Kopieer de link hieronder'); }
}
function history_replace(url) { try { window.history.replaceState(null, '', url); } catch { /* ignore */ } }

function exportJson() {
  const data = JSON.stringify(toScenarioFile({ ...current, id: current.id || current.key.replace(/^\w+:/, '') }), null, 2);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  a.download = `scenario-${current.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ontwerp'}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function importJson(e) {
  const f = e.target.files?.[0]; e.target.value = '';
  if (!f) return;
  try {
    const sc = validateScenario(JSON.parse(await f.text()));
    applyPatches(await fetchPlan(sc.base || PLAN_URL), sc.patches); // validate before saving
    const list = loadLocal();
    const entry = { id: 's' + Date.now().toString(36), name: sc.name, description: sc.description, base: sc.base || PLAN_URL, patches: sc.patches, savedAt: new Date().toISOString() };
    list.push(entry); saveLocal(list);
    await loadScenario({ ...entry, key: 'local:' + entry.id });
    toast(`Geïmporteerd: ${sc.name}`);
  } catch (err) { toast('Import mislukt: ' + err.message); }
}

async function swapCompare() {
  if (!compareWith) return;
  const a = current, aDirty = dirty, aHist = history;
  const b = compareWith;
  await loadScenario(b);
  if (b._dirty) { dirty = true; history = b._history || []; }
  compareWith = { ...a, _dirty: aDirty, _history: aHist };
  refreshPanels();
}

// Public API (used by tests and, later, the chat assistant).
window.viz = {
  applyEdit, undo: undoEdit, ops: Object.keys(OPS),
  getScenario: () => toScenarioFile(current), getPlan: () => structuredClone(plan),
  loadScenario: (key) => loadScenario(scenarioByKey(key)),
  listScenarios: () => [scenarioByKey('base'), ...repoScenarios, ...localScenarios()].map((s) => ({ key: s.key, name: s.name })),
  shareUrl: () => `${location.origin}${location.pathname}#s=${encodeShare(current)}`,
  startWalk: (room) => startWalk(room), stopWalk: () => stopWalk(),
  tryMove, roomAt, walkable,
  setPose: (x, z, yawDeg = 0) => { camera.position.x = x * SCALE; camera.position.z = z * SCALE; walk.yaw = THREE.MathUtils.degToRad(yawDeg); walk.pitch = 0; },
  position: () => ({ x: camera.position.x / SCALE, z: camera.position.z / SCALE, yaw: THREE.MathUtils.radToDeg(walk.yaw), room: roomAt(camera.position.x / SCALE, camera.position.z / SCALE) }),
};

init().catch((e) => { console.error(e); $('#loading').innerHTML = '<span>Kon het model niet laden: ' + e.message + '</span>'; });
