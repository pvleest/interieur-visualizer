import * as THREE from 'three';
import { OrbitControls } from '../vendor/addons/OrbitControls.js';
import { RoomEnvironment } from '../vendor/addons/RoomEnvironment.js';
import { CSS2DRenderer } from '../vendor/addons/CSS2DRenderer.js';
import { buildPlan, SCALE, setWallHeight } from './engine.js';
import { setMaxAnisotropy } from './materials.js';

const params = new URLSearchParams(location.search);
const PLAN_URL = params.get('plan') || 'plans/vleugel.json';
const RENDER_MODE = params.get('ui') === '0';
const TYPE_NAMES = {
  base: 'Onderkast', tall: 'Hoge kast', wall: 'Bovenkast', wardrobe: 'Inbouwkast', plinth: 'Verhoging', fridge: 'Koelkast', freezer: 'Vriezer',
  ovenColumn: 'Oven-kolom', dishwasher: 'Vaatwasser', worktop: 'Werkblad', sink: 'Spoelbak', hob: 'Kookplaat', hood: 'Afzuigkap', panel: 'Paneel',
  washer: 'Wasmachine', dryer: 'Droger', basketDrawers: 'Wasmandlades', openShelf: 'Open stelling', workbench: 'Werkplek', ironingCabinet: 'Strijkkast',
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

async function init() {
  plan = await (await fetch(PLAN_URL)).json();
  built = buildPlan(plan);
  scene.add(built.root);
  document.title = `${plan.meta?.title || 'Interieur'} · 3D-ontwerp`;
  $('#title').textContent = plan.meta?.title || 'Interieurontwerp';
  $('#subtitle').textContent = plan.meta?.subtitle || '';

  // sun / shadow frustum fitted to the rooms
  const bb = new THREE.Box3();
  for (const r of built.rooms) { bb.expandByPoint(new THREE.Vector3(r.bounds.minX, 0, r.bounds.minZ)); bb.expandByPoint(new THREE.Vector3(r.bounds.maxX, 0, r.bounds.maxZ)); }
  const c = bb.getCenter(new THREE.Vector3()).multiplyScalar(SCALE);
  const size = bb.getSize(new THREE.Vector3()).multiplyScalar(SCALE);
  const ext = Math.max(size.x, size.z) * 0.75 + 2;
  sun.position.set(c.x - 6, 14, c.z + 9);
  sun.target.position.copy(c);
  Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 50 });
  sun.shadow.camera.updateProjectionMatrix();

  buildUI();
  const v = params.get('view') || 'overzicht';
  if (v === 'walk') startWalk(params.get('room') || 'keuken', true);
  else goView(v, true);
  if (params.get('select')) selectItem(built.items[Number(params.get('select'))]);
  renderer.setAnimationLoop(loop);
  setTimeout(() => $('#loading').classList.add('done'), 150);
  let frames = 0;
  const ready = () => { if (++frames > 12) { window.__ready = true; } else requestAnimationFrame(ready); };
  requestAnimationFrame(ready);
}

// ---------- UI ----------
function buildUI() {
  const nav = $('#views');
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

  $('#tLabels').onclick = (e) => { app.classList.toggle('hide-labels'); e.target.classList.toggle('on', !app.classList.contains('hide-labels')); };
  if (app.classList.contains('hide-labels')) $('#tLabels').classList.remove('on');
  $('#tWalls').onclick = (e) => {
    wallsMode = { auto: 'low', low: 'high', high: 'auto' }[wallsMode];
    e.target.textContent = 'Wanden: ' + { auto: 'auto', low: 'laag', high: 'hoog' }[wallsMode];
  };
  $('#tPanel').onclick = () => { app.classList.toggle('panel-open'); $('#tPanel').classList.toggle('on', app.classList.contains('panel-open')); };
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));

  // design tab
  const st = plan.meta?.style ? `<div class="style-card"><b>Stijl</b><br>${plan.meta.style}
    <div class="swatches"><span class="sw"><i style="background:#c9a57c"></i>mat eiken</span><span class="sw"><i style="background:#bcae9b"></i>warm greige</span>
    <span class="sw"><i style="background:#1b1b1b"></i>zwart</span><span class="sw"><i style="background:#ece8e1"></i>composiet</span><span class="sw"><i style="background:#a3a19c"></i>gietvloer</span></div></div>` : '';
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
  if (window.innerWidth <= 820) showTab('design');
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
function walkable(x, z) {
  for (const r of built.rooms) {
    const b = r.bounds;
    if (x > b.minX + 18 && x < b.maxX - 18 && z > b.minZ + 18 && z < b.maxZ - 18) return true;
  }
  for (const w of built.walls) {
    for (const op of w.spec.openings || []) {
      if (op.type === 'window' || op.type === 'garage' || op.type === 'fixed') continue;
      const d = new THREE.Vector2(-w.n.y, w.n.x);
      const rel = new THREE.Vector2(x - w.a.x, z - w.a.y);
      const u = rel.dot(d), v = rel.dot(w.n);
      if (u > op.offset + 12 && u < op.offset + op.width - 12 && Math.abs(v) < 45) return true;
    }
  }
  for (const c of plan.context || []) {
    const xs = c.polygon.map(p => p[0]), zs = c.polygon.map(p => p[1]);
    if (x > Math.min(...xs) + 18 && x < Math.max(...xs) - 18 && z > Math.min(...zs) + 18 && z < Math.max(...zs) - 18) return true;
  }
  return false;
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
  if (k.sr) mv.sub(side); if (k.sl) mv.add(side);
  if (mv.lengthSq() > 0) {
    mv.normalize().multiplyScalar(speed);
    const nx = camera.position.x + mv.x, nz = camera.position.z + mv.y;
    if (walkable(nx / SCALE, nz / SCALE)) { camera.position.x = nx; camera.position.z = nz; }
    else if (walkable(nx / SCALE, camera.position.z / SCALE)) camera.position.x = nx;
    else if (walkable(camera.position.x / SCALE, nz / SCALE)) camera.position.z = nz;
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

init().catch((e) => { console.error(e); $('#loading').innerHTML = '<span>Kon het model niet laden: ' + e.message + '</span>'; });
