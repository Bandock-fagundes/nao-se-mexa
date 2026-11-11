// Móveis, recipientes, objetos derrubáveis e a chave. Frente local = +Z; origem no chão, centro da pegada.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRng } from '../../../shared/rng.js';
import { buildFlames, buildSparks, coalMaterial } from './fx.js';

export function tint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
export function mesh(geo, mat, color = 0xffffff) {
  if (!geo.attributes.color) tint(geo, color);
  const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; return m;
}
export function B(g, w, h, d, mat, x, y, z, color, rx = 0, ry = 0, rz = 0) {
  const m = mesh(new THREE.BoxGeometry(w, h, d), mat, color); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m;
}
export function RB(g, w, h, d, r, mat, x, y, z, color) {
  const m = mesh(new RoundedBoxGeometry(w, h, d, 2, r), mat, color); m.position.set(x, y, z); g.add(m); return m;
}
export function C(g, rt, rb, h, mat, x, y, z, color, seg = 12, rx = 0, rz = 0) {
  const m = mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, color); m.position.set(x, y, z); m.rotation.set(rx, 0, rz); g.add(m); return m;
}
export function S(g, r, mat, x, y, z, color, sx = 1, sy = 1, sz = 1, seg = 12) {
  const m = mesh(new THREE.SphereGeometry(r, seg, Math.max(6, seg * 0.75 | 0)), mat, color); m.position.set(x, y, z); m.scale.set(sx, sy, sz); g.add(m); return m;
}
// dyn: parte móvel única (porta de armário, tampa de baú…). dynParts (v2): várias partes independentes (gavetas)
// v3: a segunda folha (extra) também é móvel — sem isso ela era fundida na malha estática e não abria
const dyn = (g, o) => { o.part.userData.dynamic = true; if (o.extra) o.extra.userData.dynamic = true; g.userData.dyn = o; g.userData.parts = [o]; return g; };
const dynParts = (g, list) => { for (const o of list) { o.part.userData.dynamic = true; if (o.extra) o.extra.userData.dynamic = true; } g.userData.dyn = list[0]; g.userData.parts = list; return g; };
const knob = (g, M, x, y, z) => S(g, 0.018, M.brass, x, y, z, 0xffffff, 1, 1, 1, 8);

const COLORS = { cloth: [0x5a1416, 0x1e3a2a, 0x2a2a40, 0x4a3a20, 0x3a1a2a], books: [0x5a1a14, 0x1a3a24, 0x1a2440, 0x4a3a1a, 0x2a1a10, 0x3a3a30, 0x601818, 0x203018] };

// ---------- builders genéricos ----------
function legsTable(g, M, w, d, h, col, inset = 0.06, r = 0.03) {
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) C(g, r * 0.7, r, h, M.darkWood, sx * (w / 2 - inset), h / 2, sz * (d / 2 - inset), col, 8);
}
function table(g, M, w, d, h, col = 0xffffff) {
  B(g, w, 0.05, d, M.wood, 0, h - 0.025, 0, col);
  B(g, w - 0.1, 0.08, d - 0.1, M.darkWood, 0, h - 0.09, 0, col);
  legsTable(g, M, w, d, h - 0.05, col);
}
function chair(g, M, x, z, ry, col) {
  const c = new THREE.Group(); c.position.set(x, 0, z); c.rotation.y = ry; g.add(c);
  B(c, 0.44, 0.05, 0.44, M.fabric, 0, 0.47, 0, col);
  for (const [a, b] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) B(c, 0.04, 0.45, 0.04, M.darkWood, a, 0.225, b);
  B(c, 0.44, 0.62, 0.05, M.darkWood, 0, 0.8, -0.2); B(c, 0.34, 0.42, 0.03, M.fabric, 0, 0.82, -0.175, col);
  return c;
}
function drawerFront(g, M, w, h, x, y, z, col) {
  const p = new THREE.Group(); p.position.set(x, y, z); g.add(p);
  B(p, w, h, 0.03, M.wood, 0, 0, 0, col); knob(g === p ? p : p, M, 0, 0, 0.025);
  return p;
}
// caixa com tampa (recipiente "prateleira"): pequena caixa de madeira sobre a prateleira
function shelfBox(g, M, x, y, z) {
  const box = new THREE.Group(); box.position.set(x, y, z); g.add(box);
  B(box, 0.34, 0.16, 0.24, M.wood, 0, 0.08, 0, 0x8a6040);
  B(box, 0.35, 0.02, 0.02, M.brass, 0, 0.12, 0.125);
  const lid = new THREE.Group(); lid.position.set(0, 0.16, -0.12); box.add(lid);
  B(lid, 0.35, 0.03, 0.25, M.wood, 0, 0.015, 0.12, 0x7a5030);
  const anchor = new THREE.Object3D(); anchor.position.set(0, 0.06, 0); box.add(anchor);
  return { part: lid, type: 'lid', amount: -1.8, anchor, label: 'caixa na prateleira' };
}
function books(g, M, w, y, depth, rnd, z0 = 0.02, x0 = 0) { // x0: centro da faixa de livros
  let bx = x0 - w / 2 + 0.04;
  while (bx < x0 + w / 2 - 0.08) {
    const bw = 0.03 + rnd.next() * 0.05, bh = 0.22 + rnd.next() * 0.14;
    if (rnd.next() < 0.1) { bx += 0.08 + rnd.next() * 0.1; continue; }
    const m = B(g, bw, bh, depth, M.books, bx + bw / 2, y + bh / 2, z0, COLORS.books[rnd.int(0, COLORS.books.length - 1)]);
    if (rnd.next() < 0.08) { m.rotation.z = 0.22; m.position.x += 0.02; }
    bx += bw + 0.004;
  }
}
function jars(g, M, w, y, rnd) {
  for (let x = -w / 2 + 0.12; x < w / 2 - 0.1; x += 0.16 + rnd.next() * 0.1) {
    const k = rnd.int(0, 2);
    if (k === 0) C(g, 0.05, 0.05, 0.16, M.glass, x, y + 0.08, 0.02, 0x9aa080, 10);
    else if (k === 1) C(g, 0.06, 0.07, 0.12, M.porcelain, x, y + 0.06, 0.02, 0xd8c8a8, 10);
    else S(g, 0.08, M.sheet, x, y + 0.07, 0.02, 0xa08a60, 1, 0.8, 1, 8);
  }
}

// v3: roupas penduradas no cabideiro — casacos, vestidos e camisas com dobras de tecido e cabides de madeira.
// Tudo vira 2 malhas (tecido + cabides), coloridas por vértice: pouco custo de desenho por armário.
const CLOTH_COLORS = [0x6a1a20, 0x24402e, 0x232a48, 0x6e5a30, 0x34302c, 0x9a8e78, 0x4a3048, 0x7a3020, 0x34444c, 0x5a2a2a, 0x2a3a2a];
function buildClothes(M, innerW, innerD, railY, rnd, variant, coatsOnly) {
  const g = new THREE.Group();
  const n = Math.max(3, Math.min(9, Math.floor(innerW / 0.115)));
  const cloth = [], wood = [];
  const step = innerW / n, sh = Math.min(innerD - 0.03, 0.36);
  for (let i = 0; i < n; i++) {
    const xx = -innerW / 2 + step * (i + 0.5) + (rnd.next() - 0.5) * 0.025;
    const type = coatsOnly ? (rnd.next() < 0.75 ? 'coat' : 'shirt') : ['coat', 'dress', 'shirt', 'coat', 'dress', 'shirt'][rnd.int(0, 5)];
    const len = type === 'coat' ? 0.95 + rnd.next() * 0.22 : type === 'dress' ? 1.08 + rnd.next() * 0.2 : 0.6 + rnd.next() * 0.12;
    const thick = type === 'coat' ? 0.085 : type === 'dress' ? 0.06 : 0.045;
    const col = CLOTH_COLORS[(variant * 3 + i * 7 + rnd.int(0, 9)) % CLOTH_COLORS.length];
    const geo = new THREE.BoxGeometry(thick, len, sh, 4, 16, 10);
    const pos = geo.attributes.position, ph = rnd.next() * 6, tw = (rnd.next() - 0.5) * 0.5;
    for (let k = 0; k < pos.count; k++) {
      let px = pos.getX(k); const py = pos.getY(k); let pz = pos.getZ(k);
      const f = (len / 2 - py) / len; // 0 = ombro, 1 = barra
      const widen = type === 'dress' ? 1 + f * 0.45 : type === 'coat' ? 1 + f * 0.1 : 1;
      const u = pz / (sh / 2); // -1 (fundo do armário) … +1 (frente)
      // v4: seção arredondada (mais cheia no meio, fina nas bordas) — não parece mais uma placa
      px *= 0.45 + 0.55 * Math.cos(Math.min(1, Math.abs(u)) * Math.PI / 2);
      pz *= widen * (f < 0.1 ? 0.72 + f * 2.8 : 1);                 // ombros caídos
      px += Math.sin(pz * 34 + ph) * 0.011 * (0.35 + f) + Math.sin(py * 9 + ph) * 0.004; // dobras do tecido
      // v4: barra ondulada e caimento curvo (a peça "barriga" um pouco e torce de leve até a barra)
      pz += Math.sin(py * 13 + ph) * 0.012 * f * Math.abs(u);
      px += Math.sin(u * 1.6 + ph) * 0.018 * f;
      { const a = tw * f, c = Math.cos(a), s2 = Math.sin(a); const x2 = px * c - pz * s2; pz = px * s2 + pz * c; px = x2; }
      if (type !== 'dress' && Math.abs(pz) > sh * 0.38 && f > 0.08 && f < 0.75) px *= 1.25; // mangas mais grossas nas bordas
      pos.setXYZ(k, px, py, Math.max(-innerD / 2 + 0.008, Math.min(innerD / 2 - 0.008, pz)));
    }
    geo.computeVertexNormals();
    geo.rotateY((rnd.next() - 0.5) * 0.22);
    geo.translate(xx, railY - 0.075 - len / 2, 0);
    tint(geo, col); cloth.push(geo);
    if (type === 'coat') { const lap = new THREE.BoxGeometry(thick + 0.006, len * 0.35, 0.05, 1, 1, 1); lap.translate(xx, railY - 0.075 - len * 0.2, sh * 0.42); tint(lap, col === 0xb8ae98 ? 0x8a8070 : 0x1a1410); cloth.push(lap); }
    const bar = new THREE.BoxGeometry(0.014, 0.02, sh * 0.96); bar.translate(xx, railY - 0.06, 0); tint(bar, 0x6a4a30); wood.push(bar);
    const hk = new THREE.TorusGeometry(0.017, 0.0028, 4, 10, Math.PI * 1.3); hk.rotateY(Math.PI / 2); hk.rotateX(-0.4); hk.translate(xx, railY + 0.004, 0); tint(hk, 0x9a8a68); wood.push(hk);
  }
  const mc = new THREE.Mesh(mergeGeometries(cloth, false), M.fabric); mc.castShadow = true; mc.receiveShadow = true; g.add(mc);
  const mw = new THREE.Mesh(mergeGeometries(wood, false), M.wood); g.add(mw);
  return g;
}

// v3: UV em escala de mundo nas caixas de madeira envelhecida (o veio não estica num painel de 2 m)
function woodUV(g, mat, tile = 0.75) {
  g.traverse(o => {
    if (!o.isMesh || o.material !== mat || !o.geometry.parameters || o.geometry.type !== 'BoxGeometry' || o.userData.wuv) return;
    const { width: w, height: h, depth: d } = o.geometry.parameters, uv = o.geometry.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    const per = uv.count / 6;
    for (let f = 0; f < 6; f++) for (let i = 0; i < per; i++) { const k = f * per + i; uv.setXY(k, uv.getX(k) * dims[f][0] / tile, uv.getY(k) * dims[f][1] / tile); }
    uv.needsUpdate = true; o.userData.wuv = true;
  });
}
// ---------- catálogo ----------
export function buildProp(kind, w, d, M, variant = 0) {
  const g = new THREE.Group();
  const rnd = makeRng('prop' + kind + variant);
  const cloth = COLORS.cloth[variant % COLORS.cloth.length];
  switch (kind) {
    case 'cabinet': case 'wardrobe': case 'oldwardrobe': case 'bcabinet': case 'china_cabinet': {
      const W = w - 0.08, H = kind === 'bcabinet' ? 1.7 : kind === 'cabinet' ? 2.0 : 2.15, Dp = Math.min(d - 0.06, 0.48);
      const robe = kind === 'wardrobe' || kind === 'oldwardrobe' || kind === 'cabinet';
      const body = kind === 'bcabinet' ? 0xd8d0c0 : kind === 'oldwardrobe' ? 0x9a8470 : 0xffffff;
      // v3: guarda-roupas em madeira escura envelhecida com almofadas (M.agedWood); banheiro continua em porcelana
      const mat = kind === 'bcabinet' ? M.porcelain : (M.agedWood || M.darkWood);
      const th = 0.035, y0 = 0.08;
      // corpo OCO: fundo de verdade (painel grosso) + laterais, teto e piso — ao abrir, você vê o interior, nunca a parede
      B(g, W, H, th, mat, 0, H / 2 + y0, -Dp / 2 + th / 2, body);
      B(g, th, H, Dp, mat, -W / 2 + th / 2, H / 2 + y0, 0, body);
      B(g, th, H, Dp, mat, W / 2 - th / 2, H / 2 + y0, 0, body);
      B(g, W, th, Dp, mat, 0, H + y0 - th / 2, 0, body);
      B(g, W, th, Dp, mat, 0, y0 + th / 2, 0, body);
      // cornija (2 frisos) e rodapé com pezinhos
      B(g, W + 0.06, 0.07, Dp + 0.04, mat, 0, H + y0 + 0.035, 0.0, body);
      B(g, W + 0.02, 0.04, Dp + 0.02, mat, 0, H + y0 + 0.09, -0.005, body);
      B(g, W + 0.02, 0.05, Dp + 0.01, mat, 0, y0 - 0.005, 0, body);
      for (const sx of [-1, 1]) B(g, 0.07, 0.05, 0.07, mat, sx * (W / 2 - 0.035), 0.025, Dp / 2 - 0.04, body);
      // forro interno: madeira mais clara (não é um buraco preto) + sombra suave no fundo
      const lining = kind === 'bcabinet' ? 0xc8c0b0 : 0xc8a890;
      B(g, W - 2 * th - 0.004, H - 2 * th - 0.004, 0.008, kind === 'bcabinet' ? M.porcelain : mat, 0, H / 2 + y0, -Dp / 2 + th + 0.005, lining);
      if (robe) {
        // prateleira alta (chapéus/caixas) e cabideiro de latão
        B(g, W - 2 * th, 0.02, Dp - 0.05, mat, 0, y0 + H * 0.86, -0.02, 0xd0b8a0);
        C(g, 0.011, 0.011, W - 2 * th, M.brass, 0, y0 + H * 0.8, 0.0, 0xffffff, 8, 0, Math.PI / 2);
        for (const sx of [-1, 1]) B(g, 0.02, 0.05, 0.03, M.brass, sx * (W / 2 - th - 0.01), y0 + H * 0.8, 0);
        if (rnd.next() < 0.7) { const hb = C(g, 0.12, 0.12, 0.14, M.fabric, -W / 4 + rnd.next() * 0.1, y0 + H * 0.86 + 0.08, -0.03, [0x5a3a2a, 0x2a3a4a, 0x6a1a1a][variant % 3], 14); void hb; }
        // roupas penduradas (malha única, colorida por vértice) — escondidas quando o armário guarda a chave
        const clothes = buildClothes(M, W - 2 * th - 0.04, Dp - 0.06, y0 + H * 0.8, rnd, variant, kind === 'cabinet');
        clothes.userData.dynamic = true; g.add(clothes); g.userData.clothes = clothes;
      } else {
        B(g, W - 2 * th, 0.02, Dp - 0.06, M.darkWood, 0, y0 + H * 0.5 - 0.25, 0.0, 0x6a4a30);
        if (kind === 'china_cabinet') for (let i = 0; i < 4; i++) C(g, 0.1, 0.1, 0.015, M.porcelain, -W / 2 + 0.2 + i * (W - 0.4) / 3, y0 + H * 0.5 - 0.12, -0.1, 0xffffff, 16, Math.PI / 2 - 0.3);
        if (kind === 'bcabinet') for (let i = 0; i < 3; i++) B(g, 0.2, 0.05, 0.22, M.fabric, -W / 2 + 0.18 + i * 0.22, y0 + H * 0.5 - 0.22, -0.04, [0xd8d0c0, 0x8aa0a8, 0xc8b8a0][i]);
      }
      // ganchinho de chave no centro do fundo (só aparece no armário que guarda a chave)
      const hook = new THREE.Group(); hook.position.set(0, y0 + H * 0.58, -Dp / 2 + th + 0.012); g.add(hook);
      B(hook, 0.026, 0.04, 0.006, M.brass, 0, 0.012, 0.003, 0xc89a40);
      S(hook, 0.0035, M.brass, 0, 0.026, 0.007, 0xe0b850, 1, 1, 1, 6); S(hook, 0.0035, M.brass, 0, -0.002, 0.007, 0xe0b850, 1, 1, 1, 6);
      C(hook, 0.0022, 0.0022, 0.02, M.brass, 0, 0.004, 0.016, 0xd8aa48, 6, Math.PI / 2);
      const hk = mesh(new THREE.TorusGeometry(0.006, 0.0022, 6, 10, Math.PI), M.brass, 0xd8aa48); hk.position.set(0, 0.009, 0.026); hk.rotation.set(0, Math.PI / 2, 0); hook.add(hk);
      hook.visible = false; hook.userData.dynamic = true; g.userData.hook = hook;
      // portas almofadadas (moldura + 2 almofadas em relevo), puxadores verticais e espelho de fechadura
      const doorCol = body === 0xffffff ? 0xd8bca8 : body;
      const lw = W / 2;
      const mkDoor = (side) => {
        const dg = new THREE.Group(); dg.position.set(side * W / 2, y0, Dp / 2 + 0.01); g.add(dg);
        const cx = -side * lw / 2, dh = H - 0.04;
        B(dg, lw - 0.012, dh, 0.03, mat, cx, H / 2, 0, doorCol);
        if (kind !== 'bcabinet') {
          for (const [py, ph] of [[H * 0.7, H * 0.38], [H * 0.27, H * 0.34]]) {
            const glassy = kind === 'china_cabinet' && py > H * 0.5;
            B(dg, lw - 0.13, ph, 0.012, glassy ? M.glass : mat, cx, py, 0.02, glassy ? 0xffffff : (kind === 'bcabinet' ? 0xc8c0b0 : 0xa88a72));   // almofada
            B(dg, lw - 0.1, 0.022, 0.014, mat, cx, py + ph / 2 + 0.011, 0.018, 0xffffff);                            // friso
            B(dg, lw - 0.1, 0.022, 0.014, mat, cx, py - ph / 2 - 0.011, 0.018, 0x806048);
          }
        }
        const hx = -side * (lw - 0.07);
        C(dg, 0.008, 0.008, 0.2, M.brass, hx, H * 0.52, 0.035, 0xffffff, 8);
        for (const yy of [H * 0.52 - 0.1, H * 0.52 + 0.1]) B(dg, 0.014, 0.014, 0.02, M.brass, hx, yy, 0.025);
        if (side < 0) { B(dg, 0.03, 0.05, 0.004, M.brass, hx + side * 0.03 * -1, H * 0.45, 0.018, 0xb08a3a); }
        return dg;
      };
      const left = mkDoor(-1), right = mkDoor(1);
      if (kind === 'oldwardrobe') { const sh = mesh(new THREE.PlaneGeometry(W * 0.7, 0.9, 8, 4), M.sheet, 0xb0a898); sh.position.set(0.1, H * 0.75, Dp / 2 + 0.05); g.add(sh); sh.userData.dynamic = true; }
      // chave: pendurada no gancho do centro (hang) — ou, nos armários sem roupa, também no gancho
      const anchor = new THREE.Object3D(); anchor.position.set(0, y0 + H * 0.58 + 0.005, -Dp / 2 + th + 0.036); g.add(anchor);
      if (mat === M.agedWood) woodUV(g, mat);
      return dyn(g, { part: left, type: 'door', amount: -1.9, anchor, hang: true, label: kind === 'china_cabinet' ? 'cristaleira' : kind === 'bcabinet' ? 'armário do banheiro' : 'guarda-roupa', extra: right });
    }
    case 'dresser': {
      // v3: cômoda com UMA gaveta grande em cima (a que abre — é onde a chave pode estar) e uma grade de
      // gavetinhas decorativas embaixo
      const H = 1.0, W = w - 0.08, Dp = Math.min(d - 0.06, 0.46);
      const mat = M.agedWood || M.darkWood;
      B(g, W, H - 0.12, Dp, mat, 0, (H - 0.12) / 2 + 0.1, 0, 0xffffff);
      B(g, W + 0.05, 0.045, Dp + 0.05, M.wood, 0, H - 0.0, 0, 0x8a6040);
      B(g, W + 0.02, 0.06, Dp + 0.02, mat, 0, 0.1, 0, 0x9a7a60);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const f = C(g, 0.03, 0.022, 0.08, mat, sx * (W / 2 - 0.05), 0.04, sz * (Dp / 2 - 0.05), 0x8a6a50, 8); void f; }
      // gaveta grande (interativa)
      const bigH = 0.2, bigW = W - 0.08, yTop = H - 0.15;
      const p = new THREE.Group(); p.position.set(0, yTop, Dp / 2 + 0.005); g.add(p);
      B(p, bigW, bigH, 0.03, mat, 0, 0, 0, 0xd8bca8);
      B(p, bigW - 0.06, bigH - 0.06, 0.008, mat, 0, 0, 0.017, 0xb09078);
      for (const sx of [-0.28, 0.28]) { knob(p, M, sx * bigW, 0, 0.028); }
      B(p, 0.035, 0.05, 0.004, M.brass, 0, 0, 0.022, 0xb08a3a);
      // v4: caixa da gaveta ABERTA por cima (fundo + laterais + traseira em madeira) — antes era um bloco preto
      // maciço e, olhando de cima, aparecia a tampa dele como uma faixa cinza lisa
      { const iw = bigW - 0.04, ih = bigH - 0.03, idp = Dp - 0.08, zc = -Dp / 2 + 0.01, t = 0.012;
        B(p, iw, t, idp, M.wood, 0, -ih / 2 + t / 2, zc, 0x6a4a30);                       // fundo
        for (const sx of [-1, 1]) B(p, t, ih, idp, M.wood, sx * (iw / 2 - t / 2), 0, zc, 0x4a3020); // laterais
        B(p, iw, ih, t, M.wood, 0, 0, zc - idp / 2 + t / 2, 0x3a2416);                    // traseira
        B(p, iw - 2 * t, 0.006, idp - 0.03, M.fabric, 0, -ih / 2 + t + 0.003, zc, 0x4a1a1c); } // forro de feltro
      const an = new THREE.Object3D(); an.position.set(0, -bigH / 2 + 0.04, -0.12); p.add(an); // v4: +1 cm (chave sobre o forro novo)
      // gavetinhas decorativas: 2 fileiras × 4 (ou 3 se for estreita), fixas
      const cols = W > 1.2 ? 4 : 3, rows = 2, gy0 = 0.17, gy1 = yTop - bigH / 2 - 0.035;
      const cw = (W - 0.08) / cols, rh = (gy1 - gy0) / rows;
      for (let rr = 0; rr < rows; rr++) for (let cc = 0; cc < cols; cc++) {
        const x = -W / 2 + 0.04 + cw * (cc + 0.5), y = gy0 + rh * (rr + 0.5);
        B(g, cw - 0.025, rh - 0.025, 0.02, mat, x, y, Dp / 2 + 0.008, 0xc8ac98);
        knob(g, M, x, y, Dp / 2 + 0.03);
      }
      // espelho
      B(g, 0.6, 0.75, 0.04, M.darkWood, 0, H + 0.4, -Dp / 2 + 0.05); B(g, 0.5, 0.62, 0.01, M.glass, 0, H + 0.4, -Dp / 2 + 0.08, 0x9aa0b0);
      if (mat === M.agedWood) woodUV(g, mat);
      return dynParts(g, [{ part: p, type: 'drawer', amount: 0.32, anchor: an, label: 'gaveta grande da cômoda' }]);
    }
    case 'statue': {
      // busto de mármore sobre pedestal
      C(g, 0.2, 0.21, 0.08, M.stone, 0, 0.04, 0, 0xb8b2a8, 16);
      C(g, 0.13, 0.15, 0.9, (M.marble || M.porcelain), 0, 0.53, 0, 0xc8c2b4, 14);
      C(g, 0.19, 0.17, 0.07, M.stone, 0, 1.01, 0, 0xb8b2a8, 16);
      const bust = new THREE.Group(); bust.position.y = 1.05; g.add(bust);
      S(bust, 0.18, (M.marble || M.porcelain), 0, 0.16, 0, 0xd8d2c4, 1.15, 0.75, 0.62, 14);
      C(bust, 0.05, 0.06, 0.12, (M.marble || M.porcelain), 0, 0.32, 0, 0xd8d2c4, 10);
      S(bust, 0.11, (M.marble || M.porcelain), 0, 0.5, 0.01, 0xd8d2c4, 0.85, 1.05, 0.95, 14);
      S(bust, 0.022, (M.marble || M.porcelain), 0, 0.5, 0.11, 0xd0cabc, 0.8, 1.2, 1, 6);
      if (variant % 3 === 0) B(bust, 0.13, 0.02, 0.02, M.black, 0, 0.53, 0.095, 0x101010); // olhos cobertos por uma faixa
      return g;
    }
    case 'pew': {
      const W = w - 0.12, Dp = d - 0.14;
      for (const sx of [-1, 1]) B(g, 0.06, 0.95, Dp, M.darkWood, sx * (W / 2 - 0.03), 0.475, 0, 0x3a2214);
      B(g, W - 0.1, 0.05, Dp * 0.48, M.wood, 0, 0.45, Dp * 0.16, 0x5a3a24);
      B(g, W - 0.1, 0.5, 0.04, M.wood, 0, 0.75, -Dp * 0.08, 0x5a3a24);
      B(g, W - 0.1, 0.05, 0.12, M.wood, 0, 0.98, -Dp * 0.08, 0x4a2a18);
      B(g, W - 0.1, 0.04, Dp * 0.25, M.wood, 0, 0.12, Dp * 0.16, 0x3a2214);
      B(g, W - 0.1, 0.3, 0.035, M.darkWood, 0, 0.62, -Dp / 2 + 0.03, 0x3a2214);
      B(g, W - 0.1, 0.035, 0.18, M.darkWood, 0, 0.78, -Dp / 2 + 0.1, 0x3a2214);
      return g;
    }
    case 'altar': {
      const W = w - 0.08, Dp = Math.min(d - 0.06, 0.44);
      B(g, W, 0.94, Dp, M.stone, 0, 0.47, 0, 0xa8a298);
      B(g, W + 0.04, 0.06, Dp + 0.04, M.stone, 0, 0.97, 0, 0xb8b2a8);
      B(g, W * 0.92, 0.006, Dp + 0.05, M.fabric, 0, 1.003, 0, 0xe0d8c8);
      B(g, W * 0.3, 0.5, 0.006, M.fabric, 0, 0.72, Dp / 2 + 0.026, 0x6a1416);
      B(g, 0.03, 0.24, 0.03, M.brass, 0, 1.12, -0.05, 0xc89a40); B(g, 0.14, 0.03, 0.03, M.brass, 0, 1.17, -0.05, 0xc89a40);
      return g;
    }
    case 'console': case 'sideboard': case 'side_table': case 'nightstand': {
      const H = kind === 'console' ? 0.85 : kind === 'nightstand' ? 0.6 : kind === 'side_table' ? 0.68 : 0.92;
      const W = w - 0.08, Dp = Math.min(d - 0.06, 0.46);
      const solid = kind !== 'console' && kind !== 'side_table';
      if (solid) { B(g, W, H - 0.1, Dp, M.darkWood, 0, (H - 0.1) / 2 + 0.08, 0); legsTable(g, M, W, Dp, 0.1, 0xffffff, 0.04, 0.025); }
      else { legsTable(g, M, W, Dp, H - 0.04, 0xffffff, 0.04, 0.022); B(g, W - 0.06, 0.14, Dp - 0.06, M.darkWood, 0, H - 0.12, 0); }
      B(g, W + 0.04, 0.04, Dp + 0.04, M.wood, 0, H - 0.02, 0, 0x8a6040);
      const rows = kind === 'sideboard' ? 2 : 1;
      const cols = W > 1.2 ? 2 : 1;
      let top = null; const drawers = [];
      for (let rr = 0; rr < rows; rr++) for (let cc = 0; cc < cols; cc++) {
        const dw = W / cols - 0.06, dh = solid ? Math.min(0.2, (H - 0.2) / rows - 0.04) : 0.11;
        const y = H - 0.12 - rr * (dh + 0.05) - (solid ? 0.02 : 0);
        const x = cols === 1 ? 0 : (cc === 0 ? -W / 4 : W / 4);
        const p = new THREE.Group(); p.position.set(x, y, Dp / 2 + 0.005); g.add(p);
        B(p, dw, dh, 0.03, M.wood, 0, 0, 0, 0x6a4228); knob(p, M, 0, 0, 0.025);
        // v2: TODA gaveta tem fundo (caixa) e ponto de apoio para a chave — cada uma abre separada
        B(p, dw - 0.04, dh - 0.03, Dp - 0.08, M.black, 0, 0, -Dp / 2 + 0.01);
        const an = new THREE.Object3D(); an.position.set(0, -dh / 2 + 0.03, -0.1); p.add(an);
        drawers.push({ part: p, type: 'drawer', amount: 0.3, anchor: an, label: 'gaveta' + (rows * cols > 1 ? ` ${rr * cols + cc + 1}` : '') });
        if (!top) top = p;
      }
      // decoração em cima
      if (kind === 'console' || kind === 'sideboard') { C(g, 0.05, 0.07, 0.25, M.porcelain, W / 2 - 0.2, H + 0.125, 0, 0x4a5a70, 10); }
      void top;
      return dynParts(g, drawers);
    }
    case 'clock': {
      B(g, 0.4, 1.6, 0.32, M.darkWood, 0, 0.8, 0); B(g, 0.44, 0.5, 0.36, M.darkWood, 0, 1.85, 0); B(g, 0.46, 0.06, 0.38, M.wood, 0, 2.13, 0); // cabe na célula de 0,5 m (relógios lado a lado não se atravessam)
      const face = mesh(new THREE.CircleGeometry(0.17, 24), M.paper, 0xd8ccaa); face.position.set(0, 1.85, 0.185); g.add(face);
      B(g, 0.01, 0.12, 0.005, M.black, 0, 1.88, 0.19); B(g, 0.08, 0.01, 0.005, M.black, 0.03, 1.85, 0.19);
      B(g, 0.26, 0.9, 0.01, M.glass, 0, 0.95, 0.165, 0x8090a0); C(g, 0.06, 0.06, 0.01, M.brass, 0, 0.7, 0.12, 0xffffff, 16, Math.PI / 2);
      return g;
    }
    case 'bench': { B(g, w - 0.1, 0.08, 0.4, M.fabric, 0, 0.46, 0, cloth); legsTable(g, M, w - 0.1, 0.38, 0.42, 0xffffff, 0.05, 0.025); return g; }
    case 'plant': {
      C(g, 0.17, 0.12, 0.34, M.porcelain, 0, 0.17, 0, 0x6a4a3a, 14);
      for (let i = 0; i < 9; i++) { const a = i * 0.7, l = 0.4 + rnd.next() * 0.5; const m = C(g, 0.006, 0.01, l, M.darkWood, Math.cos(a) * 0.05, 0.34 + l / 2, Math.sin(a) * 0.05, 0x3a2a18, 5, Math.sin(a) * 0.4, Math.cos(a) * 0.4); }
      for (let i = 0; i < 6; i++) S(g, 0.05, M.green, (rnd.next() - 0.5) * 0.3, 0.6 + rnd.next() * 0.4, (rnd.next() - 0.5) * 0.3, 0x3a3a1a, 1.4, 0.3, 0.8, 6);
      return g;
    }
    case 'fireplace': {
      // v5: lareira de verdade — boca aberta com fornalha de tijolo enegrecido, soleira de pedra, consolo de madeira,
      // cães de ferro com lenha, leito de brasas, chamas animadas (shader) e faíscas. A pegada (w × d, altura 1,65)
      // é a mesma de antes: nada muda na colisão/gerador. A luz é a 'fire' do gerador (pool de luzes), o brilho no
      // chão é posto por mansion.js (fica fora da pegada).
      const W = w - 0.2, D2 = Math.min(d, 0.5) / 2;               // frente em +D2, parede em -D2
      const ow = Math.min(0.92, W * 0.52), oh = 0.8, bodyH = 1.22;  // boca
      const zf = D2 - 0.08, zb = -D2 + 0.03;                        // face da frente do corpo / fundo da fornalha
      const pier = (W - ow) / 2;
      // corpo de pedra (2 pilares + verga) — o vão do meio fica aberto
      for (const sx of [-1, 1]) B(g, pier, bodyH, zf - (-D2), M.stone, sx * (ow / 2 + pier / 2), bodyH / 2, (zf - D2) / 2, 0x8e887e);
      B(g, ow, bodyH - oh, zf - (-D2), M.stone, 0, oh + (bodyH - oh) / 2, (zf - D2) / 2, 0x8e887e);
      // fornalha: fundo e laterais em leque, tijolo com fuligem (mais preto em cima)
      const inner = ow - 0.24, depth = zf - zb;
      const soot = (geo, yTop) => { const p = geo.attributes.position, c = new Float32Array(p.count * 3); for (let i = 0; i < p.count; i++) { const k = 0.8 - 0.62 * Math.pow(Math.min(1, Math.max(0, p.getY(i) / yTop)), 0.8); c[i * 3] = k; c[i * 3 + 1] = k * 0.86; c[i * 3 + 2] = k * 0.78; } geo.setAttribute('color', new THREE.BufferAttribute(c, 3)); return geo; };
      const back = new THREE.Mesh(soot(new THREE.PlaneGeometry(inner, oh, 1, 4).translate(0, oh / 2, 0), oh), M.sootBrick); back.position.z = zb; g.add(back);
      for (const sx of [-1, 1]) {
        const len = Math.hypot((ow - inner) / 2, depth), ang = Math.atan2((ow - inner) / 2, depth);
        const geo = soot(new THREE.PlaneGeometry(len, oh, 1, 4).translate(0, oh / 2, 0), oh);
        const m = new THREE.Mesh(geo, M.sootBrick); m.position.set(sx * (inner / 2 + (ow - inner) / 4), 0, (zb + zf) / 2);
        m.rotation.y = -sx * (Math.PI / 2 - ang); g.add(m);
      }
      // teto da fornalha (fuligem) e piso de cinzas
      const roof = new THREE.Mesh(tint(new THREE.PlaneGeometry(ow, depth), 0x1a1512), M.soot); roof.rotation.x = Math.PI / 2; roof.position.set(0, oh - 0.002, (zb + zf) / 2); g.add(roof);
      B(g, ow, 0.05, depth, M.soot, 0, 0.025, (zb + zf) / 2, 0x0c0a09);
      // soleira (pedra mais clara, um degrau baixo que avança para o cômodo) e moldura da boca
      B(g, Math.min(W, ow + 0.5), 0.05, D2 - zf + 0.02, M.stone, 0, 0.025, (zf + D2) / 2, 0x6e6a64);
      for (const sx of [-1, 1]) B(g, 0.05, oh + 0.03, 0.03, M.iron, sx * (ow / 2 + 0.01), (oh + 0.03) / 2, zf + 0.012, 0x2a2826);
      B(g, ow + 0.07, 0.05, 0.03, M.iron, 0, oh + 0.01, zf + 0.012, 0x2a2826);
      // consolo de madeira: pilastras, friso e prateleira
      for (const sx of [-1, 1]) {
        B(g, 0.12, bodyH - 0.06, 0.05, M.darkWood, sx * (ow / 2 + 0.13), (bodyH - 0.06) / 2, zf + 0.022, 0x4a2c1a);
        B(g, 0.16, 0.1, 0.07, M.darkWood, sx * (ow / 2 + 0.13), bodyH - 0.1, zf + 0.03, 0x3a2214); // capitel
        B(g, 0.16, 0.08, 0.06, M.darkWood, sx * (ow / 2 + 0.13), 0.04, zf + 0.026, 0x3a2214);  // base
      }
      B(g, ow + 0.38, 0.16, 0.035, M.darkWood, 0, oh + 0.2, zf + 0.016, 0x4a2c1a);            // friso
      B(g, W, 0.07, D2 * 2 - 0.02, M.darkWood, 0, bodyH + 0.035, 0, 0x3c2416);              // prateleira
      B(g, W - 0.06, 0.03, D2 * 2 - 0.06, M.darkWood, 0, bodyH - 0.012, -0.01, 0x2a160c);
      // cães de ferro (andirons) + grelha
      for (const sx of [-1, 1]) {
        B(g, 0.03, 0.03, 0.3, M.iron, sx * 0.17, 0.09, (zb + zf) / 2 + 0.02, 0x222120);
        C(g, 0.018, 0.022, 0.2, M.iron, sx * 0.17, 0.15, zf - 0.03, 0x222120, 8);
        S(g, 0.03, M.brass, sx * 0.17, 0.27, zf - 0.03, 0x8a6a30, 1, 1, 1, 8);
      }
      for (let i = 0; i < 4; i++) B(g, 0.38, 0.012, 0.012, M.iron, 0, 0.11, zb + 0.1 + i * 0.06, 0x222120);
      // lenha queimando (casca escura, ponta carbonizada)
      const logZ = (zb + zf) / 2 + 0.01;
      C(g, 0.048, 0.052, 0.5, M.charLog, -0.02, 0.15, logZ - 0.05, 0x3a2416, 9, 0, Math.PI / 2 + 0.05);
      C(g, 0.045, 0.05, 0.46, M.charLog, 0.03, 0.15, logZ + 0.06, 0x2e1c12, 9, 0, Math.PI / 2 - 0.08);
      { const l = C(g, 0.04, 0.045, 0.42, M.charLog, 0.0, 0.23, logZ, 0x241610, 9, 0, Math.PI / 2); l.rotation.set(0.0, 0.55, Math.PI / 2 + 0.12); }
      // leito de brasas (não ilumina: é só emissivo no shader)
      const coal = new THREE.Mesh(new THREE.PlaneGeometry(ow - 0.18, depth - 0.08), coalMaterial()); coal.rotation.x = -Math.PI / 2; coal.position.set(0, 0.056, logZ); coal.userData.dynamic = true; g.add(coal);
      // chamas (billboards em Y) e faíscas
      const fl = [];
      const fx0 = [-0.17, -0.06, 0.05, 0.16, -0.11, 0.1, 0.0];
      fx0.forEach((x, i) => fl.push({ x, y: 0.12 + (i > 3 ? 0.06 : 0), z: logZ + ((i * 37) % 5 - 2) * 0.02, w: 0.2 + (i % 3) * 0.05, h: i === 6 ? 0.62 : 0.34 + ((i * 53) % 7) * 0.035, seed: i * 1.37 + 0.2 }));
      const flames = buildFlames(fl); flames.userData.dynamic = true; g.add(flames);
      const sparks = buildSparks(26, -0.15, 0.15, 0.2, oh - 0.25, logZ - 0.05, logZ + 0.05); sparks.userData.dynamic = true; g.add(sparks);
      // castiçais e relógio sobre o consolo
      C(g, 0.035, 0.05, 0.28, M.brass, -W / 2 + 0.25, bodyH + 0.21, 0.0, 0xffffff, 8); C(g, 0.035, 0.05, 0.28, M.brass, W / 2 - 0.25, bodyH + 0.21, 0.0, 0xffffff, 8);
      C(g, 0.012, 0.012, 0.08, M.paper, -W / 2 + 0.25, bodyH + 0.39, 0.0, 0xe8dcc0, 6); C(g, 0.012, 0.012, 0.06, M.paper, W / 2 - 0.25, bodyH + 0.38, 0.0, 0xe8dcc0, 6);
      B(g, 0.22, 0.26, 0.1, M.darkWood, 0.12, bodyH + 0.2, -0.04, 0x3a2214);
      { const face = mesh(new THREE.CircleGeometry(0.075, 18), M.paper, 0xc8bc9a); face.position.set(0.12, bodyH + 0.22, 0.012); g.add(face); }
      g.userData.firebox = { ow, oh, zf, logZ }; // usado por mansion.js (brilho no chão) e pelo trailer
      return g;
    }
    case 'bookshelf': case 'kshelf': case 'pshelf': case 'mshelf': case 'winerack': {
      const W = w - 0.08, H = kind === 'winerack' ? 1.9 : 2.15, Dp = 0.4;
      const metal = kind === 'mshelf';
      const mat = metal ? M.iron : M.darkWood;
      B(g, W, H, 0.03, mat, 0, H / 2, -Dp / 2 + 0.015); B(g, 0.05, H, Dp, mat, -W / 2, H / 2, 0); B(g, 0.05, H, Dp, mat, W / 2, H / 2, 0);
      const n = kind === 'winerack' ? 6 : 5;
      let boxRes = null;
      const boxShelf = 2 + (variant % 2);
      for (let s = 0; s < n; s++) {
        const y = 0.06 + s * (H - 0.1) / n;
        B(g, W, 0.035, Dp, mat, 0, y, 0, metal ? 0xffffff : 0xffffff);
        if (s === boxShelf) {
          const bxc = -W / 4 + (variant % 3) * 0.1; boxRes = shelfBox(g, M, bxc, y + 0.02, 0.0);
          // v2 fase 2: os livros desta prateleira ficam SÓ à direita da caixinha (antes a faixa começava no meio e atravessava a caixa)
          const l0 = bxc + 0.175 + 0.03, l1 = W / 2 - 0.03;
          if (kind === 'bookshelf' && l1 - l0 > 0.16) books(g, M, l1 - l0, y + 0.02, 0.26, rnd, 0.02, (l0 + l1) / 2);
          continue;
        }
        if (kind === 'bookshelf') books(g, M, W, y + 0.02, 0.26, rnd);
        else if (kind === 'winerack') { for (let x = -W / 2 + 0.1; x < W / 2 - 0.05; x += 0.11) C(g, 0.035, 0.035, 0.3, M.bottleGlass, x, y + 0.06, 0.02, 0xffffff, 8, Math.PI / 2); }
        else if (kind === 'mshelf') { for (let x = -W / 2 + 0.15; x < W / 2 - 0.1; x += 0.28 + rnd.next() * 0.1) { if (rnd.next() < 0.5) B(g, 0.22, 0.18, 0.28, M.paper, x, y + 0.1, 0, 0x8a7a5a); else C(g, 0.07, 0.07, 0.16, M.metal, x, y + 0.1, 0, 0x6a7a8a, 10); } }
        else jars(g, M, W, y + 0.02, rnd);
      }
      return dyn(g, boxRes);
    }
    case 'sofa': {
      const W = w - 0.15, Dp = d - 0.25;
      RB(g, W, 0.35, Dp, 0.05, M.fabric, 0, 0.3, 0, cloth);
      RB(g, W, 0.6, 0.22, 0.06, M.fabric, 0, 0.7, -Dp / 2 + 0.11, cloth);
      RB(g, 0.2, 0.55, Dp, 0.06, M.fabric, -W / 2 + 0.1, 0.5, 0, cloth); RB(g, 0.2, 0.55, Dp, 0.06, M.fabric, W / 2 - 0.1, 0.5, 0, cloth);
      for (let i = 0; i < 3; i++) RB(g, (W - 0.45) / 3 - 0.02, 0.13, Dp - 0.3, 0.05, M.fabric, -W / 2 + 0.22 + (i + 0.5) * (W - 0.45) / 3, 0.53, 0.08, cloth);
      legsTable(g, M, W, Dp, 0.14, 0xffffff, 0.08, 0.025);
      return g;
    }
    case 'armchair': case 'rocking_chair': {
      const W = 0.8, Dp = 0.8;
      if (kind === 'rocking_chair') {
        for (const sx of [-1, 1]) { const rk = mesh(new THREE.TorusGeometry(0.6, 0.02, 6, 20, 1.4), M.darkWood); rk.rotation.set(0, Math.PI / 2, Math.PI / 2 + 0.7 - 0.7); rk.position.set(sx * 0.25, 0.6, 0); rk.rotation.set(0, Math.PI / 2, -Math.PI / 2 - 0.7); g.add(rk); }
        B(g, 0.55, 0.04, 0.5, M.darkWood, 0, 0.45, 0); B(g, 0.55, 0.75, 0.04, M.darkWood, 0, 0.85, -0.25, 0xffffff, -0.15);
        for (const sx of [-1, 1]) B(g, 0.04, 0.42, 0.04, M.darkWood, sx * 0.25, 0.24, 0);
        return g;
      }
      RB(g, W, 0.3, Dp, 0.05, M.fabric, 0, 0.32, 0, cloth);
      RB(g, W, 0.85, 0.2, 0.06, M.fabric, 0, 0.85, -Dp / 2 + 0.1, cloth);
      RB(g, 0.16, 0.5, Dp - 0.1, 0.05, M.fabric, -W / 2 + 0.08, 0.6, 0.05, cloth); RB(g, 0.16, 0.5, Dp - 0.1, 0.05, M.fabric, W / 2 - 0.08, 0.6, 0.05, cloth);
      for (const sx of [-1, 1]) RB(g, 0.12, 0.35, 0.35, 0.04, M.fabric, sx * (W / 2 - 0.06), 1.1, -Dp / 2 + 0.2, cloth);
      legsTable(g, M, W, Dp, 0.17, 0xffffff, 0.08, 0.025);
      return g;
    }
    case 'coffee_table': { table(g, M, w - 0.3, d - 0.3, 0.45); B(g, 0.25, 0.04, 0.18, M.books, 0.2, 0.47, 0, 0x5a1a14); C(g, 0.08, 0.06, 0.06, M.porcelain, -0.2, 0.48, 0.05, 0xd8d0c0, 12); return g; }
    case 'dining_table': {
      const W = w - 1.0, Dp = d - 1.0;
      table(g, M, W, Dp, 0.78);
      const n = Math.floor(W / 0.7);
      for (let i = 0; i < n; i++) { const x = -W / 2 + 0.35 + i * (W - 0.7) / Math.max(1, n - 1); chair(g, M, x, Dp / 2 + 0.25, Math.PI, cloth); chair(g, M, x + 0.05, -Dp / 2 - 0.25, 0, cloth); }
      chair(g, M, W / 2 + 0.35, 0, -Math.PI / 2, cloth); chair(g, M, -W / 2 - 0.35, 0, Math.PI / 2, cloth);
      for (let i = 0; i < n; i++) { const x = -W / 2 + 0.35 + i * (W - 0.7) / Math.max(1, n - 1); for (const sz of [-1, 1]) C(g, 0.12, 0.1, 0.015, M.porcelain, x, 0.79, sz * (Dp / 2 - 0.2), 0xe0d8c8, 16); }
      // candelabro
      C(g, 0.02, 0.08, 0.3, M.brass, 0, 0.93, 0); for (const sx of [-1, 0, 1]) { C(g, 0.015, 0.015, 0.12, M.paper, sx * 0.12, 1.13, 0, 0xe8dcc0, 6); }
      B(g, W * 0.8, 0.005, 0.4, M.fabric, 0, 0.785, 0, 0x6a1a18);
      return g;
    }
    case 'counter': case 'sink': case 'washtub': {
      const W = w - 0.06, Dp = Math.min(d - 0.06, 0.5), H = kind === 'washtub' ? 0.8 : 0.9;
      if (kind === 'washtub') {
        legsTable(g, M, W - 0.1, Dp - 0.1, 0.55, 0xffffff, 0.05, 0.025);
        const tub = mesh(new THREE.CylinderGeometry(Dp / 2, Dp / 2 - 0.06, 0.3, 18, 1, true), M.metal, 0x9a9a9a); tub.position.set(0, 0.7, 0); tub.material = M.metal; g.add(tub);
        C(g, Dp / 2 - 0.06, Dp / 2 - 0.06, 0.02, M.metal, 0, 0.56, 0, 0x6a6a6a, 18);
        B(g, 0.32, 0.5, 0.02, M.paleWood, 0.25, 0.8, -0.1, 0xffffff, -0.3);
        return g;
      }
      B(g, W, H - 0.05, Dp, kind === 'sink' ? M.porcelain : M.paleWood, 0, (H - 0.05) / 2, 0, kind === 'sink' ? 0xd0c8b8 : 0x8a7050);
      B(g, W + 0.04, 0.05, Dp + 0.04, kind === 'sink' ? M.porcelain : M.stone, 0, H - 0.025, 0.01, kind === 'sink' ? 0xe8e0d0 : 0x9a948a);
      const door = new THREE.Group(); door.position.set(-W / 2 + 0.03, 0.08, Dp / 2 + 0.01); g.add(door);
      B(door, W / 2 - 0.06, H - 0.28, 0.025, M.wood, (W / 2 - 0.06) / 2, (H - 0.28) / 2, 0, 0x6a4a30); knob(door, M, W / 2 - 0.12, (H - 0.28) / 2, 0.02);
      B(g, W / 2 - 0.06, H - 0.28, 0.025, M.wood, W / 4, 0.08 + (H - 0.28) / 2, Dp / 2 + 0.01, 0x6a4a30);
      B(g, W - 0.08, H - 0.2, 0.02, M.black, 0, H / 2, Dp / 2 - 0.02);
      if (kind === 'sink') { C(g, 0.18, 0.14, 0.12, M.porcelain, 0, H + 0.02, 0.02, 0xe8e4dc, 18); C(g, 0.015, 0.015, 0.2, M.brass, 0, H + 0.12, -0.17, 0xffffff, 8); B(g, 0.55, 0.7, 0.03, M.glass, 0, H + 0.75, -Dp / 2 + 0.02, 0x8a90a0); B(g, 0.62, 0.77, 0.02, M.darkWood, 0, H + 0.75, -Dp / 2 + 0.005); }
      else { C(g, 0.1, 0.09, 0.14, M.iron, -0.3, H + 0.07, 0, 0x4a4a4a, 12); C(g, 0.05, 0.05, 0.18, M.porcelain, 0.35, H + 0.09, -0.05, 0xc8b898, 10); B(g, 0.35, 0.03, 0.22, M.paleWood, 0.05, H + 0.015, 0.05); }
      const anchor = new THREE.Object3D(); anchor.position.set(-W / 4, 0.12, 0); g.add(anchor);
      return dyn(g, { part: door, type: 'door', amount: -1.7, anchor, label: kind === 'sink' ? 'armário da pia' : 'armário da cozinha' });
    }
    case 'stove': {
      B(g, w - 0.1, 0.8, 0.44, M.iron, 0, 0.45, 0, 0x2a2a2a); B(g, w - 0.04, 0.05, 0.48, M.iron, 0, 0.87, 0, 0x1a1a1a);
      for (const sx of [-0.2, 0.2]) C(g, 0.12, 0.12, 0.02, M.iron, sx, 0.9, 0.05, 0x111111, 16);
      C(g, 0.08, 0.08, 1.8, M.iron, 0.3, 1.8, -0.15, 0x222222, 10);
      B(g, 0.4, 0.3, 0.02, M.iron, -0.1, 0.4, 0.23, 0x333333); C(g, 0.13, 0.12, 0.16, M.metal, -0.2, 0.98, 0.05, 0x6a5a4a, 14);
      for (let i = 0; i < 4; i++) S(g, 0.02, M.brass, -0.3 + i * 0.2, 0.75, 0.23);
      return g;
    }
    case 'ktable': case 'reading_table': {
      const W = w - 0.7, Dp = d - 0.6;
      table(g, M, W, Dp, 0.78, kind === 'ktable' ? 0xa08060 : 0xffffff);
      if (kind === 'ktable') { chair(g, M, 0, Dp / 2 + 0.3, Math.PI, 0x6a4a30); chair(g, M, 0.3, -Dp / 2 - 0.3, 0, 0x6a4a30); B(g, 0.4, 0.06, 0.3, M.paleWood, -0.2, 0.81, 0); C(g, 0.1, 0.08, 0.1, M.porcelain, 0.3, 0.83, 0.1, 0xd0c0a0); }
      else { for (let i = 0; i < 3; i++) B(g, 0.22, 0.05, 0.3, M.books, -0.3, 0.805 + i * 0.05, 0, COLORS.books[i]); B(g, 0.32, 0.01, 0.22, M.paper, 0.2, 0.785, 0.05); }
      const dp = new THREE.Group(); dp.position.set(0, 0.68, Dp / 2 - 0.04); g.add(dp);
      B(dp, 0.5, 0.1, 0.03, M.wood, 0, 0, 0, 0x6a4228); knob(dp, M, 0, 0, 0.02); B(dp, 0.46, 0.08, Dp * 0.6, M.black, 0, 0, -Dp * 0.3);
      const anchor = new THREE.Object3D(); anchor.position.set(0, 0.0, -0.15); dp.add(anchor);
      return dyn(g, { part: dp, type: 'drawer', amount: 0.3, anchor, label: 'gaveta da mesa' });
    }
    case 'desk': {
      const W = w - 0.1, Dp = Math.min(d - 0.4, 0.75);
      g.position.z = 0;
      const top = new THREE.Group(); top.position.z = -(d - Dp) / 2 + 0.02; g.add(top);
      B(top, W, 0.06, Dp, M.wood, 0, 0.78, 0, 0x7a5236);
      B(top, 0.45, 0.72, Dp - 0.05, M.darkWood, -W / 2 + 0.25, 0.39, 0); B(top, 0.45, 0.72, Dp - 0.05, M.darkWood, W / 2 - 0.25, 0.39, 0);
      const drawers = [];
      // ordem = drawerLayout('desk'): 3 linhas (de cima para baixo) × 2 colunas
      for (const yy of [0.66, 0.45, 0.2]) for (const xx of [-W / 2 + 0.25, W / 2 - 0.25]) {
        const p = new THREE.Group(); p.position.set(xx, yy, Dp / 2 - 0.01); top.add(p);
        B(p, 0.38, 0.17, 0.02, M.wood, 0, 0, 0, 0x6a4228); knob(p, M, 0, 0, 0.02);
        B(p, 0.34, 0.13, Dp - 0.12, M.black, 0, 0, -Dp / 2 + 0.05);
        const an = new THREE.Object3D(); an.position.set(0, -0.04, -0.12); p.add(an);
        drawers.push({ part: p, type: 'drawer', amount: 0.3, anchor: an, label: `gaveta ${drawers.length + 1} da escrivaninha` });
      }
      B(top, 0.3, 0.02, 0.22, M.paper, 0.1, 0.82, 0.05, 0xd8ccaa).rotation.y = 0.2;
      B(top, 0.22, 0.05, 0.3, M.books, -0.3, 0.835, -0.1, 0x3a1010);
      C(top, 0.03, 0.035, 0.08, M.brass, 0.4, 0.85, -0.15, 0x2a2a2a, 8);
      chair(g, M, 0, Dp / 2 - 0.05, Math.PI, cloth).position.z = top.position.z + Dp / 2 + 0.3;
      return dynParts(g, drawers);
    }
    case 'chest': {
      const W = Math.min(w - 0.15, 0.9), Dp = 0.46;
      B(g, W, 0.45, Dp, M.wood, 0, 0.225, 0, 0x7a5030);
      for (const xx of [-W / 2 + 0.12, W / 2 - 0.12]) B(g, 0.05, 0.47, Dp + 0.02, M.iron, xx, 0.23, 0, 0x5a4a30);
      B(g, W - 0.04, 0.38, Dp - 0.04, M.black, 0, 0.27, 0);
      const lid = new THREE.Group(); lid.position.set(0, 0.45, -Dp / 2); g.add(lid);
      B(lid, W + 0.02, 0.09, Dp + 0.02, M.wood, 0, 0.045, Dp / 2, 0x6a4428);
      C(lid, Dp / 2, Dp / 2, W + 0.02, M.wood, 0, 0.09, Dp / 2, 0x6a4428, 12, 0, Math.PI / 2).scale.set(1, 1, 0.35);
      for (const xx of [-W / 2 + 0.12, W / 2 - 0.12]) B(lid, 0.05, 0.11, Dp + 0.04, M.iron, xx, 0.06, Dp / 2, 0x5a4a30);
      B(lid, 0.08, 0.1, 0.02, M.brass, 0, 0.0, Dp + 0.02);
      const anchor = new THREE.Object3D(); anchor.position.set(0, 0.42, 0); g.add(anchor);
      return dyn(g, { part: lid, type: 'lid', amount: -1.75, anchor, label: 'baú' });
    }
    case 'crate': {
      const s = Math.min(w, d) - 0.18, H = s * 0.8;
      const wm = M.paleWood;
      for (const yy of [0.04, H - 0.04]) for (const sz of [-1, 1]) B(g, s, 0.07, 0.04, wm, 0, yy, sz * (s / 2 - 0.02), 0x8a7050);
      B(g, s - 0.02, H, s - 0.02, wm, 0, H / 2, 0, 0xa08060);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) B(g, 0.06, H, 0.06, wm, sx * (s / 2 - 0.03), H / 2, sz * (s / 2 - 0.03), 0x6a5038);
      B(g, s - 0.08, H - 0.06, s - 0.08, M.black, 0, H / 2 + 0.04, 0);
      const lid = new THREE.Group(); lid.position.set(0, H, -s / 2); g.add(lid);
      for (let i = 0; i < 4; i++) B(lid, s, 0.03, s / 4 - 0.01, wm, 0, 0.015, s / 8 + i * s / 4, 0x9a7a58);
      B(lid, 0.05, 0.035, s, wm, -s / 3, 0.035, s / 2, 0x6a5038); B(lid, 0.05, 0.035, s, wm, s / 3, 0.035, s / 2, 0x6a5038);
      const anchor = new THREE.Object3D(); anchor.position.set(0, H - 0.05, 0); g.add(anchor);
      if (variant % 2) { const c2 = new THREE.Group(); c2.position.set(0.05, H + 0.04, 0.05); c2.rotation.y = 0.4; B(c2, s * 0.6, s * 0.45, s * 0.6, wm, 0, s * 0.225, 0, 0x8a6a4a); c2.userData.onLid = true; lid.add(c2); c2.position.set(0.05, 0.04, s / 2); }
      return dyn(g, { part: lid, type: 'lid', amount: -1.6, anchor, label: 'caixa' });
    }
    case 'barrel': case 'barrel_big': {
      if (kind === 'barrel') {
        const b = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.75, 16, 4), M.wood, 0x6a4a30); bulge(b.geometry, 0.04); b.position.y = 0.375; g.add(b);
        for (const yy of [0.1, 0.375, 0.65]) C(g, 0.215, 0.215, 0.03, M.iron, 0, yy, 0, 0x3a3a3a, 16);
      } else {
        const b = mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.9, 18, 4), M.wood, 0x5a3a24); bulge(b.geometry, 0.06); b.rotation.z = Math.PI / 2; b.position.y = 0.5; g.add(b);
        for (const xx of [-0.35, 0, 0.35]) { const r = C(g, 0.435, 0.435, 0.03, M.iron, xx, 0.5, 0, 0x3a3a3a, 18, 0, Math.PI / 2); }
        B(g, 0.9, 0.1, 0.12, M.darkWood, 0, 0.05, 0.25); B(g, 0.9, 0.1, 0.12, M.darkWood, 0, 0.05, -0.25);
        C(g, 0.03, 0.03, 0.08, M.brass, 0.46, 0.4, 0, 0xffffff, 8, 0, Math.PI / 2);
      }
      return g;
    }
    case 'sack': { const sk = mesh(new THREE.SphereGeometry(0.22, 12, 10), M.sheet, 0x9a8a60); lumpy(sk.geometry, 0.04, 7); sk.scale.set(1, 1.2, 0.9); sk.position.y = 0.26; g.add(sk); return g; }
    case 'globe': { C(g, 0.02, 0.03, 0.75, M.darkWood, 0, 0.375, 0); C(g, 0.18, 0.2, 0.04, M.darkWood, 0, 0.02, 0); S(g, 0.2, M.paper, 0, 0.95, 0, 0x8a7a50, 1, 1, 1, 18); const ring = mesh(new THREE.TorusGeometry(0.22, 0.008, 6, 24), M.brass); ring.position.y = 0.95; ring.rotation.y = 0.5; g.add(ring); return g; }
    case 'bed': case 'bed_big': {
      const W = w - 0.1, L = d - 0.15;
      const big = kind === 'bed_big';
      B(g, W, 0.3, L, M.darkWood, 0, 0.25, 0);
      RB(g, W - 0.08, 0.22, L - 0.12, 0.06, M.fabric, 0, 0.5, 0.02, 0xd8d0c0);
      RB(g, W - 0.04, 0.08, L * 0.62, 0.04, M.fabric, 0, 0.62, L * 0.17, cloth);
      for (const sx of W > 1.4 ? [-0.35, 0.35] : [0]) RB(g, 0.55, 0.14, 0.32, 0.06, M.fabric, sx, 0.66, -L / 2 + 0.3, 0xe0d8c8);
      B(g, W + 0.06, big ? 1.4 : 1.2, 0.08, M.darkWood, 0, big ? 0.7 : 0.6, -L / 2 - 0.02); B(g, W + 0.06, 0.7, 0.08, M.darkWood, 0, 0.35, L / 2 + 0.02);
      if (big) { for (const sx of [-1, 1]) for (const sz of [-1, 1]) C(g, 0.04, 0.05, 2.3, M.darkWood, sx * W / 2, 1.15, sz * L / 2, 0xffffff, 10); B(g, W + 0.1, 0.12, L + 0.1, M.darkWood, 0, 2.3, 0); const cn = mesh(new THREE.PlaneGeometry(L, 1.6, 10, 1), M.curtain); cn.rotation.y = Math.PI / 2; cn.position.set(-W / 2 - 0.02, 1.45, 0); g.add(cn); }
      return g;
    }
    case 'bathtub': {
      const W = w - 0.2, Dp = d - 0.25;
      RB(g, W, 0.55, Dp, 0.15, M.porcelain, 0, 0.42, 0, 0xe8e4dc);
      RB(g, W - 0.12, 0.05, Dp - 0.12, 0.1, M.porcelain, 0, 0.68, 0, 0x6a6a5a);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) S(g, 0.05, M.brass, sx * (W / 2 - 0.15), 0.08, sz * (Dp / 2 - 0.1), 0xffffff, 1, 1.5, 1, 8);
      C(g, 0.015, 0.015, 0.4, M.brass, -W / 2 + 0.08, 0.9, 0, 0xffffff, 8);
      return g;
    }
    case 'toilet': { C(g, 0.17, 0.13, 0.4, M.porcelain, 0, 0.2, 0.05, 0xe0dcd0, 14); C(g, 0.19, 0.19, 0.04, M.darkWood, 0, 0.42, 0.05, 0xffffff, 14); B(g, 0.42, 0.28, 0.18, M.porcelain, 0, 1.75, -0.12, 0xe0dcd0); C(g, 0.015, 0.015, 1.3, M.brass, 0.12, 1.05, -0.12, 0xffffff, 6); B(g, 0.005, 0.5, 0.005, M.iron, 0.18, 1.4, -0.05); return g; }
    case 'piano': {
      const W = w - 0.3;
      B(g, W, 1.3, 0.6, M.black, 0, 0.75, -0.2, 0x1a1210); B(g, W - 0.1, 0.06, 0.3, M.porcelain, 0, 0.75, 0.2, 0xe8e0d0);
      for (let i = 0; i < 18; i++) B(g, 0.025, 0.02, 0.18, M.black, -W / 2 + 0.2 + i * (W - 0.4) / 18, 0.79, 0.16);
      B(g, W, 0.08, 0.35, M.black, 0, 0.7, 0.15, 0x1a1210); for (const sx of [-1, 1]) B(g, 0.08, 0.7, 0.08, M.black, sx * (W / 2 - 0.1), 0.35, 0.25, 0x1a1210);
      B(g, 0.9, 0.06, 0.38, M.fabric, 0, 0.5, 0.75, 0x2a1414);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) B(g, 0.04, 0.48, 0.04, M.black, sx * 0.4, 0.24, 0.75 + sz * 0.15);
      C(g, 0.015, 0.015, 0.2, M.paper, 0.4, 1.5, -0.25, 0xe8dcc0, 6);
      return g;
    }
    case 'crib': { B(g, w - 0.3, 0.1, d - 0.3, M.paleWood, 0, 0.45, 0); RB(g, w - 0.4, 0.1, d - 0.4, 0.04, M.fabric, 0, 0.53, 0, 0xc8c0b0); for (let x = -(w - 0.3) / 2; x <= (w - 0.3) / 2 + 0.01; x += 0.1) for (const sz of [-1, 1]) C(g, 0.012, 0.012, 0.95, M.paleWood, x, 0.48, sz * (d - 0.3) / 2, 0xffffff, 6); for (const sz of [-1, 1]) B(g, w - 0.25, 0.04, 0.04, M.paleWood, 0, 0.95, sz * (d - 0.3) / 2); return g; }
    case 'rocking_horse': { const body = S(g, 0.2, M.paleWood, 0, 0.55, 0, 0xa07a50, 0.7, 0.8, 1.6, 10); S(g, 0.12, M.paleWood, 0, 0.8, 0.32, 0xa07a50, 0.7, 1, 1.3, 10); for (const sx of [-1, 1]) { const rk = mesh(new THREE.TorusGeometry(0.55, 0.02, 6, 16, 1.2), M.darkWood); rk.rotation.set(0, Math.PI / 2, -Math.PI / 2 - 0.6); rk.position.set(sx * 0.12, 0.58, 0); g.add(rk); C(g, 0.02, 0.02, 0.4, M.paleWood, sx * 0.12, 0.25, 0.2); C(g, 0.02, 0.02, 0.4, M.paleWood, sx * 0.12, 0.25, -0.2); } return g; }
    case 'sheet': {
      const W = w - 0.2, Dp = d - 0.2, H = 0.7 + (variant % 3) * 0.35;
      const geo = new THREE.BoxGeometry(W, H, Dp, 10, 6, 10);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const f = (y + H / 2) / H;
        p.setX(i, x * (1 + 0.12 * (1 - f)) + Math.sin(z * 9 + y * 4) * 0.025); p.setZ(i, z * (1 + 0.12 * (1 - f)) + Math.sin(x * 8 + y * 5) * 0.025);
        if (y > H / 2 - 0.01) p.setY(i, y - 0.06 * Math.abs(Math.sin(x * 3 + z * 2)));
      }
      geo.computeVertexNormals();
      const m = mesh(geo, M.sheet, 0xb8b2a4); m.position.y = H / 2; g.add(m);
      return g;
    }
    case 'boiler': {
      const tk = C(g, 0.6, 0.6, 1.9, M.iron, 0, 1.0, -0.1, 0x3a3430, 20);
      C(g, 0.62, 0.62, 0.06, M.metal, 0, 0.3, -0.1, 0x5a4a3a, 20); C(g, 0.62, 0.62, 0.06, M.metal, 0, 1.7, -0.1, 0x5a4a3a, 20);
      S(g, 0.6, M.iron, 0, 1.95, -0.1, 0x3a3430, 1, 0.3, 1, 16);
      C(g, 0.06, 0.06, 1.4, M.metal, 0.4, 2.6, -0.3, 0x6a5a4a, 8); C(g, 0.05, 0.05, 0.5, M.metal, -0.45, 1.2, 0, 0x6a5a4a, 8, 0, Math.PI / 2);
      C(g, 0.09, 0.09, 0.03, M.brass, 0, 1.2, 0.51, 0xffffff, 16, Math.PI / 2); const gl = mesh(new THREE.CircleGeometry(0.07, 16), M.glowRed); gl.position.set(0, 1.2, 0.53); g.add(gl); gl.userData.dynamic = true;
      B(g, 0.35, 0.3, 0.05, M.iron, 0, 0.55, 0.5, 0x222222);
      return g;
    }
    case 'mannequin': {
      C(g, 0.02, 0.02, 1.0, M.darkWood, 0, 0.5, 0); C(g, 0.18, 0.2, 0.04, M.darkWood, 0, 0.02, 0);
      const t = mesh(new THREE.SphereGeometry(0.2, 16, 12), M.fabric, 0x8a7a68); t.scale.set(1, 1.8, 0.7); t.position.y = 1.35; g.add(t);
      S(g, 0.06, M.darkWood, 0, 1.75, 0, 0x5a4030);
      const sh = mesh(new THREE.ConeGeometry(0.24, 0.8, 16, 1, true), M.sheet, 0x9a9488); sh.position.y = 1.0; sh.material = M.sheet; g.add(sh);
      return g;
    }
  }
  B(g, w - 0.1, 0.8, d - 0.1, M.wood, 0, 0.4, 0);
  return g;
}

function bulge(geo, amt) {
  const p = geo.attributes.position; geo.computeBoundingBox(); const h = geo.boundingBox.max.y - geo.boundingBox.min.y;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i) / (h / 2); const f = 1 + amt * (1 - y * y) / 0.2; p.setX(i, p.getX(i) * f); p.setZ(i, p.getZ(i) * f); }
  geo.computeVertexNormals();
}
function lumpy(geo, amt, freq) {
  const p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const n = Math.sin(v.x * freq) * Math.cos(v.y * freq * 0.8) * Math.sin(v.z * freq * 1.3); v.multiplyScalar(1 + n * amt / (v.length() || 1)); p.setXYZ(i, v.x, v.y, v.z); }
  geo.computeVertexNormals();
}

// v3: chave PEQUENA (~6 cm, tamanho real de chave antiga de chaveiro). O que chama a atenção é o brilho dourado
// pulsante (halo aditivo) que o jogo liga só quando a chave está no campo de visão da câmera.
let haloTex = null;
function keyHaloTexture() {
  if (haloTex) return haloTex;
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,240,190,1)'); gr.addColorStop(0.18, 'rgba(255,205,90,0.75)'); gr.addColorStop(0.5, 'rgba(255,170,40,0.18)'); gr.addColorStop(1, 'rgba(255,150,20,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  x.globalCompositeOperation = 'lighter';
  for (const [w, h, a] of [[128, 4, 0.85], [4, 128, 0.85], [70, 2, 0.4], [2, 70, 0.4]]) {
    const lg = x.createRadialGradient(64, 64, 0, 64, 64, Math.max(w, h) / 2);
    lg.addColorStop(0, `rgba(255,236,170,${a})`); lg.addColorStop(1, 'rgba(255,200,80,0)');
    x.save(); x.translate(64, 64); if (w === 70 || h === 70) x.rotate(Math.PI / 4); x.fillStyle = lg; x.fillRect(-w / 2, -h / 2, w, h); x.restore();
  }
  haloTex = new THREE.CanvasTexture(c); haloTex.colorSpace = THREE.SRGBColorSpace;
  return haloTex;
}
export function buildKey(M) {
  const g = new THREE.Group();
  if (!M.keyGold) M.keyGold = new THREE.MeshStandardMaterial({ color: 0xd8a838, metalness: 0.9, roughness: 0.3, emissive: 0xffa020, emissiveIntensity: 0.5 });
  const gm = M.keyGold;
  const add = (geo, x, y, z, rz = 0) => { const m = new THREE.Mesh(geo, gm); m.position.set(x, y, z); m.rotation.z = rz; g.add(m); return m; };
  add(new THREE.TorusGeometry(0.0095, 0.0024, 8, 20), 0, 0, 0);                       // argola
  add(new THREE.TorusGeometry(0.0042, 0.0012, 6, 12), 0, 0, 0);                       // ornamento
  add(new THREE.CylinderGeometry(0.0032, 0.0032, 0.004, 10), 0.0125, 0, 0, Math.PI / 2); // colar
  add(new THREE.CylinderGeometry(0.0019, 0.0019, 0.042, 8), 0.034, 0, 0, Math.PI / 2);  // haste
  add(new THREE.BoxGeometry(0.0045, 0.0095, 0.0024), 0.049, -0.0055, 0);               // palhetão
  add(new THREE.BoxGeometry(0.0035, 0.0065, 0.0024), 0.0545, -0.004, 0);
  for (const c of g.children) c.position.z += 0.0026; // apoiada (o +Z local vira "para cima" quando deitada)
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: keyHaloTexture(), color: 0xffc860, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.0 }));
  halo.scale.set(0.12, 0.12, 1); halo.position.set(0.026, 0, 0.012); halo.renderOrder = 5; halo.visible = false;
  g.add(halo); g.userData.halo = halo;
  return g;
}

export function buildKnockable(kind, M) {
  const g = new THREE.Group();
  if (kind === 'vase') { const pts = []; for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(0.06 + Math.sin(t * Math.PI) * 0.08 - (t > 0.85 ? 0.03 : 0), t * 0.45)); } const v = mesh(new THREE.LatheGeometry(pts, 16), M.porcelain, 0x3a5a7a); g.add(v); g.userData.h = 0.45; }
  else if (kind === 'bucket') { const b = mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.3, 16, 1, true), M.metal, 0x8a8a8a); b.position.y = 0.15; g.add(b); C(g, 0.12, 0.12, 0.01, M.metal, 0, 0.005, 0, 0x6a6a6a, 16); const h = mesh(new THREE.TorusGeometry(0.15, 0.006, 6, 16, Math.PI), M.iron); h.position.y = 0.3; g.add(h); g.userData.h = 0.3; }
  else if (kind === 'bottles') { for (let i = 0; i < 3; i++) { C(g, 0.035, 0.035, 0.22, M.bottleGlass, -0.06 + i * 0.06, 0.11, (i % 2) * 0.04, 0xffffff, 10); C(g, 0.012, 0.02, 0.08, M.bottleGlass, -0.06 + i * 0.06, 0.26, (i % 2) * 0.04, 0xffffff, 8); } g.userData.h = 0.3; }
  else if (kind === 'candelabrum') { C(g, 0.08, 0.1, 0.03, M.brass, 0, 0.015, 0, 0xffffff, 14); C(g, 0.015, 0.02, 0.5, M.brass, 0, 0.27, 0, 0xffffff, 8); B(g, 0.32, 0.02, 0.02, M.brass, 0, 0.45, 0); for (const sx of [-0.15, 0, 0.15]) C(g, 0.012, 0.012, 0.1, M.paper, sx, 0.52, 0, 0xe8dcc0, 6); g.userData.h = 0.55; }
  else { B(g, 0.28, 0.22, 0.22, M.paper, 0, 0.11, 0, 0x8a7050); g.userData.h = 0.22; }
  return g;
}
