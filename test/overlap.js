// Varredura 3D de sobreposição entre objetos da casa (v2 fase 2).
// Constrói as caixas (AABB) de cada malha de cada móvel, quadro, janela, luminária, vela e objeto derrubável
// e procura pares de objetos DIFERENTES que se atravessam. Usado pelo teste test/overlap.test.js e pelo
// script de diagnóstico work/overlap.mjs.
import * as THREE from 'three';
import { CELL, LEVELS } from '../shared/config.js';
import { buildProp, buildKnockable } from '../client/src/render/props.js';
import { decorBox, lampBox, windowBox } from '../client/src/render/decorboxes.js';

const mat = new THREE.MeshBasicMaterial();
const M = new Proxy({}, { get: (t, k) => t[k] || (t[k] = mat) });
const propCache = new Map();

// caixas por malha de um móvel, já no espaço do mundo
function propBoxes(p) {
  const horiz = p.facing === 0 || p.facing === 2;
  const w = (horiz ? p.sx : p.sz) * CELL, d = (horiz ? p.sz : p.sx) * CELL;
  const key = p.kind + ':' + w + ':' + d + ':' + p.variant;
  let g = propCache.get(key);
  if (!g) { g = buildProp(p.kind, w, d, M, p.variant); propCache.set(key, g); }
  const root = new THREE.Group(); root.position.set(p.x, LEVELS[p.level].y, p.z); root.rotation.y = [0, Math.PI / 2, Math.PI, -Math.PI / 2][p.facing];
  root.add(g); root.updateMatrixWorld(true);
  const out = [];
  g.traverse(o => { if (o.isMesh) { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); out.push(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)); } });
  root.remove(g);
  return out;
}
function knockBoxes(k) {
  const g = buildKnockable(k.kind, M); g.position.set(k.x, LEVELS[k.level].y, k.z); g.rotation.y = k.rot; g.updateMatrixWorld(true);
  const out = []; g.traverse(o => { if (o.isMesh) { o.geometry.computeBoundingBox(); out.push(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)); } });
  return out;
}
const union = (bs) => { const u = new THREE.Box3(); for (const b of bs) u.union(b); return u; };
// interseção com folga (encostar não conta)
function hit(a, b, tol) {
  return a.min.x < b.max.x - tol && a.max.x > b.min.x + tol && a.min.y < b.max.y - tol && a.max.y > b.min.y + tol && a.min.z < b.max.z - tol && a.max.z > b.min.z + tol;
}

// Lista todos os objetos sólidos da casa com suas caixas
export function collectObjects(map) {
  const objs = [];
  for (const p of map.props) objs.push({ type: 'prop:' + p.kind, id: 'p' + p.id, level: p.level, boxes: propBoxes(p), prop: p.id });
  for (const k of map.knockables) objs.push({ type: 'knock:' + k.kind, id: 'k' + k.id, level: k.level, boxes: knockBoxes(k) });
  for (const dc of map.decor) { const b = decorBox(dc); if (b) objs.push({ type: 'decor:' + dc.kind, id: 'd' + objs.length, level: dc.level, boxes: [b] }); }
  for (const w of map.windows) objs.push({ type: 'window', id: 'w' + objs.length, level: w.level, boxes: windowBox(w) });
  for (const l of map.lamps) { const b = lampBox(l); if (b) objs.push({ type: 'lamp:' + l.kind, id: 'l' + objs.length, level: l.level, boxes: [b], onProp: l.prop }); }
  for (const o of objs) o.box = union(o.boxes);
  return objs;
}

// Pares que se atravessam. tol = folga em metros.
export function findOverlaps(map, tol = 0.012) {
  const objs = collectObjects(map), bad = [];
  for (let i = 0; i < objs.length; i++) for (let j = i + 1; j < objs.length; j++) {
    const a = objs[i], b = objs[j];
    if (a.level !== b.level || !hit(a.box, b.box, tol)) continue;
    // vela apoiada no próprio móvel: pode encostar no tampo, mas não atravessar
    let found = null;
    for (const ba of a.boxes) { for (const bb of b.boxes) if (hit(ba, bb, tol)) { found = [ba, bb]; break; } if (found) break; }
    if (found) bad.push({ a: a.type, b: b.type, ida: a.id, idb: b.id, level: a.level, at: found[0].getCenter(new THREE.Vector3()).toArray().map(v => +v.toFixed(2)) });
  }
  return bad;
}
