// Geometry helpers. Authoring unit = centimetre; UVs are generated in metres so
// that every 1 m x 1 m texture keeps real-world scale on any box size.
import * as THREE from 'three';
import { RoundedBoxGeometry } from '../vendor/addons/RoundedBoxGeometry.js';

const cache = new Map();

export function boxGeo(w, h, d) {
  const key = `${w.toFixed(2)}|${h.toFixed(2)}|${d.toFixed(2)}`;
  if (cache.has(key)) return cache.get(key);
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // face order: +x, -x, +y, -y, +z, -z (4 vertices each)
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * dims[f][0] / 100, uv.getY(i) * dims[f][1] / 100);
    }
  }
  cache.set(key, g);
  return g;
}

export function roundedGeo(w, h, d, r = 2, seg = 3) {
  const key = `r${w}|${h}|${d}|${r}|${seg}`;
  if (cache.has(key)) return cache.get(key);
  const g = new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 0.01, h / 2 - 0.01, d / 2 - 0.01));
  const uv = g.attributes.uv; const pos = g.attributes.position;
  // simple planar-ish UVs in metres
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + pos.getZ(i)) / 100, pos.getY(i) / 100);
  cache.set(key, g);
  return g;
}

// Add a box to a group. x,z = centre, y = bottom.
export function B(group, w, h, d, material, x = 0, y = 0, z = 0, { cast = true, receive = true, rounded = 0 } = {}) {
  const geo = rounded ? roundedGeo(w, h, d, rounded) : boxGeo(w, h, d);
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y + h / 2, z);
  m.castShadow = cast; m.receiveShadow = receive;
  group.add(m);
  return m;
}

export function cyl(group, rTop, rBot, h, material, x = 0, y = 0, z = 0, seg = 24) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), material);
  m.position.set(x, y + h / 2, z);
  m.castShadow = true; m.receiveShadow = true;
  group.add(m);
  return m;
}
