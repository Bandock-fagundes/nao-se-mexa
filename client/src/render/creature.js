// Criatura: SkinnedMesh único com esqueleto procedural (27 ossos) e animação procedural
// ligada ao estado real enviado pelo servidor.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------- esqueleto (pose de ligação, coordenadas do mundo, criatura olhando +Z) ----------
const J = {
  root: V(0, 0, 0), hips: V(0, 1.62, -0.05), spine1: V(0, 1.88, 0.0), spine2: V(0, 2.15, 0.1), chest: V(0, 2.4, 0.22),
  neck: V(0, 2.62, 0.36), head: V(0, 2.8, 0.5),
};
const BONES = [
  ['root', null, J.root], ['hips', 'root', J.hips], ['spine1', 'hips', J.spine1], ['spine2', 'spine1', J.spine2], ['chest', 'spine2', J.chest],
  ['neck', 'chest', J.neck], ['head', 'neck', J.head],
  ['jawL', 'head', V(0.045, 2.72, 0.66)], ['jawR', 'head', V(-0.045, 2.72, 0.66)],
];
for (const s of [1, -1]) {
  const k = s > 0 ? 'L' : 'R';
  BONES.push(['clav' + k, 'chest', V(s * 0.1, 2.5, 0.24)], ['upperArm' + k, 'clav' + k, V(s * 0.36, 2.48, 0.2)], ['forearm' + k, 'upperArm' + k, V(s * 0.47, 1.83, 0.33)],
    ['hand' + k, 'forearm' + k, V(s * 0.5, 1.12, 0.44)], ['fingers' + k, 'hand' + k, V(s * 0.5, 0.94, 0.48)]);
  BONES.push(['thigh' + k, 'hips', V(s * 0.17, 1.55, -0.05)], ['shin' + k, 'thigh' + k, V(s * 0.2, 0.95, 0.3)], ['foot' + k, 'shin' + k, V(s * 0.21, 0.36, -0.12)], ['toes' + k, 'foot' + k, V(s * 0.22, 0.07, 0.12)]);
}
const BI = Object.fromEntries(BONES.map((b, i) => [b[0], i]));

// ---------- ruído suave determinístico ----------
function hash3(x, y, z) { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  let r = 0;
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) r += hash3(xi + a, yi + b, zi + c) * (a ? u : 1 - u) * (b ? v : 1 - v) * (c ? w : 1 - w);
  return r * 2 - 1;
}

// ---------- tubo esfolado ao longo de uma polilinha ----------
// pts: [{p, r, sx, sy, bones:[[idx,w],...], bump(angle,t)}]
class SkinBuilder {
  constructor() { this.parts = []; }
  tube(pts, { radial = 16, sub = 4, noise = 0.012, cap = true, uvScale = 1.5, extra, rScale = 1 } = {}) {
    // reamostra com Catmull-Rom
    const P = pts.map(q => q.p);
    const curve = new THREE.CatmullRomCurve3(P, false, 'centripetal');
    const n = (pts.length - 1) * sub + 1;
    const rings = [];
    let prevN = null;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const seg = Math.min(pts.length - 2, Math.floor(u * (pts.length - 1)));
      const lt = u * (pts.length - 1) - seg;
      const A = pts[seg], Bp = pts[seg + 1];
      const lerp = (a, b) => a + (b - a) * (lt * lt * (3 - 2 * lt));
      const r = lerp(A.r, Bp.r) * rScale, sx = lerp(A.sx ?? 1, Bp.sx ?? 1), sy = lerp(A.sy ?? 1, Bp.sy ?? 1);
      const p = curve.getPointAt(u), tan = curve.getTangentAt(u).normalize();
      // moldura por transporte paralelo
      let nor;
      if (!prevN) { const up = Math.abs(tan.y) > 0.9 ? V(1, 0, 0) : V(0, 1, 0); nor = new THREE.Vector3().crossVectors(tan, up).normalize(); }
      else { nor = prevN.clone().sub(tan.clone().multiplyScalar(prevN.dot(tan))).normalize(); }
      prevN = nor;
      const bin = new THREE.Vector3().crossVectors(tan, nor).normalize();
      // pesos de osso: mistura entre pontos-chave
      const wA = 1 - lt, wB = lt;
      const bw = new Map();
      for (const [bi, w] of A.bones) bw.set(bi, (bw.get(bi) || 0) + w * wA);
      for (const [bi, w] of Bp.bones) bw.set(bi, (bw.get(bi) || 0) + w * wB);
      rings.push({ p, tan, nor, bin, r, sx, sy, u, bw: [...bw.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4) });
    }
    const pos = [], uv = [], si = [], sw = [], idx = [];
    let len = 0;
    rings.forEach((rg, i) => {
      if (i > 0) len += rg.p.distanceTo(rings[i - 1].p);
      for (let k = 0; k <= radial; k++) {
        const a = k / radial * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        let rr = rg.r;
        if (extra) rr += extra(a, rg.u, rg.p);
        const dir = rg.nor.clone().multiplyScalar(ca * rg.sx).add(rg.bin.clone().multiplyScalar(sa * rg.sy));
        const q = rg.p.clone().addScaledVector(dir, rr);
        if (noise) { const nd = dir.clone().normalize(); q.addScaledVector(nd, noise * vnoise(q.x * 9, q.y * 9, q.z * 9) + noise * 0.5 * vnoise(q.x * 23, q.y * 23, q.z * 23)); }
        pos.push(q.x, q.y, q.z); uv.push(k / radial * 2, len * uvScale);
        const b = rg.bw; let tot = 0; for (const [, w] of b) tot += w;
        for (let j = 0; j < 4; j++) { si.push(b[j] ? b[j][0] : 0); sw.push(b[j] ? b[j][1] / tot : 0); }
      }
    });
    for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < radial; k++) {
      const a = i * (radial + 1) + k, b = a + radial + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    if (cap) { // tampa nas pontas (leque)
      for (const [ri, flip] of [[0, true], [rings.length - 1, false]]) {
        const rg = rings[ri]; const c = pos.length / 3;
        const cp = rg.p.clone().addScaledVector(rg.tan, (flip ? -1 : 1) * rg.r * 0.6);
        pos.push(cp.x, cp.y, cp.z); uv.push(0.5, 0);
        const b = rg.bw; let tot = 0; for (const [, w] of b) tot += w;
        for (let j = 0; j < 4; j++) { si.push(b[j] ? b[j][0] : 0); sw.push(b[j] ? b[j][1] / tot : 0); }
        for (let k = 0; k < radial; k++) { const a = ri * (radial + 1) + k; if (flip) idx.push(c, a + 1, a); else idx.push(c, a, a + 1); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.parts.push(g);
    return g;
  }
  // geometria rígida presa a um osso (dentes, garras)
  rigid(geo, bone) {
    geo = geo.index ? geo : geo;
    const n = geo.attributes.position.count;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { si[i * 4] = bone; sw[i * 4] = 1; }
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    if (!geo.index) { const ix = []; for (let i = 0; i < n; i++) ix.push(i); geo.setIndex(ix); }
    this.parts.push(geo);
    return geo;
  }
  build() { const g = mergeGeometries(this.parts, false); return g; }
}
const pt = (p, r, bones, sx = 1, sy = 1) => ({ p, r, bones, sx, sy });
const one = (name) => [[BI[name], 1]];
const mix = (a, b, w) => [[BI[a], 1 - w], [BI[b], w]];

function buildGeometry() {
  const skin = new SkinBuilder(), dark = new SkinBuilder(), teeth = new SkinBuilder();
  // ----- tronco (bacia → costelas → pescoço) com costelas e vértebras -----
  const torsoBump = (a, u) => {
    let r = 0;
    const back = Math.max(0, -Math.sin(a)); // lado de trás (binormal negativo ~ -Z)
    const front = Math.max(0, Math.sin(a));
    if (u > 0.32 && u < 0.72) r += 0.014 * Math.max(0, Math.sin(u * Math.PI * 22)) * (1 - back) * (0.6 + 0.4 * Math.abs(Math.cos(a)));
    r += 0.02 * Math.pow(Math.max(0, Math.sin(u * Math.PI * 28)), 3) * Math.pow(back, 6);
    if (u > 0.18 && u < 0.32) r -= 0.025 * front; // ventre fundo
    return r;
  };
  skin.tube([
    pt(V(0, 1.42, -0.06), 0.13, one('hips'), 1.2, 1),
    pt(V(0, 1.6, -0.05), 0.2, one('hips'), 1.35, 0.95),
    pt(J.spine1, 0.15, mix('hips', 'spine1', 0.6), 1.15, 0.9),
    pt(V(0, 2.02, 0.04), 0.19, mix('spine1', 'spine2', 0.6), 1.25, 0.9),
    pt(J.spine2, 0.24, mix('spine2', 'chest', 0.3), 1.32, 0.88),
    pt(J.chest, 0.27, one('chest'), 1.35, 0.85),
    pt(V(0, 2.52, 0.28), 0.22, mix('chest', 'neck', 0.2), 1.3, 0.85),
    pt(J.neck, 0.11, mix('chest', 'neck', 0.7), 1, 1),
    pt(V(0, 2.72, 0.44), 0.085, mix('neck', 'head', 0.5), 1, 1.1),
  ], { radial: 22, sub: 5, noise: 0.012, extra: torsoBump, uvScale: 1.2 });
  // ----- cabeça alongada, sem olhos -----
  const H = J.head;
  skin.tube([
    pt(V(0, 2.74, 0.44), 0.07, mix('neck', 'head', 0.7)),
    pt(V(0, 2.82, 0.5), 0.13, one('head'), 0.95, 1.05),
    pt(V(0, 2.86, 0.6), 0.165, one('head'), 0.9, 1.15),
    pt(V(0, 2.82, 0.74), 0.15, one('head'), 0.8, 1.1),
    pt(V(0, 2.74, 0.88), 0.1, one('head'), 0.75, 1.1),
    pt(V(0, 2.66, 0.97), 0.035, one('head')),
  ], { radial: 20, sub: 5, noise: 0.008, extra: (a, u) => (u > 0.3 && u < 0.6 ? -0.02 * Math.pow(Math.max(0, Math.cos(a)), 8) - 0.02 * Math.pow(Math.max(0, -Math.cos(a)), 8) : 0) });
  // cavidades onde seriam olhos (vazias, escuras)
  for (const s of [1, -1]) { const g = new THREE.SphereGeometry(0.03, 10, 8); g.scale(0.9, 0.6, 0.5); g.translate(s * 0.1, 2.88, 0.7); dark.rigid(g, BI.head); }
  // ----- boca vertical: interior escuro + lábios nos ossos da mandíbula + dentes -----
  {
    const g = new THREE.SphereGeometry(0.1, 16, 12); g.scale(0.32, 1.25, 0.55); g.rotateX(-0.5); g.translate(0, 2.7, 0.8); dark.rigid(g, BI.head);
  }
  for (const s of [1, -1]) {
    const jb = s > 0 ? 'jawL' : 'jawR';
    skin.tube([
      pt(V(s * 0.05, 2.84, 0.66), 0.02, one(jb)), pt(V(s * 0.045, 2.79, 0.79), 0.035, one(jb)), pt(V(s * 0.04, 2.67, 0.86), 0.04, one(jb)), pt(V(s * 0.045, 2.56, 0.8), 0.03, one(jb)), pt(V(s * 0.05, 2.52, 0.7), 0.015, one(jb)),
    ], { radial: 10, sub: 4, noise: 0.004 });
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      const y = 2.82 - t * 0.28, z = 0.74 + Math.sin(t * Math.PI) * 0.12;
      const g = new THREE.ConeGeometry(0.009, 0.05 + 0.02 * Math.sin(t * Math.PI), 5);
      g.rotateZ(s * Math.PI / 2); g.translate(s * 0.02, y, z);
      teeth.rigid(g, BI[jb]);
    }
  }
  // espinhos ósseos nas costas
  for (let i = 0; i < 7; i++) {
    const t = i / 6; const y = 1.95 + t * 0.6, z = -0.1 + t * 0.38;
    const g = new THREE.ConeGeometry(0.022, 0.09 - t * 0.02, 6); g.rotateX(-1.9 + t * 0.4); g.translate(0, y, z - 0.19);
    dark.rigid(g, BI[t < 0.5 ? 'spine2' : 'chest']);
  }
  // ----- braços longos até os joelhos -----
  for (const s of [1, -1]) {
    const k = s > 0 ? 'L' : 'R';
    skin.tube([
      pt(V(s * 0.08, 2.5, 0.22), 0.09, mix('chest', 'clav' + k, 0.5)),
      pt(V(s * 0.3, 2.52, 0.2), 0.12, mix('clav' + k, 'upperArm' + k, 0.5), 1, 1.1),
      pt(V(s * 0.4, 2.25, 0.24), 0.09, one('upperArm' + k)),
      pt(V(s * 0.45, 2.0, 0.29), 0.078, one('upperArm' + k)),
      pt(V(s * 0.47, 1.83, 0.33), 0.06, mix('upperArm' + k, 'forearm' + k, 0.5)),
      pt(V(s * 0.485, 1.6, 0.37), 0.068, one('forearm' + k)),
      pt(V(s * 0.5, 1.3, 0.42), 0.05, one('forearm' + k)),
      pt(V(s * 0.5, 1.12, 0.44), 0.04, mix('forearm' + k, 'hand' + k, 0.6), 1.3, 0.8),
      pt(V(s * 0.5, 0.98, 0.47), 0.045, one('hand' + k), 1.5, 0.6),
    ], { radial: 16, sub: 6, noise: 0.006, rScale: 0.78 });
    // cotovelo ósseo
    { const g = new THREE.SphereGeometry(0.034, 12, 10); g.translate(s * 0.47, 1.84, 0.3); skin.rigid(g, BI['forearm' + k]); }
    // dedos longos com garras
    for (let f = 0; f < 4; f++) {
      const fx = s * (0.47 + f * 0.022), fz = 0.47 + (f - 1.5) * 0.012;
      const len = f === 0 || f === 3 ? 0.27 : 0.33;
      skin.tube([pt(V(fx, 0.97, fz), 0.017, one('hand' + k)), pt(V(fx + s * 0.005, 0.97 - len * 0.45, fz + 0.03), 0.014, one('fingers' + k)), pt(V(fx + s * 0.006, 0.97 - len, fz + 0.07), 0.008, one('fingers' + k))], { radial: 7, sub: 3, noise: 0.002 });
      const g = new THREE.ConeGeometry(0.008, 0.11, 6); g.rotateX(Math.PI - 0.4); g.translate(fx + s * 0.006, 0.97 - len - 0.045, fz + 0.09); dark.rigid(g, BI['fingers' + k]);
    }
    skin.tube([pt(V(s * 0.48, 1.05, 0.46), 0.016, one('hand' + k)), pt(V(s * 0.45, 0.92, 0.52), 0.012, one('fingers' + k)), pt(V(s * 0.44, 0.84, 0.55), 0.007, one('fingers' + k))], { radial: 7, sub: 3, noise: 0.002 });
  }
  // ----- pernas digitígradas -----
  for (const s of [1, -1]) {
    const k = s > 0 ? 'L' : 'R';
    skin.tube([
      pt(V(s * 0.16, 1.62, -0.07), 0.15, mix('hips', 'thigh' + k, 0.6), 1, 1.1),
      pt(V(s * 0.18, 1.3, 0.1), 0.14, one('thigh' + k)),
      pt(V(s * 0.2, 1.05, 0.24), 0.09, one('thigh' + k)),
      pt(V(s * 0.2, 0.95, 0.3), 0.075, mix('thigh' + k, 'shin' + k, 0.5)),
      pt(V(s * 0.205, 0.75, 0.16), 0.07, one('shin' + k), 1, 1.2),
      pt(V(s * 0.21, 0.5, -0.04), 0.05, one('shin' + k)),
      pt(V(s * 0.21, 0.36, -0.12), 0.045, mix('shin' + k, 'foot' + k, 0.5)),
      pt(V(s * 0.215, 0.2, 0.0), 0.04, one('foot' + k)),
      pt(V(s * 0.22, 0.07, 0.12), 0.042, mix('foot' + k, 'toes' + k, 0.4), 1.3, 0.8),
    ], { radial: 16, sub: 6, noise: 0.008, rScale: 0.8 });
    { const g = new THREE.SphereGeometry(0.045, 12, 10); g.translate(s * 0.2, 0.96, 0.31); skin.rigid(g, BI['shin' + k]); }
    for (let t = -1; t <= 1; t++) {
      const tx = s * 0.22 + t * 0.04;
      skin.tube([pt(V(tx, 0.06, 0.12), 0.024, one('toes' + k)), pt(V(tx + t * 0.02, 0.035, 0.26), 0.018, one('toes' + k)), pt(V(tx + t * 0.025, 0.025, 0.34), 0.01, one('toes' + k))], { radial: 7, sub: 3, noise: 0.002 });
      const g = new THREE.ConeGeometry(0.01, 0.07, 6); g.rotateX(Math.PI / 2 + 0.3); g.translate(tx + t * 0.025, 0.02, 0.38); dark.rigid(g, BI['toes' + k]);
    }
  }
  const gs = skin.build(), gd = dark.build(), gt = teeth.build();
  const merged = mergeGeometries([gs, gd, gt], true);
  return merged;
}

export function buildCreature(M) {
  const geo = buildGeometry();
  const bones = [];
  for (const [name, parent, wp] of BONES) {
    const b = new THREE.Bone(); b.name = name;
    if (parent) { const pb = bones[BI[parent]]; pb.add(b); b.position.copy(wp).sub(BONES[BI[parent]][2]); }
    else b.position.copy(wp);
    bones.push(b);
  }
  const skinMat = new THREE.MeshStandardMaterial({ map: M.T.creatureSkin.map, normalMap: M.T.creatureSkin.normalMap, roughnessMap: M.T.creatureSkin.roughnessMap, color: 0x9a9c92, roughness: 0.88, metalness: 0.0, normalScale: new THREE.Vector2(0.9, 0.9), envMapIntensity: 0.3 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x120606, roughness: 0.55, metalness: 0.0 });
  const toothMat = new THREE.MeshStandardMaterial({ color: 0xbfb294, roughness: 0.6 });
  const mesh = new THREE.SkinnedMesh(geo, [skinMat, darkMat, toothMat]);
  mesh.add(bones[0]);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  const root = new THREE.Group(); root.add(mesh);
  const anim = new CreatureAnimator(bones);
  return { root, mesh, bones, anim };
}

// ---------- animação procedural ----------
const E = (x = 0, y = 0, z = 0) => ({ x, y, z });
export class CreatureAnimator {
  constructor(bones) {
    this.b = Object.fromEntries(bones.map(b => [b.name, b]));
    this.rest = Object.fromEntries(bones.map(b => [b.name, b.position.clone()]));
    this.phase = 0; this.t = 0; this.lurch = 0; this.prevSpeed = 0; this.prevYaw = null; this.yawRate = 0;
    this.footCb = null; this.lastStep = 0; this.jaw = 0;
    this.q = new THREE.Quaternion(); this.e = new THREE.Euler();
  }
  // s: {anim, animT, speed, headYaw, headPitch, yaw, duck}
  update(dt, s) {
    this.t += dt;
    const t = this.t, b = this.b;
    const speed = s.speed || 0;
    if (this.prevYaw !== null) { let d = s.yaw - this.prevYaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; this.yawRate += ((d / Math.max(dt, 1e-3)) - this.yawRate) * Math.min(1, dt * 6); }
    this.prevYaw = s.yaw;
    if (this.prevSpeed > 2.2 && speed < this.prevSpeed - 1.2 * dt * 10) this.lurch = 1;
    this.prevSpeed = speed;
    this.lurch = Math.max(0, this.lurch - dt * 2.2);
    const run = Math.min(1, Math.max(0, (speed - 2.2) / 2));
    const stride = 1.4 + run * 1.4;
    const turning = Math.abs(this.yawRate) > 0.8 && speed < 0.4;
    const prevPhase = this.phase;
    this.phase += (speed / stride) * Math.PI * 2 * dt * 0.5 + (turning ? dt * 5 : 0);
    // passos (pé tocando o chão)
    const stepIdx = Math.floor(this.phase / Math.PI);
    if (stepIdx !== Math.floor(prevPhase / Math.PI) && (speed > 0.3 || turning) && this.footCb) this.footCb(stepIdx % 2 === 0 ? 'L' : 'R', run);
    const ph = this.phase;
    const gaitAmp = Math.min(1, speed / 1.2) * (0.42 + run * 0.4) + (turning ? 0.15 : 0);
    const P = {};
    for (const k in b) P[k] = E();
    const hipsOff = V(0, 0, 0);
    // postura base curvada
    P.spine1.x = 0.24; P.spine2.x = 0.16; P.chest.x = 0.12; P.neck.x = -0.3; P.head.x = -0.02;
    P.clavL.z = -0.08; P.clavR.z = 0.08;
    P.forearmL.x = -0.18; P.forearmR.x = -0.18; P.fingersL.x = -0.25; P.fingersR.x = -0.25;
    // respiração
    const br = s.anim === 'recover' || s.anim === 'kill' ? 2.6 : 1;
    P.chest.x += Math.sin(t * 1.25) * 0.025 * br; P.spine2.x += Math.sin(t * 1.25) * 0.012 * br; P.clavL.z -= Math.sin(t * 1.25) * 0.02 * br; P.clavR.z += Math.sin(t * 1.25) * 0.02 * br;
    // marcha
    const sw = Math.sin(ph), cw = Math.cos(ph);
    P.thighL.x = -sw * gaitAmp; P.thighR.x = sw * gaitAmp;
    P.shinL.x = Math.max(0, cw) * gaitAmp * 0.9 + 0.05; P.shinR.x = Math.max(0, -cw) * gaitAmp * 0.9 + 0.05;
    P.footL.x = -Math.max(0, cw) * gaitAmp * 0.6; P.footR.x = -Math.max(0, -cw) * gaitAmp * 0.6;
    P.toesL.x = sw * 0.2 * gaitAmp; P.toesR.x = -sw * 0.2 * gaitAmp;
    hipsOff.y = -Math.abs(Math.cos(ph)) * 0.05 * gaitAmp - run * 0.12;
    P.hips.z = sw * 0.05 * gaitAmp; P.hips.y = sw * 0.08 * gaitAmp; P.spine2.y = -sw * 0.1 * gaitAmp;
    P.upperArmL.x = sw * gaitAmp * 0.6; P.upperArmR.x = -sw * gaitAmp * 0.6;
    P.forearmL.x -= Math.max(0, -sw) * 0.3 * gaitAmp; P.forearmR.x -= Math.max(0, sw) * 0.3 * gaitAmp;
    // corrida: inclina para frente, braços para trás
    P.spine1.x += run * 0.32; P.spine2.x += run * 0.12; P.neck.x -= run * 0.25; P.head.x -= run * 0.15;
    P.upperArmL.x += run * 0.45; P.upperArmR.x += run * 0.45; P.upperArmL.z = -run * 0.2; P.upperArmR.z = run * 0.2;
    this.jawTarget = run * 0.25;
    // olhar
    const hy = s.headYaw || 0, hp = s.headPitch || 0;
    P.neck.y = hy * 0.45; P.head.y = hy * 0.55; P.neck.x += -hp * 0.5; P.head.x += -hp * 0.5;
    P.spine2.y += hy * 0.15;
    // estados
    const at = s.animT || 0;
    switch (s.anim) {
      case 'investigate_walk': P.spine1.x += 0.12; P.neck.x += 0.12; P.upperArmR.x -= 0.35; P.forearmR.x -= 0.3; P.head.z = Math.sin(t * 0.9) * 0.15; break;
      case 'stop': this.lurch = Math.max(this.lurch, 0.8); break;
      case 'turn': case 'hear': {
        const k = Math.min(1, at / 0.15);
        P.clavL.z -= 0.15 * k; P.clavR.z += 0.15 * k; P.spine1.x -= 0.08 * k; P.head.z = 0.18 * Math.sin(Math.min(1, at * 3) * Math.PI);
        this.jawTarget = at < 0.6 ? 0.18 * Math.abs(Math.sin(t * 34)) : 0.05;
        P.fingersL.x -= 0.4; P.fingersR.x -= 0.4; P.upperArmL.z = -0.15; P.upperArmR.z = 0.15;
        break;
      }
      case 'sniff': {
        P.spine1.x += 0.25; P.spine2.x += 0.1; P.neck.x += 0.35 + Math.sin(t * 15) * 0.07; P.head.x += 0.15 + Math.sin(t * 15 + 1) * 0.06;
        this.jawTarget = 0.05 + 0.05 * Math.abs(Math.sin(t * 15));
        P.upperArmL.x -= 0.15; P.upperArmR.x -= 0.15;
        break;
      }
      case 'inspect': {
        P.spine1.x += 0.38; P.spine2.x += 0.2; P.neck.x += 0.1; P.head.z = 0.25;
        P.upperArmR.x -= 1.0 + Math.sin(t * 1.5) * 0.15; P.forearmR.x -= 0.45; P.fingersR.x -= 0.5 + 0.3 * Math.abs(Math.sin(t * 2));
        break;
      }
      case 'look': P.spine2.y += hy * 0.2; P.head.z = Math.sin(t * 0.7) * 0.12; break;
      case 'attack': {
        const wind = Math.min(1, at / 0.25), strike = Math.min(1, Math.max(0, (at - 0.25) / 0.18)), rec = Math.max(0, (at - 0.5) / 0.25);
        const up = wind * (1 - strike);
        P.upperArmL.x -= 2.3 * up + 0.9 * strike * (1 - rec); P.upperArmR.x -= 2.3 * up + 0.9 * strike * (1 - rec);
        P.upperArmL.z = -0.5 * up; P.upperArmR.z = 0.5 * up;
        P.forearmL.x -= 0.5 * up; P.forearmR.x -= 0.5 * up;
        P.spine1.x += -0.15 * up + 0.55 * strike * (1 - rec); P.spine2.x += 0.2 * strike;
        P.fingersL.x -= 0.6 * strike; P.fingersR.x -= 0.6 * strike;
        this.jawTarget = 0.35 + 0.35 * wind;
        break;
      }
      case 'kill': {
        P.spine1.x += 0.6; P.spine2.x += 0.3; P.chest.x += 0.15; P.neck.x += 0.3; P.head.x += 0.25 + Math.sin(t * 6) * 0.05;
        P.upperArmL.x -= 1.1; P.upperArmR.x -= 1.1; P.forearmL.x -= 0.6; P.forearmR.x -= 0.6; P.fingersL.x -= 0.9; P.fingersR.x -= 0.9;
        hipsOff.y -= 0.3; P.thighL.x -= 0.5; P.thighR.x -= 0.5; P.shinL.x += 0.6; P.shinR.x += 0.6;
        this.jawTarget = 0.4 + 0.2 * Math.abs(Math.sin(t * 5));
        break;
      }
      case 'door': P.upperArmR.x -= 1.5; P.forearmR.x -= 0.1; P.spine1.x += 0.25; P.fingersR.x += 0.3; break;
      case 'recover': P.neck.x += 0.2; P.spine1.x += 0.1; this.jawTarget = 0.12 + 0.08 * Math.sin(t * 2.6); break;
    }
    // inércia da parada repentina
    P.spine1.x += this.lurch * 0.35 * Math.cos((1 - this.lurch) * 9); P.head.x -= this.lurch * 0.2;
    // abaixa ao passar por portas
    const duck = s.duck || 0;
    P.spine1.x += duck * 0.35; P.neck.x -= duck * 0.15; hipsOff.y -= duck * 0.12;
    // mudança de direção: torção do tronco
    P.spine2.y += Math.max(-0.35, Math.min(0.35, this.yawRate * 0.12));
    // mandíbula (abre para os lados)
    this.jaw += (this.jawTarget - this.jaw) * Math.min(1, dt * 12);
    P.jawL.y = this.jaw; P.jawR.y = -this.jaw;
    // aplica com suavização
    const k = Math.min(1, dt * (s.anim === 'attack' ? 22 : 11));
    for (const name in P) {
      const bone = b[name];
      this.e.set(P[name].x, P[name].y, P[name].z, 'XYZ');
      this.q.setFromEuler(this.e);
      bone.quaternion.slerp(this.q, name.startsWith('thigh') || name.startsWith('shin') || name.startsWith('foot') || name.startsWith('toes') ? Math.min(1, dt * 18) : k);
    }
    b.hips.position.copy(this.rest.hips).add(hipsOff.multiplyScalar(1));
  }
}
