// Constrói a mansão 3D a partir do mapa gerado (mesma semente do servidor).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CELL, W, D, T, LEVELS, ROWS } from '../../../shared/config.js';
import { buildProp, buildKey, buildKnockable, B, C, S, RB, mesh, tint } from './props.js';
import { storyPainting, noteTexture, NOTES, PAINTING_TITLES, windowDrawingsTexture } from '../story.js';
import { winSize } from './decorboxes.js';
import { buildExterior } from './exterior.js';
import { buildFireGlow, windowSkyMaterial, windowSkyGeometry, windowGlassMaterial, moonPatchMaterial, moonPatchGeometry } from './fx.js';
import { SURFACE_Y } from '../../../shared/mapgen.js';
import { makeRng } from '../../../shared/rng.js';

const OPEN = new Set([T.FLOOR, T.DOOR, T.STAIR, T.LOW, T.TALL, T.EXIT, T.HOLE, T.CURTAIN]);

class GB { // construtor de geometria
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.i = []; }
  quad(a, b, c, d, n, uva, uvb, uvc, uvd, ca = 1, cb = 1, cc = 1, cd = 1) {
    const o = this.p.length / 3;
    for (const v of [a, b, c, d]) this.p.push(v[0], v[1], v[2]);
    for (let k = 0; k < 4; k++) this.n.push(n[0], n[1], n[2]);
    for (const u of [uva, uvb, uvc, uvd]) this.uv.push(u[0], u[1]);
    for (const s of [ca, cb, cc, cd]) this.c.push(s, s, s);
    if (this.rev) this.i.push(o, o + 2, o + 1, o, o + 3, o + 2); else this.i.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  quadR(...a) { this.rev = true; this.quad(...a); this.rev = false; }
  build() {
    if (!this.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}

const doorHeight = (L) => Math.min(LEVELS[L].h - 0.45, 2.75);
const wallTopFor = (L) => L < 3 ? LEVELS[L + 1].y - LEVELS[L].y : LEVELS[L].h;

export function buildMansion(map, world, M) {
  const root = new THREE.Group();
  const levels = [0, 1, 2, 3].map(L => { const g = new THREE.Group(); g.name = 'level' + L; root.add(g); return g; });
  const res = { root, levels, doors: [], containers: [], knockables: [], lamps: [], interact: [], flames: [], flickerMeshes: [], exit: null, windows: [], notes: [], paintings: [] };
  const lv = map.levels;
  const get = (L, x, z) => (x < 0 || z < 0 || x >= W || z >= D) ? T.VOID : lv[L].grid[z * W + x];
  const roomOf = (L, x, z) => (x < 0 || z < 0 || x >= W || z >= D) ? -1 : lv[L].room[z * W + x];

  // v5: vãos das janelas (por andar) para recortar as paredes: plano da face, normal e retângulo (u ao longo da parede)
  const holes = [[], [], [], []];
  for (const wdw of map.windows) {
    const { ww, wh, wy } = winSize(wdw), sx = Math.sin(wdw.rot), alongZ = Math.abs(sx) > 0.5;
    const uc = alongZ ? wdw.z : wdw.x;
    holes[wdw.level].push({ nx: Math.round(sx), nz: Math.round(Math.cos(wdw.rot)), plane: alongZ ? wdw.x : wdw.z, u0: uc - ww / 2, u1: uc + ww / 2, y0: wy - wh / 2, y1: wy + wh / 2 });
  }
  for (let L = 0; L < 4; L++) {
    const y0 = LEVELS[L].y, rh = LEVELS[L].h, H = wallTopFor(L), dh = doorHeight(L);
    const builders = new Map();
    const gb = (key) => { if (!builders.has(key)) builders.set(key, new GB()); return builders.get(key); };
    const floorMat = (x, z) => {
      if (L === 0) return 'floorStone'; if (L === 3) return 'floorPlanks';
      let r = roomOf(L, x, z);
      if (r < 0) for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { r = roomOf(L, x + a, z + b); if (r >= 0) break; }
      if (r >= 0 && map.rooms[r].look === 'marble') return 'floorMarble'; // v3: mármore rachado no hall
      const f = r >= 0 ? map.rooms[r].floor : 'wood';
      return f === 'stone' ? 'floorStone' : f === 'tile' ? 'floorTile' : f === 'carpet' ? 'floorCarpet' : 'floorWood';
    };
    const blockedAO = (x, z) => { const t = get(L, x, z); return t === T.WALL || t === T.VOID || t === T.TALL ? 1 : 0; };
    const vAO = (vx, vz) => { const n = blockedAO(vx - 1, vz - 1) + blockedAO(vx, vz - 1) + blockedAO(vx - 1, vz) + blockedAO(vx, vz); return Math.max(0.42, 1 - n * 0.2); };
    // ---------- pisos e tetos ----------
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
      const t = get(L, x, z);
      if (t === T.WALL || t === T.VOID || t === T.HOLE || t === T.STAIR) continue;
      const fm = floorMat(x, z);
      const X0 = x * CELL, X1 = X0 + CELL, Z0 = z * CELL, Z1 = Z0 + CELL;
      const us = fm === 'floorWood' ? 2 : fm === 'floorTile' ? 1.6 : fm === 'floorPlanks' ? 2.4 : fm === 'floorCarpet' ? 1.5 : fm === 'floorMarble' ? 2.4 : 3;
      const under = (t === T.LOW) ? 0.7 : 1;
      gb(fm).quad([X0, y0, Z1], [X1, y0, Z1], [X1, y0, Z0], [X0, y0, Z0], [0, 1, 0], [X0 / us, Z1 / us], [X1 / us, Z1 / us], [X1 / us, Z0 / us], [X0 / us, Z0 / us],
        vAO(x, z + 1) * under, vAO(x + 1, z + 1) * under, vAO(x + 1, z) * under, vAO(x, z) * under);
      // teto (se não houver vão de escada acima)
      const above = L < 3 ? get(L + 1, x, z) : T.WALL;
      if (above !== T.HOLE && above !== T.STAIR) {
        const yc = y0 + rh, cm = L === 3 ? 'planks' : L === 0 ? 'ceilingDark' : 'ceiling';
        const cs = 2.5;
        const a = (vx, vz) => 0.55 + 0.45 * vAO(vx, vz);
        gb(cm).quad([X0, yc, Z0], [X1, yc, Z0], [X1, yc, Z1], [X0, yc, Z1], [0, -1, 0], [X0 / cs, Z0 / cs], [X1 / cs, Z0 / cs], [X1 / cs, Z1 / cs], [X0 / cs, Z1 / cs], a(x, z), a(x + 1, z), a(x + 1, z + 1), a(x, z + 1));
      }
    }
    // ---------- paredes ----------
    const styleOf = (x, z) => {
      let r = roomOf(L, x, z);
      if (r < 0) {
        const t = get(L, x, z);
        if (t === T.HOLE) { // vão: usa a sala de escada do andar de baixo
          r = L > 0 ? roomOf(L - 1, x, z) : -1;
          if (r >= 0) return map.rooms[r].wall;
        }
        for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { r = roomOf(L, x + a, z + b); if (r >= 0) break; }
      }
      if (r < 0) return L === 0 ? 'stone' : L === 3 ? 'attic' : 'red';
      return map.rooms[r].wall;
    };
    const paperMat = { red: 'wallRed', green: 'wallGreen', blue: 'wallBlue', gold: 'wallGold', plain: 'wallPlain', tile: 'wallPlain' };
    const isTransition = (x, z) => { const t = get(L, x, z); return t === T.DOOR || t === T.EXIT || (t === T.FLOOR && roomOf(L, x, z) < 0); };
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
      if (get(L, x, z) !== T.WALL) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz, nt = get(L, nx, nz);
        if (!OPEN.has(nt)) continue;
        // geometria da face
        let a, b, n; // a,b: extremidades horizontais (x,z) da face
        if (dx === 1) { a = [(x + 1) * CELL, z * CELL]; b = [(x + 1) * CELL, (z + 1) * CELL]; n = [1, 0, 0]; }
        else if (dx === -1) { a = [x * CELL, (z + 1) * CELL]; b = [x * CELL, z * CELL]; n = [-1, 0, 0]; }
        else if (dz === 1) { a = [(x + 1) * CELL, (z + 1) * CELL]; b = [x * CELL, (z + 1) * CELL]; n = [0, 0, 1]; }
        else { a = [x * CELL, z * CELL]; b = [(x + 1) * CELL, z * CELL]; n = [0, 0, -1]; }
        const ua = dx !== 0 ? a[1] : a[0], ub = dx !== 0 ? b[1] : b[0];
        // v5: vão da janela — a face é recortada (retângulo do vidro) para a janela ter profundidade de verdade
        const plane = dx !== 0 ? a[0] : a[1];
        const hole = holes[L].find(h => h.nx === n[0] && h.nz === n[2] && Math.abs(h.plane - plane) < 1e-3 && h.u1 > Math.min(ua, ub) && h.u0 < Math.max(ua, ub));
        const P = (t, y) => [a[0] + (b[0] - a[0]) * t, y0 + y, a[1] + (b[1] - a[1]) * t];
        const rect = (mat, t0, t1, ya, yb, us, vs, ca, cb, voff) => { const u0 = ua + (ub - ua) * t0, u1 = ua + (ub - ua) * t1;
          gb(mat).quadR(P(t0, ya), P(t1, ya), P(t1, yb), P(t0, yb), n, [u0 / us, (ya + voff) / vs], [u1 / us, (ya + voff) / vs], [u1 / us, (yb + voff) / vs], [u0 / us, (yb + voff) / vs], ca, ca, cb, cb); };
        const hT = hole ? [(hole.u0 - ua) / (ub - ua), (hole.u1 - ua) / (ub - ua)].map(v => Math.min(1, Math.max(0, v))).sort((p, q) => p - q) : null;
        const face = (mat, ya, yb, us, vs, ca, cb, voff = 0) => {
          const hy0 = hole ? Math.max(ya, hole.y0) : 0, hy1 = hole ? Math.min(yb, hole.y1) : 0;
          if (!hole || hy0 >= hy1) return rect(mat, 0, 1, ya, yb, us, vs, ca, cb, voff);
          const cAt = (y) => ca + (cb - ca) * (y - ya) / (yb - ya);
          if (hT[0] > 0) rect(mat, 0, hT[0], ya, yb, us, vs, ca, cb, voff);
          if (hT[1] < 1) rect(mat, hT[1], 1, ya, yb, us, vs, ca, cb, voff);
          if (hy0 > ya) rect(mat, hT[0], hT[1], ya, hy0, us, vs, ca, cAt(hy0), voff);
          if (hy1 < yb) rect(mat, hT[0], hT[1], hy1, yb, us, vs, cAt(hy1), cb, voff);
        };
        if (isTransition(nx, nz)) { face('trim', 0, dh, 1, 1, 0.6, 0.8); continue; } // batente
        const st = styleOf(nx, nz);
        const top = nt === T.HOLE || nt === T.STAIR ? H : H;
        if (st === 'stone') { face('stone', 0, top, 2.5, 2.5, 0.5, 0.75); continue; }
        if (st === 'brick') { face('brick', 0, top, 2.0, 2.0, 0.5, 0.78); continue; }
        if (st === 'attic') { face('planks', 0, top, 2.4, 2.4, 0.5, 0.7); continue; }
        if (st === 'tile') { face('wallTile', 0, 1.3, 1.6, 1.6, 0.55, 0.95); face('wallPlain', 1.3, top, 1.4, 1.4, 0.95, 0.7); continue; }
        face('wainscot', 0, 1.0, 1.6, 1.0, 0.5, 0.95);
        face(paperMat[st] || 'wallRed', 1.0, rh, 1.25, 1.25, 0.95, 0.72);
        if (top > rh) face(paperMat[st] || 'wallRed', rh, top, 1.25, 1.25, 0.72, 0.72);
        // rodapé / guarda-cadeira / sanca
        const off = (k) => [n[0] * k, n[2] * k];
        const tr = (ya, yb, k, c1, c2) => { // v5: interrompido no vão da janela
          if (hole && ya < hole.y1 && yb > hole.y0) { if (hT[0] > 0) trS(ya, yb, k, c1, c2, 0, hT[0]); if (hT[1] < 1) trS(ya, yb, k, c1, c2, hT[1], 1); return; }
          trS(ya, yb, k, c1, c2, 0, 1);
        };
        const trS = (ya, yb, k, c1, c2, t0, t1) => { const o = off(k); const A = P(t0, 0), Bp = P(t1, 0), a = [A[0], A[2]], b = [Bp[0], Bp[2]], ua = dx !== 0 ? a[1] : a[0], ub = dx !== 0 ? b[1] : b[0]; gb('trim').quadR([a[0] + o[0], y0 + ya, a[1] + o[1]], [b[0] + o[0], y0 + ya, b[1] + o[1]], [b[0] + o[0], y0 + yb, b[1] + o[1]], [a[0] + o[0], y0 + yb, a[1] + o[1]], n, [ua, ya], [ub, ya], [ub, yb], [ua, yb], c1, c1, c2, c2); gb('trim').quadR([a[0] + o[0], y0 + yb, a[1] + o[1]], [b[0] + o[0], y0 + yb, b[1] + o[1]], [b[0], y0 + yb, b[1]], [a[0], y0 + yb, a[1]], [0, 1, 0], [ua, 0], [ub, 0], [ub, 0.05], [ua, 0.05], c2, c2, c2, c2); };
        tr(0, 0.16, 0.025, 0.5, 0.7); tr(0.97, 1.03, 0.02, 0.8, 0.9); tr(rh - 0.14, rh - 0.02, 0.05, 0.55, 0.5);
      }
    }
    // vergas sobre portas/arcos
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
      if (!isTransition(x, z)) continue;
      const t = get(L, x, z);
      // orientação: parede ao longo de x se vizinhos x são parede/transição
      const alongX = (get(L, x - 1, z) === T.WALL || isTransition(x - 1, z)) && (get(L, x + 1, z) === T.WALL || isTransition(x + 1, z));
      const X0 = x * CELL, X1 = X0 + CELL, Z0 = z * CELL, Z1 = Z0 + CELL;
      const ya = y0 + dh, yb = y0 + H;
      gb('trim').quadR([X0, ya, Z1], [X1, ya, Z1], [X1, ya, Z0], [X0, ya, Z0], [0, -1, 0], [0, 0], [1, 0], [1, 1], [0, 1], 0.6, 0.6, 0.6, 0.6);
      const st = styleOf(x, z), pm = st === 'stone' ? 'stone' : st === 'brick' ? 'brick' : st === 'attic' ? 'planks' : (paperMat[st] || 'wallRed');
      if (alongX) {
        for (const [zz, nz] of [[Z1, 1], [Z0, -1]]) gb(pm).quadR(nz > 0 ? [X1, ya, zz] : [X0, ya, zz], nz > 0 ? [X0, ya, zz] : [X1, ya, zz], nz > 0 ? [X0, yb, zz] : [X1, yb, zz], nz > 0 ? [X1, yb, zz] : [X0, yb, zz], [0, 0, nz], [X1 / 1.25, ya / 1.25], [X0 / 1.25, ya / 1.25], [X0 / 1.25, yb / 1.25], [X1 / 1.25, yb / 1.25], 0.8, 0.8, 0.7, 0.7);
      } else {
        for (const [xx, nx] of [[X1, 1], [X0, -1]]) gb(pm).quadR(nx > 0 ? [xx, ya, Z0] : [xx, ya, Z1], nx > 0 ? [xx, ya, Z1] : [xx, ya, Z0], nx > 0 ? [xx, yb, Z1] : [xx, yb, Z0], nx > 0 ? [xx, yb, Z0] : [xx, yb, Z1], [nx, 0, 0], [Z0 / 1.25, ya / 1.25], [Z1 / 1.25, ya / 1.25], [Z1 / 1.25, yb / 1.25], [Z0 / 1.25, yb / 1.25], 0.8, 0.8, 0.7, 0.7);
      }
      void t;
    }
    for (const [key, b] of builders) {
      const geo = b.build(); if (!geo) continue;
      // v4: em pedaços de ~8 m (recorte por frustum funciona; antes era uma malha do andar inteiro por material)
      addChunked(levels[L], geo, M[key], key !== 'ceiling' && key !== 'ceilingDark' && !key.startsWith('floor'));
    }
  }

  // ---------- escadas ----------
  const stairGroups = [];
  for (const st of map.stairs) {
    const g = new THREE.Group(); levels[st.lower].add(g); stairGroups.push(g);
    const yA = LEVELS[st.lower].y, yB = LEVELS[st.upper].y, rise = yB - yA, N = 24;
    const dir = st.dir === 1 ? 1 : -1, len = (Math.abs(st.zTop - st.zBot) + 1) * CELL, run = len / N;
    const x0 = st.x0 * CELL, wdt = st.w * CELL, zb = dir === 1 ? st.zBot * CELL : (st.zBot + 1) * CELL;
    for (let k = 0; k < N; k++) {
      const top = yA + (k + 1) * rise / N;
      const zc = zb + dir * (k + 0.5) * run;
      B(g, wdt, top - yA, run, M.darkWood, x0 + wdt / 2, (top + yA) / 2, zc, 0x5a3a26);
      B(g, wdt + 0.02, 0.035, run + 0.03, M.wood, x0 + wdt / 2, top - 0.015, zc - dir * 0.01, 0x7a5236);
      // passadeira vermelha (na escadaria principal, mais larga e com varões de latão)
      B(g, wdt * (st.grand ? 0.7 : 0.62), 0.012, run + 0.02, M.fabric, x0 + wdt / 2, top + 0.004, zc, st.grand ? 0x6a1014 : 0x5a1214);
      if (st.grand) C(g, 0.008, 0.008, wdt * 0.74, M.brass, x0 + wdt / 2, top + 0.012, zc - dir * (run / 2 - 0.02), 0xffffff, 6, 0, Math.PI / 2);
    }
    const stringers = st.grand ? st.stringers : [st.stringer];
    for (const sc of stringers) {
      const railX = sc * CELL + (sc > st.x0 ? 0.02 : CELL - 0.02);
      for (let k = 0; k <= N; k += st.grand ? 2 : 3) {
        const yy = yA + k * rise / N, zz = zb + dir * k * run;
        C(g, 0.025, 0.03, 0.95, M.darkWood, railX + (sc > st.x0 ? -0.05 : 0.05), yy + 0.47, zz, 0x3a2214, 8);
      }
      const L2 = Math.hypot(N * run, rise);
      const rail = mesh(new THREE.BoxGeometry(0.07, 0.06, L2), M.darkWood, 0x3a2214);
      rail.position.set(railX + (sc > st.x0 ? -0.05 : 0.05), yA + rise / 2 + 0.95, zb + dir * N * run / 2); rail.rotation.x = -dir * Math.atan2(rise, N * run); g.add(rail);
      if (st.grand) { // pilar de arranque com pinha no pé da escadaria
        const px = railX + (sc > st.x0 ? -0.06 : 0.06);
        B(g, 0.16, 1.15, 0.16, M.darkWood, px, yA + 0.575, zb - dir * 0.1, 0x2a160c);
        S(g, 0.07, M.brass, px, yA + 1.22, zb - dir * 0.1, 0xc89a40, 1, 1.2, 1, 10);
      }
    }
  }

  for (const g of stairGroups) mergeLocal(g); // v4: degraus/balaústres/corrimão por material (eram ~150 malhas por escada)
  // ---------- móveis ----------
  const staticByLevel = [[], [], [], []];
  for (const p of map.props) {
    const horizFacing = p.facing === 0 || p.facing === 2;
    const w = (horizFacing ? p.sx : p.sz) * CELL, d = (horizFacing ? p.sz : p.sx) * CELL;
    const g = buildProp(p.kind, w, d, M, p.variant);
    g.position.set(p.x, LEVELS[p.level].y, p.z);
    g.rotation.y = [0, Math.PI / 2, Math.PI, -Math.PI / 2][p.facing];
    levels[p.level].add(g);
    staticByLevel[p.level].push(g);
    g.traverse(o => { if (o.userData.flame) res.flames.push(o); });
    if (g.userData.firebox) { // v5: brilho tremulante do fogo no piso à frente da lareira (fora da pegada; não colide)
      const glow = buildFireGlow(2.4, 1.8); glow.position.set(0, 0.009, g.userData.firebox.zf - 0.05); g.add(glow); glow.userData.dynamic = true;
    }
    if (p.container !== undefined && g.userData.parts) {
      // v2: cada parte (gaveta / porta / tampa) é um alvo próprio com sua caixa de mira
      const c = map.containers[p.container];
      g.updateMatrixWorld(true);
      const whole = new THREE.Box3(new THREE.Vector3(p.x0 * CELL, LEVELS[p.level].y, p.z0 * CELL), new THREE.Vector3((p.x0 + p.sx) * CELL, LEVELS[p.level].y + (p.block === 'TALL' ? 2.1 : 1.0), (p.z0 + p.sz) * CELL));
      const parts = g.userData.parts.map((dy, i) => {
        const box = dy.type === 'drawer' ? new THREE.Box3().setFromObject(dy.part).expandByScalar(0.025) : whole;
        res.interact.push({ kind: 'container', id: c.id, part: i, level: p.level, box });
        return { idx: i, part: dy.part, extra: dy.extra, type: dy.type, amount: dy.amount, anchor: dy.anchor, hang: !!dy.hang, label: dy.label, open: false, cur: 0, box };
      });
      // v3: roupas e ganchinho do guarda-roupa (o jogo esvazia o armário que guarda a chave e mostra o gancho)
      const clothes = g.userData.clothes || null; if (clothes) clothes.visible = false;
      res.containers[c.id] = { id: c.id, kind: c.kind, level: p.level, parts, box: whole, ax: c.ax, az: c.az, x: c.x, z: c.z, label: parts[0].label, clothes, hook: g.userData.hook || null, hasKey: false };
    }
  }
  // fusão por material (menos chamadas de desenho)
  for (let L = 0; L < 4; L++) mergeStatic(staticByLevel[L], levels[L], root);
  placeNotes(map, res, levels, M);

  // ---------- portas ----------
  for (const d of map.doors) {
    const dh = doorHeight(d.level), y0 = LEVELS[d.level].y;
    const g = new THREE.Group(); g.position.set(d.x, y0, d.z); if (d.axis === 'x') g.rotation.y = Math.PI / 2; levels[d.level].add(g);
    const wdt = d.cells.length * CELL, half = wdt / 2;
    const col = d.type === 'rusty' ? 0x5a4a3c : d.type === 'heavy' ? 0x3a2418 : 0x6a4428;
    // guarnições nas duas faces
    for (const s of [-1, 1]) {
      B(g, 0.1, dh + 0.08, 0.04, M.trim, -half - 0.03, dh / 2, s * (CELL / 2 + 0.02));
      B(g, 0.1, dh + 0.08, 0.04, M.trim, half + 0.03, dh / 2, s * (CELL / 2 + 0.02));
      B(g, wdt + 0.26, 0.12, 0.05, M.trim, 0, dh + 0.04, s * (CELL / 2 + 0.02));
    }
    const leaves = [];
    for (const side of [-1, 1]) {
      const pv = new THREE.Group(); pv.position.set(side * half, 0, 0); g.add(pv);
      const lw = half - 0.01;
      B(pv, lw, dh - 0.02, 0.06, M.wood, -side * lw / 2, dh / 2, 0, col);
      for (const yy of [dh * 0.25, dh * 0.68]) for (const zz of [0.035, -0.035]) B(pv, lw - 0.16, dh * 0.3, 0.012, M.darkWood, -side * lw / 2, yy, zz, col);
      if (d.type !== 'wood') for (const yy of [dh * 0.15, dh * 0.85]) B(pv, lw, 0.06, 0.075, M.iron, -side * lw / 2, yy, 0, d.type === 'rusty' ? 0x6a4028 : 0x2a2a2a);
      for (const zz of [0.045, -0.045]) S(pv, 0.03, M.brass, -side * (lw - 0.07), dh * 0.47, zz, 0xffffff, 1, 1, 1, 10);
      leaves.push({ pv, side });
    }
    // v4: funde as peças de cada folha (gira junto) e as guarnições do batente — ~20 malhas → ~6 por porta
    for (const lf of leaves) mergeLocal(lf.pv);
    mergeLocal(g, (o) => leaves.some(lf => lf.pv === o));
    const view = { id: d.id, level: d.level, g, leaves, open: false, cur: 0, swing: d.swing, type: d.type, x: d.x, z: d.z };
    res.doors[d.id] = view;
    const bx = d.axis === 'z' ? new THREE.Vector3(half + 0.05, 0, 0.45) : new THREE.Vector3(0.45, 0, half + 0.05);
    res.interact.push({ kind: 'door', id: d.id, level: d.level, box: new THREE.Box3(new THREE.Vector3(d.x - bx.x, y0, d.z - bx.z), new THREE.Vector3(d.x + bx.x, y0 + dh, d.z + bx.z)) });
  }
  // ---------- saída ----------
  {
    const e = map.exit, dh = doorHeight(1), half = e.cells.length * CELL / 2;
    const g = new THREE.Group(); g.position.set(e.x, 0, CELL / 2); levels[1].add(g);
    for (const s of [-1, 1]) B(g, 0.18, dh + 0.3, 0.6, M.darkWood, s * (half + 0.09), (dh + 0.3) / 2, 0.05);
    B(g, wdt2(half) + 0.5, 0.3, 0.6, M.darkWood, 0, dh + 0.15, 0.05);
    // v6: folhas em madeira mais clara (destaca no hall escuro), almofadas entalhadas em relevo, dobradiças e
    // maçanetas de latão; 3 CADEADOS de verdade (corpo arredondado dourado e brilhante, haste em U, buraco da chave)
    const leaves = [];
    const DW = 0x8a5e3a, DWd = 0x6a4428, DWl = 0xa8764a;
    for (const side of [-1, 1]) {
      const pv = new THREE.Group(); pv.position.set(side * half, 0, -0.05); g.add(pv);
      const lw = half - 0.01, cxl = -side * lw / 2;
      B(pv, lw, dh, 0.07, M.wood, cxl, dh / 2, 0, DWd);                                         // miolo
      for (const sx of [-1, 1]) B(pv, 0.12, dh, 0.1, M.wood, cxl + sx * (lw / 2 - 0.06), dh / 2, 0, DW);   // montantes
      for (const yy of [0.1, dh * 0.42, dh * 0.62, dh - 0.09]) B(pv, lw - 0.2, yy === 0.1 ? 0.2 : 0.12, 0.1, M.wood, cxl, yy, 0, DW); // travessas
      // almofadas em relevo (chanfro + campo) — duas de baixo, duas de cima
      for (const [y0p, y1p] of [[0.2, dh * 0.42 - 0.06], [dh * 0.62 + 0.06, dh - 0.15]]) {
        const ph = y1p - y0p, pw = lw - 0.3;
        RB(pv, pw, ph, 0.05, 0.012, M.wood, cxl, y0p + ph / 2, 0.035, DWl);
        B(pv, pw - 0.08, ph - 0.08, 0.02, M.wood, cxl, y0p + ph / 2, 0.06, DW);
      }
      B(pv, lw - 0.3, dh * 0.2 - 0.18, 0.04, M.wood, cxl, dh * 0.52, 0.03, DWl);                 // almofada do meio (fechadura)
      for (const yy of [0.35, dh - 0.35]) { B(pv, 0.04, 0.22, 0.03, M.brass, side * -0.02, yy, 0.06, 0xb08a40); C(pv, 0.014, 0.014, 0.24, M.brass, side * -0.005, yy, 0.07, 0xb08a40, 8); }
      const kx = -side * (lw - 0.1);
      S(pv, 0.035, M.brass, kx, dh * 0.47, 0.11, 0xc8a050, 1, 1, 0.7, 14);
      B(pv, 0.06, 0.16, 0.012, M.brass, kx, dh * 0.47, 0.055, 0xb08a40);
      leaves.push({ pv, side });
    }
    const locks = [];
    const chain = new THREE.Group(); g.add(chain);
    for (let i = 0; i < 11; i++) { const l = mesh(new THREE.TorusGeometry(0.045, 0.011, 8, 14), M.iron, 0x6a665e); l.position.set(-0.5 + i * 0.1, 1.2 + Math.sin(i * 0.45) * 0.05, 0.13); l.rotation.y = (i % 2) * Math.PI / 2; chain.add(l); }
    const gold = M.lockGold || (M.lockGold = new THREE.MeshStandardMaterial({ color: 0xe0b048, metalness: 0.85, roughness: 0.22, emissive: 0x3a2604, emissiveIntensity: 0.6, vertexColors: true }));
    const steel = M.lockSteel || (M.lockSteel = new THREE.MeshStandardMaterial({ color: 0xc8c8cc, metalness: 0.9, roughness: 0.28, vertexColors: true }));
    const dark = M.lockHole || (M.lockHole = new THREE.MeshStandardMaterial({ color: 0x050403, roughness: 0.9, vertexColors: true }));
    for (let i = 0; i < 3; i++) {
      const lk = new THREE.Group(); lk.position.set(-0.27 + i * 0.27, 1.02 + (i === 1 ? -0.03 : 0), 0.17); lk.rotation.z = (i - 1) * 0.12;
      RB(lk, 0.1, 0.085, 0.04, 0.014, gold, 0, 0, 0, 0xffffff);                                         // corpo
      B(lk, 0.104, 0.01, 0.042, gold, 0, 0.03, 0, 0xd8b060); B(lk, 0.104, 0.01, 0.042, gold, 0, -0.03, 0, 0xd8b060); // frisos
      const arc = mesh(new THREE.TorusGeometry(0.03, 0.0075, 10, 18, Math.PI), steel); arc.position.y = 0.088; lk.add(arc);  // haste em U
      C(lk, 0.0075, 0.0075, 0.05, steel, -0.03, 0.065, 0, 0xffffff, 10); C(lk, 0.0075, 0.0075, 0.05, steel, 0.03, 0.065, 0, 0xffffff, 10);
      const kh = mesh(new THREE.CircleGeometry(0.008, 12), dark); kh.position.set(0, 0.004, 0.0205); lk.add(kh);   // buraco da chave
      B(lk, 0.005, 0.018, 0.002, dark, 0, -0.008, 0.0205, 0xffffff);
      g.add(lk); locks.push(lk);
    }
    // v6: o exterior antigo (chão + céu em plano) saiu — agora é o lado de fora de verdade (exterior.js: estrada, postes)
    res.exit = { g, leaves, locks, chain, open: false, cur: 0, x: e.x, z: e.z };
    res.interact.push({ kind: 'exit', id: 0, level: 1, box: new THREE.Box3(new THREE.Vector3(e.x - half - 0.2, 0, 0), new THREE.Vector3(e.x + half + 0.2, dh, 0.9)) });
  }
  // ---------- objetos derrubáveis ----------
  for (const k of map.knockables) {
    const g = buildKnockable(k.kind, M);
    g.position.set(k.x, LEVELS[k.level].y, k.z); g.rotation.y = k.rot; levels[k.level].add(g);
    const view = { id: k.id, kind: k.kind, g, knocked: false, t: 0, level: k.level, rot: k.rot };
    mergeLocal(g); // v4: as peças do objeto caem juntas
    res.knockables[k.id] = view;
    res.interact.push({ kind: 'knock', id: k.id, level: k.level, box: new THREE.Box3(new THREE.Vector3(k.x - 0.25, LEVELS[k.level].y, k.z - 0.25), new THREE.Vector3(k.x + 0.25, LEVELS[k.level].y + (g.userData.h || 0.4) + 0.1, k.z + 0.25)) });
  }
  // ---------- janelas, quadros, tapetes, cortinas ----------
  const deco = [[], [], [], []];
  // v5: janela de verdade — vão recortado na parede (ver holes), forro de madeira no vão, peitoril, guarnição,
  // caixilho com travessas, vidro sujo e transparente, desenhos das crianças colados no vidro, o céu noturno lá fora
  // (shader pela direção do olhar: lua, estrelas, árvores) e a mancha de luar no piso. A luz fria é a 'moon' do pool.
  const skyGeos = [[], [], [], []], glassGeos = [[], [], [], []], patchGeos = [[], [], [], []];
  const _q = new THREE.Matrix4();
  map.windows.forEach((wdw, wi) => {
    const g = new THREE.Group(); g.position.set(wdw.x, LEVELS[wdw.level].y, wdw.z); g.rotation.y = wdw.rot; levels[wdw.level].add(g);
    const { ww, wh, wy } = winSize(wdw);
    const parts = buildWindowParts(g, wdw, wi, M);
    g.updateMatrixWorld(true); _q.copy(g.matrixWorld);
    // a matriz do nível é identidade (nível na origem): dá para fundir no espaço do mundo
    skyGeos[wdw.level].push(parts.sky.applyMatrix4(_q));
    glassGeos[wdw.level].push(parts.glass.applyMatrix4(_q));
    if (parts.patch) patchGeos[wdw.level].push(parts.patch.applyMatrix4(_q));
    deco[wdw.level].push(parts.frame);
    // luar
    res.lamps.push({ kind: 'moon', level: wdw.level, x: wdw.x + Math.sin(wdw.rot) * 0.7, y: LEVELS[wdw.level].y + wy, z: wdw.z + Math.cos(wdw.rot) * 0.7, color: 0x6a84c8, intensity: 1.5, range: 5.5, state: 'on' });
    res.windows.push({ level: wdw.level, g, ww, wh, wy });
  });
  for (let L = 0; L < 4; L++) {
    const add = (geos, mat, order) => { if (!geos.length) return; const m = new THREE.Mesh(mergeGeometries(geos, false), mat); m.renderOrder = order; m.castShadow = false; m.receiveShadow = false; levels[L].add(m); return m; };
    // v6: o céu agora é a cúpula do exterior (exterior.js) — atrás do vidro há quintal, mato e árvores de verdade
    const gl = add(glassGeos[L], windowGlassMaterial(), 3); if (gl) gl.receiveShadow = false;
    add(patchGeos[L], moonPatchMaterial(), 2);
  }
  for (const dc of map.decor) {
    const y0 = LEVELS[dc.level].y;
    if (dc.kind === 'painting') {
      const g = new THREE.Group(); g.position.set(dc.x, y0 + dc.y, dc.z); g.rotation.y = dc.rot; levels[dc.level].add(g);
      B(g, dc.w + 0.1, dc.h + 0.1, 0.05, M.brass, 0, 0, 0.025, 0x8a6a30);
      // v2 fase 2: quadros que contam a história da família (ver client/src/story.js)
      const p = new THREE.Mesh(new THREE.PlaneGeometry(dc.w, dc.h), new THREE.MeshStandardMaterial({ map: storyPainting(dc.v), color: 0xb4a890, roughness: 0.82 }) /* tinta fosca: de perto a lanterna estourava o quadro */); p.position.z = 0.053; g.add(p);
      if (dc.v % 4 === 1) g.rotation.z = 0.03; // levemente torto (cabe na moldura: a caixa de ocupação já tem folga)
      g.updateMatrixWorld(true);
      const pi = res.paintings.length; res.paintings.push({ v: dc.v, title: PAINTING_TITLES[dc.v % 8], g }); g.userData.painting = true; // v6: g → o trailer esconde os quadros
      res.interact.push({ kind: 'painting', id: pi, level: dc.level, box: new THREE.Box3().setFromObject(g).expandByScalar(0.04) });
    } else if (dc.kind === 'rug' || dc.kind === 'runner') {
      const mat = M.T.carpets[(dc.v || 0) % 3];
      const m = new THREE.Mesh(new THREE.PlaneGeometry(dc.w, dc.d), new THREE.MeshStandardMaterial({ ...mat, roughness: 1 }));
      m.rotation.x = -Math.PI / 2; if (dc.kind === 'runner' || dc.w > dc.d) m.rotation.z = Math.PI / 2 * (dc.kind === 'runner' ? 1 : 0);
      if (dc.kind === 'runner') { m.geometry = new THREE.PlaneGeometry(dc.d, dc.w); m.rotation.z = dc.alongZ ? 0 : Math.PI / 2; }
      m.position.set(dc.x, y0 + 0.006, dc.z); m.receiveShadow = true; levels[dc.level].add(m);
    } else if (dc.kind === 'curtain_alcove') {
      const [c0, c1] = dc.cells;
      const horiz = c0[1] === c1[1];
      const geo = new THREE.PlaneGeometry(1.1, LEVELS[dc.level].h - 0.1, 26, 1); const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 30) * 0.05);
      geo.computeVertexNormals();
      const c = new THREE.Mesh(geo, M.curtain); c.castShadow = true;
      const cx = (c0[0] + c1[0] + 1) / 2 * CELL, cz = (c0[1] + c1[1] + 1) / 2 * CELL;
      if (horiz) { c.position.set(cx, y0 + LEVELS[dc.level].h / 2, dc.z + (dc.rot === 0 ? 0.5 : -0.5)); }
      else { c.position.set(dc.x + (Math.abs(dc.rot - Math.PI / 2) < 0.1 ? 0.5 : -0.5), y0 + LEVELS[dc.level].h / 2, cz); c.rotation.y = Math.PI / 2; }
      levels[dc.level].add(c);
      B(levels[dc.level], horiz ? 1.2 : 0.03, 0.03, horiz ? 0.03 : 1.2, M.brass, c.position.x, y0 + LEVELS[dc.level].h - 0.08, c.position.z);
    }
  }
  for (let L = 0; L < 4; L++) mergeStatic(deco[L], levels[L], root);
  // ---------- luminárias ----------
  const fixtures = [[], [], [], []];
  for (const l of map.lamps) {
    const lamp = { ...l };
    const g = new THREE.Group(); g.position.set(l.x, l.y, l.z); levels[l.level].add(g);
    const off = l.state === 'off';
    const glowMat = off ? M.black : (l.kind === 'emergency' ? M.glowRed : M.glow);
    if (l.kind === 'wall') {
      g.rotation.y = l.rot;
      C(g, 0.06, 0.06, 0.02, M.brass, 0, 0, 0.01, 0xffffff, 16, Math.PI / 2);
      const arm = mesh(new THREE.TorusGeometry(0.1, 0.012, 8, 16, Math.PI), M.brass); arm.position.set(0, -0.0, 0.1); arm.rotation.y = Math.PI / 2; g.add(arm);
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.11, 0.14, 16, 1, true), off ? M.paper : M.shade); shade.position.set(0, 0.12, 0.2); g.add(shade);
      lamp.bulb = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), glowMat); lamp.bulb.position.set(0, 0.1, 0.2); g.add(lamp.bulb);
      lamp.lx = l.x + Math.sin(l.rot) * 0.5; lamp.lz = l.z + Math.cos(l.rot) * 0.5;
    } else if (l.kind === 'chandelier') {
      C(g, 0.008, 0.008, 0.9, M.iron, 0, 0.45, 0, 0x2a2a2a, 6);
      const ring = mesh(new THREE.TorusGeometry(0.45, 0.02, 8, 32), M.brass); ring.rotation.x = Math.PI / 2; g.add(ring);
      const ring2 = mesh(new THREE.TorusGeometry(0.25, 0.015, 8, 24), M.brass); ring2.rotation.x = Math.PI / 2; ring2.position.y = 0.15; g.add(ring2);
      lamp.bulbs = [];
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; C(g, 0.015, 0.015, 0.1, M.paper, Math.cos(a) * 0.45, 0.06, Math.sin(a) * 0.45, 0xe8dcc0, 6); const b = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 6), glowMat); b.scale.y = 1.8; b.position.set(Math.cos(a) * 0.45, 0.14, Math.sin(a) * 0.45); g.add(b); lamp.bulbs.push(b); }
    } else if (l.kind === 'flame') {
      // v2 fase 2: chamas das 3 velas do candelabro da mesa de jantar (o candelabro é do próprio móvel)
      const p = map.props[l.prop], th = [0, Math.PI / 2, Math.PI, -Math.PI / 2][p ? p.facing : 0];
      g.position.set(p ? p.x : l.x, l.y, p ? p.z : l.z); g.rotation.y = th; lamp.bulbs = [];
      for (const sx of [-0.12, 0, 0.12]) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), glowMat); b.scale.y = 2; b.position.set(sx, 0.0, 0); g.add(b); lamp.bulbs.push(b); }
      lamp.y = l.y + 0.05;
    } else if (l.kind === 'candle') {
      C(g, 0.02, 0.02, 0.12, M.paper, 0, 0.06, 0, 0xe8dcc0, 8); C(g, 0.04, 0.05, 0.015, M.brass, 0, 0.007, 0);
      lamp.bulb = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), glowMat); lamp.bulb.scale.y = 2; lamp.bulb.position.y = 0.15; g.add(lamp.bulb);
      lamp.y = l.y + 0.25;
    } else if (l.kind === 'bulb') {
      C(g, 0.004, 0.004, 0.5, M.black, 0, 0.25, 0, 0xffffff, 4);
      lamp.bulb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), glowMat); g.add(lamp.bulb);
      const cage = mesh(new THREE.CylinderGeometry(0.03, 0.12, 0.08, 12, 1, true), M.iron); cage.position.y = 0.06; g.add(cage);
    } else if (l.kind === 'emergency') {
      g.rotation.y = l.rot || 0;
      B(g, 0.22, 0.12, 0.08, M.iron, 0, 0, 0.04, 0x2a2a2a);
      lamp.bulb = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.03), glowMat); lamp.bulb.position.set(0, 0, 0.09); g.add(lamp.bulb);
      lamp.lz = l.z + Math.cos(l.rot || 0) * 0.3;
    }
    mergeLocal(g); // v4: suporte/braço/aro da luminária numa malha só (lâmpadas e cúpula ficam separadas: sem cor por vértice)
    if (lamp.bulb && l.state === 'flicker') { lamp.bulb.material = glowMat.clone(); res.flickerMeshes.push(lamp); }
    if (lamp.bulbs && l.state === 'flicker') { const mm = glowMat.clone(); lamp.bulbs.forEach(b => b.material = mm); res.flickerMeshes.push(lamp); }
    lamp.seed = Math.random() * 100;
    res.lamps.push(lamp);
  }
  // v6: lado de fora (quintal, mata, estrada com postes) — visto pelas janelas e pela porta de saída
  if (typeof document !== 'undefined') { res.exterior = buildExterior(map); root.add(res.exterior.g); }
  return res;
}
function wdt2(h) { return h * 2; }

// ---------- v2 fase 2: bilhetes, páginas de diário, livros abertos e recorte de jornal sobre os móveis ----------
// Escolha determinística (mesma casa = mesmos bilhetes para todos). Cada um só é colocado num ponto LIVRE do
// tampo: raios de cima conferem que nada (livro, vela, prato, espelho) ocupa a área do papel.
const NOTE_KINDS = ['desk', 'reading_table', 'nightstand', 'side_table', 'coffee_table', 'console', 'sideboard', 'dresser', 'ktable'];
function placeNotes(map, res, levels, M) {
  const rng = makeRng('bilhetes-' + map.seed);
  const cands = map.props.filter(p => NOTE_KINDS.includes(p.kind) && SURFACE_Y[p.kind] !== undefined);
  // embaralha e prefere um bilhete por cômodo, espalhados pelos andares
  for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [cands[i], cands[j]] = [cands[j], cands[i]]; }
  const usedRooms = new Set(), rc = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
  let n = 0;
  for (const p of cands) {
    if (n >= NOTES.length) break;
    if (usedRooms.has(p.room)) continue;
    const note = NOTES[n], base = LEVELS[p.level].y, topY = base + SURFACE_Y[p.kind];
    const sz = note.type === 'book' ? [0.34, 0.25] : note.type === 'news' ? [0.3, 0.36] : [0.2, 0.27];
    const lvl = levels[p.level]; lvl.updateMatrixWorld(true);
    const th = [0, Math.PI / 2, Math.PI, -Math.PI / 2][p.facing];
    const horiz = p.facing === 0 || p.facing === 2, w = (horiz ? p.sx : p.sz) * CELL, d = (horiz ? p.sz : p.sx) * CELL;
    const free = (lx, lz, ang) => { // confere 9 pontos da área do papel (com 3 cm de folga)
      for (const a of [-0.5, 0, 0.5]) for (const b of [-0.5, 0, 0.5]) {
        const ux = lx + (a * (sz[0] + 0.06)) * Math.cos(ang) + (b * (sz[1] + 0.06)) * Math.sin(ang), uz = lz - (a * (sz[0] + 0.06)) * Math.sin(ang) + (b * (sz[1] + 0.06)) * Math.cos(ang);
        const wx = p.x + ux * Math.cos(th) + uz * Math.sin(th), wz = p.z - ux * Math.sin(th) + uz * Math.cos(th);
        rc.set(new THREE.Vector3(wx, topY + 1.2, wz), down); rc.far = 1.5;
        const hit = rc.intersectObjects(lvl.children, true).find(h => h.object.isMesh);
        if (!hit || Math.abs(hit.point.y - topY) > 0.012) return null;
        for (const l of map.lamps) if (l.level === p.level && Math.hypot(l.x - wx, l.z - wz) < 0.09 && l.y > base + 0.3 && l.y < topY + 0.6) return null;
        for (const sf of map.surfaces || []) if (sf.prop === p.id && Math.hypot(sf.x - wx, sf.z - wz) < 0.12) return null; // lugar reservado para chave
      }
      return true;
    };
    let spot = null;
    for (let t = 0; t < 24 && !spot; t++) {
      const lx = (rng.next() - 0.5) * Math.max(0, w - sz[0] - 0.2), lz = (rng.next() - 0.5) * Math.max(0, d - sz[1] - 0.2), ang = (rng.next() - 0.5) * 0.6;
      if (free(lx, lz, ang)) spot = [lx, lz, ang];
    }
    if (!spot) continue;
    const [lx, lz, ang] = spot;
    const g = new THREE.Group(); g.position.set(p.x + lx * Math.cos(th) + lz * Math.sin(th), topY, p.z - lx * Math.sin(th) + lz * Math.cos(th)); g.rotation.y = th + ang;
    const page = new THREE.MeshStandardMaterial({ map: noteTexture(note), color: 0x9c907a, roughness: 0.95 }) /* escurecido: sob a lanterna de perto o papel estourava em branco */;
    if (note.type === 'book') {
      // livro aberto: capa escura + duas páginas levemente curvadas para cima
      B(g, sz[0], 0.02, sz[1], M.leather, 0, 0.01, 0, 0x5a1a14);
      for (const s of [-1, 1]) { const pg = new THREE.Mesh(tint(new THREE.BoxGeometry(sz[0] / 2 - 0.01, 0.012, sz[1] - 0.02), 0xffffff), [M.paper, M.paper, page, M.paper, M.paper, M.paper]); pg.position.set(s * sz[0] / 4, 0.027, 0); pg.rotation.z = -s * 0.06; g.add(pg); }
    } else {
      const pg = new THREE.Mesh(tint(new THREE.BoxGeometry(sz[0], 0.003, sz[1]), 0xffffff), [M.paper, M.paper, page, M.paper, M.paper, M.paper]); pg.position.y = 0.0016; g.add(pg);
    }
    levels[p.level].add(g); g.updateMatrixWorld(true);
    res.notes.push({ note, level: p.level, g });
    res.interact.push({ kind: 'read', id: res.notes.length - 1, level: p.level, box: new THREE.Box3().setFromObject(g).expandByScalar(0.06) });
    usedRooms.add(p.room); n++;
  }
}

// ---------- v4: fusão local e pedaços ----------
const _inv = new THREE.Matrix4(), _m4 = new THREE.Matrix4();
const mergeable = (o) => o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && o.visible && !Array.isArray(o.material) && !o.children.length &&
  Object.keys(o.userData).every(k => k === 'wuv') && o.geometry.attributes.color && o.geometry.attributes.uv && o.geometry.attributes.normal;
const KEEP_ATTR = ['position', 'normal', 'uv', 'color'];
// geometria sem índice (RoundedBox…) ganha índice trivial 0,1,2… para poder ser fundida com as indexadas
function indexed(g) { if (!g.index) { const n = g.attributes.position.count, a = new (n > 65535 ? Uint32Array : Uint16Array)(n); for (let i = 0; i < n; i++) a[i] = i; g.setIndex(new THREE.BufferAttribute(a, 1)); } return g; }
// funde as malhas filhas de `node` por material, no espaço local de `node` (a peça continua podendo se mexer).
// `stop(o)` = filhos que NÃO entram (partes móveis próprias, subgrupos com referência no jogo).
export function mergeLocal(node, stop = (o) => !!o.userData.dynamic) {
  node.updateMatrixWorld(true);
  _inv.copy(node.matrixWorld).invert();
  const buckets = new Map(), used = [];
  const walk = (o) => {
    for (const ch of o.children) {
      if (stop(ch)) continue;
      if (mergeable(ch)) {
        const geo = indexed(ch.geometry.clone()).applyMatrix4(_m4.multiplyMatrices(_inv, ch.matrixWorld));
        for (const k of Object.keys(geo.attributes)) if (!KEEP_ATTR.includes(k)) geo.deleteAttribute(k);
        if (!buckets.has(ch.material)) buckets.set(ch.material, { geos: [], objs: [], cast: false });
        const b = buckets.get(ch.material); b.geos.push(geo); b.objs.push(ch); b.cast ||= ch.castShadow;
      } else if (!ch.isMesh && ch.visible && !ch.isLight) walk(ch);
    }
  };
  walk(node);
  for (const [mat, b] of buckets) {
    if (b.geos.length < 2) continue;
    const merged = mergeGeometries(b.geos, false); if (!merged) continue;
    for (const o of b.objs) o.parent.remove(o);
    const m = new THREE.Mesh(merged, mat); m.castShadow = b.cast; m.receiveShadow = true; node.add(m); used.push(m);
  }
  return used;
}
// divide uma geometria indexada (já em coordenadas do mundo) em pedaços de `tile` m pelo centro dos triângulos.
// Os pedaços compartilham os mesmos atributos (um buffer só na GPU) e cada um tem índice e esfera envolvente próprios.
const CHUNK = 10, CHUNK_MIN_TRIS = 3000; // malhas pequenas não compensam dividir (mais draw calls que economia)
export function addChunked(parent, geo, mat, cast, tile = CHUNK) {
  const idx = geo.index.array, pos = geo.attributes.position.array, groups = new Map();
  if (idx.length / 3 < CHUNK_MIN_TRIS) tile = 1e6;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const cx = (pos[a] + pos[b] + pos[c]) / 3, cz = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3;
    const key = Math.floor(cx / tile) * 1000 + Math.floor(cz / tile);
    let arr = groups.get(key); if (!arr) groups.set(key, arr = []);
    arr.push(idx[t], idx[t + 1], idx[t + 2]);
  }
  const out = [];
  for (const arr of groups.values()) {
    const g = groups.size === 1 ? geo : new THREE.BufferGeometry();
    if (g !== geo) { for (const k of Object.keys(geo.attributes)) g.setAttribute(k, geo.attributes[k]); g.setIndex(arr); }
    const box = new THREE.Box3(), v = new THREE.Vector3();
    for (const i of arr) box.expandByPoint(v.fromArray(pos, i * 3));
    const sph = new THREE.Sphere(); box.getCenter(sph.center); let r2 = 0;
    for (const i of arr) r2 = Math.max(r2, v.fromArray(pos, i * 3).distanceToSquared(sph.center));
    sph.radius = Math.sqrt(r2); g.boundingBox = box; g.boundingSphere = sph;
    const m = new THREE.Mesh(g, mat); m.castShadow = cast; m.receiveShadow = true; parent.add(m); out.push(m);
  }
  return out;
}

function mergeStatic(groups, parent, root) {
  const buckets = new Map();
  for (const g of groups) {
    g.updateMatrixWorld(true);
    // v4: dentro de cada parte móvel (gaveta, porta de armário, tampa, roupas) funde as peças por material
    const dynRoots = []; g.traverse(o => { if (o !== g && o.userData.dynamic && !o.isMesh) dynRoots.push(o); });
    for (const d of dynRoots) mergeLocal(d);
    const remove = [];
    g.traverse(o => {
      if (!o.isMesh) return;
      let a = o, dynamic = false;
      while (a && a !== g.parent) { if (a.userData.dynamic) { dynamic = true; break; } a = a.parent; }
      if (dynamic || !o.geometry.attributes.color || !o.geometry.attributes.uv || Array.isArray(o.material)) return;
      const geo = indexed(o.geometry.clone()).applyMatrix4(o.matrixWorld);
      for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) geo.deleteAttribute(k);
      if (!buckets.has(o.material)) buckets.set(o.material, []);
      buckets.get(o.material).push(geo);
      remove.push(o);
    });
    for (const o of remove) o.parent.remove(o);
  }
  for (const [mat, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    // as coordenadas já estão no espaço do mundo: o pai (nível) está na origem. v4: em pedaços de ~8 m
    addChunked(parent, merged, mat, true);
  }
}

// ---------- pool de luzes: só as N luminárias mais próximas recebem luz real ----------
export class LightPool {
  constructor(scene, count) {
    this.lights = [];
    for (let i = 0; i < count; i++) { const l = new THREE.PointLight(0xffaa55, 0, 8, 2); l.castShadow = false; scene.add(l); this.lights.push({ l, lamp: null, k: 0 }); }
    this.acc = 1;
  }
  update(dt, t, camPos, camLevel, lamps) {
    this.acc += dt;
    if (this.acc > 0.25) {
      this.acc = 0;
      const cands = [];
      for (const lp of lamps) {
        if (lp.state === 'off' || Math.abs(lp.level - camLevel) > 1) continue;
        const d = Math.hypot((lp.lx ?? lp.x) - camPos.x, lp.y - camPos.y, (lp.lz ?? lp.z) - camPos.z);
        if (d > 22) continue;
        cands.push({ lp, s: d + (lp.level !== camLevel ? 6 : 0) - (lp.kind === 'chandelier' ? 2 : 0) });
      }
      cands.sort((a, b) => a.s - b.s);
      const chosen = new Set(cands.slice(0, this.lights.length).map(c => c.lp));
      for (const s of this.lights) if (s.lamp && !chosen.has(s.lamp)) s.lamp = null;
      for (const lp of chosen) {
        if (this.lights.some(s => s.lamp === lp)) continue;
        const free = this.lights.find(s => !s.lamp);
        if (free) { free.lamp = lp; free.k = 0; }
      }
    }
    for (const s of this.lights) {
      if (!s.lamp) { s.l.intensity *= 0.8; continue; }
      const lp = s.lamp;
      s.k = Math.min(1, s.k + dt * 3);
      s.l.position.set(lp.lx ?? lp.x, lp.y, lp.lz ?? lp.z);
      s.l.color.setHex(lp.color); s.l.distance = lp.range * (lp.kind === 'fire' ? 1.0 : 0.75);
      // poças de luz quentes e pequenas: a lanterna é a luz principal
      s.l.intensity = lp.intensity * (lp.kind === 'moon' ? 1.0 : lp.kind === 'fire' ? 0.95 : 0.42) * s.k * flicker(lp, t); // v5: a lareira acesa ilumina a sala de verdade // v2: luzes da casa mais fracas — a lanterna manda
    }
  }
}
export function flicker(lp, t) {
  if (lp.state === 'flicker') {
    const s = lp.seed || 0;
    if (lp.kind === 'fire') return 0.78 + 0.12 * Math.sin(t * 9.1 + s) * Math.sin(t * 5.3 + s * 2) + 0.07 * Math.sin(t * 17.7 + s * 3) + 0.03 * Math.sin(t * 31 + s);
    if (lp.kind === 'candle' || lp.kind === 'flame') return 0.8 + 0.2 * Math.sin(t * 13 + s) * Math.sin(t * 7.3 + s * 2);
    const n = Math.sin(t * 23 + s) * Math.sin(t * 3.1 + s) + Math.sin(t * 57 + s * 3) * 0.3;
    return n > 0.55 ? 0.08 : 0.85 + 0.15 * Math.sin(t * 40 + s);
  }
  return 1;
}

// ---------- v5: peças de uma janela (exportado para o trailer/lab) ----------
// g: grupo da janela (origem no pé da parede, centro do vão; +z = para dentro do cômodo, -z = para dentro da parede).
// Põe em g as malhas próprias (desenhos colados, cortinas) e devolve:
//   frame: grupo com madeira/forro/peitoril (vai para a fusão estática), sky/glass/patch: geometrias no espaço de g.
const drawMats = new Map();
export function buildWindowParts(g, wdw, wi, M) {
  const { ww, wh, wy } = winSize(wdw);
  const gd = 0.22;                                   // profundidade do caixilho dentro da parede (0,5 m de espessura)
  const yb = wy - wh / 2, yt = wy + wh / 2;
  const fr = new THREE.Group(); g.add(fr);
  // forro do vão (madeira) — laterais, topo — e peitoril que avança 9 cm para o cômodo
  const WW = M.windowWood || M.trim;
  for (const s of [-1, 1]) B(fr, 0.03, wh, gd + 0.01, WW, s * (ww / 2 - 0.015), wy, -gd / 2, 0xffffff);
  B(fr, ww, 0.03, gd + 0.01, WW, 0, yt - 0.015, -gd / 2, 0xd0d0d0);
  B(fr, ww + 0.14, 0.04, gd + 0.09, WW, 0, yb + 0.005, -gd / 2 + 0.045, 0xffffff);   // peitoril
  // guarnição na parede (cobre a emenda do recorte)
  for (const s of [-1, 1]) B(fr, 0.09, wh + 0.07, 0.03, M.trim, s * (ww / 2 + 0.03), wy + 0.015, 0.015, 0x3a2214);
  B(fr, ww + 0.15, 0.06, 0.035, M.trim, 0, yt + 0.01, 0.0175, 0x3a2214);
  B(fr, ww + 0.19, 0.02, 0.05, M.trim, 0, yt + 0.035, 0.025, 0x2a160c);                   // cornija da guarnição
  B(fr, ww + 0.04, 0.035, 0.022, M.trim, 0, yb - 0.02, 0.011, 0x3a2214);                    // avental sob o peitoril
  // caixilho (guilhotina antiga): moldura + travessas
  const z = -gd, sash = 0x2a1a10, bw = wdw.small ? 0.04 : 0.05;
  for (const s of [-1, 1]) B(fr, bw, wh, 0.045, M.trim, s * (ww / 2 - 0.03 - bw / 2), wy, z, sash);
  B(fr, ww - 0.06, bw, 0.045, M.trim, 0, yt - 0.03 - bw / 2, z, sash); B(fr, ww - 0.06, bw, 0.045, M.trim, 0, yb + 0.03 + bw / 2, z, sash);
  if (wdw.small) { B(fr, 0.025, wh - 0.08, 0.03, M.trim, 0, wy, z, sash); B(fr, ww - 0.08, 0.025, 0.03, M.trim, 0, wy, z, sash); }
  else {
    B(fr, ww - 0.06, 0.055, 0.06, M.trim, 0, wy, z + 0.01, sash);                         // trilho de encontro
    B(fr, 0.026, wh - 0.08, 0.03, M.trim, 0, wy, z, sash);
    for (const f of [0.25, 0.75]) B(fr, ww - 0.08, 0.024, 0.03, M.trim, 0, yb + wh * f, z, sash);
    B(fr, 0.06, 0.02, 0.03, M.brass, 0, wy + 0.035, z + 0.04, 0xa08040);                   // tranca
  }
  // vidro (mesma folha para todo o vão) e céu lá fora logo atrás
  const glass = new THREE.PlaneGeometry(ww - 0.06, wh - 0.06); glass.translate(0, wy, z - 0.006);
  const out = new THREE.Vector3(-Math.sin(wdw.rot), 0, -Math.cos(wdw.rot));                 // para fora da casa
  const az = ((wi * 0.6180339) % 1 - 0.5) * 0.7, el = 0.24 + ((wi * 0.4142) % 1) * 0.16;
  const moon = out.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), az).multiplyScalar(Math.cos(el)); moon.y = Math.sin(el);
  const sky = windowSkyGeometry(ww - 0.02, wh - 0.02, wy, z - 0.03, moon);
  // desenhos de criança colados no vidro, do lado de dentro (papel com transparência em volta)
  const vk = (wi * 7 + (wdw.room || 0) * 3) % 5 + (wdw.small ? 's' : 'b');
  if (false && !drawMats.has(vk) && typeof document !== 'undefined') { const tx = windowDrawingsTexture(parseInt(vk), wdw.small); drawMats.set(vk, new THREE.MeshStandardMaterial({ map: tx, color: 0x625c52, emissive: 0x1a2236, emissiveMap: tx, emissiveIntensity: 0.5, roughness: 0.9, transparent: true, alphaTest: 0.02, depthWrite: false }) /* fosco: a lanterna de perto estourava o papel; o emissivo é o luar atravessando o papel */); }
  if (false && drawMats.has(vk)) { const dm = new THREE.Mesh(new THREE.PlaneGeometry(ww - 0.06, wh - 0.06), drawMats.get(vk)); dm.position.set(0, wy, z - 0.002); dm.renderOrder = 4; g.add(dm); }
  // cortinas laterais (mesma medida de antes: decorboxes.windowBox)
  if (!wdw.small && !wdw.curtain && !wdw.noDrape) for (const s of [-1, 1]) {
    const geo = new THREE.PlaneGeometry(0.45, 2.4, 16, 1); const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 38) * 0.04);
    geo.computeVertexNormals();
    const c = new THREE.Mesh(geo, M.curtain); c.position.set(s * (ww / 2 + 0.2), wy - 0.2, 0.12); c.castShadow = true; g.add(c);
  }
  // mancha de luar no piso (não sob a cortina-esconderijo, que fica fechada na frente)
  let patch = null;
  if (!wdw.curtain) { patch = moonPatchGeometry(ww, 0.35, wdw.small ? 1.4 : 2.3); patch.translate(0, 0.011, 0); }
  return { frame: fr, sky, glass, patch };
}
