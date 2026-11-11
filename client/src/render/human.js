// Colegas de equipe (v5): manequim de madeira entalhada, estilo boneco articulado de artista — tórax com peito,
// costelas e escápulas, cintura com junta esférica, quadril, coxas/panturrilhas/antebraços torneados com volume,
// juntas esféricas mais claras com pinos de latão, mãos entalhadas e cabeça oval com queixo/nariz/sobrancelha.
// Madeira tingida escura (silhueta escura para leitura no co-op), veios + arranhões/desgaste, cachecol colorido
// (identifica o jogador) e lanterna funcional na mão direita. Sem mochila (a caixa nas costas da v1 foi removida).
// Geometrias e materiais são compartilhados entre os bonecos; dois níveis de detalhe (alto ≈ 7k tri, baixo ≈ 1,5k)
// trocados por distância (>16 m baixo, <14 m alto). Rig e nomes de juntas iguais à v4 (animações intactas).
import * as THREE from 'three';
import { dollWoodTextures } from './hand.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const gauss = (x, w) => Math.exp(-(x * x) / (w * w));
export const TEAMMATE_ACCENTS = [0x8a2a24, 0x2a5a80, 0x7a6a24, 0x2f6a3a];
export const TEAMMATE_LOD_FAR = 16, TEAMMATE_LOD_NEAR = 14;

function grp(parent, x, y, z) { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }
function hash(x, y, z) { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); }

// ---------------------------------------------------------------- geometria
// peça torneada ao longo de -Y (0 → -len): perfil r(t), seção elíptica, deslocamento do eixo (barriga da panturrilha
// etc.), pontas arredondadas, cor por vértice (desgaste claro nas partes salientes, encardido perto das juntas)
function turned(len, rFn, { seg = 20, rings = 24, sx = 1, sz = 1, zOff = null, xOff = null, round0 = 0.7, round1 = 0.7, vScale = 2.4 } = {}) {
  const pos = [], uv = [], col = [], idx = [];
  const ts = []; for (let i = 0; i <= rings; i++) ts.push(0.5 - 0.5 * Math.cos(Math.PI * i / rings));
  const rs = ts.map(t => rFn(t)); const rMax = Math.max(...rs);
  const r0 = rs[0] || rMax * 0.5, r1 = rs[rings] || rMax * 0.5;
  for (let i = 0; i <= rings; i++) {
    const t = ts[i]; let r = rs[i];
    const e0 = round0 ? Math.min(1, t * len / (r0 * round0)) : 1, e1 = round1 ? Math.min(1, (1 - t) * len / (r1 * round1)) : 1;
    r *= Math.sqrt(Math.max(0, 1 - (1 - e0) ** 2)) * Math.sqrt(Math.max(0, 1 - (1 - e1) ** 2));
    r = Math.max(r, 1e-4);
    const y = -t * len, cz = zOff ? zOff(t) : 0, cx = xOff ? xOff(t) : 0;
    const rel = rs[i] / rMax, grime = 1 - 0.22 * (gauss(t, 0.12) + gauss(1 - t, 0.12));
    for (let k = 0; k <= seg; k++) {
      const a = k / seg * Math.PI * 2, x = Math.sin(a) * r * sx + cx, z = Math.cos(a) * r * sz + cz;
      pos.push(x, y, z); uv.push(k / seg * 0.6, t * len * vScale);
      const c = clamp((0.74 + 0.26 * rel * rel) * grime * (0.95 + 0.08 * hash(k, i, len)), 0.4, 1);
      col.push(c, c * 0.985, c * 0.97);
    }
  }
  for (let i = 0; i < rings; i++) for (let k = 0; k < seg; k++) { const a = i * (seg + 1) + k, b = a + seg + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// perfil por pontos [t, r] com interpolação suave + sulcos entalhados [t0, largura, profundidade]
function prof(pts, grooves = []) {
  return (t) => {
    let r = pts[pts.length - 1][1];
    for (let i = 0; i < pts.length - 1; i++) if (t <= pts[i + 1][0]) { const [ta, ra] = pts[i], [tb, rb] = pts[i + 1]; r = ra + (rb - ra) * sstep(ta, tb, t); break; }
    for (const [t0, w, d] of grooves) r *= 1 - d * gauss(t - t0, w);
    return r;
  };
}
// esfera deformada: shape(x,y,z unitários) → [x,y,z] em metros; cor por convexidade (saliência = desgaste claro)
function blob(ws, hs, shape, { uvScale = 1 } = {}) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  const p = g.attributes.position, uvA = g.attributes.uv, col = [];
  let maxL = 0; const tmp = [];
  for (let i = 0; i < p.count; i++) {
    const [x, y, z] = shape(p.getX(i), p.getY(i), p.getZ(i));
    tmp.push([x, y, z]); maxL = Math.max(maxL, Math.hypot(x, y * 0.7, z));
  }
  for (let i = 0; i < p.count; i++) {
    const [x, y, z] = tmp[i]; p.setXYZ(i, x, y, z);
    uvA.setXY(i, uvA.getX(i) * uvScale, y * 2.4 + 0.5);
    const c = clamp((0.76 + 0.24 * (Math.hypot(x, y * 0.7, z) / maxL) ** 2) * (0.95 + 0.08 * hash(x * 40, y * 40, z * 40)), 0.4, 1);
    col.push(c, c * 0.985, c * 0.97);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
// "superelipsoide": deixa a esfera mais quadrada (peças entalhadas, não balões)
const sq = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);

// tórax: caixa torácica afunilando na cintura, peitoral, sulco do esterno, costas planas com escápulas
// achata os polos da esfera (seção da latitude engorda): topo/base quase planos, como bloco entalhado
function boxy(x, y, z, e) { const r = Math.hypot(x, z); if (r < 1e-6) return [x, z]; const k = Math.pow(r, e) / r; return [x * k, z * k]; }
function chestShape(x0, y, z0) {
  const [x, z] = boxy(x0, y, z0, 0.45);
  const v = sq(y, 0.7), X = sq(x, 0.75), Z = sq(z, 0.85);
  const hw = 0.11 + 0.07 * sstep(-1, 0.5, v) - 0.012 * sstep(0.8, 1, v);
  const hd = (z > 0 ? 0.098 : 0.088) - 0.018 * sstep(0.55, 1, v) - 0.014 * sstep(-0.3, -1, v);
  const px = X * hw, py = v * 0.19 + 0.28 - 0.045 * X * X * sstep(0.2, 1, v);   // ombros caindo a partir do pescoço
  let pz = Z * hd;
  if (z > 0) {
    pz += 0.02 * gauss(v - 0.35, 0.3) * gauss(Math.abs(X) - 0.45, 0.32) * z;            // peitorais
    pz -= 0.009 * gauss(X, 0.12) * sstep(-0.7, 0.1, v) * z;                                // esterno
    pz -= 0.007 * gauss(v - 0.02, 0.07) * gauss(Math.abs(X) - 0.45, 0.4) * z;             // borda inferior do peito
    pz -= 0.006 * gauss(v + 0.45, 0.05) * gauss(X, 0.35) * z;                              // sulco do abdome
  } else {
    pz -= 0.014 * gauss(v - 0.38, 0.28) * gauss(Math.abs(X) - 0.5, 0.28) * z;             // escápulas
    pz += 0.007 * gauss(X, 0.09) * z;                                                     // sulco da coluna
  }
  return [px, py, pz];
}
// quadril/pélvis: largo em cima, afunilando para a virilha, glúteos atrás
function pelvisShape(x0, y, z0) {
  const [x, z] = boxy(x0, y, z0, 0.55);
  const v = sq(y, 0.7), X = sq(x, 0.75), Z = sq(z, 0.85);
  const hw = 0.112 + 0.04 * sstep(-0.9, 0.5, v);
  let pz = Z * (z > 0 ? 0.084 : 0.088) * (1 - 0.18 * sstep(-0.2, -1, v));
  if (z < 0) pz += 0.02 * gauss(v + 0.2, 0.45) * gauss(Math.abs(X) - 0.45, 0.4) * z;   // glúteos
  if (z > 0) pz -= 0.006 * gauss(v - 0.55, 0.3) * z;                                       // barriga baixa
  const crotch = 0.035 * (1 - Math.min(1, Math.abs(X) * 1.6)) * sstep(-0.5, -1, v);       // virilha (entre as coxas)
  return [X * hw, v * 0.105 - 0.02 + crotch, pz];
}
// cabeça oval entalhada: crânio, maxilar afunilado, queixo, nariz, sobrancelhas, órbitas rasas
function headShape(x, y, z) {
  const v = sq(y, 0.92);
  const jaw = 1 - 0.26 * sstep(-0.1, -1, v), top = 1 - 0.06 * sstep(0.5, 1, v), back = z < 0 ? 1 + 0.08 * sstep(-0.4, 0.5, v) : 1;
  const px = x * 0.078 * jaw * top, py = v * 0.102 + 0.1;
  let pz = z * 0.09 * back * jaw ** (z < 0 ? 0.6 : 0.3);
  if (z > 0) {
    pz += 0.012 * gauss(v + 0.78, 0.22) * gauss(x, 0.35) * z;                                // queixo
    pz += 0.02 * gauss(v + 0.1, 0.2) * gauss(x, 0.1) * z * sstep(-0.45, -0.1, v);            // nariz
    pz += 0.007 * gauss(v - 0.22, 0.08) * gauss(Math.abs(x) - 0.35, 0.3) * z;              // sobrancelha
    pz -= 0.009 * gauss(v - 0.07, 0.11) * gauss(Math.abs(x) - 0.38, 0.16) * z;             // órbitas
  }
  return [px, py, pz];
}
// pé entalhado: sola plana, peito do pé, bico arredondado
function footShape(x, y, z) {
  const Y = Math.max(y, -0.6), front = sstep(-0.3, 1, z);
  const hw = 0.043 + 0.008 * front;
  const hh = 0.036 * (1 - 0.48 * front);
  return [sq(x, 0.8) * hw, -0.06 + (Y + 0.6) / 1.6 * 2 * hh, z * 0.105 + 0.045];
}
// palma da mão: bloco achatado (espessura em X), mais larga nos nós dos dedos
function palmShape(x, y, z) {
  const w = 0.034 + 0.006 * sstep(0.6, -0.8, y);
  return [sq(x, 0.85) * 0.016, y * 0.045 - 0.048, sq(z, 0.8) * w];
}
function waistShape(x, y, z) { return [x * 0.098, y * 0.06 + 0.075, z * 0.078]; }

const LOD = {
  hi: { limb: 12, rings: 11, blobW: 20, blobH: 15, head: [24, 18], ball: [11, 8], small: [8, 6], hand: true },
  lo: { limb: 6, rings: 5, blobW: 9, blobH: 6, head: [9, 7], ball: [6, 4], small: [5, 3], hand: false },
};
let GEO = null;
function geometries() {
  if (GEO) return GEO;
  GEO = {};
  for (const [lv, q] of Object.entries(LOD)) {
    const L = q.limb, R = q.rings;
    GEO[lv] = {
      chest: blob(q.blobW, q.blobH, chestShape, { uvScale: 1.6 }),
      pelvis: blob(q.blobW, q.blobH, pelvisShape, { uvScale: 1.6 }),
      waist: blob(q.ball[0] + 3, q.ball[1], waistShape),
      head: blob(q.head[0], q.head[1], headShape),
      foot: blob(q.ball[0] + 3, q.ball[1] + 1, footShape),
      // coxa: quadríceps volumoso na frente, sulcos entalhados nas pontas
      thigh: turned(0.4, prof([[0, 0.07], [0.18, 0.081], [0.55, 0.068], [1, 0.047]], q.hand ? [[0.08, 0.02, 0.06], [0.93, 0.02, 0.07]] : []), { seg: L, rings: R, sz: 0.95, zOff: t => 0.008 * Math.sin(t * Math.PI) }),
      // panturrilha: barriga atrás (z−) no terço superior
      calf: turned(0.38, prof([[0, 0.048], [0.22, 0.056], [0.6, 0.042], [1, 0.032]], q.hand ? [[0.07, 0.02, 0.06], [0.93, 0.02, 0.07]] : []), { seg: L, rings: R, sz: 1.05, zOff: t => -0.012 * Math.sin(Math.min(1, t * 1.6) * Math.PI) }),
      upperArm: turned(0.25, prof([[0, 0.046], [0.38, 0.05], [0.7, 0.042], [1, 0.035]], q.hand ? [[0.1, 0.025, 0.06], [0.92, 0.025, 0.07]] : []), { seg: L, rings: R, sx: 0.95, zOff: t => 0.005 * Math.sin(t * Math.PI) }),
      forearm: turned(0.225, prof([[0, 0.037], [0.22, 0.042], [0.7, 0.031], [1, 0.025]], q.hand ? [[0.08, 0.025, 0.07], [0.92, 0.025, 0.08]] : []), { seg: L, rings: R, sx: 1.18, sz: 0.92 }),
      neck: turned(0.1, prof([[0, 0.045], [0.5, 0.04], [1, 0.044]], q.hand ? [[0.5, 0.06, 0.05]] : []), { seg: L, rings: Math.max(4, Math.round(R / 2)) }),
      ball: new THREE.SphereGeometry(1, q.ball[0], q.ball[1]),
      small: new THREE.SphereGeometry(1, q.small[0], q.small[1]),
    };
    // bolas das juntas: UV de veio + cor por vértice uniforme (o material usa vertexColors)
    for (const b of [GEO[lv].ball, GEO[lv].small]) b.setAttribute('color', new THREE.Float32BufferAttribute(new Array(b.attributes.position.count * 3).fill(0.92), 3));
    const ww = GEO[lv].waist;
    if (!ww.attributes.color) ww.setAttribute('color', new THREE.Float32BufferAttribute(new Array(ww.attributes.position.count * 3).fill(1), 3));
  }
  GEO.pinHead = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
  return GEO;
}

// ---------------------------------------------------------------- materiais (compartilhados)
let stainCache = null;
// madeira tingida: textura dos bonecos + arranhões claros (desgaste), batidas escuras e manchas de verniz gasto
function stainedTextures() {
  if (stainCache) return stainCache;
  const base = dollWoodTextures();
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  g.drawImage(base.map.image, 0, 0, S, S);
  let seed = 31; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 14; i++) { const x = rnd() * S, y = rnd() * S, r = 20 + rnd() * 60; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(255,235,200,${0.07 + rnd() * 0.07})`); gr.addColorStop(1, 'rgba(255,235,200,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  for (let i = 0; i < 70; i++) { // arranhões finos claros
    const x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI, l = 6 + rnd() * 30;
    g.strokeStyle = `rgba(250,225,185,${0.18 + rnd() * 0.25})`; g.lineWidth = 0.6 + rnd() * 0.8;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + rnd() * 3, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  for (let i = 0; i < 40; i++) { const x = rnd() * S, y = rnd() * S; g.fillStyle = `rgba(40,22,10,${0.25 + rnd() * 0.3})`; g.beginPath(); g.ellipse(x, y, 1 + rnd() * 2.5, 1 + rnd() * 2, rnd() * 3, 0, 7); g.fill(); }
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  stainCache = { map: tex, normalMap: base.normalMap, roughnessMap: base.roughnessMap };
  return stainCache;
}
let MAT = null; const ACC = new Map();
function materials() {
  if (MAT) return MAT;
  const T = stainedTextures();
  const wood = (color, rough, ns) => new THREE.MeshStandardMaterial({ map: T.map, normalMap: T.normalMap, roughnessMap: T.roughnessMap, normalScale: new THREE.Vector2(ns, ns), color, roughness: rough, metalness: 0, vertexColors: true });
  MAT = {
    body: wood(0x7a5a40, 1.0, 0.55),     // nogueira tingida (escura → silhueta legível contra a lanterna)
    head: wood(0x80603f, 1.0, 0.5),
    joint: wood(0xb48e66, 0.85, 0.4),    // juntas um tom mais claro: articulações bem marcadas
    pin: new THREE.MeshStandardMaterial({ color: 0x8a6a34, roughness: 0.38, metalness: 0.85 }),
    flBody: new THREE.MeshStandardMaterial({ color: 0x26272b, metalness: 0.45, roughness: 0.42 }),
    flGrip: new THREE.MeshStandardMaterial({ color: 0x111113, metalness: 0.1, roughness: 0.8 }),
  };
  return MAT;
}
function accentMat(accent, M) {
  if (!ACC.has(accent)) ACC.set(accent, new THREE.MeshStandardMaterial({ map: M && M.T && M.T.fabric ? M.T.fabric.map : null, color: accent, roughness: 0.92, emissive: accent, emissiveIntensity: 0.07 }));
  return ACC.get(accent);
}

// ---------------------------------------------------------------- montagem
// cada peça tem versão alta e baixa; t.lodSets guarda as malhas de cada nível
function piece(t, parent, lv, geo, mat, pos, scale, rot) {
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.copy(pos); if (scale) m.scale.copy(scale); if (rot) m.rotation.copy(rot);
  parent.add(m); t.lodSets[lv].push(m); return m;
}
function both(t, parent, key, mat, pos, scale, rot) { const G = geometries(); for (const lv of ['hi', 'lo']) piece(t, parent, lv, G[lv][key], mat, pos, scale, rot); }
function ballJoint(t, parent, r, pos, axis = null, scale = null) {
  const G = geometries(), Mt = materials(), key = r < 0.04 ? 'small' : 'ball';
  for (const lv of ['hi', 'lo']) piece(t, parent, lv, G[lv][key], Mt.joint, pos, scale ? scale.clone().multiplyScalar(r) : V(r, r, r));
  if (axis) { // pino de latão atravessando a junta (dobradiça) — só no nível alto
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), axis);
    for (const sgn of [-1, 1]) { const m = piece(t, parent, 'hi', G.pinHead, Mt.pin, pos.clone().addScaledVector(axis, sgn * r * 0.93), V(r * 0.3, r * 0.14, r * 0.3)); m.quaternion.copy(q); }
  }
}
// falange torneada leve (compartilhada por comprimento/raio), ao longo de a → b
const PHAL = new Map();
function phalanx(a, b, r0, r1, mat) {
  const len = a.distanceTo(b), key = len.toFixed(4) + '_' + r0.toFixed(4);
  if (!PHAL.has(key)) PHAL.set(key, turned(len, prof([[0, r0], [0.5, (r0 + r1) * 0.47], [1, r1]]), { seg: 5, rings: 5, round0: 0.9, round1: 0.9, vScale: 6 }));
  const m = new THREE.Mesh(PHAL.get(key), mat); m.position.copy(a);
  m.quaternion.setFromUnitVectors(V(0, -1, 0), b.clone().sub(a).normalize()); return m;
}
// mão entalhada: palma em bloco + 4 dedos com 2 falanges + polegar; grip=true fecha em volta da lanterna
function carvedHand(t, parent, s, grip) {
  const G = geometries(), Mt = materials();
  const h = new THREE.Group(); parent.add(h);
  for (const lv of ['hi', 'lo']) piece(t, h, lv, lv === 'hi' ? (G.palmHi || (G.palmHi = blob(12, 9, palmShape))) : (G.palmLo || (G.palmLo = blob(6, 4, palmShape))), Mt.body);
  const fingers = new THREE.Group(); h.add(fingers); t.lodSets.hi.push(fingers);
  const mitt = new THREE.Mesh(G.lo.small, Mt.body); mitt.scale.set(0.016, 0.03, 0.03); mitt.position.set(-s * (grip ? 0.016 : 0.006), -0.1, 0); h.add(mitt); t.lodSets.lo.push(mitt);
  for (let f = 0; f < 4; f++) {
    const z = (1.5 - f) * 0.0165, L = [0.04, 0.045, 0.043, 0.034][f], curl = grip ? [1.05, 1.2, 1.3, 1.35][f] : 0.3 + f * 0.07;
    let p = V(-s * 0.003, -0.091, z), ang = 0;
    for (let k = 0; k < 2; k++) {
      ang += curl * (k === 0 ? 0.6 : 0.95); const l = L * [0.55, 0.45][k];
      const q = p.clone().add(V(-s * Math.sin(ang) * l, -Math.cos(ang) * l, 0));
      fingers.add(phalanx(p, q, 0.0085 - k * 0.0012, 0.0075 - k * 0.0014, Mt.body)); p = q;
    }
  }
  const t0 = V(-s * 0.012, -0.03, 0.03), t1 = t0.clone().add(V(-s * 0.016, -0.026, 0.016)), t2 = t1.clone().add(V(-s * (grip ? 0.016 : 0.008), -0.022, grip ? -0.004 : 0.008));
  fingers.add(phalanx(t0, t1, 0.0105, 0.009, Mt.body)); fingers.add(phalanx(t1, t2, 0.0088, 0.0072, Mt.body));
  return h;
}

export function buildTeammate(M, idx = 0) {
  const accent = TEAMMATE_ACCENTS[idx % TEAMMATE_ACCENTS.length];
  const Mt = materials(), cloth = accentMat(accent, M), G = geometries();
  const root = new THREE.Group(); root.name = 'teammate';
  const t = { root, lodSets: { hi: [], lo: [] }, lod: 'hi' };
  const body = grp(root, 0, 0, 0);       // sobe/desce (agachar, balanço)
  const pelvis = grp(body, 0, 0.94, 0);
  const parts = {};
  // quadril (bloco da pélvis)
  both(t, pelvis, 'pelvis', Mt.body);
  // pernas: junta esférica do quadril → coxa → joelho (dobradiça + patela) → panturrilha → tornozelo → pé
  for (const s of [-1, 1]) {
    const hip = grp(pelvis, s * 0.09, -0.04, 0);
    ballJoint(t, hip, 0.064, V(0, 0, 0));
    both(t, hip, 'thigh', Mt.body, V(0, -0.02, 0));
    const knee = grp(hip, 0, -0.42, 0);
    ballJoint(t, knee, 0.048, V(0, 0, 0), V(1, 0, 0));
    piece(t, knee, 'hi', G.hi.small, Mt.joint, V(0, 0.004, 0.036), V(0.03, 0.036, 0.016));            // patela
    both(t, knee, 'calf', Mt.body, V(0, -0.025, 0));
    const ankle = grp(knee, 0, -0.42, 0);
    ballJoint(t, ankle, 0.034, V(0, 0, 0), V(1, 0, 0));
    both(t, ankle, 'foot', Mt.body);
    parts['hip' + s] = hip; parts['knee' + s] = knee; parts['ankle' + s] = ankle;
  }
  // tronco: junta da cintura + tórax
  const spine = grp(pelvis, 0, 0.04, 0);
  const torso = grp(spine, 0, 0.0, 0);
  for (const lv of ['hi', 'lo']) piece(t, torso, lv, G[lv].waist, Mt.joint);
  both(t, torso, 'chest', Mt.body);
  // cachecol colorido (identifica o jogador): gola + ponta caída na frente
  const G2 = G.scarf || (G.scarf = { ring: new THREE.TorusGeometry(0.062, 0.024, 8, 18), ringLo: new THREE.TorusGeometry(0.062, 0.024, 5, 10), tail: turned(0.17, prof([[0, 0.022], [1, 0.026]]), { seg: 8, rings: 6, sx: 1.2, sz: 0.35, round0: 0.3, round1: 0.3 }) });
  for (const [lv, gg] of [['hi', G2.ring], ['lo', G2.ringLo]]) piece(t, torso, lv, gg, cloth, V(0, 0.475, 0.006), V(1.12, 1, 0.98), new THREE.Euler(Math.PI / 2 - 0.12, 0, 0));
  const tail = new THREE.Mesh(G2.tail, cloth); tail.position.set(0.035, 0.465, 0.085); tail.rotation.set(-0.22, 0, 0.18); torso.add(tail);
  // pescoço e cabeça
  const neckG = grp(torso, 0, 0.5, 0.0);
  both(t, neckG, 'neck', Mt.joint, V(0, 0.085, 0.006));
  const head = grp(neckG, 0, 0.09, 0.01);
  ballJoint(t, head, 0.03, V(0, 0.0, 0));
  both(t, head, 'head', Mt.head);
  // braços: ombro (junta esférica, "deltoide") → braço → cotovelo (dobradiça) → antebraço → punho → mão
  for (const s of [-1, 1]) {
    const sh = grp(torso, s * 0.2, 0.39, 0);
    ballJoint(t, sh, 0.056, V(s * 0.004, 0, 0), null, V(1.05, 1, 1));
    both(t, sh, 'upperArm', Mt.body, V(0, -0.03, 0));
    const el = grp(sh, 0, -0.28, 0);
    ballJoint(t, el, 0.037, V(0, 0, 0), V(1, 0, 0));
    both(t, el, 'forearm', Mt.body, V(0, -0.02, 0.005));
    const wr = grp(el, 0, -0.26, 0.01);
    ballJoint(t, wr, 0.023, V(0, 0, 0), V(0, 0, 1));
    const hd = carvedHand(t, wr, s, s < 0); hd.position.y = -0.006;
    parts['sh' + s] = sh; parts['el' + s] = el; parts['wr' + s] = wr;
  }
  // braçadeira na cor do jogador (lê de costas também)
  for (const [lv, gg] of [['hi', G2.ring], ['lo', G2.ringLo]]) piece(t, parts['sh1'], lv, gg, cloth, V(0, -0.11, 0.002), V(0.82, 0.82, 0.55), new THREE.Euler(Math.PI / 2, 0, 0));
  // lanterna na mão direita (lado -X do boneco, que olha para +Z); a lente aponta para -Y local do punho
  const fl = new THREE.Group(); fl.position.set(0.012, -0.075, 0.0); parts['wr-1'].add(fl);
  const FG = G.fl || (G.fl = {
    barrel: new THREE.CylinderGeometry(0.017, 0.017, 0.15, 18), grip: new THREE.CylinderGeometry(0.0185, 0.0185, 0.07, 18),
    head: new THREE.CylinderGeometry(0.027, 0.018, 0.045, 20), bezel: new THREE.TorusGeometry(0.025, 0.003, 4, 16), lens: new THREE.CircleGeometry(0.023, 18),
  });
  fl.add(new THREE.Mesh(FG.barrel, Mt.flBody));
  const gr = new THREE.Mesh(FG.grip, Mt.flGrip); gr.position.y = 0.01; fl.add(gr);
  const fhead = new THREE.Mesh(FG.head, Mt.flBody); fhead.position.y = -0.095; fl.add(fhead);
  const bz = new THREE.Mesh(FG.bezel, Mt.flBody); bz.rotation.x = Math.PI / 2; bz.position.y = -0.117; fl.add(bz);
  const lensMat = new THREE.MeshStandardMaterial({ color: 0xfff0d8, emissive: 0xfff0d8, emissiveIntensity: 3 });
  const lens = new THREE.Mesh(FG.lens, lensMat); lens.rotation.x = Math.PI / 2; lens.position.y = -0.118; fl.add(lens);
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  for (const m of t.lodSets.lo) m.visible = false;
  // LOD automático: usa a câmera principal (a que está na cena; câmeras de sombra não têm pai)
  const probe = (r, sc, cam) => { if (!t.lodLock && cam && cam.parent) updateTeammateLOD(t, cam); };
  t.lodSets.hi.concat(t.lodSets.lo).forEach(m => { if (m.isMesh && (m.geometry === G.hi.chest || m.geometry === G.lo.chest)) m.onBeforeRender = probe; });
  const S = () => ({ x: 0, v: 0 });
  return Object.assign(t, { body, pelvis, spine, torso, neck: neckG, head, parts, fl, lensMat, accent, phase: 0, dead: 0, sp: {}, S, walk: 0, run: 0, crouch: 0, first: true });
}

// troca de nível de detalhe: lod = 'hi' | 'lo' (fixa e trava) ou uma câmera (por distância, com histerese)
const _wp = new THREE.Vector3(), _cp = new THREE.Vector3();
export function setTeammateLOD(t, lod) { t.lodLock = lod === 'hi' || lod === 'lo'; applyLOD(t, lod === 'lo' ? 'lo' : 'hi'); }
export function updateTeammateLOD(t, camera) {
  t.root.getWorldPosition(_wp); camera.getWorldPosition(_cp);
  const d = _wp.distanceTo(_cp);
  const want = t.lod === 'hi' ? (d > TEAMMATE_LOD_FAR ? 'lo' : 'hi') : (d < TEAMMATE_LOD_NEAR ? 'hi' : 'lo');
  if (want !== t.lod) applyLOD(t, want);
  return t.lod;
}
function applyLOD(t, lv) { t.lod = lv; for (const m of t.lodSets.hi) m.visible = lv === 'hi'; for (const m of t.lodSets.lo) m.visible = lv === 'lo'; }
// triângulos renderizados do boneco no nível dado (para relatórios/testes)
export function teammateTriangles(t, lod = t.lod) {
  let n = 0; const saved = t.lod; applyLOD(t, lod);
  t.root.traverseVisible(o => { if (o.isMesh) { const g = o.geometry; n += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
  applyLOD(t, saved); return Math.round(n);
}
// luz da lanterna presa à mão (útil no trailer / laboratório; no jogo a luz remota é gerenciada pelo game.js)
export function attachTeammateFlashlight(t, { intensity = 30, distance = 18, angle = 0.4, penumbra = 0.5, decay = 1.5, shadow = false } = {}) {
  const sp = new THREE.SpotLight(0xe8f0ff, intensity, distance, angle, penumbra, decay);
  sp.position.set(0, -0.12, 0); sp.target.position.set(0, -2, 0); sp.castShadow = shadow;
  if (shadow) { sp.shadow.mapSize.set(1024, 1024); sp.shadow.bias = -0.0008; sp.shadow.camera.near = 0.15; }
  t.fl.add(sp, sp.target); t.flLight = sp; return sp;
}

function spr(st, target, om, ze, dt) {
  const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
  for (let i = 0; i < n; i++) { st.v += (om * om * (target - st.x) - 2 * ze * om * st.v) * h; st.x += st.v * h; }
  return st.x;
}
// anima a figura: passos (fase ligada à distância), braços, agachar, olhar, morte
export function animateTeammate(t, dt, s) {
  dt = Math.min(Math.max(dt, 0), 0.1); if (!dt) return;
  if (s.camera) updateTeammateLOD(t, s.camera);
  const speed = s.speed || 0;
  const k = (name, target, om = 12, ze = 0.7) => { const st = t.sp[name] || (t.sp[name] = { x: target, v: 0 }); if (t.first) { st.x = target; st.v = 0; } return spr(st, target, om, ze, dt); };
  t.walk += (clamp(speed / 1.4, 0, 1) - t.walk) * Math.min(1, dt * 6);
  t.run += ((speed > 3.2 ? 1 : 0) - t.run) * Math.min(1, dt * 4);
  t.crouch += ((s.crouch ? 1 : 0) - t.crouch) * Math.min(1, dt * 7);
  const stepLen = s.crouch ? 0.55 : speed > 3.2 ? 0.95 : 0.75;
  t.phase += dt * speed / stepLen * Math.PI; // meio ciclo por passo
  const ph = t.phase, w = t.walk, run = t.run, cr = t.crouch;
  const amp = Math.asin(clamp(stepLen / 1.72, 0, 0.95)) * w * (1 - 0.35 * cr);
  const sn = Math.sin(ph), cs = Math.cos(ph);
  // pernas
  const P = t.parts;
  P['hip-1'].rotation.x = k('hipL', -sn * amp - cr * 1.05 - run * 0.15, 16, 0.8);
  P['hip1'].rotation.x = k('hipR', sn * amp - cr * 1.05 - run * 0.15, 16, 0.8);
  P['knee-1'].rotation.x = k('kneeL', Math.max(0, cs) * (0.55 + run * 0.7) * w + cr * 1.75 + 0.04, 18, 0.8);
  P['knee1'].rotation.x = k('kneeR', Math.max(0, -cs) * (0.55 + run * 0.7) * w + cr * 1.75 + 0.04, 18, 0.8);
  P['ankle-1'].rotation.x = k('ankL', -Math.max(0, cs) * 0.3 * w - cr * 0.6 + Math.max(0, sn) * 0.2 * w, 18, 0.8);
  P['ankle1'].rotation.x = k('ankR', -Math.max(0, -cs) * 0.3 * w - cr * 0.6 + Math.max(0, -sn) * 0.2 * w, 18, 0.8);
  // corpo: balanço vertical (2x por ciclo), lateral, torção e inclinação
  const bob = -Math.abs(cs) * (0.025 + run * 0.03) * w;
  t.body.position.y = k('bodyY', -0.38 * cr + bob + (1 - Math.cos(amp)) * -0.06, 14, 0.75);
  t.pelvis.rotation.y = k('pelY', -sn * 0.12 * w, 12, 0.7); t.pelvis.rotation.z = k('pelZ', cs * 0.04 * w, 12, 0.7);
  t.spine.rotation.x = k('spX', cr * 0.42 + run * 0.28 + Math.abs(cs) * 0.03 * w, 10, 0.65);
  t.spine.rotation.y = k('spY', sn * 0.16 * w, 10, 0.6);
  // braço esquerdo balança oposto à perna esquerda; braço direito aponta a lanterna (com leve atraso)
  const pitch = s.pitch || 0;
  P['sh1'].rotation.x = k('shL', -sn * (0.45 + run * 0.6) * w - cr * 0.3 - run * 0.2, 9, 0.55);
  P['sh1'].rotation.z = k('shLz', 0.08 + run * 0.1, 9, 0.6);
  P['el1'].rotation.x = k('elL', -0.2 - Math.max(0, -sn) * 0.4 * w - run * 0.9 - cr * 0.3, 9, 0.5);
  P['sh-1'].rotation.x = k('shR', -1.3 - pitch * 0.85 + sn * 0.05 * w - t.spine.rotation.x - t.pelvis.rotation.x, 10, 0.6);
  P['sh-1'].rotation.z = k('shRz', -0.12, 10, 0.6);
  P['el-1'].rotation.x = k('elR', -0.28 - run * 0.25 + Math.abs(cs) * 0.04 * w, 10, 0.55);
  P['wr-1'].rotation.x = k('wrR', 0.0, 10, 0.6);
  // cabeça acompanha o olhar
  t.neck.rotation.x = k('nk', -pitch * 0.35 - t.spine.rotation.x * 0.7, 10, 0.7);
  t.head.rotation.x = k('hd', -pitch * 0.35, 12, 0.7);
  t.head.rotation.y = k('hdY', -sn * 0.06 * w, 10, 0.7);
  // morte: cai de lado (mola amortecida → sem estalo)
  t.dead = k('dead', s.alive ? 0 : 1, 6, 0.85);
  // pose de corpo caído (deitado de lado, encolhido, braço jogado para cima, cabeça virada) —
  // mistura a pose viva com a pose caída conforme a mola 'dead' (0 → 1)
  const d = clamp(t.dead, 0, 1.1);
  if (d > 0.001) {
    const mix = (o, ax, v) => { o.rotation[ax] += (v - o.rotation[ax]) * Math.min(d, 1); };
    mix(P['hip-1'], 'x', -0.35); mix(P['hip1'], 'x', -0.95); mix(P['knee-1'], 'x', 0.55); mix(P['knee1'], 'x', 1.35);
    mix(P['ankle-1'], 'x', 0.25); mix(P['ankle1'], 'x', 0.1);
    mix(P['sh1'], 'x', -2.4); mix(P['sh1'], 'z', 0.35); mix(P['el1'], 'x', -0.35);
    mix(P['sh-1'], 'x', -0.7); mix(P['sh-1'], 'z', -0.25); mix(P['el-1'], 'x', -1.1); mix(P['wr-1'], 'x', 0.4);
    mix(t.spine, 'x', 0.32); mix(t.spine, 'y', 0.12); mix(t.pelvis, 'y', 0); mix(t.pelvis, 'z', 0);
    mix(t.neck, 'x', 0.25); mix(t.head, 'x', 0.1); mix(t.head, 'y', 0.55); mix(t.head, 'z', 0.2);
    t.body.position.y = t.body.position.y * (1 - Math.min(d, 1));
  }
  t.root.rotation.z = t.dead * 1.52;
  t.body.position.x = Math.min(d, 1) * 0.12; // com a raiz girada ~90°, +X local vira 'para cima': o ombro/quadril apoia NO chão
  t.lensMat.emissiveIntensity = s.fl ? 3 : 0;
  t.first = false;
}
