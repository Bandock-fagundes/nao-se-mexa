// v7 — ACESSÓRIOS DOS BONECOS (aparência escolhida pelo jogador): cachecol de lã, chapéu fedora de feltro ou
// gorro de tricô, numa cor da paleta (shared/look.js).
//  • Cachecol: faixa de tricô com espessura, dada DUAS voltas no pescoço (a de baixo deitada nos ombros, a de cima
//    abraçando o pescoço), nó na frente e duas pontas caídas no peito com franjas. As voltas e as pontas são
//    "encaixadas" no corpo por raios contra a malha do tórax (nunca atravessam o peito/ombros). As pontas balançam
//    com uma mola por ponta (gravidade no espaço do tórax + inércia do andar/corrida), deformando os vértices na CPU.
//  • Fedora: copa com vinco central em gota e beliscões na frente, fita de gorgorão com laço, aba com borda debruada
//    (desce na frente, sobe atrás). Gorro: corpo de meia malha que acompanha a cabeça + barra dobrada canelada.
//    A abertura dos dois é medida na própria cabeça do boneco (raios), então assentam sem atravessar.
//  • Texturas procedurais (canvas): ponto meia (V's), canelado 2×2, feltro e gorgorão → mapa de cor + normal.
//  • Dois níveis de detalhe, iguais aos do boneco (t.lodSets.hi/lo, troca > 16 m).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const gauss = (x, w) => Math.exp(-(x * x) / (w * w));
const spow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
function hash1(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

// =====================================================================================================
// TEXTURAS (canvas → cor + normal), compartilhadas por todos os bonecos
// =====================================================================================================
function heightToTextures(S, H, albedo, strength, { repeat = [1, 1] } = {}) {
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return [c, c.getContext('2d')]; };
  const [ca, ga] = mk(), [cn, gn] = mk();
  const ia = ga.createImageData(S, S), inn = gn.createImageData(S, S);
  const h = (x, y) => H[((y + S) % S) * S + ((x + S) % S)];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const a = clamp(albedo[y * S + x], 0, 1) * 255;
    ia.data[i] = ia.data[i + 1] = ia.data[i + 2] = a; ia.data[i + 3] = 255;
    const dx = (h(x + 1, y) - h(x - 1, y)) * 0.5 * strength, dy = (h(x, y + 1) - h(x, y - 1)) * 0.5 * strength;
    const nx = -dx, ny = dy, nz = 1, l = Math.hypot(nx, ny, nz);
    inn.data[i] = (nx / l * 0.5 + 0.5) * 255; inn.data[i + 1] = (ny / l * 0.5 + 0.5) * 255; inn.data[i + 2] = (nz / l * 0.5 + 0.5) * 255; inn.data[i + 3] = 255;
  }
  ga.putImageData(ia, 0, 0); gn.putImageData(inn, 0, 0);
  const map = new THREE.CanvasTexture(ca), normalMap = new THREE.CanvasTexture(cn);
  for (const t of [map, normalMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.repeat.set(repeat[0], repeat[1]); }
  map.colorSpace = THREE.SRGBColorSpace;
  return { map, normalMap };
}
// ruído de valor periódico (para fiapos/feltro)
function valueNoise(S, cells, seed) {
  const g = []; for (let i = 0; i < cells * cells; i++) g.push(hash1(i * 13.7 + seed));
  const out = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const fx = x / S * cells, fy = y / S * cells, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const G = (a, b) => g[((b % cells) * cells + (a % cells))];
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    out[y * S + x] = lerp(lerp(G(x0, y0), G(x0 + 1, y0), sx), lerp(G(x0, y0 + 1), G(x0 + 1, y0 + 1), sx), sy);
  }
  return out;
}
// tricô: C colunas × R carreiras de pontos em V por ladrilho; rib = padrão de colunas 'K'/'P' (canelado)
function knitHeight(S, C, R, rib) {
  const H = new Float32Array(S * S), A = new Float32Array(S * S);
  const cw = S / C, rh = S / R;
  const n1 = valueNoise(S, 64, 3.1), n2 = valueNoise(S, 16, 7.7);
  const legA = Math.hypot(cw * 0.45, rh) * 0.62, legB = cw * 0.2;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let best = 0, bestId = 0;
    const ci0 = Math.floor(x / cw), ri0 = Math.floor(y / rh);
    for (let ci = ci0 - 1; ci <= ci0 + 1; ci++) for (let ri = ri0 - 1; ri <= ri0 + 1; ri++) {
      const col = ((ci % C) + C) % C, purl = rib && rib[col] === 'P';
      const ox = ci * cw, oy = ri * rh;
      if (purl) {
        // ponto tricô ao avesso: "calombo" horizontal, rebaixado
        const qx = x - (ox + cw * 0.5), qy = y - (oy + rh * 0.5);
        const e = (qx / (cw * 0.55)) ** 2 + (qy / (rh * 0.33)) ** 2;
        if (e < 1) { const hh = 0.5 * Math.sqrt(1 - e) * (0.88 + 0.12 * Math.cos(qx * 0.8 + qy * 1.6)); if (hh > best) { best = hh; bestId = ci * 31 + ri; } }
        continue;
      }
      for (const sd of [-1, 1]) {
        const cx = ox + cw * (0.5 + sd * 0.22), cy = oy + rh * 0.5;
        const dx = -sd * cw * 0.45, dy = rh; const dl = Math.hypot(dx, dy), ux = dx / dl, uy = dy / dl;
        const qx = x - cx, qy = y - cy, al = qx * ux + qy * uy, pe = -qx * uy + qy * ux;
        const e = (al / legA) ** 2 + (pe / legB) ** 2;
        if (e < 1) {
          let hh = Math.sqrt(1 - e);
          hh *= 0.86 + 0.14 * Math.cos(al * 0.75 + pe * 2.4 * sd);        // fios torcidos (plies)
          hh += (rib ? 0.18 : 0);
          if (hh > best) { best = hh; bestId = ci * 31 + ri + sd; }
        }
      }
    }
    const fuzz = (n1[y * S + x] - 0.5) * 0.12 + (n2[y * S + x] - 0.5) * 0.06;
    H[y * S + x] = best + fuzz;
    const v = hash1(bestId * 3.3) * 0.08;
    A[y * S + x] = 0.7 + 0.3 * Math.pow(clamp(best, 0, 1), 0.55) - v + fuzz * 0.5;
  }
  return { H, A };
}
let TEX = null;
function textures() {
  if (TEX) return TEX;
  const S = 256;
  // ponto meia (cachecol/gorro): 8 colunas × 10 carreiras por ladrilho de 10,4 × 8,8 cm (lã grossa, tricô à mão)
  const k = knitHeight(S, 8, 10, null);
  const knit = heightToTextures(S, k.H, k.A, 5.5, { repeat: [1 / 0.104, 1 / 0.088] });
  // canelado 2×2 (barra do gorro)
  const r = knitHeight(S, 8, 10, 'KKPPKKPP');
  const rib = heightToTextures(S, r.H, r.A, 8, { repeat: [1 / 0.072, 1 / 0.06] });
  // feltro: fibras curtas + ruído
  const f1 = valueNoise(S, 48, 1.3), f2 = valueNoise(S, 32, 5.9), f3 = valueNoise(S, 8, 9.2);
  const FH = new Float32Array(S * S), FA = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) { FH[i] = f1[i] * 0.5 + f2[i] * 0.35 + f3[i] * 0.15; FA[i] = 0.86 + (f2[i] - 0.5) * 0.1 + (f3[i] - 0.5) * 0.1 + (f1[i] - 0.5) * 0.06; }
  const felt = heightToTextures(S, FH, FA, 2.2, { repeat: [1 / 0.09, 1 / 0.09] });
  // gorgorão (fita do chapéu): nervuras finas na horizontal
  const GH = new Float32Array(S * S), GA = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const i = y * S + x; const v = 0.5 + 0.5 * Math.sin(y / S * Math.PI * 2 * 48); GH[i] = v * 0.9 + f1[i] * 0.1; GA[i] = 0.8 + v * 0.2; }
  const gros = heightToTextures(S, GH, GA, 3, { repeat: [1 / 0.05, 1 / 0.05] });
  TEX = { knit, rib, felt, gros };
  return TEX;
}
const MATS = new Map();
function accMat(kind, col) {
  const key = kind + ':' + col;
  if (MATS.has(key)) return MATS.get(key);
  const T = textures();
  const c = new THREE.Color(col);
  let m;
  if (kind === 'knit' || kind === 'rib') {
    const tx = T[kind];
    m = new THREE.MeshPhysicalMaterial({
      color: c, map: tx.map, normalMap: tx.normalMap, normalScale: new THREE.Vector2(1.1, 1.1), roughness: 0.96, metalness: 0,
      sheen: 0.6, sheenRoughness: 0.7, sheenColor: c.clone().multiplyScalar(1.25), vertexColors: true, // brilho de fibra no MESMO tom (puxar para branco deixava vinho/vermelho cor-de-rosa)
      emissive: c, emissiveIntensity: 0.035,
    });
  } else if (kind === 'felt') {
    m = new THREE.MeshPhysicalMaterial({
      color: c, map: T.felt.map, normalMap: T.felt.normalMap, normalScale: new THREE.Vector2(0.45, 0.45), roughness: 0.9, metalness: 0,
      sheen: 0.4, sheenRoughness: 0.6, sheenColor: c.clone().multiplyScalar(1.2), vertexColors: true,
      emissive: c, emissiveIntensity: 0.03,
    });
  } else { // fita de gorgorão: mesmo matiz, bem mais escuro, com leve brilho de seda
    const d = c.clone().multiplyScalar(0.32);
    m = new THREE.MeshPhysicalMaterial({ color: d, map: T.gros.map, normalMap: T.gros.normalMap, normalScale: new THREE.Vector2(0.22, 0.22), roughness: 0.55, metalness: 0, sheen: 0.5, sheenRoughness: 0.4, sheenColor: d.clone().lerp(new THREE.Color(1, 1, 1), 0.3), vertexColors: true });
  }
  MATS.set(key, m); return m;
}

// =====================================================================================================
// GEOMETRIA: faixa varrida ao longo de uma curva (cachecol) e superfícies de revolução moduladas (chapéus)
// =====================================================================================================
// pts: centro; wd: direção da LARGURA desejada; od: direção "para fora" (espessura); W/Th: largura/espessura;
// fold(i, xN, len) → deslocamento extra na espessura (dobras); shade(i, xN, side) → cor por vértice (AO)
function sweepBand(pts, wd, od, W, Th, { seg = 16, p = 2.8, fold = null, shade = null, caps = true } = {}) {
  const n = pts.length, pos = [], uv = [], col = [], idx = [];
  const Tn = [], Wn = [], Nn = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const T = b.clone().sub(a).normalize();
    const w = wd[i].clone().addScaledVector(T, -wd[i].dot(T)).normalize();
    let nn = new THREE.Vector3().crossVectors(T, w);
    if (nn.dot(od[i]) < 0) nn.negate();
    Tn.push(T); Wn.push(w); Nn.push(nn);
  }
  // orientação do triângulo (normal para fora)
  const flip = new THREE.Vector3().crossVectors(Wn[0], Nn[0]).dot(Tn[0]) > 0;
  let L = 0; const lens = [0];
  for (let i = 1; i < n; i++) { L += pts[i].distanceTo(pts[i - 1]); lens.push(L); }
  const ring = seg + 1;
  for (let i = 0; i < n; i++) {
    let u = 0, prev = null;
    for (let k = 0; k <= seg; k++) {
      const a = k / seg * Math.PI * 2;
      const xN = spow(Math.cos(a), 2 / p), yN = spow(Math.sin(a), 2 / p);
      const x = xN * W[i] / 2;
      let y = yN * Th[i] / 2 * (0.82 + 0.18 * (1 - xN * xN));
      const off = fold ? fold(i, xN, lens[i]) : 0;
      const P = pts[i].clone().addScaledVector(Wn[i], x).addScaledVector(Nn[i], y + off);
      if (prev) u += P.distanceTo(prev); prev = P;
      pos.push(P.x, P.y, P.z); uv.push(u, lens[i]);
      const c = shade ? shade(i, xN, yN) : 1; col.push(c, c, c);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < seg; k++) {
    const a = i * ring + k, b = a + ring;
    if (flip) idx.push(a, a + 1, b, b, a + 1, b + 1); else idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  // costura do anel: média das normais do primeiro e do último vértice de cada anel
  const nr = g.attributes.normal;
  for (let i = 0; i < n; i++) { const a = i * ring, b = a + seg; const x = nr.getX(a) + nr.getX(b), y = nr.getY(a) + nr.getY(b), z = nr.getZ(a) + nr.getZ(b), l = Math.hypot(x, y, z) || 1; nr.setXYZ(a, x / l, y / l, z / l); nr.setXYZ(b, x / l, y / l, z / l); }
  if (!caps) return g;
  const parts = [g];
  for (const [i, dir] of [[0, -1], [n - 1, 1]]) {
    const cp = [], cu = [], cc = [], ci = [];
    const c0 = pts[i].clone().addScaledVector(Tn[i], dir * Th[i] * 0.15);
    cp.push(c0.x, c0.y, c0.z); cu.push(0, 0); cc.push(0.8, 0.8, 0.8);
    for (let k = 0; k <= seg; k++) { const j = (i * ring + k) * 3; cp.push(pos[j], pos[j + 1], pos[j + 2]); cu.push(uv[(i * ring + k) * 2], 0.01); cc.push(0.8, 0.8, 0.8); }
    for (let k = 0; k < seg; k++) { const fl = (dir > 0) === flip; if (fl) ci.push(0, k + 1, k + 2); else ci.push(0, k + 2, k + 1); }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3)); cg.setAttribute('uv', new THREE.Float32BufferAttribute(cu, 2)); cg.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
    cg.setIndex(ci); cg.computeVertexNormals(); parts.push(cg);
  }
  return mergeGeometries(parts, false);
}
// superfície de revolução: f(φ, s) → Vector3 (s ∈ [0,1] ao longo do perfil); uv em metros (perímetro × perfil)
function ringSurface(nPhi, sList, f, { shade = null, closed = false, flip = false } = {}) {
  const ns = sList.length, pos = [], uv = [], col = [], idx = [];
  const P = [];
  for (let i = 0; i <= nPhi; i++) { const row = []; for (let j = 0; j < ns; j++) row.push(f((i % nPhi) / nPhi * Math.PI * 2, sList[j])); P.push(row); }
  // comprimentos
  const vAcc = P.map(row => { const a = [0]; for (let j = 1; j < ns; j++) a.push(a[j - 1] + row[j].distanceTo(row[j - 1])); return a; });
  const uAcc = []; for (let j = 0; j < ns; j++) { let u = 0; const a = [0]; for (let i = 1; i <= nPhi; i++) { u += P[i][j].distanceTo(P[i - 1][j]); a.push(u); } uAcc.push(a); }
  for (let i = 0; i <= nPhi; i++) for (let j = 0; j < ns; j++) {
    const p = P[i][j]; pos.push(p.x, p.y, p.z); uv.push(uAcc[j][i], vAcc[i][j]);
    const c = shade ? shade((i % nPhi) / nPhi * Math.PI * 2, sList[j]) : 1; col.push(c, c, c);
  }
  for (let i = 0; i < nPhi; i++) for (let j = 0; j < ns - 1; j++) { const a = i * ns + j, b = (i + 1) * ns + j; if (flip) idx.push(a, b, a + 1, b, b + 1, a + 1); else idx.push(a, a + 1, b, b, a + 1, b + 1); }
  if (closed) for (let i = 0; i < nPhi; i++) { const a = i * ns + ns - 1, b = (i + 1) * ns + ns - 1, a0 = i * ns, b0 = (i + 1) * ns; if (flip) idx.push(a, b, a0, b, b0, a0); else idx.push(a, a0, b, b, a0, b0); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  // costura em φ = 0/2π
  const nr = g.attributes.normal;
  for (let j = 0; j < ns; j++) { const a = j, b = nPhi * ns + j; const x = nr.getX(a) + nr.getX(b), y = nr.getY(a) + nr.getY(b), z = nr.getZ(a) + nr.getZ(b), l = Math.hypot(x, y, z) || 1; nr.setXYZ(a, x / l, y / l, z / l); nr.setXYZ(b, x / l, y / l, z / l); }
  return g;
}
const lin = (n, a = 0, b = 1, e = 1) => { const o = []; for (let i = 0; i <= n; i++) o.push(a + (b - a) * Math.pow(i / n, e)); return o; };

// =====================================================================================================
// SONDAS: medem o corpo do boneco (tórax no espaço do tronco, cabeça no espaço do grupo da cabeça)
// =====================================================================================================
class Probe {
  constructor(geo) { this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); this.mesh.updateMatrixWorld(true); this.rc = new THREE.Raycaster(); }
  // altura da superfície de cima em (x, z) (−∞ se não houver)
  top(x, z) { this.rc.set(V3(x, 3, z), V3(0, -1, 0)); const h = this.rc.intersectObject(this.mesh); return h.length ? h[0].point.y : -Infinity; }
  // distância do eixo/centro c até a superfície na direção d (de fora para dentro)
  radial(c, d) { this.rc.set(c.clone().addScaledVector(d, 1), d.clone().negate()); const h = this.rc.intersectObject(this.mesh); return h.length ? h[0].point.distanceTo(c) : 0; }
  // frente do tórax em (x, y): z da superfície vista de +Z
  front(x, y) { this.rc.set(V3(x, y, 1), V3(0, 0, -1)); const h = this.rc.intersectObject(this.mesh); return h.length ? h[0].point.z : -Infinity; }
}

// =====================================================================================================
// CACHECOL
// =====================================================================================================
const NECK = { x: 0, z: 0.006 };
const KNOT = V3(0.026, 0.418, 0.0);      // z calculado pela frente do peito
function buildScarf(lv, chest) {
  const hi = lv === 'hi';
  const pr = new Probe(chest);
  const TH = 0.017;
  KNOT.z = Math.max(pr.front(KNOT.x, KNOT.y), pr.front(KNOT.x, KNOT.y - 0.03)) + 0.022;
  // ---- voltas no pescoço: hélice de 2 voltas, de baixo (nos ombros) para cima (no pescoço), começando e
  // terminando no nó. Largura inclinada para dentro (a volta de baixo deita no caimento do ombro).
  const N = hi ? 220 : 44;
  const pts = [], wd = [], od = [], W = [], Th = [], kk = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N, th = u * Math.PI * 4;
    const phi = th + 0.18;
    const k = sstep(0.36, 0.66, u);
    const rx = lerp(0.098, 0.074, k), rz = lerp(0.092, 0.07, k);
    const out = V3(Math.sin(phi), 0, Math.cos(phi));
    let p = V3(NECK.x + out.x * rx, lerp(0.448, 0.512, k) + 0.012 * (1 - Math.cos(phi)) * 0.5, NECK.z + out.z * rz);
    // pontas entram no nó
    const e0 = 1 - sstep(0, 0.085, u), e1 = sstep(0.915, 1, u);
    const kn = KNOT.clone().add(V3(e1 ? -0.006 : 0.006, 0.012, -0.008));
    p.lerp(kn, Math.max(e0, e1) * 0.92);
    const beta = lerp(0.62, 0.22, k);
    pts.push(p); od.push(out.clone()); kk.push(k);
    wd.push(V3(0, Math.cos(beta), 0).addScaledVector(out, -Math.sin(beta)));
    W.push(lerp(0.07, 0.062, k) * (1 - 0.35 * Math.max(e0, e1)));
    Th.push(TH * (1 + 0.12 * Math.max(e0, e1)));
  }
  // encaixe no corpo: levanta o centro até a face interna (5 amostras na largura) ficar acima do tórax;
  // afasta do pescoço (raio interno ≥ 5,3 cm)
  for (let it = 0; it < 2; it++) for (let i = 0; i <= N; i++) {
    const T = pts[Math.min(N, i + 1)].clone().sub(pts[Math.max(0, i - 1)]).normalize();
    const w = wd[i].clone().addScaledVector(T, -wd[i].dot(T)).normalize();
    let nn = new THREE.Vector3().crossVectors(T, w); if (nn.dot(od[i]) < 0) nn.negate();
    let lift = 0;
    for (const x of [-0.5, -0.25, 0, 0.25, 0.5]) {
      const q = pts[i].clone().addScaledVector(w, x * W[i]).addScaledVector(nn, -Th[i] * 0.5);
      lift = Math.max(lift, pr.top(q.x, q.z) + 0.003 - q.y);
    }
    pts[i].y += Math.max(0, lift);
    const r = Math.hypot(pts[i].x - NECK.x, pts[i].z - NECK.z), rIn = r - Th[i] * 0.5;
    if (rIn < 0.053 && pts[i].y > 0.44) { const s = (0.053 + Th[i] * 0.5) / r; pts[i].x = NECK.x + (pts[i].x - NECK.x) * s; pts[i].z = NECK.z + (pts[i].z - NECK.z) * s; }
  }
  // suaviza a altura (sem quinas)
  for (let it = 0; it < (hi ? 6 : 2); it++) { const ys = pts.map(p => p.y); for (let i = 1; i < N; i++) pts[i].y = Math.max(ys[i], (ys[i - 1] + ys[i] * 2 + ys[i + 1]) / 4); }
  const loops = sweepBand(pts, wd, od, W, Th, {
    seg: hi ? 20 : 8,
    // franzido: ondas curtas na espessura (lã amontoada) mais fortes nas bordas + vinco ao longo
    fold: hi ? (i, xN, len) => 0.0032 * Math.sin(len * Math.PI * 2 / 0.034 + xN * 1.7 + Math.sin(len * 9) * 1.2) * (0.35 + 0.65 * xN * xN) + 0.0015 * Math.cos(xN * Math.PI * 1.5 + len * 4) : null,
    shade: (i, xN, yN) => (yN < 0 ? 0.72 : 1) * (1 - 0.18 * Math.abs(xN) ** 6) * (1 - 0.12 * (1 - kk[i])),
  });
  // ---- nó: tira enrolada em volta das pontas + volume por dentro
  const kp = [], kw = [], ko = [], kW = [], kT = [];
  const NK = hi ? 48 : 12;
  for (let i = 0; i <= NK; i++) {
    const a = i / NK * Math.PI * 2 + 0.3;
    const out = V3(Math.sin(a), 0, Math.cos(a));
    kp.push(KNOT.clone().add(V3(out.x * 0.029, 0.001 + 0.005 * Math.sin(a * 2), out.z * 0.016)));
    // a tira fecha por cima (inclinada para dentro), como um nó apertado
    kw.push(V3(0.15 * Math.sin(a), 1, 0).normalize().multiplyScalar(Math.cos(0.5)).addScaledVector(out, -Math.sin(0.5)));
    ko.push(out); kW.push(0.046 - 0.004 * Math.cos(a * 2)); kT.push(0.016);
  }
  const knot = sweepBand(kp, kw, ko, kW, kT, { seg: hi ? 16 : 6, fold: hi ? (i, xN) => 0.0025 * Math.sin(xN * 4 + i * 0.7) : null, shade: (i, xN, yN) => (yN < 0 ? 0.6 : 1) * (1 - 0.25 * Math.abs(xN) ** 4), caps: false });
  // miolo do nó (escuro, só aparece pela fresta de cima)
  const core = new THREE.SphereGeometry(1, hi ? 14 : 6, hi ? 10 : 4); core.scale(0.026, 0.022, 0.013); core.translate(KNOT.x, KNOT.y + 0.004, KNOT.z - 0.001);
  { const uvA = core.attributes.uv; for (let i = 0; i < uvA.count; i++) uvA.setXY(i, uvA.getX(i) * 0.12, uvA.getY(i) * 0.06); }
  core.setAttribute('color', new THREE.Float32BufferAttribute(new Array(core.attributes.position.count * 3).fill(0.55), 3));
  const statics = mergeGeometries([loops, knot, core], false);
  // ---- pontas (geometria em repouso; cada boneco tem a sua cópia que balança)
  const tails = [
    { x0: KNOT.x + 0.006, x1: KNOT.x + 0.03, L: 0.34, layer: 0, tw: 0.1, seed: 1 },
    { x0: KNOT.x - 0.01, x1: KNOT.x - 0.032, L: 0.27, layer: 1, tw: -0.14, seed: 2 },
  ].map(tp => buildTail(lv, pr, tp, TH));
  return { statics, tails };
}
function buildTail(lv, pr, tp, TH) {
  const hi = lv === 'hi', N = hi ? 60 : 10;
  const y0 = KNOT.y + 0.004;
  const pts = [], wd = [], od = [], W = [], Th = [];
  let zPrev = KNOT.z + 0.004 + tp.layer * 0.012;
  for (let i = 0; i <= N; i++) {
    const s = i / N, y = y0 - s * tp.L;
    const x = lerp(tp.x0, tp.x1, Math.pow(s, 0.6));
    const zs = Math.max(pr.front(x - 0.03, y), pr.front(x, y), pr.front(x + 0.03, y)) + TH * 0.5 + 0.004 + tp.layer * (TH + 0.003);
    const z = Math.max(zs, zPrev - (s < 0.08 ? 0.01 : 0)); zPrev = z;
    pts.push(V3(x, y, z));
    const ang = tp.tw * (1 - s) + 0.04 * Math.sin(s * 5 + tp.seed);
    wd.push(V3(Math.cos(ang), Math.sin(ang) * 0.3, 0)); od.push(V3(0, 0, 1));
    W.push(lerp(0.045, 0.084, sstep(0, 0.3, s))); Th.push(TH * (1 + 0.3 * (1 - sstep(0, 0.15, s))));
  }
  const parts = [sweepBand(pts, wd, od, W, Th, {
    seg: hi ? 20 : 8,
    // pregas ao longo da ponta (franzida no nó, abrindo para baixo) + ondulação suave
    fold: hi ? (i, xN, len) => { const s = i / N; return (0.0045 * (1 - s) + 0.0016) * Math.sin(xN * Math.PI * (2.2 - s) + tp.seed * 1.7 + s * 2) + 0.0012 * Math.sin(len * 40 + xN * 3); } : null,
    shade: (i, xN, yN) => (yN < 0 ? 0.7 : 1) * (1 - 0.15 * Math.abs(xN) ** 6) * (i < 3 ? 0.8 : 1),
  })];
  // franjas: fios torcidos saindo da barra
  if (hi) {
    const e = pts[N], Tn = pts[N].clone().sub(pts[N - 1]).normalize();
    const w = wd[N].clone().addScaledVector(Tn, -wd[N].dot(Tn)).normalize();
    const M = 13;
    for (let k = 0; k < M; k++) {
      const xN = (k + 0.5) / M - 0.5, r = 0.0029, len = 0.036 + 0.012 * hash1(k * 7 + tp.seed * 13);
      const base = e.clone().addScaledVector(w, xN * W[N] * 0.94).add(V3(0, 0.004, 0));
      const splay = (hash1(k * 3.1 + tp.seed) - 0.5) * 0.35 + xN * 0.25, bend = (hash1(k * 5.3 + tp.seed) - 0.5) * 0.3;
      const fp = [], fw = [], fo = [], fW = [], fT = [];
      const NF = 6;
      for (let j = 0; j <= NF; j++) {
        const s = j / NF;
        fp.push(base.clone().add(V3(Math.sin(splay) * len * s + w.x * 0, -Math.cos(splay * 0.5) * len * s, bend * len * s * s)));
        fw.push(V3(Math.cos(s * 6 + k), 0, Math.sin(s * 6 + k))); fo.push(V3(-Math.sin(s * 6 + k), 0, Math.cos(s * 6 + k)));
        fW.push(r * 2 * (1 - 0.25 * s)); fT.push(r * 1.6 * (1 - 0.25 * s));
      }
      parts.push(sweepBand(fp, fw, fo, fW, fT, { seg: 6, p: 2, shade: () => 0.82 }));
    }
  }
  const g = mergeGeometries(parts, false);
  g.userData = { y0, L: tp.L, rest: Float32Array.from(g.attributes.position.array), nrest: Float32Array.from(g.attributes.normal.array) };
  return g;
}

// =====================================================================================================
// CHAPÉUS (espaço do grupo da cabeça: +Y para cima, +Z para a frente do rosto)
// =====================================================================================================
// raio da cabeça (centro c) na direção horizontal φ, máximo numa faixa de alturas
function headRing(pr, phiN, ys, cz = 0) {
  const R = [];
  for (let i = 0; i < phiN; i++) {
    const a = i / phiN * Math.PI * 2, d = V3(Math.sin(a), 0, Math.cos(a));
    let m = 0; for (const y of ys) m = Math.max(m, pr.radial(V3(0, y, cz), d));
    R.push(m);
  }
  // suaviza (o nariz/sobrancelha não podem deformar a copa)
  const S = R.slice();
  for (let i = 0; i < phiN; i++) { let s = 0, w = 0; for (let k = -4; k <= 4; k++) { const ww = gauss(k, 3); s += R[(i + k + phiN) % phiN] * ww; w += ww; } S[i] = Math.max(R[i] * 0.985, s / w); }
  return (phi) => { const f = ((phi / (Math.PI * 2)) % 1 + 1) % 1 * phiN, i0 = Math.floor(f), t = f - i0; return lerp(S[i0 % phiN], S[(i0 + 1) % phiN], t); };
}
const FEDORA_Y = 0.142;
function buildFedora(lv, head) {
  const hi = lv === 'hi', pr = new Probe(head);
  const R = headRing(pr, 72, [FEDORA_Y - 0.004, FEDORA_Y + 0.004, FEDORA_Y + 0.015, FEDORA_Y + 0.03], 0);
  const Rb = (phi) => R(phi) + 0.0065;                                   // abertura (folga para a carneira)
  const nPhi = hi ? 112 : 18;
  // ---- copa: perfil (raio relativo m, altura h) → vinco em gota no topo + beliscões na frente
  const Hc = (phi) => 0.104 + 0.008 * (-Math.cos(phi));                  // atrás um pouco mais alta
  const prof = (s) => {                                                  // s 0 = fita, 1 = centro do topo
    if (s < 0.62) { const t = s / 0.62; return [1 - 0.07 * t * t, t * 0.86]; }
    if (s < 0.8) { const t = (s - 0.62) / 0.18, a = t * Math.PI / 2; return [0.93 - 0.11 * Math.sin(a), 0.86 + 0.14 * Math.sin(a) * (1 - 0.3 * t)]; }
    const t = (s - 0.8) / 0.2; return [0.82 * (1 - t), 0.958 + 0.042 * Math.sin(t * Math.PI / 2) * 0];
  };
  const crownPt = (phi, s) => {
    const [m, hN] = prof(s);
    const H = Hc(phi);
    let r = Rb(phi) * m;
    // beliscões dos dois lados da frente, na metade de cima
    const pinch = (gauss(phi - 0.62, 0.32) + gauss(phi - (Math.PI * 2 - 0.62), 0.32)) * sstep(0.35, 0.85, hN) * (s < 0.8 ? 1 : 1 - (s - 0.8) / 0.2);
    r -= 0.013 * pinch;
    // copa afunila na frente (gota)
    r *= 1 - 0.07 * Math.max(0, Math.cos(phi)) * sstep(0.4, 1, hN);
    let x = Math.sin(phi) * r, z = Math.cos(phi) * r * 1.0;
    let y = hN * H;
    // vinco central (frente→trás), só no topo
    const top = sstep(0.66, 0.86, s);
    const crease = 0.024 * gauss(x, 0.024) * sstep(-0.075, 0.0, z) * (1 - 0.35 * sstep(0.0, 0.06, z));
    y -= crease * top;
    return V3(x, y, z);
  };
  const crown = ringSurface(nPhi, lin(hi ? 34 : 7), crownPt, { flip: true, shade: (phi, s) => s > 0.8 ? 0.92 : 1 - 0.1 * (1 - sstep(0, 0.08, s)) });
  // ---- aba: seção fechada (em cima → borda debruada → embaixo), curvatura por ângulo
  const bw = (phi) => 0.054 + 0.004 * Math.cos(phi) - 0.003 * Math.sin(phi) ** 2;
  const curl = (phi, t) => t * t * (-0.016 * Math.max(0, Math.cos(phi)) ** 1.5 + 0.024 * Math.max(0, -Math.cos(phi)) ** 1.4 + 0.012 * Math.sin(phi) ** 2 * t);
  const brimSec = [];   // [t, d] fechado
  const nT = hi ? 14 : 4;
  for (let i = 0; i <= nT; i++) brimSec.push([i / nT, 0.0021]);
  const nL = hi ? 8 : 3;
  for (let i = 1; i < nL; i++) { const a = i / nL * Math.PI; brimSec.push([1 + 0.0035 / 0.054 * Math.sin(a), 0.0021 + 0.0005 + Math.cos(a) * 0.003 - 0.0005]); }
  for (let i = nT; i >= 0; i--) brimSec.push([i / nT, -0.0021]);
  const brimPt = (phi, s) => {
    const k = Math.min(brimSec.length - 1, Math.round(s * (brimSec.length - 1)));
    const [t, d] = brimSec[k];
    const r = Rb(phi) - 0.002 + t * bw(phi), y = curl(phi, Math.min(1, t)) + d - 0.001;
    // normal aproximada da aba (para a espessura seguir a curvatura)
    const dy = (curl(phi, Math.min(1, t) + 0.01) - curl(phi, Math.min(1, t))) / (0.01 * bw(phi));
    const nl = Math.hypot(1, dy);
    return V3(Math.sin(phi) * (r - d * dy / nl), y + d * (1 / nl - 1) * 0, Math.cos(phi) * (r - d * dy / nl));
  };
  const brim = ringSurface(nPhi, brimSec.map((_, i) => i / (brimSec.length - 1)), brimPt, { closed: true, shade: (phi, s) => s > 0.5 ? 0.78 : 1 });
  // ---- fita de gorgorão + laço do lado esquerdo
  const bandPt = (phi, s) => {
    const sec = [[0, 0], [0, 1], [1, 1], [1, 0]];
    const q = s * 4, k = Math.min(3, Math.floor(q)), t = q - k;
    const A = sec[k], B = sec[(k + 1) % 4];
    const out = lerp(A[0], B[0], t), hh = lerp(A[1], B[1], t);
    const yy = 0.003 + hh * 0.027;
    const base = crownPt(phi, (yy / Hc(phi)) / 0.86 * 0.62);
    const r = Math.hypot(base.x, base.z) + 0.0012 + out * 0.0022;
    return V3(Math.sin(phi) * r, yy, Math.cos(phi) * r);
  };
  const bandG = ringSurface(nPhi, lin(4), bandPt, { closed: false, shade: (phi, s) => (s > 0.2 && s < 0.8) ? 1 : 0.8 });
  const bandParts = [bandG];
  if (hi) {
    const phiB = Math.PI / 2 + 0.25, rB = Rb(phiB) * 0.995 + 0.004;
    const c = V3(Math.sin(phiB) * rB, 0.017, Math.cos(phiB) * rB), out = V3(Math.sin(phiB), 0, Math.cos(phiB)), tg = V3(Math.cos(phiB), 0, -Math.sin(phiB));
    for (const [dx, sc] of [[-0.016, 1], [-0.028, 0.8]]) {
      const lobe = new THREE.SphereGeometry(1, 14, 10); lobe.scale(0.011 * sc + 0.003, 0.0105 * sc, 0.0035);
      const m4 = new THREE.Matrix4().makeBasis(tg, V3(0, 1, 0), out).setPosition(c.clone().addScaledVector(tg, -dx * 0.6 - 0.006).addScaledVector(out, 0.002 + 0.001 * sc));
      lobe.applyMatrix4(m4); lobe.setAttribute('color', new THREE.Float32BufferAttribute(new Array(lobe.attributes.position.count * 3).fill(0.9), 3)); bandParts.push(lobe);
    }
    const kn = new THREE.SphereGeometry(1, 10, 8); kn.scale(0.0045, 0.0125, 0.0045); kn.translate(c.x + out.x * 0.004, c.y, c.z + out.z * 0.004);
    kn.setAttribute('color', new THREE.Float32BufferAttribute(new Array(kn.attributes.position.count * 3).fill(0.85), 3)); bandParts.push(kn);
    for (const g of bandParts.slice(1)) { g.deleteAttribute('uv'); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 2).fill(0), 2)); }
  }
  const band = mergeGeometries(bandParts.map(g => g.index ? g : g), false);
  const felt = mergeGeometries([crown, brim], false);
  for (const g of [felt, band]) g.translate(0, FEDORA_Y, 0);
  return { felt, band };
}
function buildBeanie(lv, head) {
  const hi = lv === 'hi', pr = new Probe(head);
  const c = V3(0, 0.1, -0.004);
  const nPhi = hi ? 120 : 18;
  // borda de baixo: logo acima das sobrancelhas na frente, cobrindo a nuca atrás
  const yB = (phi) => 0.097 + 0.022 * Math.cos(phi) - 0.006 * Math.sin(phi) ** 2;
  const elev0 = (phi) => Math.asin(clamp((yB(phi) - c.y) / 0.09, -0.9, 0.9));
  const surf = (phi, s, add) => {
    const e0 = elev0(phi), el = lerp(e0, Math.PI / 2, s);
    const d = V3(Math.sin(phi) * Math.cos(el), Math.sin(el), Math.cos(phi) * Math.cos(el));
    // cabeça medida, mas nunca dentro de um elipsoide redondo (o topo da cabeça é ovalado/pontudo)
    const re = 1 / Math.sqrt((d.x / 0.081) ** 2 + (d.y / 0.104) ** 2 + (d.z / 0.092) ** 2);
    const r = Math.max(pr.radial(c, d), re * sstep(0.3, 0.8, s) + pr.radial(c, d) * (1 - sstep(0.3, 0.8, s)));
    // folga/volume: malha grossa + leve "caimento" atrás no topo
    const slouch = 0.008 * Math.sin(Math.PI * sstep(0.25, 1, s)) * (0.5 + 0.5 * Math.max(0, -Math.cos(phi)));
    // diminuições do topo (6 gomos)
    const seam = 0.0017 * sstep(0.62, 0.9, s) * (1 - sstep(0.96, 1, s)) * Math.pow(Math.abs(Math.cos(phi * 3)), 8);
    return c.clone().addScaledVector(d, r + add + slouch - seam);
  };
  const body = ringSurface(nPhi, lin(hi ? 30 : 6), (phi, s) => surf(phi, s, 0.0075), { flip: true, shade: (phi, s) => 1 - 0.12 * (1 - sstep(0, 0.15, s)) });
  // barra dobrada: seção fechada (face de fora sobe, dobra arredondada embaixo, face de dentro)
  const nR = hi ? 240 : 18;
  const cuffH = 0.04, sec = [];
  const nS = hi ? 8 : 2;
  for (let i = 0; i <= nS; i++) sec.push([i / nS, 1]);            // por fora, de baixo para cima
  for (let i = 1; i <= (hi ? 4 : 1); i++) { const a = i / (hi ? 5 : 2) * Math.PI; sec.push([1 + 0.06 * Math.sin(a), Math.cos(a)]); }
  for (let i = nS; i >= 0; i--) sec.push([i / nS, -1]);           // por dentro, de cima para baixo
  for (let i = 1; i <= (hi ? 6 : 1); i++) { const a = i / (hi ? 7 : 2) * Math.PI; sec.push([-0.1 * Math.sin(a), -Math.cos(a)]); }
  const cuffPt = (phi, s) => {
    const k = Math.min(sec.length - 1, Math.round(s * (sec.length - 1)));
    const [t, side] = sec[k];
    // altura ao longo do corpo (ângulo de elevação equivalente a 4 cm)
    const sAt = clamp(t, -0.2, 1.1) * 0.21;
    const p = surf(phi, Math.max(0, sAt), 0.0075);
    const pl = surf(phi, Math.max(0, sAt) + 0.01, 0.0075), dir = p.clone().sub(pl).normalize();
    if (sAt < 0) p.addScaledVector(dir, sAt / 0.21 * cuffH * 0.4);
    const out = p.clone().sub(c).setY(0).normalize();
    const rib = hi ? 0.0016 * Math.cos(phi * 60) : 0;
    const thick = 0.0052 + 0.0052 * side + (side > 0 ? rib : 0) + 0.002;
    return p.addScaledVector(out, thick);
  };
  const cuff = ringSurface(nR, sec.map((_, i) => i / (sec.length - 1)), cuffPt, { closed: true, flip: true, shade: (phi, s) => (s > 0.42 && s < 0.98) ? 0.7 : (hi ? 0.9 + 0.1 * Math.cos(phi * 60) : 1) });
  return { knit: body, rib: cuff };
}

// =====================================================================================================
// CACHE de geometrias por nível + montagem num boneco
// =====================================================================================================
const GEOS = {};
function geo(kind, lv, refs) {
  const key = kind + lv;
  if (!GEOS[key]) GEOS[key] = kind === 'scarf' ? buildScarf(lv, refs.chest) : kind === 'fedora' ? buildFedora(lv, refs.head) : buildBeanie(lv, refs.head);
  return GEOS[key];
}
function addMesh(t, parent, lv, g, mat) {
  const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; parent.add(m);
  t.lodSets[lv].push(m); m.visible = t.lod ? t.lod === lv : lv === 'hi'; t.acc.meshes.push(m); return m;
}
// look = { acc: 'scarf'|'fedora'|'beanie', col: 0xRRGGBB }; refs = { chest, head } (geometrias altas do corpo)
export function attachAccessory(t, look, refs) {
  removeAccessory(t);
  const acc = look && ['scarf', 'fedora', 'beanie'].includes(look.acc) ? look.acc : 'scarf';
  const col = look && Number.isFinite(look.col) ? look.col : 0x8a2a24;
  t.acc = { kind: acc, col, meshes: [], tails: [] };
  t.look = { acc, col };
  for (const lv of ['hi', 'lo']) {
    const G = geo(acc, lv, refs);
    if (acc === 'scarf') {
      const mat = accMat('knit', col);
      addMesh(t, t.torso, lv, G.statics, mat);
      G.tails.forEach((tg, j) => {
        const g = tg.clone(); g.userData = tg.userData;
        const m = addMesh(t, t.torso, lv, g, mat);
        m.frustumCulled = false; // a ponta se move: o volume de corte em repouso não vale
        t.acc.tails.push({ m, lv, j, x: 0, z: 0, vx: 0, vz: 0, L: tg.userData.L });
      });
    } else if (acc === 'fedora') {
      addMesh(t, t.head, lv, G.felt, accMat('felt', col));
      addMesh(t, t.head, lv, G.band, accMat('band', col));
    } else {
      addMesh(t, t.head, lv, G.knit, accMat('knit', col));
      addMesh(t, t.head, lv, G.rib, accMat('rib', col));
    }
  }
  t.acc.prevPos = null; t.acc.prevVel = null;
}
export function removeAccessory(t) {
  if (!t.acc) return;
  for (const m of t.acc.meshes) {
    m.removeFromParent();
    for (const lv of ['hi', 'lo']) { const i = t.lodSets[lv].indexOf(m); if (i >= 0) t.lodSets[lv].splice(i, 1); }
  }
  for (const tl of t.acc.tails) tl.m.geometry.dispose();
  t.acc = null;
}
// balanço das pontas do cachecol: pêndulo amortecido por ponta no espaço do tronco (gravidade local + inércia)
const _q = new THREE.Quaternion(), _g = new THREE.Vector3(), _p = new THREE.Vector3(), _a = new THREE.Vector3();
export function updateAccessory(t, dt) {
  const A = t.acc; if (!A || !A.tails.length || !(dt > 0)) return;
  t.torso.updateWorldMatrix(true, false);
  t.torso.getWorldQuaternion(_q).invert();
  _g.set(0, -1, 0).applyQuaternion(_q);                       // "para baixo" visto pelo tronco
  t.torso.getWorldPosition(_p);
  if (!A.prevPos || dt > 0.25) { A.prevPos = _p.clone(); A.prevVel = new THREE.Vector3(); }
  const vel = _p.clone().sub(A.prevPos).divideScalar(dt); A.prevPos.copy(_p);
  if (vel.length() > 12) vel.set(0, 0, 0);                    // teleporte
  _a.copy(vel).sub(A.prevVel).divideScalar(dt).clampLength(0, 40); A.prevVel.lerp(vel, 1);
  const aL = _a.clone().applyQuaternion(_q), vL = vel.clone().applyQuaternion(_q);
  const lvVisible = t.lod || 'hi';
  for (const tl of A.tails) {
    const om = Math.sqrt(9.8 / (tl.L * 0.75)) * (tl.j ? 1.08 : 1), ze = 0.32;
    // posição de equilíbrio da ponta (deslocamento horizontal no espaço do tronco)
    const gx = _g.x * tl.L * 0.8, gz = _g.z * tl.L * 0.8;
    const tx = gx - aL.x / 9.8 * tl.L * 0.5 - vL.x * 0.012, tz = gz - aL.z / 9.8 * tl.L * 0.5 - vL.z * 0.02;
    const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
    for (let i = 0; i < n; i++) {
      tl.vx += (om * om * (tx - tl.x) - 2 * ze * om * tl.vx) * h; tl.vz += (om * om * (tz - tl.z) - 2 * ze * om * tl.vz) * h;
      tl.x += tl.vx * h; tl.z += tl.vz * h;
      // o peito segura a ponta (não entra no tronco); limite de amplitude
      if (tl.z < -0.004) { tl.z = -0.004; if (tl.vz < 0) tl.vz *= -0.2; }
      const r = Math.hypot(tl.x, tl.z), rm = tl.L * 0.6; if (r > rm) { tl.x *= rm / r; tl.z *= rm / r; }
    }
    if (tl.lv !== lvVisible) continue;
    deformTail(tl);
  }
}
function deformTail(tl) {
  const g = tl.m.geometry, { rest, y0, L } = g.userData, pos = g.attributes.position.array;
  const dx = tl.x, dz = tl.z, d2 = dx * dx + dz * dz;
  if (Math.abs(dx - (tl.ldx ?? 9)) < 1e-4 && Math.abs(dz - (tl.ldz ?? 9)) < 1e-4) return;
  tl.ldx = dx; tl.ldz = dz;
  for (let i = 0; i < pos.length; i += 3) {
    const y = rest[i + 1], s = clamp((y0 - y) / L, 0, 1.25);
    const w = Math.pow(s, 1.7);
    pos[i] = rest[i] + dx * w;
    pos[i + 2] = rest[i + 2] + dz * w;
    pos[i + 1] = y + d2 / (2 * L) * w * 1.2;   // a ponta sobe um pouco ao se afastar (comprimento constante)
  }
  g.attributes.position.needsUpdate = true;
  g.computeVertexNormals();
}
// número de triângulos do acessório num nível (relatórios/laboratório)
export function accessoryTriangles(t, lv) { let n = 0; for (const m of (t.acc ? t.acc.meshes : [])) if (t.lodSets[lv].includes(m)) n += m.geometry.index.count / 3; return n; }
