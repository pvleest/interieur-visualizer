// Scenario data model + edit API (pure data, no rendering).
//
// A scenario = a base plan (plans/*.json) + an ordered list of patch operations.
// The same patch format is used by scenario files (scenarios/*.json), by
// applyEdit() in the app, and later by a natural-language "chat" front-end.

export const SCENARIO_FORMAT = 'interieur-scenario';

const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

function merge(target, set) {
  for (const [k, v] of Object.entries(set || {})) {
    if (v === null) delete target[k];
    else target[k] = clone(v);
  }
  return target;
}

function need(cond, msg) { if (!cond) throw new Error(msg); }

function findItem(plan, id) {
  const it = plan.items.find((i) => i.id === id);
  need(it, `Onbekend item: "${id}"`);
  return it;
}
function findWall(plan, id) {
  const w = plan.walls.find((x) => x.id === id);
  need(w, `Onbekende wand: "${id}"`);
  return w;
}
function findOpening(wall, ref) {
  const ops = wall.openings || (wall.openings = []);
  const idx = typeof ref === 'number' ? ref : ops.findIndex((o) => o.id === ref);
  need(idx >= 0 && idx < ops.length, `Onbekende opening ${JSON.stringify(ref)} in wand "${wall.id}"`);
  return idx;
}
function uniqueId(plan, base) {
  let id = base || 'item', n = 1;
  while (plan.items.some((i) => i.id === id)) id = `${base}-${++n}`;
  return id;
}

// All supported operations. Each mutates `plan` in place.
export const OPS = {
  palette: (plan, p) => { need(p.set && typeof p.set === 'object', 'palette: "set" ontbreekt'); plan.palette = merge(plan.palette || {}, p.set); },
  defineMaterial: (plan, p) => { need(p.name && p.def, 'defineMaterial: "name" en "def" zijn verplicht'); (plan.materials ||= {})[p.name] = clone(p.def); },
  setMeta: (plan, p) => { plan.meta = merge(plan.meta || {}, p.set); },
  updateItem: (plan, p) => merge(findItem(plan, p.id), p.set),
  moveItem: (plan, p) => {
    const it = findItem(plan, p.id);
    if (p.pos) it.pos = clone(p.pos);
    if (p.by) it.pos = [(it.pos?.[0] || 0) + p.by[0], (it.pos?.[1] || 0) + p.by[1]];
    if (p.rot !== undefined) it.rot = p.rot;
    if (p.elev !== undefined) it.elev = p.elev;
  },
  resizeItem: (plan, p) => { need(Array.isArray(p.size), 'resizeItem: "size" [b,d,h] ontbreekt'); findItem(plan, p.id).size = clone(p.size); },
  addItem: (plan, p) => {
    need(p.item && p.item.type, 'addItem: "item" met "type" is verplicht');
    const it = clone(p.item);
    it.id = it.id && !plan.items.some((i) => i.id === it.id) ? it.id : uniqueId(plan, it.id || `${it.room || 'item'}-${it.type}`);
    plan.items.push(it);
  },
  removeItem: (plan, p) => { findItem(plan, p.id); plan.items = plan.items.filter((i) => i.id !== p.id); },
  updateRoom: (plan, p) => { const r = plan.rooms.find((x) => x.id === p.id); need(r, `Onbekende ruimte: "${p.id}"`); merge(r, p.set); },
  updateWall: (plan, p) => merge(findWall(plan, p.id), p.set),
  addWall: (plan, p) => {
    need(p.wall && p.wall.id && Array.isArray(p.wall.from) && Array.isArray(p.wall.to), 'addWall: "wall" met "id", "from" en "to" is verplicht');
    need(!plan.walls.some((w) => w.id === p.wall.id), `addWall: wand "${p.wall.id}" bestaat al`);
    plan.walls.push(clone(p.wall));
  },
  removeWall: (plan, p) => { findWall(plan, p.id); plan.walls = plan.walls.filter((w) => w.id !== p.id); },
  addOpening: (plan, p) => { need(p.opening, 'addOpening: "opening" ontbreekt'); (findWall(plan, p.wall).openings ||= []).push(clone(p.opening)); },
  updateOpening: (plan, p) => { const w = findWall(plan, p.wall); merge(w.openings[findOpening(w, p.index ?? p.opening)], p.set); },
  removeOpening: (plan, p) => { const w = findWall(plan, p.wall); w.openings.splice(findOpening(w, p.index ?? p.opening), 1); },
  setView: (plan, p) => { need(p.id && p.view, 'setView: "id" en "view" zijn verplicht'); (plan.views ||= {})[p.id] = clone(p.view); },
};

// Accepts a single op, an array of ops, or { ops: [...] } / { patches: [...] }.
export function normalizePatch(patch) {
  if (!patch) return [];
  if (Array.isArray(patch)) return patch;
  if (Array.isArray(patch.ops)) return patch.ops;
  if (Array.isArray(patch.patches)) return patch.patches;
  return [patch];
}

export function applyPatches(basePlan, patches) {
  const plan = clone(basePlan);
  normalizePatch(patches).forEach((p, i) => {
    const fn = OPS[p?.op];
    if (!fn) throw new Error(`Patch #${i + 1}: onbekende operatie "${p?.op}". Toegestaan: ${Object.keys(OPS).join(', ')}`);
    try { fn(plan, p); } catch (e) { throw new Error(`Patch #${i + 1} (${p.op}): ${e.message}`); }
  });
  return plan;
}

// ---------- compaction ----------
// Edit mode produces many small item operations (every drag is a moveItem). Before saving or sharing,
// fold them: later move/resize/update ops on an item merge into its previous op of the same kind or into
// the addItem that created it; a removeItem drops the item's earlier edits (and its addItem, if any).
// The resulting plan is the same as with the full list.
const ITEM_OPS = new Set(['addItem', 'updateItem', 'moveItem', 'resizeItem', 'removeItem']);
const idOf = (p) => (p.op === 'addItem' ? p.item?.id : p.id);
export function compactPatches(patches) {
  const out = [];
  const same = (q, id) => ITEM_OPS.has(q.op) && idOf(q) === id;
  for (const p of normalizePatch(patches).map(clone)) {
    if (!ITEM_OPS.has(p.op) || p.op === 'addItem' || !p.id) { out.push(p); continue; }
    const id = p.id;
    if (p.op === 'removeItem') {
      let added = false;
      for (let k = out.length - 1; k >= 0; k--) {
        const q = out[k];
        if (!same(q, id)) continue;
        if (q.op === 'removeItem') break;
        out.splice(k, 1);
        if (q.op === 'addItem') { added = true; break; }
      }
      if (!added) out.push(p);
      continue;
    }
    let j = out.length - 1;
    while (j >= 0 && !same(out[j], id)) j--;
    const prev = j >= 0 ? out[j] : null;
    try {
      if (prev && prev.op === 'addItem') { OPS[p.op]({ items: [prev.item] }, p); continue; }
      if (prev && prev.op === p.op) {
        if (p.op === 'resizeItem') { prev.size = p.size; continue; }
        if (p.op === 'updateItem') { prev.set = { ...prev.set, ...p.set }; continue; }
        if (p.op === 'moveItem' && !(p.by && prev.by && !prev.pos) ) {
          if (p.pos) { prev.pos = p.pos; delete prev.by; }
          else if (p.by) prev.pos = [prev.pos[0] + p.by[0], prev.pos[1] + p.by[1]];
          if (p.rot !== undefined) prev.rot = p.rot;
          if (p.elev !== undefined) prev.elev = p.elev;
          continue;
        }
      }
    } catch { /* fall through: keep the op as it is */ }
    out.push(p);
  }
  return out;
}

// ---------- serialisation / sharing ----------
export function toScenarioFile(s) {
  return { format: SCENARIO_FORMAT, version: 1, id: s.id, name: s.name, description: s.description || '', base: s.base, patches: compactPatches(s.patches || []) };
}

export function validateScenario(o) {
  need(o && typeof o === 'object', 'Geen geldig scenario-bestand');
  need(!o.format || o.format === SCENARIO_FORMAT, `Onbekend formaat: ${o.format}`);
  need(typeof o.name === 'string' && o.name.trim(), 'Scenario heeft geen naam');
  need(Array.isArray(o.patches), 'Scenario heeft geen "patches"-lijst');
  need(!o.base || /^[\w\-./]+\.json$/.test(o.base), 'Ongeldig base-pad');
  return { id: o.id, name: o.name.trim(), description: o.description || '', base: o.base, patches: o.patches };
}

export function encodeShare(s) {
  const LZ = window.LZString;
  return LZ.compressToEncodedURIComponent(JSON.stringify(toScenarioFile(s)));
}
export function decodeShare(str) {
  const LZ = window.LZString;
  const json = LZ.decompressFromEncodedURIComponent(str);
  need(json, 'De gedeelde link is beschadigd of onvolledig');
  return validateScenario(JSON.parse(json));
}

// ---------- local storage ----------
const LS_KEY = 'interieur-visualizer.scenarios.v1';
export function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
}
export function saveLocal(list) { localStorage.setItem(LS_KEY, JSON.stringify(list)); }
