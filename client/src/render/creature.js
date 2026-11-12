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
// v9: coluna em 4 segmentos (spine1, spine2, spine3, chest) e pescoço em 2 (neck, neck2) — a ondulação sobe
// vértebra por vértebra; dedos com 3 falanges; as FILHAS fundidas ao tronco: dois rostinhos meio enterrados na pele
// (kidHeadA no peito, kidHeadB nas costas) e dois braços pequenos (kidA no flanco esquerdo, kidB nas costas, à
// direita), com ombro, cotovelo e punho próprios. Pontos costurados em volta de cada emenda.
const J = {
  root: V(0, 0, 0), hips: V(0, 1.62, -0.05), spine1: V(0, 1.88, 0.0), spine2: V(0, 2.15, 0.1), spine3: V(0, 2.28, 0.16), chest: V(0, 2.4, 0.22),
  neck: V(0, 2.62, 0.36), neck2: V(0, 2.71, 0.43), head: V(0, 2.8, 0.5),
};
const BONES = [
  ['root', null, J.root], ['hips', 'root', J.hips], ['spine1', 'hips', J.spine1], ['spine2', 'spine1', J.spine2], ['spine3', 'spine2', J.spine3], ['chest', 'spine3', J.chest],
  ['neck', 'chest', J.neck], ['neck2', 'neck', J.neck2], ['head', 'neck2', J.head],
  ['jawL', 'head', V(0.045, 2.72, 0.66)], ['jawR', 'head', V(-0.045, 2.72, 0.66)],
];
// filhas: ombro → cotovelo → punho (posições de ligação, ajustadas à superfície do tronco em buildGeometry)
const KID = {
  A: { parent: 'spine2', sh: V(0.14, 2.05, 0.37), d1: V(0.55, -0.45, 0.7), d2: V(0.12, -0.6, 0.8), n: V(0.71, -0.49, 0.52) },
  B: { parent: 'spine3', sh: V(-0.13, 2.29, -0.12), d1: V(-0.6, -0.3, -0.7), d2: V(-0.25, -0.8, -0.45), n: V(-0.74, 0, -0.68) },
};
for (const k in KID) { const q = KID[k]; q.el = q.sh.clone().addScaledVector(q.d1.normalize(), 0.23); q.wr = q.el.clone().addScaledVector(q.d2.normalize(), 0.21); }
const KIDFACE = {
  A: { parent: 'spine2', c: V(-0.035, 2.135, 0.512), n: V(-0.12, 0.08, 0.99), r: 0.095, scream: false },
  B: { parent: 'chest', c: V(0.1, 2.343, -0.178), n: V(0.54, 0.11, -0.84), r: 0.09, scream: true },
};
for (const k of ['A', 'B']) { const q = KID[k]; BONES.push(['kid' + k + '1', q.parent, q.sh], ['kid' + k + '2', 'kid' + k + '1', q.el], ['kid' + k + '3', 'kid' + k + '2', q.wr]); }
BONES.push(['kidHeadA', KIDFACE.A.parent, KIDFACE.A.c], ['kidHeadB', KIDFACE.B.parent, KIDFACE.B.c]);
// dedos: 4 por mão, 2 falanges articuladas cada (articulações = nós dos dedos), mais o polegar
const FING = [0, 1, 2, 3].map(f => ({ len: [0.37, 0.41, 0.39, 0.32][f], z: 0.474 + (1.5 - f) * 0.025, xo: 0.004 * Math.abs(f - 1.5) }));
const knuckle = (s, f) => V(s * (0.5 + FING[f].xo), 0.965, FING[f].z);
const midJoint = (s, f) => { const k = knuckle(s, f), L = FING[f].len; return V(k.x - s * 0.012, k.y - L * 0.46, k.z + 0.012); };
const tipPt = (s, f) => { const k = knuckle(s, f), L = FING[f].len; return V(k.x - s * 0.03, k.y - L, k.z + 0.03); };
const distJoint = (s, f) => midJoint(s, f).lerp(tipPt(s, f), 0.55); // v9: 3ª falange
for (const s of [1, -1]) {
  const k = s > 0 ? 'L' : 'R';
  BONES.push(['clav' + k, 'chest', V(s * 0.1, 2.5, 0.24)], ['upperArm' + k, 'clav' + k, V(s * 0.36, 2.48, 0.2)], ['forearm' + k, 'upperArm' + k, V(s * 0.47, 1.83, 0.33)],
    ['hand' + k, 'forearm' + k, V(s * 0.5, 1.12, 0.44)]);
  for (let f = 0; f < 4; f++) BONES.push(['f' + f + 'a' + k, 'hand' + k, knuckle(s, f)], ['f' + f + 'b' + k, 'f' + f + 'a' + k, midJoint(s, f)], ['f' + f + 'c' + k, 'f' + f + 'b' + k, distJoint(s, f)]);
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
let LO = false; // v9: geração do nível de detalhe baixo (LOD) — menos anéis/lados, sem dentes de dentro/palato/costuras
class SkinBuilder {
  constructor() { this.parts = []; }
  tube(pts, { radial = 16, sub = 4, noise = 0.012, cap = true, uvScale = 1.5, extra, rScale = 1 } = {}) {
    if (LO) { radial = Math.max(5, Math.round(radial * 0.45)); sub = Math.max(1, Math.round(sub * 0.45)); }
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
    const q = new THREE.Vector3(), cv = geo.attributes.cav;
    for (let i = 0; i < n; i++) {
      si[i * 4] = bone; sw[i * 4] = 1;
      q.fromBufferAttribute(geo.attributes.position, i);
      const c = vertexTint(q, 0.06, 0), k = tint * (cv ? 1 - cv.getX(i) : 1); col[i * 3] = c[0] * k; col[i * 3 + 1] = c[1] * k * (cv ? 1 - cv.getX(i) * 0.15 : 1); col[i * 3 + 2] = c[2] * k * (cv ? 1 - cv.getX(i) * 0.2 : 1);
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

function buildGeometry(lo = false) {
  LO = lo;
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
    pt(J.spine2, 0.24, mix('spine2', 'spine3', 0.3), 1.32, 0.88),
    pt(J.chest, 0.27, mix('spine3', 'chest', 0.8), 1.35, 0.85),
    pt(V(0, 2.52, 0.28), 0.22, mix('chest', 'neck', 0.2), 1.3, 0.85),
    pt(J.neck, 0.11, mix('chest', 'neck', 0.7), 1, 1),
    pt(V(0, 2.72, 0.44), 0.085, mix('neck', 'neck2', 0.75), 1, 1.1),
  ], { radial: 30, sub: 7, noise: 0.01, extra: torsoBump, uvScale: 1.2 });
  const torsoG = skin.parts[skin.parts.length - 1];
  // v9: ponto da superfície do tronco mais perto de p (+ normal) — encaixa rostos, braços e costuras na pele
  const surf = (p) => {
    const P = torsoG.attributes.position, N = torsoG.attributes.normal; let bi = 0, bd = 1e9;
    for (let i = 0; i < P.count; i++) { const d = (P.getX(i) - p.x) ** 2 + (P.getY(i) - p.y) ** 2 + (P.getZ(i) - p.z) ** 2; if (d < bd) { bd = d; bi = i; } }
    return { p: V(P.getX(bi), P.getY(bi), P.getZ(bi)), n: V(N.getX(bi), N.getY(bi), N.getZ(bi)).normalize() };
  };
  if (typeof globalThis !== 'undefined' && globalThis.__crSurf) globalThis.__crSurf(surf);
  // ----- cabeça alongada, sem olhos, com crânio marcado -----
  skin.tube([
    pt(V(0, 2.74, 0.44), 0.07, mix('neck2', 'head', 0.6)),
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
  // cavidades onde seriam olhos (vazias, úmidas) (v2 fase 2: um pouco maiores)
  for (const s of [1, -1]) { const g = new THREE.SphereGeometry(0.036, 12, 8); g.scale(0.9, 0.6, 0.5); g.translate(s * 0.1, 2.88, 0.7); maw.rigid(g, BI.head); }
  // ----- boca vertical: interior úmido + gengivas + lábios nas mandíbulas + dentes irregulares -----
  { const g = new THREE.SphereGeometry(0.1, 24, 16); g.scale(0.42, 1.38, 0.62); g.rotateX(-0.5); g.translate(0, 2.7, 0.785); maw.rigid(g, BI.head); }
  { const g = new THREE.SphereGeometry(0.04, 10, 8); g.scale(0.6, 1.4, 0.6); g.translate(0, 2.68, 0.76); maw.rigid(g, BI.head); } // garganta
  for (const s of [1, -1]) {
    const jb = s > 0 ? 'jawL' : 'jawR';
    skin.tube([
      pt(V(s * 0.056, 2.84, 0.66), 0.02, one(jb)), pt(V(s * 0.056, 2.79, 0.785), 0.029, one(jb)), pt(V(s * 0.052, 2.67, 0.855), 0.032, one(jb)), pt(V(s * 0.055, 2.56, 0.795), 0.025, one(jb)), pt(V(s * 0.058, 2.52, 0.7), 0.014, one(jb)),
    ], { radial: 14, sub: 5, noise: 0.006, extra: (a, u) => 0.004 * ridge(u * 60, 4) }); // v2 fase 2: lábios finos, repuxados e enrugados — gengiva e dentes à mostra
    // gengiva grossa e úmida ao longo da borda interna de cada mandíbula
    maw.tube([pt(V(s * 0.034, 2.835, 0.675), 0.013, one(jb)), pt(V(s * 0.03, 2.785, 0.795), 0.02, one(jb)), pt(V(s * 0.027, 2.67, 0.852), 0.022, one(jb)), pt(V(s * 0.03, 2.57, 0.795), 0.017, one(jb)), pt(V(s * 0.034, 2.53, 0.712), 0.011, one(jb))], { radial: 12, sub: 5, noise: 0.003 });
    // v2 fase 2 — DENTES refeitos: antes apontavam para FORA da boca ("dente versando"). Agora nascem
    // enterrados na gengiva e apontam para DENTRO (em direção ao meio da boca) e um pouco para a frente,
    // levemente curvos, em duas fileiras: a de fora com presas maiores nas pontas, a de dentro com
    // dentinhos serrilhados. Os dois lados ficam intercalados para se encaixarem quando a boca fecha.
    const mouthAt = (t) => ({ y: 2.825 - t * 0.29, z: 0.72 + Math.sin(t * Math.PI) * 0.13 });
    for (const row of (LO ? [0] : [0, 1])) {
      const n = row === 0 ? 14 : 18;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5 + (s > 0 ? 0 : 0.5)) / (n + 0.5);
        const { y, z } = mouthAt(t);
        const end = Math.abs(t - 0.5) * 2;              // 0 no meio da boca, 1 nas pontas
        const rnd = hash3(i, s * 3 + row, 7);
        // fileira de fora: presas grandes nas pontas, médios no meio; de dentro: pequenos e finos
        const h = (row === 0 ? (0.028 + 0.04 * Math.pow(end, 1.3) + 0.016 * rnd) * (i % 3 === 1 ? 0.7 : 1) : 0.013 + 0.01 * rnd) * (t > 0.86 ? 0.6 : 1); // na ponta de baixo, menores: os dois lados não se cruzam
        const r0 = row === 0 ? 0.006 + 0.004 * end : 0.0038;
        const g = new THREE.ConeGeometry(r0, h, 6, 4);
        g.translate(0, h / 2, 0);
        // curva o dente (a ponta se inclina) para não parecer um espeto reto
        const pp = g.attributes.position;
        for (let k = 0; k < pp.count; k++) { const yy = pp.getY(k) / h; pp.setZ(k, pp.getZ(k) + yy * yy * h * 0.35); }
        g.computeVertexNormals();
        // aponta para dentro (−s em X), um pouco para a frente e, perto das pontas, para o centro da boca
        const dir = new THREE.Vector3(-s, (0.5 - t) * 0.6 * end, 0.35 + (rnd - 0.5) * 0.2).normalize();
        g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
        // base afundada ~30% na gengiva (nada flutua nem atravessa para fora)
        const bx = s * (row === 0 ? 0.029 : 0.033) - dir.x * h * 0.08;
        g.translate(bx, y + (row ? 0.004 : 0), z - (row ? 0.014 : 0) - 0.004);
        teeth.rigid(g, BI[jb]);
      }
    }
  }
  // língua comprida e escura, presa ao fundo da boca (aparece quando as mandíbulas abrem)
  maw.tube([pt(V(0, 2.69, 0.74), 0.022, one('head'), 1.4, 0.6), pt(V(0, 2.665, 0.79), 0.019, one('head'), 1.5, 0.55), pt(V(0, 2.635, 0.835), 0.014, one('head'), 1.4, 0.5), pt(V(0, 2.62, 0.86), 0.006, one('head'))], { radial: 10, sub: 4, noise: 0.002 });
  for (let i = 0; i < (LO ? 0 : 7); i++) {
    const t = (i + 0.5) / 7, y = 2.8 - t * 0.2, z = 0.75 + Math.sin(t * Math.PI) * 0.07, h = 0.018 + 0.012 * hash3(i, 2, 2);
    const g = new THREE.ConeGeometry(0.004, h, 5); g.translate(0, -h / 2, 0); g.rotateX(0.5); g.translate(0, y, z + 0.012); teeth.rigid(g, BI.head);
  }
  // céu da boca com sulcos (palato) e fendas nasais acima da boca
  for (let i = 0; i < (LO ? 0 : 6); i++) { const g = new THREE.TorusGeometry(0.03, 0.0035, 5, 10, Math.PI); g.rotateY(Math.PI / 2); g.rotateX(-0.5); g.translate(0, 2.74 - i * 0.02, 0.765 + i * 0.006); maw.rigid(g, BI.head); }
  for (const s of [1, -1]) { const g = new THREE.SphereGeometry(0.011, 8, 6); g.scale(0.5, 1.8, 0.6); g.rotateZ(s * 0.3); g.translate(s * 0.022, 2.87, 0.83); maw.rigid(g, BI.head); }
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
    // cotovelo ósseo e pulso (v6b: menor e mais afundado — junta discreta)
    { const g = new THREE.SphereGeometry(0.027, 12, 10); g.scale(1, 1.25, 1); g.translate(s * 0.47, 1.84, 0.315); skin.rigid(g, BI['forearm' + k]); }
    // dedos longos e ossudos: 2 falanges articuladas com nós salientes + garras curvas escuras
    for (let f = 0; f < 4; f++) {
      const K = knuckle(s, f), M = midJoint(s, f), T = tipPt(s, f);
      const a = 'f' + f + 'a' + k, b = 'f' + f + 'b' + k, c3 = 'f' + f + 'c' + k;
      skin.tube([
        pt(K.clone().add(V(0, 0.04, -0.004)), 0.018, one('hand' + k)),
        pt(K, 0.0195, mix('hand' + k, a, 0.7)),
        pt(K.clone().lerp(M, 0.5), 0.0125, one(a)),
        pt(M.clone().add(V(0, 0.008, 0)), 0.0165, mix(a, b, 0.4)),
        pt(M.clone().lerp(T, 0.3), 0.011, one(b)),
        pt(M.clone().lerp(T, 0.55), 0.0135, mix(b, 'f' + f + 'c' + k, 0.5)), // v9: 3ª junta (nó saliente)
        pt(M.clone().lerp(T, 0.8), 0.0105, one('f' + f + 'c' + k)),
        pt(T, 0.0085, one('f' + f + 'c' + k)),
      ], { radial: 9, sub: 3, noise: 0.0015, extra: (aa, u, p, d, r0) => 0.15 * r0 * ridge(aa * 2 + 0.5, 6) });
      claw.tube([pt(T.clone().add(V(0, 0.012, 0)), 0.0085, one(c3)), pt(T.clone().add(V(-s * 0.012, -0.035, 0.012)), 0.006, one(c3)), pt(T.clone().add(V(-s * 0.035, -0.075, 0.02)), 0.0028, one(c3)), pt(T.clone().add(V(-s * 0.055, -0.092, 0.022)), 0.0005, one(c3))], { radial: 7, sub: 4, noise: 0 });
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
    { const g = new THREE.SphereGeometry(0.038, 12, 10); g.translate(s * 0.2, 0.96, 0.315); skin.rigid(g, BI['shin' + k]); }
    { const g = new THREE.SphereGeometry(0.03, 10, 8); g.scale(1, 1, 1.3); g.translate(s * 0.21, 0.37, -0.15); skin.rigid(g, BI['foot' + k]); } // calcanhar (jarrete)
    for (let t = -1; t <= 1; t++) {
      const tx = s * 0.22 + t * 0.04;
      const tip = V(tx + t * 0.025, 0.025, 0.34);
      skin.tube([pt(V(tx, 0.06, 0.12), 0.024, one('toes' + k)), pt(V(tx + t * 0.02, 0.04, 0.25), 0.017, one('toes' + k)), pt(tip, 0.01, one('toes' + k))], { radial: 8, sub: 3, noise: 0.002 });
      claw.tube([pt(tip.clone().add(V(0, 0.004, -0.01)), 0.01, one('toes' + k)), pt(tip.clone().add(V(0, -0.002, 0.04)), 0.007, one('toes' + k)), pt(tip.clone().add(V(0, -0.02, 0.075)), 0.0008, one('toes' + k))], { radial: 7, sub: 3, noise: 0 });
    }
  }
  // ----- v9: as FILHAS fundidas ao corpo da mãe -----
  const stitchRing = (c, n, R, cnt, bone, jitter = 0) => {
    const t1 = new THREE.Vector3().crossVectors(n, Math.abs(n.y) > 0.9 ? V(1, 0, 0) : V(0, 1, 0)).normalize(), t2 = new THREE.Vector3().crossVectors(n, t1);
    for (let i = 0; i < cnt; i++) {
      const a = (i + 0.5 * hash3(i, R * 50, 3)) / cnt * Math.PI * 2;
      const rad = t1.clone().multiplyScalar(Math.cos(a)).addScaledVector(t2, Math.sin(a));
      const sp = surf(c.clone().addScaledVector(rad, R * (1 + jitter * (hash3(i, 4, 5) - 0.5))).addScaledVector(n, 0.02));
      const len = 0.026 + 0.012 * hash3(i, 9, R);
      const g = new THREE.CylinderGeometry(0.0024, 0.0024, len, 4, 1);
      // linha atravessando a emenda (radial), deitada na pele e levemente torta
      const dir = rad.clone().addScaledVector(sp.n, -rad.dot(sp.n)).normalize().applyAxisAngle(sp.n, (hash3(i, 2, 7) - 0.5) * 0.5);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir));
      g.translate(sp.p.x + sp.n.x * 0.0015, sp.p.y + sp.n.y * 0.0015, sp.p.z + sp.n.z * 0.0015);
      claw.rigid(g, BI[bone]);
    }
  };
  for (const k of ['A', 'B']) {
    const F = KIDFACE[k], n = F.n.clone().normalize(), r = F.r;
    // rosto de criança meio enterrado na pele: testa, olhos fechados afundados, nariz pequeno, boca
    // (A: fechada, serena — a que aceitou; B: aberta num grito — a que resistiu)
    // só a metade da frente (a de trás fica dentro do corpo): grade densa mapeada num disco → domo; a borda
    // dobra para dentro da pele
    const NG = LO ? 12 : 44;
    const g = new THREE.PlaneGeometry(2, 2, NG, NG);
    const pp = g.attributes.position, d = new THREE.Vector3(), cav = new Float32Array(pp.count);
    const gs = (x, y, cx, cy, wx, wy) => Math.exp(-(((x - cx) / wx) ** 2) - (((y - cy) / wy) ** 2));
    for (let i = 0; i < pp.count; i++) {
      const u = pp.getX(i), v = pp.getY(i);
      const x = u * Math.sqrt(1 - v * v / 2), y = v * Math.sqrt(1 - u * u / 2), rho = Math.hypot(x, y);
      d.set(x, y, Math.sqrt(Math.max(0, 1 - rho * rho)) - 0.55 * smooth(0.78, 1, rho));
      const fx = x, fy = y, front = 1;
      const eye = gs(fx, fy, 0.34, 0.1, 0.17, 0.12) + gs(fx, fy, -0.34, 0.1, 0.17, 0.12);
      let dr = 0, c = 0;
      dr -= 0.34 * eye * front; c += 0.55 * eye * front;                                                   // órbitas fundas
      const lid = gs(fx, fy, 0.34, 0.08, 0.13, 0.03) + gs(fx, fy, -0.34, 0.08, 0.13, 0.03);
      dr += 0.1 * lid * front; c += 0.25 * lid * front;                                                     // pálpebras fechadas (risco)
      dr += 0.14 * gs(fx, fy, 0, 0.3, 0.55, 0.07) * front;                                                  // sobrancelha
      dr += 0.32 * gs(fx, fy, 0, -0.08, 0.075, 0.16) * front + 0.12 * gs(fx, fy, 0, -0.2, 0.13, 0.05) * front; // nariz
      dr += 0.12 * (gs(fx, fy, 0.36, -0.24, 0.2, 0.15) + gs(fx, fy, -0.36, -0.24, 0.2, 0.15)) * front;      // bochechas
      if (F.scream) { const m = gs(fx, fy, 0, -0.4, 0.2, 0.27); dr -= 0.8 * m * front; c += 0.9 * m * front; dr += 0.1 * gs(fx, fy, 0, -0.4, 0.3, 0.36) * front; }
      else { const m = gs(fx, fy, 0, -0.38, 0.22, 0.028); dr -= 0.12 * m * front; c += 0.5 * m * front; dr += 0.07 * gs(fx, fy, 0, -0.46, 0.15, 0.05) * front; }
      dr += 0.1 * gs(fx, fy, 0, -0.72, 0.28, 0.12) * front;                                                  // queixo
      const rr = 1 + dr + 0.01 * vnoise(d.x * 7, d.y * 7, d.z * 7);
      pp.setXYZ(i, d.x * r * rr * 0.86, d.y * r * rr * 1.08, d.z * r * rr * 0.7);
      cav[i] = clamp(c, 0, 0.85);
    }
    g.setAttribute('cav', new THREE.BufferAttribute(cav, 1));
    g.computeVertexNormals();
    const qf = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), n);
    // rosto A um pouco inclinado (dormindo), B torto (tentando sair)
    qf.multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), k === 'A' ? 0.35 : -0.5));
    g.applyQuaternion(qf); g.translate(F.c.x + n.x * 0.02, F.c.y + n.y * 0.02, F.c.z + n.z * 0.02);
    skin.rigid(g, BI['kidHead' + k], 0.93);
    if (F.scream) { const m = new THREE.SphereGeometry(r * 0.2, 10, 8); m.scale(1, 1.4, 0.5); m.translate(0, -r * 0.4, r * 0.3); m.applyQuaternion(qf); m.translate(F.c.x + n.x * 0.02, F.c.y + n.y * 0.02, F.c.z + n.z * 0.02); maw.rigid(m, BI['kidHead' + k]); }
    if (!LO) stitchRing(F.c.clone().addScaledVector(n, -0.01), n, r * 1.08, 15, F.parent, 0.1);
  }
  for (const k of ['A', 'B']) {
    const Q = KID[k], n = Q.n.clone().normalize(), a1 = 'kid' + k + '1', a2 = 'kid' + k + '2', a3 = 'kid' + k + '3';
    const sh = Q.sh, el = Q.el, wr = Q.wr, dirF = wr.clone().sub(el).normalize();
    const palm = wr.clone().addScaledVector(dirF, 0.06);
    skin.tube([
      pt(sh.clone().addScaledVector(n, -0.05), 0.055, one(Q.parent)),
      pt(sh, 0.046, mix(Q.parent, a1, 0.55)),
      pt(sh.clone().lerp(el, 0.45), 0.036, one(a1)),
      pt(el, 0.03, mix(a1, a2, 0.5)),
      pt(el.clone().lerp(wr, 0.4), 0.031, one(a2)),
      pt(wr, 0.021, mix(a2, a3, 0.6), 1.25, 0.8),
      pt(palm, 0.027, one(a3), 1.5, 0.6),
    ], { radial: 12, sub: 5, noise: 0.003, extra: (aa, u) => (u > 0.2 && u < 0.8 ? 0.0025 * ridge(aa * 2 + u * 3, 5) : 0) });
    if (!LO) stitchRing(sh.clone().addScaledVector(n, 0.005), n, 0.068, 13, Q.parent, 0.15);
    // mãozinha: 4 dedos curtos + polegar, unhas escuras de sujeira
    const side = new THREE.Vector3().crossVectors(dirF, n).normalize();
    for (let f = 0; f < 5; f++) {
      const thumb = f === 4, o = thumb ? -0.034 : (f - 1.5) * 0.014;
      const b0 = palm.clone().addScaledVector(side, o).addScaledVector(dirF, thumb ? -0.025 : 0.016);
      const L = thumb ? 0.04 : [0.05, 0.058, 0.055, 0.045][f];
      const curl = n.clone().multiplyScalar(-0.35 - 0.1 * f);
      const t1 = b0.clone().addScaledVector(dirF.clone().add(curl).normalize(), L * 0.55);
      const t2 = t1.clone().addScaledVector(dirF.clone().addScaledVector(n, -0.9).normalize(), L * 0.45);
      skin.tube([pt(b0, 0.0085, one(a3)), pt(t1, 0.0075, one(a3)), pt(t2, 0.006, one(a3))], { radial: 6, sub: 2, noise: 0.0008 });
      if (!LO) { const nl = new THREE.SphereGeometry(0.005, 5, 4); nl.scale(1, 0.4, 1.3); nl.translate(t2.x, t2.y, t2.z); claw.rigid(nl, BI[a3]); }
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
  const toothMat = new THREE.MeshPhysicalMaterial({ color: 0xc9b98e, roughness: 0.38, clearcoat: 0.5, clearcoatRoughness: 0.3 }); // marfim amarelado, úmido
  const mats = [skinMat, clawMat, mawMat, toothMat];
  const mesh = new THREE.SkinnedMesh(geo, mats);
  const root = new THREE.Group();
  root.add(bones[0]);
  root.updateMatrixWorld(true);
  const skel = new THREE.Skeleton(bones); // inversas calculadas com a raiz na origem
  mesh.bind(skel, new THREE.Matrix4());
  // v9: LOD — o mesmo esqueleto anima a malha detalhada (perto) e a leve (longe, > 13 m)
  const lo = new THREE.SkinnedMesh(buildGeometry(true), mats);
  lo.bind(skel, new THREE.Matrix4());
  const lod = new THREE.LOD();
  lod.addLevel(mesh, 0, 0.08); lod.addLevel(lo, 13, 0.08);
  for (const m of [mesh, lo]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; }
  root.add(lod);
  const anim = new CreatureAnimator(bones);
  anim.root = root;
  // setLOD('hi'|'lo') trava um nível (trailer/close); setLOD(null) volta ao automático
  const setLOD = (lv) => { lod.autoUpdate = !lv; if (lv) { mesh.visible = lv !== 'lo'; lo.visible = lv === 'lo'; } };
  return { root, mesh, lo, lod, bones, anim, setLOD, update: (dt, s) => anim.update(dt, s) };
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
  kidHead: [9, 0.38], kid: [6.5, 0.3], neck2: [8.5, 0.45], spine3: [9.5, 0.48],
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
// v9: grupos de juntas que "engasgam" juntas (congelam e depois estalam até a pose)
const HITCH_GROUPS = {
  head: ['neck', 'neck2', 'head'],
  armL: ['clavL', 'upperArmL', 'forearmL', 'handL'],
  armR: ['clavR', 'upperArmR', 'forearmR', 'handR'],
  torso: ['spine1', 'spine2', 'spine3', 'chest', 'neck', 'neck2', 'head'],
  kids: ['kidA1', 'kidA2', 'kidA3', 'kidB1', 'kidB2', 'kidB3', 'kidHeadA', 'kidHeadB'],
};
const CRACK_BONES = { head: ['neck2', 'neck', 'head'], armL: ['clavL', 'upperArmL', 'handL'], armR: ['clavR', 'upperArmR', 'handR'], torso: ['spine2', 'spine3', 'neck2'], kids: ['kidA1', 'kidB2', 'kidHeadB'] };
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
    // v9: engasgos/estalos, inclinação da cabeça, sobressaltos da corrida; evCb(tipo, dados) → sons
    this.evCb = null; this.hitch = null; this.hitchCd = 1.2; this.snapT = 0; this.snapSet = null;
    this.tilt = 0.18; this.tiltT = 2.5; this.lurchCd = 0.6; this.hearSide = 1; this.sniffN = -1; this.seed = 0;
  }
  rnd() { this.seed = (this.seed + 0.6180339887) % 1; return hash3(this.t * 3.7, this.seed * 97.1, 5.3); }
  emit(type, data) { if (this.evCb && !this.first) try { this.evCb(type, data || {}); } catch { } }
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
    const stride = lerp(1.25 + 0.42 * v, 0.95 + 0.3 * v, rf) * (1 - 0.15 * inv); // v9: corrida de passadas curtas e rápidas
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
          this.liftFoot(f, tx, tz, dur * (k === 'R' ? 1.06 : 0.96), lift * (k === 'L' ? 1.2 : 0.82), rf);
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
      const u = w.u;
      const mz = -this.vel.z * w.dur * 0.45, mx = -this.vel.x * w.dur * 0.45;
      // v9 (espreita): no andar o pé sobe rápido, paira e só então avança e desce seco
      const ue = lerp(smooth(0.12, 0.92, u), u, w.run), e2 = ue * ue, e3 = e2 * ue;
      const g00 = 2 * e3 - 3 * e2 + 1, g10 = e3 - 2 * e2 + ue, g01 = -2 * e3 + 3 * e2, g11 = e3 - e2;
      f.z = g00 * w.z0 + g10 * mz + g01 * w.z1 + g11 * mz;
      f.x = g00 * w.x0 + g10 * mx + g01 * w.x1 + g11 * mx;
      const hover = smooth(0, 0.3, u) * (1 - smooth(0.8, 1, u)) * 1.05;
      f.y = BALL_Y + w.h * lerp(hover, Math.sin(Math.PI * Math.pow(u, 0.85)), w.run);
      f.psi = lerp(w.psi0, PSI_F + 0.18, u) - (0.55 + w.run * 0.3) * Math.sin(Math.PI * u);
      f.toe = PSI_TOE - (0.7 + w.run * 0.3) * Math.sin(Math.PI * Math.min(1, u * 1.15));
      if (u >= 1) { f.sw = null; f.planted = true; f.y = BALL_Y; if (!this.first && w.dur > 0.2) this.impact = 1; if (this.footCb && !this.first) this.footCb(f.s > 0 ? 'L' : 'R', w.run); this.emit('step', { foot: f.s > 0 ? 'L' : 'R', run: w.run }); }
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
    // v9b: postura base ERETA e esticada (pedido do Gabriel): coluna estendida, cabeça alta. Só se curva para
    // passar por portas/tetos baixos (s.headroom → this.duckK) e inclina um pouco à frente ao correr.
    P.spine1.x = 0.03; P.spine2.x = 0.02; P.chest.x = 0.0; P.neck.x = -0.06; P.head.x = 0.02;
    P.clavL.z = -0.08; P.clavR.z = 0.08;
    P.upperArmL.z = -0.04; P.upperArmR.z = 0.04;
    P.forearmL.x = -0.2; P.forearmR.x = -0.2;
    P.handL.x = -0.1; P.handR.x = -0.1;
    // balanço vertical (andar: alto no meio do apoio; correr: baixo), lateral e torções
    hip.y += mid * lerp(0.03, -0.04, rf) * gw - rf * 0.06 - inv * 0.02; // v9b: na corrida abaixa só um pouco
    const sideSw = Math.cos(ph - Math.PI * duty);
    hip.x += sideSw * 0.035 * gw * (1 - rf * 0.6);
    P.hips.z = sideSw * 0.07 * gw * (1 - rf * 0.4);
    P.hips.y = -cL * lerp(0.13, 0.2, rf) * gw;
    P.spine1.y = cL * 0.04 * gw; P.spine2.y = cL * 0.08 * gw; P.chest.y = cL * lerp(0.1, 0.16, rf) * gw;
    P.spine1.z = -sideSw * 0.04 * gw; P.chest.z = -sideSw * 0.05 * gw; P.neck.z = sideSw * 0.05 * gw; // ondulação da coluna
    P.neck.y = -cL * 0.06 * gw; // a cabeça se estabiliza contra a torção do tronco
    // v9: ASSIMETRIA — ombro esquerdo caído e braço mais solto; direito mais dobrado, junto do corpo
    P.clavL.z -= 0.08; P.upperArmL.z -= 0.05; P.upperArmL.x += 0.05; P.forearmR.x -= 0.28; P.handR.x -= 0.12; P.clavR.z += 0.03;
    // v9: ESPREITA (andar) — quadril baixo, tronco projetado, cabeça baixa à frente e estável; braços pendem à frente
    // v9b: andar ereto — sem abaixar o quadril; peito aberto, cabeça alta, braços longos pendendo quase retos
    const stalk = gw * (1 - rf);
    P.chest.x -= 0.03 * stalk; P.neck.x -= 0.02 * stalk;
    P.upperArmL.x -= 0.06 * stalk; P.upperArmR.x -= 0.04 * stalk;
    // braços opostos às pernas (andar); na corrida viram "patas" que agarram à frente
    const armA = 0.34 * gw * (1 - rf) * (1 - 0.4 * inv);
    P.upperArmL.x += cL * armA; P.upperArmR.x -= cL * armA * 0.7;
    P.forearmL.x -= Math.max(0, -cL) * 0.32 * gw * (1 - rf); P.forearmR.x -= Math.max(0, cL) * 0.25 * gw * (1 - rf);
    P.handL.x += Math.sin(ph) * 0.18 * gw; P.handR.x -= Math.sin(ph) * 0.14 * gw;
    // v9b: CORRIDA — não é mais de aranha: tronco só levemente inclinado à frente, cabeça alta olhando a presa,
    // braços compridos balançando em contrafase (cotovelos dobrados), mãos abertas meio à frente.
    P.spine1.x += rf * 0.16; P.spine2.x += rf * 0.06; P.spine3.x += rf * 0.03;
    P.neck.x -= rf * 0.14; P.neck2.x -= rf * 0.05; P.head.x -= rf * 0.06;
    this.freeK = (this.freeK ?? 1) + (smooth(0.75, 1.5, s.free ?? 1.6) - (this.freeK ?? 1)) * Math.min(1, dt * 8);
    const fk = this.freeK, armR = 0.7 * rf * lerp(0.5, 1, fk);
    P.upperArmL.x += -rf * 0.25 + cL * armR; P.upperArmR.x += -rf * 0.25 - cL * armR;
    P.upperArmL.z -= rf * 0.08; P.upperArmR.z += rf * 0.08;
    P.forearmL.x -= rf * (0.55 + 0.35 * Math.max(0, -cL)); P.forearmR.x -= rf * (0.55 + 0.35 * Math.max(0, cL));
    P.handL.x += rf * 0.1; P.handR.x += rf * 0.1;
    P.spine1.x += mid * 0.03 * rf; // investida a cada passada (leve)
    P.spine1.z += rf * 0.05 * Math.sin(ph); P.spine3.z += rf * 0.05 * Math.sin(ph - 1.1); P.chest.y += rf * 0.1 * Math.cos(ph - 0.6);
    P.hips.z += rf * 0.04 * Math.sin(ph + 0.4);
    // guinadas aleatórias do tronco na corrida
    this.lurchCd -= dt;
    if (rf > 0.5 && this.lurchCd <= 0) {
      this.lurchCd = 0.4 + this.rnd() * 0.7; const sg = this.rnd() < 0.5 ? -1 : 1;
      this.spr.spine2.z.v += sg * (1.2 + this.rnd() * 1.2); this.spr.chest.y.v -= sg * (1.0 + this.rnd() * 1.4); this.spr.spine1.x.v += 0.6 * this.rnd();
    }
    // v9: onda que sobe pela coluna, vértebra por vértebra (andar e parado)
    { const wv = 0.035 * gw * (1 - rf * 0.5) + 0.018 * (1 - gw), wp = ph * (gw > 0.3 ? 1 : 0) + t * 0.9 * (1 - gw);
      const SP = ['spine1', 'spine2', 'spine3', 'chest', 'neck', 'neck2'];
      for (let i = 0; i < SP.length; i++) { P[SP[i]].z += wv * Math.sin(wp - i * 0.75); P[SP[i]].y += wv * 0.8 * Math.sin(wp * 0.5 - i * 0.6); } }
    // v9: parada — transfere o peso de uma perna para a outra, devagar
    { const iw = 1 - gw; hip.x += Math.sin(t * 0.37) * 0.035 * iw; P.hips.z += Math.sin(t * 0.37) * 0.05 * iw; P.spine1.z -= Math.sin(t * 0.37) * 0.035 * iw; }
    // ---------- respiração (caixa torácica e ombros) ----------
    const brRate = lerp(0.85, 2.1, Math.max(rf, W('recover') * 0.9, W('kill') * 0.7));
    this.brPh = (this.brPh || 0) + dt * brRate * Math.PI * 2;
    const br = Math.sin(this.brPh), brAmp = lerp(1, 1.8, Math.max(rf, W('recover'))) * (1 - 0.85 * W('hear')); // v9: prende a respiração ao escutar
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
    // v9: cabeça TORTA — inclinação que muda de repente (estala) e, parada, rola devagar até ângulos impossíveis
    this.tiltT -= dt;
    if (this.tiltT <= 0) { this.tiltT = 2 + this.rnd() * 4.5; const r0 = this.rnd(); this.tilt = (r0 < 0.5 ? -1 : 1) * (0.12 + 0.38 * this.rnd()); this.spr.head.z.v += Math.sign(this.tilt) * 4; if (r0 > 0.7) this.emit('crack', { bone: 'neck2', k: 0.45 }); }
    const idleW = (1 - gw) * (1 - W('attack')) * (1 - W('kill'));
    P.head.z += this.tilt * (1 - rf * 0.7) + n1(t * 0.11, 21) * 0.4 * idleW;
    P.neck2.z -= this.tilt * 0.35 * (1 - rf * 0.7); P.neck2.x += 0.08 * idleW * Math.max(0, n1(t * 0.09, 22));
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
    let jaw = 0.06 + 0.025 * Math.sin(this.brPh) + rf * 0.22 + rf * 0.08 * Math.abs(Math.sin(this.brPh * 0.5)); // v2 fase 2: boca sempre entreaberta, respirando — os dentes aparecem
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
      // v9: ESCUTAR — congela, prende a respiração, a cabeça tomba de lado (ouvido para o som) e o pescoço estica;
      // os dedos abrem e tremem
      const at = lt.hear, k = smooth(0, 0.12, at);
      if (Math.abs(hy) > 0.05) this.hearSide = Math.sign(hy);
      const sd = this.hearSide;
      P.clavL.z -= 0.18 * k * w; P.clavR.z += 0.18 * k * w; P.spine1.x -= 0.08 * k * w; P.neck.x -= 0.12 * w;
      P.neck2.y += 0.3 * sd * k * w; P.neck2.x -= 0.15 * k * w;
      P.head.z += (0.62 * sd * k + 0.12 * Math.sin(clamp(at * 2.5, 0, 1) * Math.PI)) * w - this.tilt * 0.8 * w;
      P.upperArmL.z -= 0.12 * w; P.upperArmR.z += 0.12 * w; P.upperArmL.x -= 0.15 * w; P.upperArmR.x -= 0.15 * w; curl -= 0.45 * w;
      for (const kk of ['L', 'R']) for (let f = 0; f < 4; f++) P['f' + f + 'a' + kk].x += n1(t * 14 + f, kk === 'L' ? 31 : 32) * 0.12 * w;
      jaw += (at < 0.7 ? 0.16 * Math.abs(Math.sin(t * 30)) : 0.03) * w;
    }
    if ((w = W('turn'))) {
      P.clavL.z -= 0.12 * w; P.clavR.z += 0.12 * w; P.spine1.x += 0.1 * w; hip.y -= 0.06 * w; curl -= 0.25 * w;
      jaw += (lt.turn < 0.5 ? 0.14 * Math.abs(Math.sin(t * 28)) : 0.05) * w;
    }
    if ((w = W('stop'))) { hip.y -= 0.05 * w; curl += 0.15 * w; }
    if ((w = W('sniff'))) {
      // v9: FAREJAR — curva-se até o chão, focinho a ~1 m do piso varrendo de um lado para o outro, fungadas em
      // rajadas de 3 (cada uma puxa a cabeça e o peito), dedos tocando o chão
      const per = 0.36, k = (lt.sniff % per) / per, n = Math.floor(lt.sniff / per), cnt = n % 5;
      const jerk = cnt < 3 && k < 0.3 ? Math.sin(k / 0.3 * Math.PI) : 0;
      if (cnt < 3 && n !== this.sniffN && w > 0.5) { this.sniffN = n; this.emit('sniff', { k: cnt === 0 ? 1 : 0.7 }); }
      hip.y -= 0.32 * w; P.spine1.x += 0.42 * w; P.spine2.x += 0.22 * w; P.spine3.x += 0.12 * w; P.neck.x += 0.05 * w;
      P.neck2.x -= jerk * 0.12 * w; P.head.x += (0.1 - jerk * 0.1) * w;
      P.chest.x -= jerk * 0.05 * w; P.clavL.z -= jerk * 0.05 * w; P.clavR.z += jerk * 0.05 * w;
      P.neck.y += n1(t * 0.5, 8) * 0.35 * w; P.head.y += n1(t * 0.5 + 0.3, 8) * 0.35 * w;
      jaw += (0.02 + jerk * 0.05) * w;
      P.upperArmL.x -= 0.55 * w; P.upperArmR.x -= 0.5 * w; P.forearmL.x -= 0.25 * w; P.forearmR.x -= 0.1 * w; curl += 0.25 * w;
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
      // v6: AGARRÃO — 0–0,3 s as duas mãos avançam e fecham no peito da vítima; 0,3–1,1 s ergue e puxa até o
      // rosto (coluna se endireita, cabeça desce para encarar, boca escancarada); 1,1–1,45 s sacode;
      // 1,45 s solta/arremessa para baixo; depois se curva sobre o corpo (pose antiga de 'kill').
      const at = lt.kill;
      const reach = smooth(0, 0.3, at), lift = smooth(0.3, 1.05, at), rel = smooth(1.42, 1.62, at), hunch = smooth(1.55, 2.2, at);
      const hold = reach * (1 - rel), up = lift * (1 - rel);
      const shake = at > 1.05 && at < 1.45 ? Math.sin(at * 38) * (1 - smooth(1.05, 1.45, at) * 0.5) : 0;
      P.upperArmL.x -= (0.9 * hold - 0.25 * up + 0.08 * shake + 0.3 * rel * (1 - hunch)) * w; P.upperArmR.x -= (0.9 * hold - 0.25 * up - 0.08 * shake + 0.3 * rel * (1 - hunch)) * w;
      P.upperArmL.z += 0.22 * hold * w; P.upperArmR.z -= 0.22 * hold * w;               // mãos fecham para o centro
      P.forearmL.x -= (0.3 * hold + 1.05 * up) * w; P.forearmR.x -= (0.3 * hold + 1.05 * up) * w;
      P.handL.x -= 0.35 * hold * w; P.handR.x -= 0.35 * hold * w;
      P.spine1.x += (0.2 * hold - 0.3 * up) * w; P.spine2.x += (-0.1 * up) * w; P.chest.x += 0.06 * shake * w;
      hip.y += 0.06 * up * w;
      P.neck.x += (0.12 * up + 0.08 * hold) * w; P.head.x += (0.06 * up) * w; P.head.z += 0.12 * Math.sin(at * 3.1) * up * w;
      curl += (1.05 * hold - 0.5 * rel * (1 - hunch)) * w;
      jaw += (0.2 + 0.55 * up + 0.1 * Math.abs(shake)) * w;
      // curvada sobre o corpo
      const hw = hunch * w;
      P.spine1.x += 0.6 * hw; P.spine2.x += 0.3 * hw; P.chest.x += 0.15 * hw; P.neck.x += 0.3 * hw;
      P.head.x += (0.25 + Math.max(0, Math.sin(t * 6)) * 0.12) * hw; P.head.z += Math.sin(t * 3.1) * 0.15 * hw;
      P.upperArmL.x -= 1.1 * hw; P.upperArmR.x -= 1.1 * hw; P.forearmL.x -= 0.6 * hw; P.forearmR.x -= 0.6 * hw;
      hip.y -= 0.42 * hw; hip.z += 0.1 * hw; curl += 0.9 * hw;
      jaw += (0.2 + 0.2 * Math.abs(Math.sin(t * 5))) * hw;
      this.kidReach = Math.max(hold, hw * 0.6) * w; // v9: as mãozinhas também agarram
    } else this.kidReach = 0;
    if ((w = W('door'))) { P.upperArmR.x -= 1.45 * w; P.forearmR.x -= 0.15 * w; P.spine1.x += 0.25 * w; curl -= 0.25 * w; P.handR.x -= 0.4 * w; }
    if ((w = W('recover'))) { P.neck.x += 0.22 * w; P.spine1.x += 0.12 * w; hip.y -= 0.04 * w; jaw += (0.12 + 0.08 * Math.sin(this.brPh)) * w; }
    // inércia da parada repentina (sobressalto amortecido)
    this.lurch = Math.max(0, this.lurch - dt * 1.8);
    // v9b: abaixa SÓ para caber — s.headroom (m acima do piso: menor vão de porta/teto à frente e em volta) é
    // comparado com o alto da cabeça medido no quadro anterior; o controlador desce rápido e sobe devagar.
    // Pose do agachamento: joelhos dobram (quadril desce), coluna dobra à frente, pescoço compensa (olha à frente).
    {
      const room = typeof s.headroom === 'number' ? s.headroom : 99;
      const err = (this.headTop ?? 2.95) - (room - 0.12);
      const want = clamp((this.duckK || 0) + err * 2.2, 0, 1.6);
      this.duckK = (this.duckK || 0) + (want - (this.duckK || 0)) * Math.min(1, dt * (want > (this.duckK || 0) ? 14 : 2.2));
      if (room > 90) this.duckK = Math.max(0, this.duckK - dt * 2);
    }
    const duck = Math.max(s.duck && typeof s.headroom !== 'number' ? s.duck * 0.6 : 0, this.duckK || 0);
    P.spine1.x += duck * 0.42; P.spine2.x += duck * 0.12; P.neck.x -= duck * 0.32; P.head.x -= duck * 0.08; hip.y -= duck * 0.26;
    // v6: no vão da porta encolhe os ombros e cola os braços no corpo (não varre o batente)
    const dk = Math.min(1, duck);
    P.clavL.z += dk * 0.12; P.clavR.z -= dk * 0.12; P.upperArmL.z += dk * 0.16; P.upperArmR.z -= dk * 0.16;
    // v6: peso — cada pisada desce o quadril e a caixa torácica (impacto amortecido), ombros acompanham
    this.impact = Math.max(0, (this.impact || 0) - dt * 5.5);
    const imp = Math.sin(Math.min(1, this.impact) * Math.PI) * (1 - rf * 0.4);
    hip.y -= imp * 0.045; P.spine1.x += imp * 0.05; P.neck.x -= imp * 0.04; P.clavL.z -= imp * 0.05; P.clavR.z += imp * 0.05;
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
    // ---------- v9: FILHAS — braços que se contorcem devagar, agarram na perseguição/no agarrão; rostos tremem ----------
    { const chase = Math.max(rf, W('attack')), kr = this.kidReach || 0, alive = 1 - 0.6 * W('hear');
      const wr = (sd, sp) => n1(t * sp, sd) * alive;
      // A (peito/flanco esquerdo, a que aceitou): mais lenta, como se acariciasse; B (costas, a que resistiu): empurra para fora
      P.kidA1.x = wr(41, 0.35) * 0.3 - 0.5 * chase - 0.6 * rf - 0.7 * kr; P.kidA1.y = wr(42, 0.3) * 0.35; P.kidA1.z = wr(43, 0.28) * 0.25;
      P.kidA2.x = -0.35 + wr(44, 0.5) * 0.35 - 0.2 * chase; P.kidA2.z = wr(45, 0.4) * 0.2;
      P.kidA3.x = -0.4 + wr(46, 0.8) * 0.4 + 0.5 * kr; P.kidA3.z = wr(47, 0.7) * 0.3;
      P.kidB1.x = wr(51, 0.55) * 0.45 - 1.0 * rf; P.kidB1.y = wr(52, 0.5) * 0.5; P.kidB1.z = wr(53, 0.45) * 0.4 - 0.25 * chase;
      P.kidB2.x = 0.3 + wr(54, 0.9) * 0.5; P.kidB2.z = wr(55, 0.8) * 0.3;
      P.kidB3.x = 0.3 + wr(56, 1.4) * 0.5 + 0.5 * Math.max(0, Math.sin(t * 9)) * chase; P.kidB3.z = wr(57, 1.1) * 0.4;
      P.kidHeadA.y = n1(t * 0.2, 61) * 0.12; P.kidHeadA.z = n1(t * 0.17, 62) * 0.1;
      P.kidHeadB.x = n1(t * 11, 63) * 0.035 * (0.4 + chase); P.kidHeadB.y = n1(t * 0.6, 64) * 0.18 + n1(t * 13, 65) * 0.03;
      // parado, os dedos da mãe tamborilam devagar, um de cada vez
      for (const kk of ['L', 'R']) for (let f = 0; f < 4; f++) P['f' + f + 'b' + kk].z += (kk === 'L' ? -1 : 1) * 0.35 * idleW * Math.max(0, Math.sin(t * 5.5 - f * 0.9)) * (n1(t * 0.25, kk === 'L' ? 71 : 72) > 0.15 ? 1 : 0); }
    // v9: coluna e pescoço segmentados — a curvatura se espalha pelos segmentos novos
    for (const a of ['x', 'y', 'z']) { P.spine3[a] += P.spine2[a] * 0.4; P.spine2[a] *= 0.7; P.neck2[a] += P.neck[a] * 0.45; P.neck[a] *= 0.7; }
    // dedos: 3ª falange acompanha a 2ª
    for (const kk of ['L', 'R']) for (let f = 0; f < 4; f++) { P['f' + f + 'c' + kk].z = P['f' + f + 'b' + kk].z * 0.75; }
    // ---------- v9: ENGASGO — um grupo de juntas congela por um instante e depois ESTALA até a pose (às vezes
    // com um estalo de osso). Movimento travado-depois-liso, nada natural. ----------
    const busy = Math.max(W('attack'), W('kill'), W('door'));
    this.hitchCd -= dt * (1 - busy);
    if (!this.hitch && this.hitchCd <= 0 && !this.first) {
      const r0 = this.rnd();
      const g = rf > 0.5 ? (r0 < 0.5 ? 'head' : 'kids') : r0 < 0.3 ? 'head' : r0 < 0.47 ? 'armL' : r0 < 0.6 ? 'armR' : r0 < 0.82 ? 'torso' : 'kids';
      const hold = {}; for (const n of HITCH_GROUPS[g]) hold[n] = { x: this.spr[n].x.x, y: this.spr[n].y.x, z: this.spr[n].z.x };
      this.hitch = { g, hold, t: 0, dur: rf > 0.5 ? 0.06 + this.rnd() * 0.08 : 0.1 + this.rnd() * 0.22 };
    }
    if (this.hitch) {
      const H = this.hitch; H.t += dt;
      if (H.t < H.dur) { for (const n in H.hold) P[n] = H.hold[n]; }
      else {
        this.snapSet = HITCH_GROUPS[H.g]; this.snapT = 0.2; this.hitch = null;
        this.hitchCd = rf > 0.5 ? 1.2 + this.rnd() * 2.5 : gw > 0.3 ? 0.9 + this.rnd() * 2.6 : 0.7 + this.rnd() * 2.2;
        if (this.rnd() < 0.42) { // estalo: impulso numa junta + som
          const list = CRACK_BONES[H.g], bn = list[Math.floor(this.rnd() * list.length)], sg = this.rnd() < 0.5 ? -1 : 1;
          const st = this.spr[bn]; if (st) { st.z.v += sg * (3 + this.rnd() * 3); st.x.v += (this.rnd() - 0.5) * 4; }
          this.emit('crack', { bone: bn, k: 0.5 + this.rnd() * 0.5 });
        }
      }
    }
    this.snapT = Math.max(0, this.snapT - dt);
    // ---------- molas → ossos ----------
    if (this.first) for (const n in this.spr) for (const a of ['x', 'y', 'z']) { this.spr[n][a].x = P[n][a]; this.spr[n][a].v = 0; }
    const hearSnap = Math.max(W('hear'), W('turn'));
    for (const n in this.spr) {
      let [om, ze] = sprOf(n);
      if (n === 'head' || n === 'neck') om *= 1 + hearSnap * 1.2; // cabeça "estala" na direção do som
      if (anim === 'attack') om *= 1.6;
      if (this.snapT > 0 && this.snapSet && this.snapSet.includes(n)) { om *= 2.6; ze *= 0.55; } // estala até a pose
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
    // v9b: alto da cabeça (m acima da raiz) — realimenta o controlador de agachamento
    { const root = b.root || b.hips.parent; root.updateMatrixWorld(true);
      this.tmp.set(0, 0.25, 0.1).applyMatrix4(b.head.matrixWorld); const r = this.tmp2.setFromMatrixPosition(root.matrixWorld);
      const sc = root.matrixWorld.getMaxScaleOnAxis() || 1; this.headTop = (this.tmp.y - r.y) / sc; }
    this.first = false;
  }
  // v6: ponto do mundo entre as duas mãos (onde a vítima é segurada no agarrão)
  grabPoint(out = new THREE.Vector3()) {
    if (this.root) this.root.updateMatrixWorld(true);
    const a = this.b.handL.getWorldPosition(new THREE.Vector3()), c = this.b.handR.getWorldPosition(new THREE.Vector3());
    out.addVectors(a, c).multiplyScalar(0.5);
    // um pouco à frente das palmas (o peito da vítima fica entre os dedos)
    const fw = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root ? this.root.quaternion : new THREE.Quaternion());
    return out.addScaledVector(fw, 0.12).add(new THREE.Vector3(0, -0.12, 0));
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
