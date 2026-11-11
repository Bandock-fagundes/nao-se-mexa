// Colegas de equipe (v5): manequim de madeira entalhada, estilo boneco articulado de artista — tórax com peito,
// costelas e escápulas, cintura com junta esférica, quadril, coxas/panturrilhas/antebraços torneados com volume,
// juntas esféricas mais claras com pinos de latão, mãos entalhadas e cabeça oval com queixo/nariz/sobrancelha.
// Madeira tingida escura (silhueta escura para leitura no co-op), veios + arranhões/desgaste, acessório escolhido
// pelo jogador (v7: cachecol/fedora/gorro na cor da paleta — render/accessories.js) e lanterna funcional na mão direita. Sem mochila (a caixa nas costas da v1 foi removida).
// Geometrias e materiais são compartilhados entre os bonecos; dois níveis de detalhe (alto ≈ 7k tri, baixo ≈ 1,5k)
// trocados por distância (>16 m baixo, <14 m alto). Rig e nomes de juntas iguais à v4 (animações intactas).
import * as THREE from 'three';
import { dollWoodTextures } from './hand.js';
import { attachAccessory, updateAccessory } from './accessories.js';
import { SLOT_COLORS } from '../../../shared/look.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const gauss = (x, w) => Math.exp(-(x * x) / (w * w));
const lerp = (a, b, t) => a + (b - a) * t;
export const TEAMMATE_ACCENTS = SLOT_COLORS; // v7: cor padrão por vaga (quem não escolheu aparência)
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
  const hw = 0.043 + 0.007 * front;
  const hh = 0.036 * (1 - 0.42 * front);
  return [sq(x, 0.8) * hw, -0.06 + (Y + 0.6) / 1.6 * 2 * hh, z * 0.082 + 0.024];
}
// v6: dedos do pé (peça separada, dobra na linha da "bola" do pé — o calcanhar sobe e os dedos ficam no chão)
function toeShape(x, y, z) {
  const Y = Math.max(y, -0.6);
  return [sq(x, 0.8) * 0.046, -0.015 + (Y + 0.6) / 1.6 * 0.03, z * 0.034 + 0.026];
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
      toe: blob(q.ball[0] + 1, q.ball[1], toeShape),
      // coxa: quadríceps volumoso na frente, sulcos entalhados nas pontas
      thigh: turned(0.345, prof([[0, 0.07], [0.18, 0.081], [0.55, 0.068], [1, 0.047]], q.hand ? [[0.08, 0.02, 0.06], [0.93, 0.02, 0.07]] : []), { seg: L, rings: R, sz: 0.95, zOff: t => 0.008 * Math.sin(t * Math.PI) }),
      // panturrilha: barriga atrás (z−) no terço superior
      calf: turned(0.335, prof([[0, 0.048], [0.22, 0.056], [0.6, 0.042], [1, 0.032]], q.hand ? [[0.07, 0.02, 0.06], [0.93, 0.02, 0.07]] : []), { seg: L, rings: R, sz: 1.05, zOff: t => -0.012 * Math.sin(Math.min(1, t * 1.6) * Math.PI) }),
      upperArm: turned(0.212, prof([[0, 0.046], [0.38, 0.05], [0.7, 0.042], [1, 0.035]], q.hand ? [[0.1, 0.025, 0.06], [0.92, 0.025, 0.07]] : []), { seg: L, rings: R, sx: 0.95, zOff: t => 0.005 * Math.sin(t * Math.PI) }),
      forearm: turned(0.192, prof([[0, 0.037], [0.22, 0.042], [0.7, 0.031], [1, 0.025]], q.hand ? [[0.08, 0.025, 0.07], [0.92, 0.025, 0.08]] : []), { seg: L, rings: R, sx: 1.18, sz: 0.92 }),
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
    joint: wood(0x5a4030, 0.95, 0.45),   // v6b: juntas DISCRETAS — mesma madeira, um tom mais escuro (nada de bolas claras)
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
  void axis; // v6b: sem pinos de latão (as juntas ficam discretas, só a bola escura na fresta entre os segmentos)
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

// look (v7) = { acc: 'scarf'|'fedora'|'beanie', col } — sem look: cachecol na cor da vaga idx
export function buildTeammate(M, idx = 0, look = null) {
  const accent = look && Number.isFinite(look.col) ? look.col : TEAMMATE_ACCENTS[idx % TEAMMATE_ACCENTS.length];
  const Mt = materials(), G = geometries();
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
    ballJoint(t, hip, 0.056, V(0, 0, 0));
    both(t, hip, 'thigh', Mt.body, V(0, -0.04, 0));                   // coxa: -0,04 … -0,385 (fresta até o joelho)
    const knee = grp(hip, 0, -0.42, 0);
    ballJoint(t, knee, 0.04, V(0, 0, 0), V(1, 0, 0));
    both(t, knee, 'calf', Mt.body, V(0, -0.042, 0));                   // canela: -0,042 … -0,377 (fresta até o tornozelo)
    const ankle = grp(knee, 0, -0.42, 0);
    ballJoint(t, ankle, 0.03, V(0, 0, 0), V(1, 0, 0));
    both(t, ankle, 'foot', Mt.body);
    const toe = grp(ankle, 0, -0.045, 0.1);
    piece(t, toe, 'hi', G.hi.small, Mt.joint, V(0, 0, 0), V(0.036, 0.012, 0.012));
    both(t, toe, 'toe', Mt.body);
    parts['hip' + s] = hip; parts['knee' + s] = knee; parts['ankle' + s] = ankle; parts['toe' + s] = toe;
  }
  // tronco: junta da cintura + tórax
  const spine = grp(pelvis, 0, 0.04, 0);
  const torso = grp(spine, 0, 0.0, 0);
  for (const lv of ['hi', 'lo']) piece(t, torso, lv, G[lv].waist, Mt.joint);
  both(t, torso, 'chest', Mt.body);
  // pescoço e cabeça
  const neckG = grp(torso, 0, 0.5, 0.0);
  both(t, neckG, 'neck', Mt.joint, V(0, 0.085, 0.006));
  const head = grp(neckG, 0, 0.09, 0.01);
  ballJoint(t, head, 0.03, V(0, 0.0, 0));
  both(t, head, 'head', Mt.head);
  // braços: ombro (junta esférica, "deltoide") → braço → cotovelo (dobradiça) → antebraço → punho → mão
  for (const s of [-1, 1]) {
    // v6: cintura escapular (clavícula) — o ombro sobe/desce/avança com o braço e com a respiração
    const clav = grp(torso, s * 0.045, 0.43, 0.0);
    piece(t, clav, 'hi', G.hi.small, Mt.joint, V(s * 0.02, 0.0, 0.012), V(0.018, 0.018, 0.018));
    parts['clav' + s] = clav;
    const sh = grp(clav, s * 0.155, -0.04, 0);
    ballJoint(t, sh, 0.05, V(s * 0.004, 0, 0), null, V(1.05, 1, 1));
    both(t, sh, 'upperArm', Mt.body, V(0, -0.038, 0));               // braço: -0,038 … -0,25 (fresta até o cotovelo)
    const el = grp(sh, 0, -0.28, 0);
    ballJoint(t, el, 0.032, V(0, 0, 0), V(1, 0, 0));
    both(t, el, 'forearm', Mt.body, V(0, -0.034, 0.005));            // antebraço: -0,034 … -0,226 (fresta até o punho)
    const wr = grp(el, 0, -0.26, 0.01);
    ballJoint(t, wr, 0.02, V(0, 0, 0), V(0, 0, 1));
    const hd = carvedHand(t, wr, s, s < 0); hd.position.y = -0.016;
    parts['sh' + s] = sh; parts['el' + s] = el; parts['wr' + s] = wr;
  }
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
  Object.assign(t, { torso, head });
  attachAccessory(t, { acc: (look && look.acc) || 'scarf', col: accent }, { chest: G.hi.chest, head: G.hi.head });
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
// v7: troca a aparência de um boneco já montado (prévia do menu / aparência que chegou depois)
export function setTeammateLook(t, look) {
  const G = geometries(); if (!look) return;
  if (t.look && t.look.acc === look.acc && t.look.col === look.col) return;
  attachAccessory(t, look, { chest: G.hi.chest, head: G.hi.head }); t.accent = look.col;
  t.root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  applyLOD(t, t.lod);
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

// =====================================================================================================
// v6 — ANIMAÇÃO COM ESQUELETO DE VERDADE
//  • pés plantados no chão: cada pé guarda sua posição no MUNDO; enquanto apoia ele não se mexe (zero
//    deslizamento) e, na hora do passo, voa num arco até o ponto previsto para a próxima pisada;
//  • IK de duas juntas (quadril → joelho → tornozelo) resolvendo o ângulo da coxa e do joelho para o
//    tornozelo alcançar o pé; o tornozelo mantém o pé paralelo ao chão (calcanhar sobe no fim do apoio,
//    dedos dobram na bola do pé, calcanhar toca primeiro na pisada);
//  • altura do quadril limitada pelo alcance das pernas (pêndulo invertido → balanço natural, joelhos
//    nunca esticam além do possível, pés nunca flutuam);
//  • corpo ereto, olhando para onde anda (game.js vira a raiz na direção do movimento; a cabeça e o
//    braço da lanterna viram para onde o jogador olha: headYaw);
//  • agachar: quadril desce, joelhos dobram pelo IK com os pés no chão;
//  • morte: agarrão (o corpo é puxado/erguido até as mãos da criatura, pernas se debatendo, mãos
//    segurando os braços dela) e depois QUEDA COM FÍSICA: boneco de pano (verlet) com as mesmas
//    juntas — cotovelos e joelhos dobram só para o lado certo, o corpo bate e assenta no chão.
// =====================================================================================================
function spr(st, target, om, ze, dt) {
  const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
  for (let i = 0; i < n; i++) { st.v += (om * om * (target - st.x) - 2 * ze * om * st.v) * h; st.x += st.v * h; }
  return st.x;
}
const L_THIGH = 0.42, L_SHIN = 0.42, ANKLE_H = 0.06, HIP_Y = 0.90, HIP_X = 0.09;
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m1 = new THREE.Matrix4(), _e1 = new THREE.Euler();
const TOE_AXIS = new THREE.Vector3(0, -0.055, 0.155).normalize();
const Y_UP = new THREE.Vector3(0, 1, 0), NEG_Y = new THREE.Vector3(0, -1, 0), POS_Z = new THREE.Vector3(0, 0, 1);
const wrapPI = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

// ângulo do corpo (convenção do jogador: yaw 0 olha para −Z) dado o olhar e a velocidade no mundo:
// andando, o corpo vira para onde anda (andar para trás = continua de frente, dando ré); a cabeça
// compensa a diferença. Devolve { yaw, headYaw }.
export function teammateFacing(t, lookYaw, vx, vz, dt) {
  const sp = Math.hypot(vx, vz);
  if (t.bodyYaw === undefined || t.first) t.bodyYaw = lookYaw;
  let want = lookYaw;
  if (sp > 0.35) {
    const mv = Math.atan2(-vx, -vz);
    const d = wrapPI(mv - lookYaw);
    want = Math.abs(d) < 1.95 ? mv : wrapPI(mv + Math.PI); // ré: costas para o movimento
  }
  // limite: a cabeça gira no máximo ~75°; o resto o corpo acompanha
  const rate = sp > 0.35 ? 7 : 3.5;
  t.bodyYaw = wrapPI(t.bodyYaw + wrapPI(want - t.bodyYaw) * Math.min(1, dt * rate));
  let hy = wrapPI(lookYaw - t.bodyYaw);
  if (Math.abs(hy) > 1.3) { t.bodyYaw = wrapPI(lookYaw - Math.sign(hy) * 1.3); hy = Math.sign(hy) * 1.3; }
  return { yaw: t.bodyYaw, headYaw: hy };
}

// IK de duas juntas no espaço do pai do quadril (pélvis). H = junta do quadril, A = alvo do tornozelo,
// pole = direção para onde o joelho aponta. Escreve hip.quaternion e knee.rotation.x.
function solveLegIK(hip, knee, H, A, pole) {
  const D = _v1.subVectors(A, H); let d = D.length();
  const dmax = (L_THIGH + L_SHIN) * 0.9995; d = clamp(d, 0.12, dmax);
  const dh = D.normalize();
  const p = _v2.copy(pole).addScaledVector(dh, -pole.dot(dh)); if (p.lengthSq() < 1e-8) p.set(0, 0, 1); p.normalize();
  const ca = clamp((L_THIGH * L_THIGH + d * d - L_SHIN * L_SHIN) / (2 * L_THIGH * d), -1, 1), al = Math.acos(ca);
  const ck = clamp((L_THIGH * L_THIGH + L_SHIN * L_SHIN - d * d) / (2 * L_THIGH * L_SHIN), -1, 1);
  const kneeA = Math.PI - Math.acos(ck);
  const thigh = _v3.copy(dh).multiplyScalar(Math.cos(al)).addScaledVector(p, Math.sin(al));
  const Yb = _v4.copy(thigh).negate();
  const Zb = new THREE.Vector3().copy(p).multiplyScalar(Math.cos(al)).addScaledVector(dh, -Math.sin(al)).normalize();
  const Xb = new THREE.Vector3().crossVectors(Yb, Zb).normalize();
  _m1.makeBasis(Xb, Yb, Zb); hip.quaternion.setFromRotationMatrix(_m1);
  knee.rotation.set(kneeA, 0, 0);
}
// IK do braço: o cotovelo aponta para 'pole' (para trás/baixo) e o antebraço dobra para a frente
const L_UARM = 0.28, L_FARM = 0.27;
function solveArmIK(sh, el, H, A, pole) {
  const D = new THREE.Vector3().subVectors(A, H); let d = D.length();
  d = clamp(d, 0.08, (L_UARM + L_FARM) * 0.999); const dh = D.normalize();
  const p = pole.clone().addScaledVector(dh, -pole.dot(dh)); if (p.lengthSq() < 1e-8) p.set(0, -1, -1); p.normalize();
  const al = Math.acos(clamp((L_UARM * L_UARM + d * d - L_FARM * L_FARM) / (2 * L_UARM * d), -1, 1));
  const bend = Math.PI - Math.acos(clamp((L_UARM * L_UARM + L_FARM * L_FARM - d * d) / (2 * L_UARM * L_FARM), -1, 1));
  const up = new THREE.Vector3().copy(dh).multiplyScalar(Math.cos(al)).addScaledVector(p, Math.sin(al));
  const Yb = up.clone().negate();
  const Zb = new THREE.Vector3().copy(p).multiplyScalar(Math.cos(al)).addScaledVector(dh, -Math.sin(al)).normalize().negate();
  const Xb = new THREE.Vector3().crossVectors(Yb, Zb).normalize();
  _m1.makeBasis(Xb, Yb, Zb); sh.quaternion.setFromRotationMatrix(_m1);
  el.rotation.set(-bend, 0, 0);
}
// gira 'g' (filho de um pai já atualizado) para que o eixo local 'axis' aponte para o ponto do mundo 'target'
function aimAt(g, target, axis = NEG_Y) {
  g.parent.updateMatrixWorld(true);
  const pos = _v1.copy(g.position).applyMatrix4(g.parent.matrixWorld);
  const dir = _v2.subVectors(target, pos); if (dir.lengthSq() < 1e-10) return;
  g.parent.getWorldQuaternion(_q1).invert(); dir.applyQuaternion(_q1).normalize();
  g.quaternion.setFromUnitVectors(axis, dir);
}
function setWorldQuat(g, qw) { g.parent.updateMatrixWorld(true); g.parent.getWorldQuaternion(_q1).invert(); g.quaternion.copy(_q1).multiply(qw); }

function initGait(t) {
  t.cyc = 0; t.vel = new THREE.Vector3(); t.lastPos = null; t.idleCd = 0; t.liftY = 0;
  t.feet = [1, -1].map(s => ({ s, w: new THREE.Vector3(), planted: true, sw: null, pitch: 0, prevF: 0 }));
  t.feetReady = false;
}
// posição de repouso do pé no mundo (sob o quadril, levemente para fora)
function restFoot(t, f, out, fwdOff = 0) {
  const r = t.root, y = r.rotation.y, c = Math.cos(y), sn = Math.sin(y);
  const lx = f.s * (HIP_X + 0.012), lz = 0.02 + fwdOff;
  return out.set(r.position.x + lx * c + lz * sn, r.position.y, r.position.z - lx * sn + lz * c);
}

// anima a figura. s: { speed, crouch, alive, fl, pitch, headYaw, camera, ground(x,z)→y do mundo,
//   grab: ponto do mundo (mãos da criatura) enquanto ela segura o corpo, solid(x,y,z)→bool (paredes) }
export function animateTeammate(t, dt, s) {
  dt = Math.min(Math.max(dt, 0), 0.1); if (!dt) return;
  if (s.camera) updateTeammateLOD(t, s.camera);
  if (!t.feet) initGait(t);
  const k = (name, target, om = 12, ze = 0.7) => { const st = t.sp[name] || (t.sp[name] = { x: target, v: 0 }); if (t.first) { st.x = target; st.v = 0; } return spr(st, target, om, ze, dt); };
  const P = t.parts, root = t.root;
  // ---------------- morte ----------------
  if (!s.alive) { deathUpdate(t, dt, s); t.lensMat.emissiveIntensity = 0; t.first = false; updateAccessory(t, dt); return; }
  if (t.rag || t.death) { t.rag = null; t.death = null; root.rotation.z = 0; t.body.position.set(0, 0, 0); t.pelvis.position.set(0, 0.94, 0); t.torso.rotation.set(0, 0, 0); for (const sd of [1, -1]) { t.parts['clav' + sd].rotation.set(0, 0, 0); t.parts['wr' + sd].rotation.set(0, 0, 0); } initGait(t); t.first = true; }
  root.rotation.z = 0;
  const ground = s.ground || null;
  const gy = (x, z) => ground ? ground(x, z) : root.position.y;
  // ---------------- velocidade real da raiz (mundo) ----------------
  const yaw = root.rotation.y, cy = Math.cos(yaw), sy = Math.sin(yaw);
  const fwd = _v3.set(sy, 0, cy).clone(), right = new THREE.Vector3(-cy, 0, sy); // frente do boneco = +Z local
  let vw = null;
  if (t.lastPos) {
    const dx = root.position.x - t.lastPos.x, dz = root.position.z - t.lastPos.z;
    if (Math.hypot(dx, dz) > 1.5) { initGait(t); } else vw = new THREE.Vector3(dx / dt, 0, dz / dt);
  }
  t.lastPos = (t.lastPos || new THREE.Vector3()).copy(root.position);
  if (!vw) vw = fwd.clone().multiplyScalar(s.speed || 0);
  t.vel.lerp(vw, Math.min(1, dt * 10));
  const v = Math.hypot(t.vel.x, t.vel.z);
  const crouch = !!s.crouch;
  t.walk += (clamp(v / 1.4, 0, 1) - t.walk) * Math.min(1, dt * 6);
  t.run += ((v > 3.0 ? 1 : 0) - t.run) * Math.min(1, dt * 4);
  t.crouch += ((crouch ? 1 : 0) - t.crouch) * Math.min(1, dt * 6);
  const w = t.walk, run = t.run, cr = t.crouch;
  // ---------------- marcha ----------------
  const stride = crouch ? 0.85 : lerp(1.25, 2.0, run) + 0.1 * clamp(v - 1.4, 0, 1.5);  // passada (2 passos)
  const duty = lerp(0.62, 0.4, run);
  const lift = crouch ? 0.06 : lerp(0.085, 0.17, run);
  const moving = v > 0.22;
  const T = moving ? stride / v : 99;
  if (moving) t.cyc += dt / T;
  if (!t.feetReady) { for (const f of t.feet) { restFoot(t, f, f.w); f.w.y = gy(f.w.x, f.w.z); } t.feetReady = true; }
  for (const f of t.feet) {
    // teleporte / pé esquecido longe: recoloca
    const rp = restFoot(t, f, _v1);
    if (Math.hypot(f.w.x - rp.x, f.w.z - rp.z) > 1.6) { f.w.copy(rp); f.w.y = gy(rp.x, rp.z); f.planted = true; f.sw = null; }
  }
  const vdir = v > 1e-3 ? new THREE.Vector3(t.vel.x / v, 0, t.vel.z / v) : fwd.clone();
  for (const f of t.feet) {
    const other = t.feet.find(o => o !== f);
    const fr = ((t.cyc + (f.s > 0 ? 0 : 0.5)) % 1 + 1) % 1;
    if (moving && f.planted) {
      const cross = f.prevF < duty && fr >= duty;
      const rp = restFoot(t, f, _v1);
      const lag = _v2.subVectors(f.w, rp); const along = lag.dot(vdir), side = Math.abs(lag.dot(right));
      const tooFar = along < -stride * 0.55 || side > 0.32 || along > stride * 0.6;
      if ((cross || tooFar) && (other.planted || run > 0.5 || tooFar)) {
        const dur = clamp((1 - duty) * T, 0.14, 0.6);
        f.planted = false; f.sw = { u: 0, dur, from: f.w.clone(), lift, run };
      }
    }
    f.prevF = fr;
  }
  // parado: passos de acomodação (depois de parar ou girar no lugar)
  t.idleCd -= dt;
  if (!moving && t.idleCd <= 0 && t.feet.every(f => f.planted)) {
    let best = null, be = crouch ? 0.16 : 0.11;
    for (const f of t.feet) { const rp = restFoot(t, f, _v1); const e = Math.hypot(f.w.x - rp.x, f.w.z - rp.z); if (e > be) { be = e; best = f; } }
    if (best) { best.planted = false; best.sw = { u: 0, dur: 0.32, from: best.w.clone(), lift: 0.05, run: 0, idle: true }; t.idleCd = 0.08; }
  }
  // pés no ar: alvo previsto (onde a raiz vai estar no meio do próximo apoio), arco com subida rápida
  for (const f of t.feet) {
    if (!f.sw) continue;
    const sw = f.sw; sw.u = Math.min(1, sw.u + dt / sw.dur);
    const remain = (1 - sw.u) * sw.dur;
    const tgt = restFoot(t, f, _v1);
    if (!sw.idle && moving) { tgt.addScaledVector(t.vel, remain); tgt.addScaledVector(vdir, duty * stride * 0.5); }
    tgt.y = gy(tgt.x, tgt.z);
    const u = sw.u, e = u * u * (3 - 2 * u);
    f.w.x = lerp(sw.from.x, tgt.x, e); f.w.z = lerp(sw.from.z, tgt.z, e);
    f.w.y = lerp(sw.from.y, tgt.y, e) + sw.lift * Math.sin(Math.PI * Math.pow(u, 0.8));
    if (u >= 1) { f.sw = null; f.planted = true; f.w.y = tgt.y; }
  }
  // inclinação do pé: calcanhar sobe no fim do apoio (pé atrás do quadril), dedos para cima na pisada
  for (const f of t.feet) {
    let pt = 0;
    if (f.sw) { const u = f.sw.u; pt = f.sw.idle ? 0 : (u < 0.35 ? lerp(0.55, 0.25, u / 0.35) * (1 - u) : -0.32 * sstep(0.55, 0.95, u)) * (0.6 + 0.4 * w); }
    else { const rp = restFoot(t, f, _v1); const along = _v2.subVectors(f.w, rp).dot(vdir); pt = moving ? clamp((-along - stride * 0.12) / (stride * 0.3), 0, 1) * 0.6 * w : 0; }
    f.pitch += (pt - f.pitch) * Math.min(1, dt * 18);
  }
  // ---------------- pose do tronco ----------------
  const ph = t.cyc * Math.PI * 2, cL = Math.cos(ph); // cL > 0: perna esquerda à frente
  const hy = clamp(s.headYaw || 0, -1.3, 1.3);
  const pitch = s.pitch || 0;
  t.pelvis.rotation.y = k('pelY', -cL * lerp(0.1, 0.16, run) * w + hy * 0.08, 12, 0.7);
  t.pelvis.rotation.x = k('pelX', cr * 0.25 + run * 0.12, 10, 0.75);
  const swSide = t.feet[0].planted ? -1 : (t.feet[1].planted ? 1 : 0);
  t.pelvis.rotation.z = k('pelZ', swSide * 0.035 * w * (1 - run * 0.5), 10, 0.7);
  t.spine.rotation.x = k('spX', cr * 0.22 + run * 0.16 + w * 0.04, 10, 0.65);
  t.spine.rotation.y = k('spY', cL * lerp(0.13, 0.2, run) * w + hy * 0.22 - t.pelvis.rotation.y * 0.3, 10, 0.6);
  t.spine.rotation.z = k('spZ', -t.pelvis.rotation.z * 0.8, 10, 0.7);
  // quadril: altura desejada, depois limitada pelo alcance das pernas (pés plantados nunca flutuam)
  let bodyY = k('bodyY', -0.03 - 0.29 * cr - run * 0.05, 12, 0.8);
  const fwdLean = k('lean', 0.02 * w + run * 0.06 - cr * 0.03, 10, 0.8);
  t.body.position.set(0, bodyY, fwdLean);
  root.updateMatrixWorld(true);
  let drop = 0;
  for (const f of t.feet) {
    if (!f.planted && !(f.sw && (f.sw.u < 0.08 || f.sw.u > 0.92))) continue;
    const hipG = P['hip' + f.s]; hipG.getWorldPosition(_v1);
    const ank = _v2.copy(f.w); ank.y += ANKLE_H + 0.13 * Math.max(0, f.pitch) * 0.55;
    const hd = Math.hypot(_v1.x - ank.x, _v1.z - ank.z), Lr = (L_THIGH + L_SHIN) * 0.985;
    const maxY = ank.y + Math.sqrt(Math.max(0, Lr * Lr - hd * hd));
    drop = Math.max(drop, _v1.y - maxY);
  }
  if (drop > 0) { bodyY -= drop; t.body.position.y = bodyY; root.updateMatrixWorld(true); }
  t.liftY = bodyY;
  // ---------------- pernas (IK) ----------------
  const qYaw = _q2.setFromAxisAngle(Y_UP, yaw).clone();
  for (const f of t.feet) {
    const hipG = P['hip' + f.s], knee = P['knee' + f.s], ankle = P['ankle' + f.s], toe = P['toe' + f.s];
    const ank = f.w.clone(); ank.y += ANKLE_H + 0.13 * Math.max(0, f.pitch) * 0.55;
    // tornozelo se desloca para trás quando o calcanhar sobe (gira em torno da bola do pé)
    if (f.pitch > 0) ank.addScaledVector(fwd, -0.1 * (1 - Math.cos(f.pitch)) * 2);
    const A = t.pelvis.worldToLocal(ank.clone());
    const pole = new THREE.Vector3(f.s * 0.12, 0, 1); // joelho para frente, levemente para fora (espaço da pélvis ≈ raiz)
    pole.applyQuaternion(_q1.copy(t.pelvis.quaternion).invert());
    solveLegIK(hipG, knee, hipG.position, A, pole);
    hipG.updateMatrixWorld(true);
    // pé: paralelo ao chão (yaw do corpo + leve abertura), com a inclinação do passo
    const qf = qYaw.clone().multiply(_q1.setFromEuler(_e1.set(Math.max(0, f.pitch) * 0.45 + Math.min(0, f.pitch), f.s * 0.08, 0)));
    setWorldQuat(ankle, qf);
    toe.rotation.set(-Math.max(0, f.pitch) * 0.45, 0, 0); // dedos ficam no chão enquanto o calcanhar sobe
  }
  // ---------------- braços ----------------
  const armA = lerp(0.32, 0.85, run) * w * (1 - 0.5 * cr);
  P['clav1'].rotation.z = k('clL', 0.04 * cL * w - run * 0.05, 10, 0.7);
  P['clav-1'].rotation.z = k('clR', -0.03 - 0.05 * cr, 10, 0.7);
  P['clav1'].rotation.y = k('clLy', -cL * 0.06 * w, 10, 0.7);
  P['sh1'].rotation.x = k('shL', cL * armA - cr * 0.35 - run * 0.15, 9, 0.6);
  P['sh1'].rotation.z = k('shLz', 0.09 + run * 0.12 + cr * 0.05, 9, 0.6);
  P['el1'].rotation.x = k('elL', -0.4 - Math.max(0, -cL) * 0.45 * w - run * 1.0 - cr * 0.5, 9, 0.55);
  P['wr1'].rotation.x = k('wrL', 0.1 + 0.1 * w, 9, 0.6);
  // braço direito aponta a lanterna para onde a cabeça olha (compensa a torção do tronco)
  P['sh-1'].rotation.x = k('shR', -0.62 - pitch * 0.7 - t.spine.rotation.x - t.pelvis.rotation.x + 0.04 * cL * w, 10, 0.6);
  P['sh-1'].rotation.y = k('shRy', clamp(hy - t.spine.rotation.y - t.pelvis.rotation.y, -0.8, 0.8) * 0.9, 10, 0.6);
  P['sh-1'].rotation.z = k('shRz', -0.1, 10, 0.6);
  P['el-1'].rotation.x = k('elR', -0.82 - run * 0.35 + cr * 0.1, 10, 0.55);
  P['wr-1'].rotation.x = k('wrR', -0.1, 10, 0.6);
  // ---------------- alcançar (abrir porta/gaveta/armário): IK do braço esquerdo até um ponto do mundo ----------------
  if (s.reach && s.reach.k > 0.001) {
    root.updateMatrixWorld(true);
    const sh = P['sh1'], el = P['el1'], clav = P['clav1'];
    const q0 = sh.quaternion.clone(), e0 = el.quaternion.clone();
    const A = clav.worldToLocal(s.reach.p.clone());
    const pole = clav.worldToLocal(new THREE.Vector3().copy(root.position).addScaledVector(fwd, -0.6).add(new THREE.Vector3(0, 0.2, 0)).addScaledVector(right, -0.5)).sub(sh.position);
    solveArmIK(sh, el, sh.position, A, pole);
    const kk = clamp(s.reach.k, 0, 1);
    sh.quaternion.copy(q0.slerp(sh.quaternion.clone(), kk)); el.quaternion.copy(e0.slerp(el.quaternion.clone(), kk));
    P['wr1'].rotation.x = lerp(P['wr1'].rotation.x, -0.25, kk);
    t.spine.rotation.y += 0; // o tronco já gira pela cabeça
  }
  // ---------------- cabeça ----------------
  const twist = t.spine.rotation.y + t.pelvis.rotation.y;
  t.neck.rotation.x = k('nk', -pitch * 0.4 - t.spine.rotation.x * 0.7 - t.pelvis.rotation.x * 0.6, 10, 0.7);
  t.neck.rotation.y = k('nkY', (hy - twist) * 0.45, 10, 0.7);
  t.head.rotation.x = k('hd', -pitch * 0.35, 12, 0.7);
  t.head.rotation.y = k('hdY', (hy - twist) * 0.5, 12, 0.7);
  t.head.rotation.z = k('hdZ', -t.spine.rotation.z * 0.6, 12, 0.7);
  t.lensMat.emissiveIntensity = s.fl ? 3 : 0;
  t.first = false;
  updateAccessory(t, dt);
}

// ------------------------------------------------------------------ morte: agarrão + boneco de pano
const GRAB_HOLD = 1.45;
function deathUpdate(t, dt, s) {
  const P = t.parts, root = t.root;
  if (!t.death) {
    t.death = { t: 0, grab: !!s.grab, rel: false };
    t.sp.dk = null;
  }
  const D = t.death; D.t += dt;
  if (D.grab && D.t < GRAB_HOLD && s.grab) {
    // segurado: o PEITO do boneco vai até as mãos da criatura (mola rápida); pernas se debatem, mãos agarram os braços dela
    const k = (name, target, om = 14, ze = 0.6) => { const st = t.sp[name] || (t.sp[name] = { x: target, v: 0 }); return spr(st, target, om, ze, dt); };
    root.updateMatrixWorld(true);
    const want = root.worldToLocal(s.grab.clone()).sub(new THREE.Vector3(0, 0.94 + 0.04 + 0.33, 0));   // peito ≈ pélvis + 0,37
    const u = sstep(0, 0.35, D.t);
    t.body.position.set(k('gx', want.x * u, 9, 0.75), k('gy', want.y * u, 9, 0.75), k('gz', want.z * u, 9, 0.75));
    const kick = Math.sin(D.t * 13), kick2 = Math.sin(D.t * 11 + 1.3);
    P['hip1'].rotation.set(k('ghL', -0.35 + kick * 0.45), 0, 0.06); P['hip-1'].rotation.set(k('ghR', -0.2 - kick2 * 0.45), 0, -0.06);
    P['knee1'].rotation.set(k('gkL', 0.7 + Math.max(0, kick) * 0.6), 0, 0); P['knee-1'].rotation.set(k('gkR', 0.5 + Math.max(0, kick2) * 0.7), 0, 0);
    P['ankle1'].quaternion.setFromEuler(_e1.set(0.5, 0, 0)); P['ankle-1'].quaternion.setFromEuler(_e1.set(0.4, 0, 0));
    P['toe1'].rotation.set(0, 0, 0); P['toe-1'].rotation.set(0, 0, 0);
    for (const sd of [1, -1]) {
      P['clav' + sd].rotation.set(0, 0, sd * 0.12);
      P['sh' + sd].rotation.set(k('gs' + sd, -2.0 + Math.sin(D.t * 9 + sd) * 0.25), 0, sd * 0.25);
      P['el' + sd].rotation.set(k('ge' + sd, -0.9 + Math.sin(D.t * 7 + sd) * 0.3), 0, 0);
      P['wr' + sd].rotation.set(0.2, 0, 0);
    }
    t.pelvis.rotation.set(0.15 + kick * 0.05, 0, kick2 * 0.06); t.spine.rotation.set(-0.25 + Math.sin(D.t * 10) * 0.06, Math.sin(D.t * 8) * 0.08, 0);
    t.neck.rotation.set(-0.35, 0, 0); t.head.rotation.set(-0.25 + Math.sin(D.t * 15) * 0.05, Math.sin(D.t * 12) * 0.12, 0);
    root.rotation.z = 0;
    t.lastJointPos = jointPositions(t, t.lastJointPos);
    return;
  }
  if (!t.rag) startRagdoll(t, dt, s);
  stepRagdoll(t, dt, s);
  applyRagdoll(t);
}
// posições do mundo das juntas que viram partículas do boneco de pano
const RAG_JOINTS = ['pelvis', 'chest', 'head', 'hip1', 'knee1', 'ankle1', 'toe1', 'hip-1', 'knee-1', 'ankle-1', 'toe-1', 'sh1', 'el1', 'wr1', 'hand1', 'sh-1', 'el-1', 'wr-1', 'hand-1'];
function jointObj(t, n) {
  if (n === 'pelvis') return [t.pelvis, null];
  if (n === 'chest') return [t.neck, null];
  if (n === 'head') return [t.head, new THREE.Vector3(0, 0.1, 0.01)];
  if (n.startsWith('hand')) return [t.parts['wr' + n.slice(4)], new THREE.Vector3(0, -0.09, 0)];
  if (n.startsWith('toe')) return [t.parts[n], new THREE.Vector3(0, -0.01, 0.055)];
  return [t.parts[n], null];
}
function jointPositions(t, out) {
  t.root.updateMatrixWorld(true);
  out = out || RAG_JOINTS.map(() => new THREE.Vector3());
  RAG_JOINTS.forEach((n, i) => { const [o, off] = jointObj(t, n); out[i].copy(off || _v1.set(0, 0, 0)).applyMatrix4(o.matrixWorld); });
  return out;
}
function startRagdoll(t, dt, s) {
  const pos = jointPositions(t);
  const prev = t.lastJointPos && t.lastJointPos.length === pos.length ? t.lastJointPos.map(v => v.clone()) : pos.map(v => v.clone());
  // empurrão: para longe da criatura (ou para trás do boneco) + um pouco de giro
  const push = new THREE.Vector3();
  if (s.from) push.subVectors(pos[0], s.from).setY(0).normalize().multiplyScalar(t.death && t.death.grab ? 0.35 : 1.0);
  else push.set(-Math.sin(t.root.rotation.y), 0, -Math.cos(t.root.rotation.y)).multiplyScalar(0.9);
  const step = Math.max(dt, 1 / 60);
  const P0 = pos.map((p, i) => {
    const v = new THREE.Vector3().subVectors(p, prev[i]).divideScalar(step).clampLength(0, 1.5);
    v.add(push); if (i === 2 || i === 1) v.addScaledVector(push, 0.5); // cabeça/peito vão primeiro
    return { p: p.clone(), o: p.clone().addScaledVector(v, -1 / 240) };
  });
  const I = Object.fromEntries(RAG_JOINTS.map((n, i) => [n, i]));
  const C = [];
  const link = (a, b, stiff = 1) => C.push([I[a], I[b], pos[I[a]].distanceTo(pos[I[b]]), stiff]);
  // tronco rígido (pélvis, quadris, peito, ombros com diagonais)
  for (const [a, b] of [['pelvis', 'hip1'], ['pelvis', 'hip-1'], ['hip1', 'hip-1'], ['pelvis', 'chest'], ['chest', 'sh1'], ['chest', 'sh-1'], ['sh1', 'sh-1'],
    ['sh1', 'hip1'], ['sh-1', 'hip-1'], ['sh1', 'hip-1'], ['sh-1', 'hip1'], ['chest', 'hip1'], ['chest', 'hip-1'], ['pelvis', 'sh1'], ['pelvis', 'sh-1']]) link(a, b, 1);
  link('chest', 'head', 1); link('head', 'sh1', 0.35); link('head', 'sh-1', 0.35);
  for (const sd of ['1', '-1']) {
    link('hip' + sd, 'knee' + sd); link('knee' + sd, 'ankle' + sd); link('ankle' + sd, 'toe' + sd); link('knee' + sd, 'toe' + sd, 0.6);
    link('sh' + sd, 'el' + sd); link('el' + sd, 'wr' + sd); link('wr' + sd, 'hand' + sd, 0.8);
  }
  const R = RAG_JOINTS.map(n => n === 'head' ? 0.1 : n === 'chest' ? 0.11 : n === 'pelvis' ? 0.1 : n.startsWith('hip') ? 0.08 : n.startsWith('sh') ? 0.06 : 0.035);
  t.rag = { P: P0, C, R, I, settle: 0, sleep: false };
  t.body.position.set(0, 0, 0);
}
function stepRagdoll(t, dt, s) {
  const G = t.rag; if (G.sleep) return;
  const N = 4, h = dt / N, I = G.I;
  const floor = s.ground ? (x, z) => s.ground(x, z) : () => t.root.position.y;
  let moved = 0;
  for (let it = 0; it < N; it++) {
    for (const q of G.P) {
      const vx = (q.p.x - q.o.x) * 0.995, vy = (q.p.y - q.o.y) * 0.995, vz = (q.p.z - q.o.z) * 0.995;
      q.o.copy(q.p); q.p.x += vx; q.p.y += vy - 9.8 * h * h; q.p.z += vz;
    }
    for (let iter = 0; iter < 6; iter++) {
      for (const [a, b, L, st] of G.C) {
        const A = G.P[a].p, B = G.P[b].p; const d = _v1.subVectors(B, A); const len = d.length() || 1e-6;
        const corr = (len - L) / len * 0.5 * st; A.addScaledVector(d, corr); B.addScaledVector(d, -corr);
      }
      // juntas de dobradiça: joelho só dobra para frente, cotovelo só para trás (em relação ao tronco)
      const pl = G.P[I.pelvis].p, ch = G.P[I.chest].p, hl = G.P[I.hip1].p, hr = G.P[I['hip-1']].p;
      const up = _v2.subVectors(ch, pl).normalize(), lat = _v3.subVectors(hl, hr).normalize();
      const fw = _v4.crossVectors(lat, up).normalize(); // frente do tronco
      for (const sd of ['1', '-1']) {
        const hp = G.P[I['hip' + sd]].p, kn = G.P[I['knee' + sd]].p, an = G.P[I['ankle' + sd]].p;
        const mid = new THREE.Vector3().addVectors(hp, an).multiplyScalar(0.5);
        const off = new THREE.Vector3().subVectors(kn, mid).dot(fw); if (off < 0.015) kn.addScaledVector(fw, 0.015 - off);
        const sh = G.P[I['sh' + sd]].p, el = G.P[I['el' + sd]].p, wr = G.P[I['wr' + sd]].p;
        const mid2 = new THREE.Vector3().addVectors(sh, wr).multiplyScalar(0.5);
        const off2 = new THREE.Vector3().subVectors(el, mid2).dot(fw); if (off2 > -0.01) el.addScaledVector(fw, -0.01 - off2);
        // não dobrar além do limite (perna/braço não fecham por completo)
        if (hp.distanceTo(an) < 0.3) { const d = _v1.subVectors(an, hp).normalize(); an.copy(hp).addScaledVector(d, 0.3); }
        if (sh.distanceTo(wr) < 0.16) { const d = _v1.subVectors(wr, sh).normalize(); wr.copy(sh).addScaledVector(d, 0.16); }
      }
      // chão e paredes
      G.P.forEach((q, i) => {
        const fy = floor(q.p.x, q.p.z) + G.R[i];
        if (q.p.y < fy) { q.p.y = fy; q.o.x += (q.p.x - q.o.x) * 0.45; q.o.z += (q.p.z - q.o.z) * 0.45; if (q.o.y < fy) q.o.y = fy + (fy - q.o.y) * 0.15; }
        if (s.solid && s.solid(q.p.x, q.p.y, q.p.z)) { q.p.x = q.o.x; q.p.z = q.o.z; }
      });
    }
  }
  for (const q of G.P) moved = Math.max(moved, q.p.distanceTo(q.o));
  G.settle = moved < 0.0008 ? G.settle + dt : 0;
  if (G.settle > 0.6 && t.death && t.death.t > 2.5) G.sleep = true;
}
// partículas → juntas (de cima para baixo na hierarquia)
function applyRagdoll(t) {
  const G = t.rag, I = G.I, P = t.parts, Pp = (n) => G.P[I[n]].p;
  const root = t.root;
  root.rotation.z = 0; t.body.position.set(0, 0, 0); t.body.rotation.set(0, 0, 0);
  root.updateMatrixWorld(true);
  // pélvis: posição + orientação (X = esquerda, Y = para o peito)
  const pl = Pp('pelvis'), X = new THREE.Vector3().subVectors(Pp('hip1'), Pp('hip-1')).normalize();
  const Yp = new THREE.Vector3().subVectors(Pp('chest'), pl).normalize();
  const Z = new THREE.Vector3().crossVectors(X, Yp).normalize(); const Y = new THREE.Vector3().crossVectors(Z, X).normalize();
  t.pelvis.position.copy(t.body.worldToLocal(pl.clone()));
  _m1.makeBasis(X, Y, Z); setWorldQuat(t.pelvis, new THREE.Quaternion().setFromRotationMatrix(_m1));
  // tronco: ombros dão o X, peito−pélvis dá o Y
  const Xs = new THREE.Vector3().subVectors(Pp('sh1'), Pp('sh-1')).normalize();
  const Zs = new THREE.Vector3().crossVectors(Xs, Yp).normalize(); const Ys = new THREE.Vector3().crossVectors(Zs, Xs).normalize();
  _m1.makeBasis(Xs, Ys, Zs); t.torso.rotation.set(0, 0, 0); setWorldQuat(t.spine, new THREE.Quaternion().setFromRotationMatrix(_m1));
  // pescoço → cabeça
  t.neck.rotation.set(0, 0, 0); aimAt(t.neck, Pp('head'), Y_UP); t.head.rotation.set(0, 0, 0);
  for (const sd of ['1', '-1']) {
    P['clav' + sd].rotation.set(0, 0, 0);
    aimAt(P['sh' + sd], Pp('el' + sd)); aimAt(P['el' + sd], Pp('wr' + sd)); aimAt(P['wr' + sd], Pp('hand' + sd));
    aimAt(P['hip' + sd], Pp('knee' + sd)); aimAt(P['knee' + sd], Pp('ankle' + sd));
    aimAt(P['ankle' + sd], Pp('toe' + sd), TOE_AXIS); P['toe' + sd].rotation.set(0, 0, 0);
  }
}
