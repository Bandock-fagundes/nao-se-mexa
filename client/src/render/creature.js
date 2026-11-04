// Criatura: SkinnedMesh único com esqueleto procedural e animação procedural fluida
// (molas amortecidas em todas as juntas, IK de pernas digitígradas com pés plantados,
// misturas suaves entre estados). O estado vem do servidor (snapshots), mas o animador
// também funciona isolado (tela de carregamento / laboratório): basta chamar
//   const c = buildCreature(M); scene.add(c.root); ... c.anim.update(dt, { anim:'walk', speed:1.3 })
// a cada quadro. Se a raiz não se move, a velocidade informada vira uma "esteira" virtual.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrapA = (d) => { while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

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
// dedos: 4 por mão, 2 falanges articuladas cada (articulações = nós dos dedos), mais o polegar
const FING = [0, 1, 2, 3].map(f => ({ len: [0.37, 0.41, 0.39, 0.32][f], z: 0.474 + (1.5 - f) * 0.025, xo: 0.004 * Math.abs(f - 1.5) }));
const knuckle = (s, f) => V(s * (0.5 + FING[f].xo), 0.965, FING[f].z);
const midJoint = (s, f) => { const k = knuckle(s, f), L = FING[f].len; return V(k.x - s * 0.012, k.y - L * 0.46, k.z + 0.012); };
const tipPt = (s, f) => { const k = knuckle(s, f), L = FING[f].len; return V(k.x - s * 0.03, k.y - L, k.z + 0.03); };
for (const s of [1, -1]) {
  const k = s > 0 ? 'L' : 'R';
  BONES.push(['clav' + k, 'chest', V(s * 0.1, 2.5, 0.24)], ['upperArm' + k, 'clav' + k, V(s * 0.36, 2.48, 0.2)], ['forearm' + k, 'upperArm' + k, V(s * 0.47, 1.83, 0.33)],
    ['hand' + k, 'forearm' + k, V(s * 0.5, 1.12, 0.44)]);
  for (let f = 0; f < 4; f++) BONES.push(['f' + f + 'a' + k, 'hand' + k, knuckle(s, f)], ['f' + f + 'b' + k, 'f' + f + 'a' + k, midJoint(s, f)]);
  BONES.push(['thumb' + k, 'hand' + k, V(s * 0.488, 1.06, 0.505)]);
  BONES.push(['thigh' + k, 'hips', V(s * 0.17, 1.55, -0.05)], ['shin' + k, 'thigh' + k, V(s * 0.2, 0.95, 0.3)], ['foot' + k, 'shin' + k, V(s * 0.21, 0.36, -0.12)], ['toes' + k, 'foot' + k, V(s * 0.22, 0.07, 0.12)]);
}
const BI = Object.fromEntries(BONES.map((b, i) => [b[0], i]));
const BW = Object.fromEntries(BONES.map(b => [b[0], b[2]]));

// ---------- ruído suave determinístico ----------
function hash3(x, y, z) { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  let r = 0;
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) r += hash3(xi + a, yi + b, zi + c) * (a ? u : 1 - u) * (b ? v : 1 - v) * (c ? w : 1 - w);
  return r * 2 - 1;
}
const n1 = (t, seed = 0) => vnoise(t, seed * 13.7, seed * 3.1);

// cor por vértice: sujeira subindo dos pés, carne fina mais quente (truque de translucidez), sulcos mais escuros
function vertexTint(q, rr, ex) {
  let r = 1, g = 1, b = 1;
  const dirt = Math.pow(smooth(1.0, 0.05, q.y), 1.3) * (0.7 + 0.3 * vnoise(q.x * 6, q.y * 6, q.z * 6));
  r *= lerp(1, 0.3, dirt); g *= lerp(1, 0.25, dirt); b *= lerp(1, 0.2, dirt);
  const grime = Math.max(0, vnoise(q.x * 3.1, q.y * 3.1 + 7, q.z * 3.1)) * 0.25;
  r *= 1 - grime * 0.8; g *= 1 - grime * 0.85; b *= 1 - grime * 0.9;
  const thin = smooth(0.05, 0.012, rr);
  r *= 1 + thin * 0.06; g *= 1 - thin * 0.12; b *= 1 - thin * 0.16;
  const cav = clamp(ex * 9, -0.32, 0.08);
  r *= 1 + cav; g *= 1 + cav * 1.1; b *= 1 + cav;
  return [r, g, b];
}

// ---------- tubo esfolado ao longo de uma polilinha ----------
class SkinBuilder {
  constructor() { this.parts = []; }
  tube(pts, { radial = 16, sub = 4, noise = 0.012, cap = true, uvScale = 1.5, extra, rScale = 1 } = {}) {
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
      const lr = (a, b) => a + (b - a) * (lt * lt * (3 - 2 * lt));
      const r = lr(A.r, Bp.r) * rScale, sx = lr(A.sx ?? 1, Bp.sx ?? 1), sy = lr(A.sy ?? 1, Bp.sy ?? 1);
      const p = curve.getPointAt(u), tan = curve.getTangentAt(u).normalize();
      let nor;
      if (!prevN) { const up = Math.abs(tan.y) > 0.9 ? V(1, 0, 0) : V(0, 1, 0); nor = new THREE.Vector3().crossVectors(tan, up).normalize(); }
      else { nor = prevN.clone().sub(tan.clone().multiplyScalar(prevN.dot(tan))).normalize(); }
      prevN = nor;
      const bin = new THREE.Vector3().crossVectors(tan, nor).normalize();
      const wA = 1 - lt, wB = lt;
      const bw = new Map();
      for (const [bi, w] of A.bones) bw.set(bi, (bw.get(bi) || 0) + w * wA);
      for (const [bi, w] of Bp.bones) bw.set(bi, (bw.get(bi) || 0) + w * wB);
      rings.push({ p, tan, nor, bin, r, sx, sy, u, bw: [...bw.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4) });
    }
    const pos = [], uv = [], si = [], sw = [], idx = [], col = [];
    let len = 0;
    rings.forEach((rg, i) => {
      if (i > 0) len += rg.p.distanceTo(rings[i - 1].p);
      for (let k = 0; k <= radial; k++) {
        const a = k / radial * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const dir = rg.nor.clone().multiplyScalar(ca * rg.sx).add(rg.bin.clone().multiplyScalar(sa * rg.sy));
        const nd = dir.clone().normalize();
        let rr = rg.r, ex = 0;
        if (extra) { ex = extra(a, rg.u, rg.p, nd, rg.r); rr += ex; }
        const q = rg.p.clone().addScaledVector(dir, rr);
        if (noise) q.addScaledVector(nd, noise * vnoise(q.x * 9, q.y * 9, q.z * 9) + noise * 0.5 * vnoise(q.x * 23, q.y * 23, q.z * 23));
        pos.push(q.x, q.y, q.z); uv.push(k / radial * 2, len * uvScale);
        col.push(...vertexTint(q, rg.r, ex));
        const b = rg.bw; let tot = 0; for (const [, w] of b) tot += w;
        for (let j = 0; j < 4; j++) { si.push(b[j] ? b[j][0] : 0); sw.push(b[j] ? b[j][1] / tot : 0); }
      }
    });
    for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < radial; k++) {
      const a = i * (radial + 1) + k, b = a + radial + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    if (cap) {
      for (const [ri, flip] of [[0, true], [rings.length - 1, false]]) {
        const rg = rings[ri]; const c = pos.length / 3;
        const cp = rg.p.clone().addScaledVector(rg.tan, (flip ? -1 : 1) * rg.r * 0.6);
        pos.push(cp.x, cp.y, cp.z); uv.push(0.5, 0); col.push(...vertexTint(cp, rg.r, 0));
        const b = rg.bw; let tot = 0; for (const [, w] of b) tot += w;
        for (let j = 0; j < 4; j++) { si.push(b[j] ? b[j][0] : 0); sw.push(b[j] ? b[j][1] / tot : 0); }
        for (let k = 0; k < radial; k++) { const a = ri * (radial + 1) + k; if (flip) idx.push(c, a + 1, a); else idx.push(c, a, a + 1); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.parts.push(g);
    return g;
  }
  // geometria rígida presa a um osso (dentes, garras, ossos salientes)
  rigid(geo, bone, tint = 1) {
    if (geo.index) geo = geo.toNonIndexed();
    const n = geo.attributes.position.count;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), col = new Float32Array(n * 3);
    const q = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      si[i * 4] = bone; sw[i * 4] = 1;
      q.fromBufferAttribute(geo.attributes.position, i);
      const c = vertexTint(q, 0.06, 0); col[i * 3] = c[0] * tint; col[i * 3 + 1] = c[1] * tint; col[i * 3 + 2] = c[2] * tint;
    }
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    const ix = []; for (let i = 0; i < n; i++) ix.push(i); geo.setIndex(ix);
    this.parts.push(geo);
    return geo;
  }
  build() { return mergeGeometries(this.parts, false); }
}
const pt = (p, r, bones, sx = 1, sy = 1) => ({ p, r, bones, sx, sy });
const one = (name) => [[BI[name], 1]];
const mix = (a, b, w) => [[BI[a], 1 - w], [BI[b], w]];
const ridge = (x, sharp = 2.5) => Math.pow(0.5 + 0.5 * Math.sin(x), sharp);

function buildGeometry() {
  const skin = new SkinBuilder(), claw = new SkinBuilder(), maw = new SkinBuilder(), teeth = new SkinBuilder();
  // ----- tronco: costelas inclinadas, esterno, vértebras salientes, escápulas, ventre fundo, cristas ilíacas -----
  const torsoBump = (a, u, p, d) => {
    const back = Math.max(0, -d.z), front = Math.max(0, d.z), side = Math.abs(d.x);
    let r = 0;
    // costelas: arcos que descem da coluna para a frente, com sulcos entre elas
    const ribMask = smooth(0.36, 0.44, u) * (1 - smooth(0.7, 0.78, u));
    const ribPhase = (u * 30 + front * 1.6 - back * 0.4) * Math.PI;
    r += ribMask * (0.017 * ridge(ribPhase, 3) - 0.006) * (1 - Math.pow(back, 3)) * (0.55 + 0.45 * side + 0.3 * front);
    // esterno (quilha estreita)
    r += ribMask * 0.012 * Math.pow(front, 14);
    // vértebras: crista contínua + nós por vértebra
    const spineK = Math.pow(back, 12);
    r += spineK * (0.016 + 0.018 * ridge(u * Math.PI * 34, 4));
    // escápulas
    r += 0.022 * Math.exp(-Math.pow((u - 0.66) / 0.07, 2)) * Math.pow(Math.max(0, back * 1.15 - 0.15), 2) * smooth(0.25, 0.6, side) ;
    // ventre fundo, sob as costelas
    if (u > 0.16 && u < 0.36) r -= 0.03 * front * Math.sin((u - 0.16) / 0.2 * Math.PI);
    // cristas ilíacas
    r += 0.016 * Math.exp(-Math.pow((u - 0.12) / 0.05, 2)) * Math.pow(side, 3);
    // músculos do pescoço (tendões)
    if (u > 0.82) r += 0.008 * ridge(a * 4 + 1.0, 6) * front;
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
  ], { radial: 30, sub: 7, noise: 0.01, extra: torsoBump, uvScale: 1.2 });
  // ----- cabeça alongada, sem olhos, com crânio marcado -----
  skin.tube([
    pt(V(0, 2.74, 0.44), 0.07, mix('neck', 'head', 0.7)),
    pt(V(0, 2.82, 0.5), 0.13, one('head'), 0.95, 1.05),
    pt(V(0, 2.86, 0.6), 0.165, one('head'), 0.9, 1.15),
    pt(V(0, 2.82, 0.74), 0.15, one('head'), 0.8, 1.1),
    pt(V(0, 2.74, 0.88), 0.1, one('head'), 0.75, 1.1),
    pt(V(0, 2.66, 0.97), 0.035, one('head')),
  ], {
    radial: 24, sub: 6, noise: 0.007, extra: (a, u, p, d) => {
      let r = 0;
      if (u > 0.3 && u < 0.6) r -= 0.022 * Math.pow(Math.abs(d.x), 8); // têmporas fundas
      r += 0.01 * Math.pow(Math.max(0, d.y), 10) * ridge(u * 40, 3) * smooth(0.2, 0.4, u); // crista óssea no topo
      return r;
    },
  });
  // cavidades onde seriam olhos (vazias, úmidas)
  for (const s of [1, -1]) { const g = new THREE.SphereGeometry(0.032, 12, 8); g.scale(0.9, 0.6, 0.5); g.translate(s * 0.1, 2.88, 0.7); maw.rigid(g, BI.head); }
  // ----- boca vertical: interior úmido + gengivas + lábios nas mandíbulas + dentes irregulares -----
  { const g = new THREE.SphereGeometry(0.1, 20, 14); g.scale(0.34, 1.3, 0.6); g.rotateX(-0.5); g.translate(0, 2.7, 0.79); maw.rigid(g, BI.head); }
  { const g = new THREE.SphereGeometry(0.04, 10, 8); g.scale(0.6, 1.4, 0.6); g.translate(0, 2.68, 0.76); maw.rigid(g, BI.head); } // garganta
  for (const s of [1, -1]) {
    const jb = s > 0 ? 'jawL' : 'jawR';
    skin.tube([
      pt(V(s * 0.05, 2.84, 0.66), 0.02, one(jb)), pt(V(s * 0.047, 2.79, 0.79), 0.036, one(jb)), pt(V(s * 0.042, 2.67, 0.865), 0.041, one(jb)), pt(V(s * 0.046, 2.56, 0.8), 0.031, one(jb)), pt(V(s * 0.05, 2.52, 0.7), 0.015, one(jb)),
    ], { radial: 12, sub: 4, noise: 0.004 });
    maw.tube([pt(V(s * 0.03, 2.83, 0.68), 0.012, one(jb)), pt(V(s * 0.026, 2.78, 0.8), 0.018, one(jb)), pt(V(s * 0.022, 2.67, 0.85), 0.02, one(jb)), pt(V(s * 0.026, 2.57, 0.79), 0.015, one(jb)), pt(V(s * 0.03, 2.53, 0.71), 0.01, one(jb))], { radial: 10, sub: 4, noise: 0.002 });
    for (let i = 0; i < 13; i++) {
      const t = i / 12;
      const y = 2.825 - t * 0.29, z = 0.72 + Math.sin(t * Math.PI) * 0.13;
      const h = (0.04 + 0.03 * Math.sin(t * Math.PI)) * (0.7 + 0.6 * hash3(i, s, 3));
      const g = new THREE.ConeGeometry(0.0075 + 0.003 * hash3(i, s, 9), h, 5);
      g.translate(0, h / 2, 0); g.rotateZ(-s * (Math.PI / 2 + (hash3(i, s, 1) - 0.5) * 0.5)); g.rotateY((hash3(i, s, 5) - 0.5) * 0.4);
      g.translate(s * 0.024, y, z);
      teeth.rigid(g, BI[jb]);
    }
  }
  // espinhos ósseos nas costas (cristas da coluna)
  for (let i = 0; i < 9; i++) {
    const t = i / 8; const y = 1.9 + t * 0.66, z = -0.12 + t * 0.42;
    const g = new THREE.ConeGeometry(0.019, 0.085 - t * 0.025, 6); g.rotateX(-1.9 + t * 0.4); g.translate(0, y, z - 0.185);
    claw.rigid(g, BI[t < 0.35 ? 'spine1' : t < 0.65 ? 'spine2' : 'chest']);
  }
  // ----- braços longos e tendinosos -----
  const sinew = (a, u, p, d, r0) => 0.18 * r0 * (ridge(a * 3 + u * 2.2, 5) * 0.6 + ridge(a * 5 - 1.3 + u * 1.4, 7) * 0.4) - 0.04 * r0;
  for (const s of [1, -1]) {
    const k = s > 0 ? 'L' : 'R';
    skin.tube([
      pt(V(s * 0.08, 2.5, 0.22), 0.09, mix('chest', 'clav' + k, 0.5)),
      pt(V(s * 0.3, 2.52, 0.2), 0.12, mix('clav' + k, 'upperArm' + k, 0.5), 1, 1.1),
      pt(V(s * 0.4, 2.25, 0.24), 0.092, one('upperArm' + k)),
      pt(V(s * 0.45, 2.0, 0.29), 0.07, one('upperArm' + k)),
      pt(V(s * 0.47, 1.83, 0.33), 0.056, mix('upperArm' + k, 'forearm' + k, 0.5)),
      pt(V(s * 0.485, 1.62, 0.37), 0.07, one('forearm' + k)),
      pt(V(s * 0.5, 1.3, 0.42), 0.046, one('forearm' + k)),
      pt(V(s * 0.5, 1.12, 0.44), 0.038, mix('forearm' + k, 'hand' + k, 0.6), 1.3, 0.8),
      pt(V(s * 0.5, 1.02, 0.465), 0.044, one('hand' + k), 1.55, 0.55),
      pt(V(s * 0.5, 0.965, 0.474), 0.046, one('hand' + k), 1.6, 0.5),
    ], { radial: 18, sub: 7, noise: 0.005, rScale: 0.78, extra: (a, u, p, d, r0) => (u > 0.1 && u < 0.8 ? sinew(a, u, p, d, r0) : 0) });
    // cotovelo ósseo e pulso
    { const g = new THREE.SphereGeometry(0.032, 12, 10); g.scale(1, 1.3, 1); g.translate(s * 0.47, 1.84, 0.3); skin.rigid(g, BI['forearm' + k]); }
    // dedos longos e ossudos: 2 falanges articuladas com nós salientes + garras curvas escuras
    for (let f = 0; f < 4; f++) {
      const K = knuckle(s, f), M = midJoint(s, f), T = tipPt(s, f);
      const a = 'f' + f + 'a' + k, b = 'f' + f + 'b' + k;
      skin.tube([
        pt(K.clone().add(V(0, 0.04, -0.004)), 0.018, one('hand' + k)),
        pt(K, 0.0195, mix('hand' + k, a, 0.7)),
        pt(K.clone().lerp(M, 0.5), 0.0125, one(a)),
        pt(M.clone().add(V(0, 0.008, 0)), 0.0165, mix(a, b, 0.4)),
        pt(M.clone().lerp(T, 0.45), 0.011, one(b)),
        pt(M.clone().lerp(T, 0.8), 0.012, one(b)),
        pt(T, 0.0085, one(b)),
      ], { radial: 9, sub: 3, noise: 0.0015, extra: (aa, u, p, d, r0) => 0.15 * r0 * ridge(aa * 2 + 0.5, 6) });
      claw.tube([pt(T.clone().add(V(0, 0.012, 0)), 0.0085, one(b)), pt(T.clone().add(V(-s * 0.012, -0.035, 0.012)), 0.006, one(b)), pt(T.clone().add(V(-s * 0.035, -0.075, 0.02)), 0.0028, one(b)), pt(T.clone().add(V(-s * 0.055, -0.092, 0.022)), 0.0005, one(b))], { radial: 7, sub: 4, noise: 0 });
    }
    // polegar
    {
      const th = 'thumb' + k, A = BW[th];
      const P1 = A.clone().add(V(-s * 0.012, -0.11, 0.05)), P2 = A.clone().add(V(-s * 0.03, -0.2, 0.075));
      skin.tube([pt(A.clone().add(V(s * 0.004, 0.03, -0.02)), 0.016, one('hand' + k)), pt(A, 0.016, mix('hand' + k, th, 0.6)), pt(A.clone().lerp(P1, 0.5), 0.0105, one(th)), pt(P1, 0.013, one(th)), pt(P2, 0.008, one(th))], { radial: 9, sub: 3, noise: 0.0015 });
      claw.tube([pt(P2.clone().add(V(0, 0.01, 0)), 0.008, one(th)), pt(P2.clone().add(V(-s * 0.015, -0.03, 0.012)), 0.0055, one(th)), pt(P2.clone().add(V(-s * 0.035, -0.06, 0.01)), 0.0006, one(th))], { radial: 7, sub: 4, noise: 0 });
    }
  }
  // ----- pernas digitígradas -----
  for (const s of [1, -1]) {
    const k = s > 0 ? 'L' : 'R';
    skin.tube([
      pt(V(s * 0.16, 1.62, -0.07), 0.15, mix('hips', 'thigh' + k, 0.6), 1, 1.1),
      pt(V(s * 0.18, 1.3, 0.1), 0.14, one('thigh' + k)),
      pt(V(s * 0.2, 1.05, 0.24), 0.088, one('thigh' + k)),
      pt(V(s * 0.2, 0.95, 0.3), 0.072, mix('thigh' + k, 'shin' + k, 0.5)),
      pt(V(s * 0.205, 0.75, 0.16), 0.07, one('shin' + k), 1, 1.2),
      pt(V(s * 0.21, 0.5, -0.04), 0.046, one('shin' + k)),
      pt(V(s * 0.21, 0.36, -0.12), 0.044, mix('shin' + k, 'foot' + k, 0.5)),
      pt(V(s * 0.215, 0.2, 0.0), 0.037, one('foot' + k)),
      pt(V(s * 0.22, 0.07, 0.12), 0.042, mix('foot' + k, 'toes' + k, 0.4), 1.3, 0.8),
    ], { radial: 18, sub: 7, noise: 0.007, rScale: 0.8, extra: (a, u, p, d, r0) => (u > 0.05 && u < 0.85 ? sinew(a, u, p, d, r0) * 0.8 : 0) });
    { const g = new THREE.SphereGeometry(0.045, 12, 10); g.translate(s * 0.2, 0.96, 0.31); skin.rigid(g, BI['shin' + k]); }
    { const g = new THREE.SphereGeometry(0.03, 10, 8); g.scale(1, 1, 1.3); g.translate(s * 0.21, 0.37, -0.15); skin.rigid(g, BI['foot' + k]); } // calcanhar (jarrete)
    for (let t = -1; t <= 1; t++) {
      const tx = s * 0.22 + t * 0.04;
      const tip = V(tx + t * 0.025, 0.025, 0.34);
      skin.tube([pt(V(tx, 0.06, 0.12), 0.024, one('toes' + k)), pt(V(tx + t * 0.02, 0.04, 0.25), 0.017, one('toes' + k)), pt(tip, 0.01, one('toes' + k))], { radial: 8, sub: 3, noise: 0.002 });
      claw.tube([pt(tip.clone().add(V(0, 0.004, -0.01)), 0.01, one('toes' + k)), pt(tip.clone().add(V(0, -0.002, 0.04)), 0.007, one('toes' + k)), pt(tip.clone().add(V(0, -0.02, 0.075)), 0.0008, one('toes' + k))], { radial: 7, sub: 3, noise: 0 });
    }
  }
  return mergeGeometries([skin.build(), claw.build(), maw.build(), teeth.build()], true);
}

// pele pálida fosca: brilho de "sheen" suave (aspecto de pele fina) + leve translucidez no contraluz
function makeSkinMaterial(M) {
  const T = M.T.creatureSkin;
  const mat = new THREE.MeshPhysicalMaterial({
    map: T.map, normalMap: T.normalMap, roughnessMap: T.roughnessMap, vertexColors: true,
    color: 0x9a978c, roughness: 0.88, metalness: 0, normalScale: new THREE.Vector2(0.75, 0.75), envMapIntensity: 0.25,
    sheen: 0.35, sheenRoughness: 0.6, sheenColor: new THREE.Color(0x6e5c56),
  });
  // translucidez barata: luz que passa pelas bordas finas (só existe onde há luz — no escuro continua invisível)
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      { float rimT = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.5);
        reflectedLight.indirectDiffuse += reflectedLight.directDiffuse * rimT * vec3(0.5, 0.26, 0.2) * 0.45; }`);
  };
  return mat;
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
  const skinMat = makeSkinMaterial(M);
  const clawMat = new THREE.MeshStandardMaterial({ color: 0x0e0b09, roughness: 0.42, metalness: 0.0 });
  const mawMat = new THREE.MeshPhysicalMaterial({ color: 0x1c0507, roughness: 0.18, metalness: 0.0, clearcoat: 0.6, clearcoatRoughness: 0.15 });
  const toothMat = new THREE.MeshStandardMaterial({ color: 0xb8a984, roughness: 0.45 });
  const mesh = new THREE.SkinnedMesh(geo, [skinMat, clawMat, mawMat, toothMat]);
  mesh.add(bones[0]);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  const root = new THREE.Group(); root.add(mesh);
  const anim = new CreatureAnimator(bones);
  anim.root = root;
  return { root, mesh, bones, anim, update: (dt, s) => anim.update(dt, s) };
}

// =====================================================================================
// Animação procedural
// =====================================================================================
// mola amortecida (subpassos para estabilidade)
function springStep(st, target, omega, zeta, dt) {
  const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
  for (let i = 0; i < n; i++) { const a = omega * omega * (target - st.x) - 2 * zeta * omega * st.v; st.v += a * h; st.x += st.v * h; }
  return st.x;
}
// parâmetros (ω rad/s, ζ) por osso — ζ < 1 dá leve oscilação orgânica
const SPR = {
  hips: [13, 0.8], spine1: [10, 0.55], spine2: [9.5, 0.5], chest: [9, 0.5], neck: [9, 0.7], head: [11, 0.72],
  jaw: [16, 0.55], clav: [11, 0.65], upperArm: [8.5, 0.55], forearm: [8, 0.5], hand: [10, 0.42], fing: [13, 0.5], thumb: [13, 0.5],
};
const sprOf = (name) => {
  if (name.startsWith('jaw')) return SPR.jaw;
  if (/^f\d/.test(name)) return SPR.fing;
  for (const k in SPR) if (name.startsWith(k)) return SPR[k];
  return [10, 0.7];
};
const LEG = /^(thigh|shin|foot|toes)/;
// estados que se misturam por peso (crossfade ~0,3 s)
const LAYERS = ['hear', 'turn', 'stop', 'sniff', 'inspect', 'look', 'attack', 'kill', 'door', 'recover', 'investigate_walk', 'run'];
// pernas: comprimentos e ângulos de repouso no plano sagital (ψ = ângulo a partir da vertical para baixo, + para frente)
const psiOf = (dy, dz) => Math.atan2(dz, -dy);
const L1 = Math.hypot(0.6, 0.35), L2 = Math.hypot(0.59, 0.42), LF = Math.hypot(0.29, 0.24), LT = Math.hypot(0.045, 0.22);
const PSI_T = psiOf(-0.6, 0.35), PSI_S = psiOf(-0.59, -0.42), PSI_F = psiOf(-0.29, 0.24), PSI_TOE = psiOf(-0.045, 0.22);
const BALL_Y = 0.07;

export class CreatureAnimator {
  constructor(bones) {
    this.b = Object.fromEntries(bones.map(b => [b.name, b]));
    this.rest = Object.fromEntries(bones.map(b => [b.name, b.position.clone()]));
    this.root = null;
    this.t = 0; this.cyc = 0; this.footCb = null;
    this.spr = {}; for (const n in this.b) if (!LEG.test(n) && n !== 'root') this.spr[n] = { x: { x: 0, v: 0 }, y: { x: 0, v: 0 }, z: { x: 0, v: 0 } };
    this.hipOff = { x: { x: 0, v: 0 }, y: { x: 0, v: 0 }, z: { x: 0, v: 0 } };
    this.w = Object.fromEntries(LAYERS.map(k => [k, 0])); this.lt = Object.fromEntries(LAYERS.map(k => [k, 0]));
    this.cur = null; this.first = true;
    this.vel = V(0, 0, 0); this.lastPos = null; this.stillT = 0; this.prevYaw = null; this.yawRate = 0;
    this.prevSpeed = 0; this.lurch = 0; this.twitchT = 1.5; this.jawEvT = 3; this.jawEv = 0; this.jaw = { x: 0, v: 0 };
    this.feet = { L: this.newFoot(1), R: this.newFoot(-1) };
    this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.m4 = new THREE.Matrix4(); this.tmp = V(0, 0, 0); this.tmp2 = V(0, 0, 0);
    this.idleStepCd = 0;
  }
  newFoot(s) { return { s, x: s * 0.22, z: 0.12, y: BALL_Y, planted: true, sw: null, psi: PSI_F, toe: PSI_TOE, prevF: 0 }; }
  restFoot(f) { return { x: f.s * 0.21, z: 0.1 }; }
  // s: {anim, animT, speed, headYaw, headPitch, yaw, duck, vx, vz, turn}
  update(dt, s = {}) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    if (dt <= 0) return;
    this.t += dt;
    const t = this.t, b = this.b;
    const anim = s.anim || 'idle';
    const yaw = s.yaw ?? (this.root ? this.root.rotation.y : 0);
    // ---------- movimento real (pés plantados exigem a velocidade verdadeira) ----------
    let dyaw = 0;
    if (this.prevYaw !== null) dyaw = wrapA(yaw - this.prevYaw);
    this.prevYaw = yaw;
    const yr = typeof s.turn === 'number' ? s.turn : dyaw / dt;
    this.yawRate += (yr - this.yawRate) * Math.min(1, dt * 8);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    let lv = null; // velocidade local (x lateral, z frente)
    if (this.root) {
      const p = this.root.position;
      if (this.lastPos) {
        const dx = p.x - this.lastPos.x, dz = p.z - this.lastPos.z;
        if (Math.hypot(dx, dz) > 2.5) { this.resetFeet(); } // teleporte
        else if (Math.hypot(dx, dz) > 1e-5) { lv = V((dx * cy - dz * sy) / dt, 0, (dx * sy + dz * cy) / dt); this.stillT = 0; }
        else this.stillT += dt;
      }
      this.lastPos = (this.lastPos || V(0, 0, 0)).copy(p);
    }
    if (!lv) {
      if (this.root && this.stillT < 0.25 && this.lastPos && !this.first) lv = this.vel.clone().multiplyScalar(Math.max(0, 1 - dt * 10)); // lacuna curta entre snapshots
      else if (typeof s.vx === 'number' && typeof s.vz === 'number' && (s.vx || s.vz)) lv = V(s.vx * cy - s.vz * sy, 0, s.vx * sy + s.vz * cy);
      else lv = V(0, 0, s.speed || 0); // esteira virtual (laboratório / tela de carregamento)
    }
    this.vel.lerp(lv, Math.min(1, dt * 9));
    const v = Math.hypot(this.vel.x, this.vel.z);
    // parada repentina → impulso de inércia
    if (this.prevSpeed > 2.0 && v < this.prevSpeed - 3.5 * dt) this.lurch = Math.max(this.lurch, Math.min(1, (this.prevSpeed - v) / (dt * 9)));
    this.prevSpeed = v;
    // ---------- pesos das camadas ----------
    if (anim !== this.cur) { this.cur = anim; if (this.lt[anim] !== undefined) this.lt[anim] = s.animT || 0; if (anim === 'stop') this.kickStop(); if (anim === 'hear' || anim === 'turn') this.kickHear(); }
    for (const k of LAYERS) {
      const on = k === anim || (k === 'run' && anim === 'run');
      this.w[k] = clamp(this.w[k] + (on ? dt : -dt) / 0.3, 0, 1);
      this.lt[k] += dt;
    }
    const W = (k) => { const x = this.w[k]; return x * x * (3 - 2 * x); };
    if (this.first) { for (const k of LAYERS) this.w[k] = k === anim ? 1 : 0; }
    // ---------- marcha ----------
    const rf = smooth(2.2, 3.8, v);           // fator de corrida (pela velocidade real)
    const inv = W('investigate_walk');
    const gw = smooth(0.12, 0.8, v);          // peso da locomoção
    const stride = (1.25 + 0.42 * v) * (1 - 0.15 * inv);
    const duty = lerp(0.62, 0.38, rf);
    const lift = lerp(0.13, 0.3, rf) * (1 - 0.35 * inv) * (0.4 + 0.6 * gw);
    const zc = lerp(0.12, 0.3, rf);
    const S = duty * stride;
    const T = v > 0.05 ? stride / v : 99;
    // esteira: pés plantados recuam com o corpo e giram com ele
    const ca = Math.cos(-dyaw), sa = Math.sin(-dyaw);
    for (const k of ['L', 'R']) {
      const f = this.feet[k];
      if (f.planted) {
        f.x -= this.vel.x * dt; f.z -= this.vel.z * dt;
        const x = f.x * ca + f.z * sa, z = -f.x * sa + f.z * ca; // gira em torno da raiz
        f.x = x; f.z = z;
      }
    }
    const moving = v > 0.25;
    if (moving) this.cyc += dt / T;
    for (const k of ['L', 'R']) {
      const f = this.feet[k], other = this.feet[k === 'L' ? 'R' : 'L'];
      const fr = ((this.cyc + (k === 'L' ? 0 : 0.5)) % 1 + 1) % 1;
      if (moving && f.planted) {
        const cross = (f.prevF < duty && fr >= duty) || (f.prevF > fr && duty >= 0.999);
        const tooFar = Math.abs(f.z - zc) > S * 0.5 + 0.35 || Math.abs(f.x - f.s * 0.2) > 0.4;
        if ((cross || tooFar) && (other.planted || rf > 0.5)) {
          const dur = clamp((1 - duty) * T, 0.16, 0.7);
          const tgt = V(f.s * lerp(0.21, 0.15, rf) + this.vel.x * duty * T * 0.5, BALL_Y, zc + S * 0.5);
          const rot = this.yawRate * duty * T * 0.5; // antecipa o giro
          const tx = tgt.x * Math.cos(rot) + tgt.z * Math.sin(rot), tz = -tgt.x * Math.sin(rot) + tgt.z * Math.cos(rot);
          this.liftFoot(f, tx, tz, dur, lift, rf);
        }
      }
      f.prevF = fr;
    }
    // parado: passos de acomodação e de giro no lugar
    this.idleStepCd -= dt;
    if (!moving && this.idleStepCd <= 0 && this.feet.L.planted && this.feet.R.planted) {
      let best = null, be = 0.14;
      for (const k of ['L', 'R']) { const f = this.feet[k], r = this.restFoot(f); const e = Math.hypot(f.x - r.x, f.z - r.z); if (e > be) { be = e; best = f; } }
      if (best) { const r = this.restFoot(best); this.liftFoot(best, r.x, r.z, 0.42, 0.11, 0); this.idleStepCd = 0.1; }
    }
    // balanço dos pés no ar
    for (const k of ['L', 'R']) {
      const f = this.feet[k];
      if (!f.sw) continue;
      const w = f.sw; w.u = Math.min(1, w.u + dt / w.dur);
      const u = w.u, u2 = u * u, u3 = u2 * u;
      const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
      const mz = -this.vel.z * w.dur * 0.45, mx = -this.vel.x * w.dur * 0.45;
      f.z = h00 * w.z0 + h10 * mz + h01 * w.z1 + h11 * mz;
      f.x = h00 * w.x0 + h10 * mx + h01 * w.x1 + h11 * mx;
      f.y = BALL_Y + w.h * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.85)), 1.0);
      f.psi = lerp(w.psi0, PSI_F + 0.18, u) - (0.55 + w.run * 0.3) * Math.sin(Math.PI * u);
      f.toe = PSI_TOE - (0.7 + w.run * 0.3) * Math.sin(Math.PI * Math.min(1, u * 1.15));
      if (u >= 1) { f.sw = null; f.planted = true; f.y = BALL_Y; if (this.footCb && !this.first) this.footCb(f.s > 0 ? 'L' : 'R', w.run); }
    }
    for (const k of ['L', 'R']) {
      const f = this.feet[k];
      if (f.planted) {
        const rel = clamp((f.z - zc) / (S * 0.5 + 0.05), -1.3, 1.3);
        const tgt = PSI_F + (rel > 0 ? 0.18 * rel : 0.42 * rel) * (0.5 + 0.5 * gw) - rf * 0.1;
        f.psi += (tgt - f.psi) * Math.min(1, dt * 14); f.toe += (PSI_TOE - f.toe) * Math.min(1, dt * 20);
      }
    }
    // ---------- pose-alvo do corpo ----------
    const P = {};
    for (const n in this.spr) P[n] = { x: 0, y: 0, z: 0 };
    const hip = { x: 0, y: 0, z: 0 };
    const ph = this.cyc * Math.PI * 2;
    const cL = Math.cos(ph);                     // >0: perna esquerda à frente
    const mid = Math.cos(2 * (ph - Math.PI * duty)); // 2x por ciclo: meio do apoio
    // postura base curvada
    P.spine1.x = 0.24; P.spine2.x = 0.16; P.chest.x = 0.12; P.neck.x = -0.3; P.head.x = -0.02;
    P.clavL.z = -0.08; P.clavR.z = 0.08;
    P.upperArmL.z = -0.04; P.upperArmR.z = 0.04;
    P.forearmL.x = -0.2; P.forearmR.x = -0.2;
    P.handL.x = -0.1; P.handR.x = -0.1;
    // balanço vertical (andar: alto no meio do apoio; correr: baixo), lateral e torções
    hip.y += mid * lerp(0.03, -0.06, rf) * gw - rf * 0.16 - inv * 0.05;
    const sideSw = Math.cos(ph - Math.PI * duty);
    hip.x += sideSw * 0.035 * gw * (1 - rf * 0.6);
    P.hips.z = sideSw * 0.07 * gw * (1 - rf * 0.4);
    P.hips.y = -cL * lerp(0.13, 0.2, rf) * gw;
    P.spine1.y = cL * 0.04 * gw; P.spine2.y = cL * 0.08 * gw; P.chest.y = cL * lerp(0.1, 0.16, rf) * gw;
    P.spine1.z = -sideSw * 0.04 * gw; P.chest.z = -sideSw * 0.05 * gw; P.neck.z = sideSw * 0.05 * gw; // ondulação da coluna
    P.neck.y = -cL * 0.06 * gw; // a cabeça se estabiliza contra a torção do tronco
    // braços opostos às pernas
    const armA = lerp(0.32, 0.95, rf) * gw * (1 - 0.4 * inv);
    P.upperArmL.x += cL * armA; P.upperArmR.x -= cL * armA;
    P.forearmL.x -= Math.max(0, -cL) * lerp(0.3, 0.6, rf) * gw; P.forearmR.x -= Math.max(0, cL) * lerp(0.3, 0.6, rf) * gw;
    P.handL.x += Math.sin(ph) * 0.18 * gw; P.handR.x -= Math.sin(ph) * 0.18 * gw;
    // corrida: curvada, investindo, braços bombeando
    P.spine1.x += rf * 0.42; P.spine2.x += rf * 0.16; P.chest.x += rf * 0.04; P.neck.x -= rf * 0.38; P.head.x -= rf * 0.22;
    P.forearmL.x -= rf * 0.75; P.forearmR.x -= rf * 0.75; P.upperArmL.z -= rf * 0.22; P.upperArmR.z += rf * 0.22;
    P.spine1.x += mid * 0.05 * rf; // investida a cada passada
    // ---------- respiração (caixa torácica e ombros) ----------
    const brRate = lerp(0.85, 2.1, Math.max(rf, W('recover') * 0.9, W('kill') * 0.7));
    this.brPh = (this.brPh || 0) + dt * brRate * Math.PI * 2;
    const br = Math.sin(this.brPh), brAmp = lerp(1, 1.8, Math.max(rf, W('recover')));
    P.chest.x -= br * 0.03 * brAmp; P.spine2.x -= br * 0.012 * brAmp; P.clavL.z -= br * 0.03 * brAmp; P.clavR.z += br * 0.03 * brAmp; P.neck.x += br * 0.02 * brAmp;
    const chestScale = 1 + (br * 0.5 + 0.5) * 0.035 * brAmp;
    // ---------- cabeça: lidera, varre devagar, espasmos ----------
    const hy = s.headYaw || 0, hp = s.headPitch || 0;
    const scanW = (1 - rf) * (1 - W('attack')) * (1 - W('kill')) * (0.5 + 0.5 * (1 - gw) + W('look'));
    const scanY = n1(t * 0.22, 1) * 0.42 * scanW + n1(t * 0.9, 2) * 0.05;
    const scanP = n1(t * 0.17, 3) * 0.12 * scanW;
    const lead = clamp(this.yawRate * 0.28, -0.55, 0.55);
    P.neck.y += hy * 0.4 + scanY * 0.4 + lead * 0.45; P.head.y += hy * 0.6 + scanY * 0.6 + lead * 0.55;
    P.neck.x += -hp * 0.5 + scanP * 0.4; P.head.x += -hp * 0.5 + scanP * 0.6;
    P.head.z += n1(t * 0.31, 4) * 0.08 * scanW;
    P.spine2.y += hy * 0.12 + lead * 0.3; P.chest.y += hy * 0.08 + lead * 0.2;
    // espasmos ocasionais (impulsos de velocidade nas molas)
    this.twitchT -= dt;
    if (this.twitchT <= 0) {
      this.twitchT = 1.6 + hash3(t, 1, 2) * 4.2 * (1 - rf * 0.7);
      const sg = hash3(t, 3, 4) < 0.5 ? -1 : 1;
      this.spr.head.z.v += sg * (2.2 + hash3(t, 5, 6) * 2.5); this.spr.head.y.v += (hash3(t, 7, 8) - 0.5) * 4; this.spr.neck.x.v += (hash3(t, 9, 1) - 0.4) * 2;
      for (const kk of ['L', 'R']) for (let f = 0; f < 4; f++) if (hash3(t, f, kk === 'L' ? 1 : 2) < 0.5) this.spr['f' + f + 'a' + kk].z.v += (kk === 'L' ? 1 : -1) * (hash3(t, f, 7) * 6 - 2);
    }
    // ---------- dedos: curvatura orgânica em onda ----------
    let curl = 0.42 + rf * 0.3 + inv * 0.1;
    // ---------- mandíbula ----------
    let jaw = rf * 0.22 + rf * 0.08 * Math.abs(Math.sin(this.brPh * 0.5));
    this.jawEvT -= dt;
    if (this.jawEvT <= 0) { this.jawEvT = 3 + hash3(t, 2, 9) * 6; this.jawEv = 1; }
    this.jawEv = Math.max(0, this.jawEv - dt * 0.9);
    jaw += Math.sin(this.jawEv * Math.PI) * 0.14 * (1 - rf) + Math.sin(this.jawEv * Math.PI * 7) * 0.02 * this.jawEv;
    // ---------- camadas de estado ----------
    const lt = this.lt;
    let w;
    if ((w = W('investigate_walk'))) {
      P.spine1.x += 0.18 * w; P.spine2.x += 0.06 * w; P.neck.x += 0.2 * w; P.head.x += 0.12 * w;
      P.head.y += Math.sin(t * 0.8) * 0.22 * w; P.head.z += Math.sin(t * 0.8 + 1) * 0.1 * w;
      P.upperArmR.x -= 0.3 * w; P.forearmR.x -= 0.35 * w; curl -= 0.1 * w;
      const sn = Math.max(0, Math.sin(t * 7.5)) * (Math.sin(t * 0.9) > 0.3 ? 1 : 0); P.head.x -= sn * 0.04 * w; // fungadas curtas
    }
    if ((w = W('hear'))) {
      const at = lt.hear, k = smooth(0, 0.12, at);
      P.clavL.z -= 0.18 * k * w; P.clavR.z += 0.18 * k * w; P.spine1.x -= 0.08 * k * w; P.neck.x -= 0.12 * w;
      P.head.z += 0.22 * Math.sin(clamp(at * 2.5, 0, 1) * Math.PI) * w;
      P.upperArmL.z -= 0.12 * w; P.upperArmR.z += 0.12 * w; curl -= 0.35 * w;
      jaw += (at < 0.7 ? 0.16 * Math.abs(Math.sin(t * 30)) : 0.04) * w;
    }
    if ((w = W('turn'))) {
      P.clavL.z -= 0.12 * w; P.clavR.z += 0.12 * w; P.spine1.x += 0.1 * w; hip.y -= 0.06 * w; curl -= 0.25 * w;
      jaw += (lt.turn < 0.5 ? 0.14 * Math.abs(Math.sin(t * 28)) : 0.05) * w;
    }
    if ((w = W('stop'))) { hip.y -= 0.05 * w; curl += 0.15 * w; }
    if ((w = W('sniff'))) {
      const per = 0.4, k = (lt.sniff % per) / per, cnt = Math.floor(lt.sniff / per) % 5;
      const jerk = cnt < 3 && k < 0.3 ? Math.sin(k / 0.3 * Math.PI) : 0;
      P.spine1.x += 0.12 * w; P.neck.x -= (0.28 + jerk * 0.1) * w; P.head.x -= (0.32 + jerk * 0.12) * w; // ergue o focinho
      P.chest.x -= jerk * 0.05 * w; P.clavL.z -= jerk * 0.04 * w; P.clavR.z += jerk * 0.04 * w;
      P.head.y += n1(t * 0.6, 8) * 0.3 * w; jaw += (0.04 + jerk * 0.06) * w;
      P.upperArmL.x -= 0.12 * w; P.upperArmR.x -= 0.12 * w;
    }
    if ((w = W('inspect'))) {
      P.spine1.x += 0.42 * w; P.spine2.x += 0.22 * w; P.neck.x += 0.12 * w; P.head.z += 0.25 * w; hip.y -= 0.18 * w;
      P.upperArmR.x -= (1.05 + Math.sin(t * 1.5) * 0.15) * w; P.forearmR.x -= 0.45 * w; P.handR.x -= 0.3 * w;
      curl += (0.2 + 0.35 * Math.abs(Math.sin(t * 2))) * w;
    }
    if ((w = W('look'))) { P.spine2.y += (hy * 0.2 + scanY * 0.3) * w; P.head.z += Math.sin(t * 0.7) * 0.1 * w; }
    if ((w = W('attack'))) {
      const at = lt.attack;
      const wind = smooth(0, 0.25, at), strike = smooth(0.25, 0.42, at), rec = smooth(0.55, 0.9, at);
      const up = wind * (1 - strike);
      P.upperArmL.x -= (2.3 * up + 0.95 * strike * (1 - rec)) * w; P.upperArmR.x -= (2.3 * up + 0.95 * strike * (1 - rec)) * w;
      P.upperArmL.z -= 0.5 * up * w; P.upperArmR.z += 0.5 * up * w;
      P.forearmL.x -= 0.6 * up * w; P.forearmR.x -= 0.6 * up * w;
      P.spine1.x += (-0.18 * up + 0.6 * strike * (1 - rec)) * w; P.spine2.x += 0.2 * strike * w; P.neck.x -= 0.2 * strike * w;
      hip.z += (0.38 * strike * (1 - rec) - 0.08 * up) * w; hip.y -= (0.22 * strike * (1 - rec) + 0.06 * up) * w; // investida
      curl += (0.7 * strike - 0.3 * up) * w; jaw += (0.4 + 0.35 * wind) * w;
    }
    if ((w = W('kill'))) {
      P.spine1.x += 0.6 * w; P.spine2.x += 0.3 * w; P.chest.x += 0.15 * w; P.neck.x += 0.3 * w;
      P.head.x += (0.25 + Math.max(0, Math.sin(t * 6)) * 0.12) * w; P.head.z += Math.sin(t * 3.1) * 0.15 * w;
      P.upperArmL.x -= 1.1 * w; P.upperArmR.x -= 1.1 * w; P.forearmL.x -= 0.6 * w; P.forearmR.x -= 0.6 * w;
      hip.y -= 0.42 * w; hip.z += 0.1 * w; curl += 0.9 * w;
      jaw += (0.4 + 0.2 * Math.abs(Math.sin(t * 5))) * w;
    }
    if ((w = W('door'))) { P.upperArmR.x -= 1.45 * w; P.forearmR.x -= 0.15 * w; P.spine1.x += 0.25 * w; curl -= 0.25 * w; P.handR.x -= 0.4 * w; }
    if ((w = W('recover'))) { P.neck.x += 0.22 * w; P.spine1.x += 0.12 * w; hip.y -= 0.04 * w; jaw += (0.12 + 0.08 * Math.sin(this.brPh)) * w; }
    // inércia da parada repentina (sobressalto amortecido)
    this.lurch = Math.max(0, this.lurch - dt * 1.8);
    // abaixa ao passar por portas
    const duck = s.duck || 0;
    P.spine1.x += duck * 0.35; P.neck.x -= duck * 0.15; hip.y -= duck * 0.14;
    // dedos (onda do indicador ao mindinho) e polegar
    for (const k of ['L', 'R']) {
      const sg = k === 'L' ? 1 : -1;
      for (let f = 0; f < 4; f++) {
        const c = curl + 0.12 * n1(t * 0.7 + f * 0.37, k === 'L' ? 11 : 12) + f * 0.04;
        P['f' + f + 'a' + k].z = -sg * c * 0.8; P['f' + f + 'b' + k].z = -sg * c * 1.15;
        P['f' + f + 'a' + k].x = (f - 1.5) * 0.1 * (1.1 - curl);
      }
      P['thumb' + k].z = -sg * (curl * 0.6 + 0.1); P['thumb' + k].x = -0.15;
    }
    // ---------- molas → ossos ----------
    if (this.first) for (const n in this.spr) for (const a of ['x', 'y', 'z']) { this.spr[n][a].x = P[n][a]; this.spr[n][a].v = 0; }
    const hearSnap = Math.max(W('hear'), W('turn'));
    for (const n in this.spr) {
      let [om, ze] = sprOf(n);
      if (n === 'head' || n === 'neck') om *= 1 + hearSnap * 1.2; // cabeça "estala" na direção do som
      if (anim === 'attack') om *= 1.6;
      const st = this.spr[n];
      const x = springStep(st.x, P[n].x, om, ze, dt), y = springStep(st.y, P[n].y, om, ze, dt), z = springStep(st.z, P[n].z, om, ze, dt);
      this.e.set(x, y, z, 'XYZ'); b[n].quaternion.setFromEuler(this.e);
    }
    this.jaw.x = Math.max(0, springStep(this.jaw, jaw, SPR.jaw[0], SPR.jaw[1], dt));
    b.jawL.quaternion.setFromEuler(this.e.set(0, this.jaw.x, 0)); b.jawR.quaternion.setFromEuler(this.e.set(0, -this.jaw.x, 0));
    // caixa torácica expande; filhos compensam para não crescer
    b.chest.scale.set(chestScale, 1, chestScale * 1.02);
    for (const n of ['neck', 'clavL', 'clavR']) b[n].scale.set(1 / chestScale, 1, 1 / (chestScale * 1.02));
    if (this.first) { this.hipOff.x.x = hip.x; this.hipOff.y.x = hip.y; this.hipOff.z.x = hip.z; }
    const hx = springStep(this.hipOff.x, hip.x, 12, 0.75, dt), hyy = springStep(this.hipOff.y, hip.y, 12, 0.7, dt), hz = springStep(this.hipOff.z, hip.z, 11, 0.7, dt);
    b.hips.position.set(this.rest.hips.x + hx, this.rest.hips.y + hyy, this.rest.hips.z + hz);
    // ---------- IK das pernas ----------
    b.hips.updateMatrix();
    this.m4.copy(b.hips.matrix).invert();
    for (const k of ['L', 'R']) this.solveLeg(k, this.feet[k]);
    this.first = false;
  }
  kickStop() { if (this.spr.spine1) { this.spr.spine1.x.v += 2.6; this.spr.spine2.x.v += 1.8; this.spr.neck.x.v -= 2.2; this.spr.head.x.v -= 1.5; this.spr.upperArmL.x.v -= 3; this.spr.upperArmR.x.v -= 3; } }
  kickHear() { if (this.spr.head) { this.spr.clavL.z.v -= 2; this.spr.clavR.z.v += 2; this.spr.spine1.x.v -= 1.2; } }
  resetFeet() { for (const k of ['L', 'R']) Object.assign(this.feet[k], this.newFoot(k === 'L' ? 1 : -1)); }
  liftFoot(f, x1, z1, dur, h, run) { f.planted = false; f.sw = { u: 0, dur, x0: f.x, z0: f.z, x1, z1, h, psi0: f.psi, run }; }
  solveLeg(k, f) {
    const b = this.b, s = f.s;
    // ponto da bola do pé e jarrete (mundo da malha) → espaço local do quadril
    const ball = this.tmp.set(f.x, f.y, f.z);
    const hock = this.tmp2.set(f.x + 0.01 * s, f.y + Math.cos(f.psi) * LF, f.z - Math.sin(f.psi) * LF);
    const toeTip = V(f.x, f.y - Math.cos(f.toe) * LT, f.z + Math.sin(f.toe) * LT);
    ball.applyMatrix4(this.m4); hock.applyMatrix4(this.m4); toeTip.applyMatrix4(this.m4);
    const hp = this.rest['thigh' + k]; // junta do quadril no espaço do quadril
    const Dx = hock.x - hp.x, Dy = hock.y - hp.y, Dz = hock.z - hp.z;
    const d = clamp(Math.hypot(Dy, Dz), Math.abs(L1 - L2) + 1e-3, (L1 + L2) * 0.999);
    const psiD = Math.atan2(Dz, -Dy);
    const alpha = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    const psiT = psiD + alpha;
    const ky = hp.y - Math.cos(psiT) * L1, kz = hp.z + Math.sin(psiT) * L1;
    const psiS = Math.atan2(hock.z - kz, -(hock.y - ky));
    const psiF = Math.atan2(ball.z - hock.z, -(ball.y - hock.y));
    const psiToe = Math.atan2(toeTip.z - ball.z, -(toeTip.y - ball.y));
    const tx = -(psiT - PSI_T), sx = -(psiS - PSI_S) - tx, fx = -(psiF - PSI_F) - tx - sx, toex = -(psiToe - PSI_TOE) - tx - sx - fx;
    const gam = Math.atan2(Dx, -Dy) - Math.atan2(s * 0.04, 1.19);
    b['thigh' + k].quaternion.setFromEuler(this.e.set(tx, 0, clamp(gam, -0.5, 0.5), 'XYZ'));
    b['shin' + k].quaternion.setFromEuler(this.e.set(sx, 0, 0, 'XYZ'));
    b['foot' + k].quaternion.setFromEuler(this.e.set(fx, 0, 0, 'XYZ'));
    b['toes' + k].quaternion.setFromEuler(this.e.set(toex, 0, 0, 'XYZ'));
  }
}
