// Constrói a mansão 3D a partir do mapa gerado (mesma semente do servidor).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CELL, W, D, T, LEVELS, ROWS } from '../../../shared/config.js';
import { buildProp, buildKey, buildKnockable, B, C, S, mesh, tint } from './props.js';
import { paintingTexture } from './textures.js';

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
  const res = { root, levels, doors: [], containers: [], knockables: [], lamps: [], interact: [], flames: [], flickerMeshes: [], exit: null, windows: [] };
  const lv = map.levels;
  const get = (L, x, z) => (x < 0 || z < 0 || x >= W || z >= D) ? T.VOID : lv[L].grid[z * W + x];
  const roomOf = (L, x, z) => (x < 0 || z < 0 || x >= W || z >= D) ? -1 : lv[L].room[z * W + x];

  for (let L = 0; L < 4; L++) {
    const y0 = LEVELS[L].y, rh = LEVELS[L].h, H = wallTopFor(L), dh = doorHeight(L);
    const builders = new Map();
    const gb = (key) => { if (!builders.has(key)) builders.set(key, new GB()); return builders.get(key); };
    const floorMat = (x, z) => {
      if (L === 0) return 'floorStone'; if (L === 3) return 'floorPlanks';
      let r = roomOf(L, x, z);
      if (r < 0) for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { r = roomOf(L, x + a, z + b); if (r >= 0) break; }
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
      const us = fm === 'floorWood' ? 2 : fm === 'floorTile' ? 1.6 : fm === 'floorPlanks' ? 2.4 : fm === 'floorCarpet' ? 1.5 : 3;
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
        const face = (mat, ya, yb, us, vs, ca, cb, voff = 0) => gb(mat).quadR([a[0], y0 + ya, a[1]], [b[0], y0 + ya, b[1]], [b[0], y0 + yb, b[1]], [a[0], y0 + yb, a[1]], n,
          [ua / us, (ya + voff) / vs], [ub / us, (ya + voff) / vs], [ub / us, (yb + voff) / vs], [ua / us, (yb + voff) / vs], ca, ca, cb, cb);
        if (isTransition(nx, nz)) { face('trim', 0, dh, 1, 1, 0.6, 0.8); continue; } // batente
        const st = styleOf(nx, nz);
        const top = nt === T.HOLE || nt === T.STAIR ? H : H;
        if (st === 'stone') { face('stone', 0, top, 2.5, 2.5, 0.5, 0.75); continue; }
        if (st === 'attic') { face('planks', 0, top, 2.4, 2.4, 0.5, 0.7); continue; }
        if (st === 'tile') { face('wallTile', 0, 1.3, 1.6, 1.6, 0.55, 0.95); face('wallPlain', 1.3, top, 1.4, 1.4, 0.95, 0.7); continue; }
        face('wainscot', 0, 1.0, 1.6, 1.0, 0.5, 0.95);
        face(paperMat[st] || 'wallRed', 1.0, rh, 1.25, 1.25, 0.95, 0.72);
        if (top > rh) face(paperMat[st] || 'wallRed', rh, top, 1.25, 1.25, 0.72, 0.72);
        // rodapé / guarda-cadeira / sanca
        const off = (k) => [n[0] * k, n[2] * k];
        const tr = (ya, yb, k, c1, c2) => { const o = off(k); gb('trim').quadR([a[0] + o[0], y0 + ya, a[1] + o[1]], [b[0] + o[0], y0 + ya, b[1] + o[1]], [b[0] + o[0], y0 + yb, b[1] + o[1]], [a[0] + o[0], y0 + yb, a[1] + o[1]], n, [ua, ya], [ub, ya], [ub, yb], [ua, yb], c1, c1, c2, c2); gb('trim').quadR([a[0] + o[0], y0 + yb, a[1] + o[1]], [b[0] + o[0], y0 + yb, b[1] + o[1]], [b[0], y0 + yb, b[1]], [a[0], y0 + yb, a[1]], [0, 1, 0], [ua, 0], [ub, 0], [ub, 0.05], [ua, 0.05], c2, c2, c2, c2); };
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
      const st = styleOf(x, z), pm = st === 'stone' ? 'stone' : st === 'attic' ? 'planks' : (paperMat[st] || 'wallRed');
      if (alongX) {
        for (const [zz, nz] of [[Z1, 1], [Z0, -1]]) gb(pm).quadR(nz > 0 ? [X1, ya, zz] : [X0, ya, zz], nz > 0 ? [X0, ya, zz] : [X1, ya, zz], nz > 0 ? [X0, yb, zz] : [X1, yb, zz], nz > 0 ? [X1, yb, zz] : [X0, yb, zz], [0, 0, nz], [X1 / 1.25, ya / 1.25], [X0 / 1.25, ya / 1.25], [X0 / 1.25, yb / 1.25], [X1 / 1.25, yb / 1.25], 0.8, 0.8, 0.7, 0.7);
      } else {
        for (const [xx, nx] of [[X1, 1], [X0, -1]]) gb(pm).quadR(nx > 0 ? [xx, ya, Z0] : [xx, ya, Z1], nx > 0 ? [xx, ya, Z1] : [xx, ya, Z0], nx > 0 ? [xx, yb, Z1] : [xx, yb, Z0], nx > 0 ? [xx, yb, Z0] : [xx, yb, Z1], [nx, 0, 0], [Z0 / 1.25, ya / 1.25], [Z1 / 1.25, ya / 1.25], [Z1 / 1.25, yb / 1.25], [Z0 / 1.25, yb / 1.25], 0.8, 0.8, 0.7, 0.7);
      }
      void t;
    }
    for (const [key, b] of builders) {
      const geo = b.build(); if (!geo) continue;
      const m = new THREE.Mesh(geo, M[key]); m.receiveShadow = true; m.castShadow = key !== 'ceiling' && key !== 'ceilingDark' && !key.startsWith('floor');
      levels[L].add(m);
    }
  }

  // ---------- escadas ----------
  for (const st of map.stairs) {
    const g = new THREE.Group(); levels[st.lower].add(g);
    const yA = LEVELS[st.lower].y, yB = LEVELS[st.upper].y, rise = yB - yA, N = 24, run = (st.zBot + 1 - st.zTop) * CELL / N;
    const x0 = st.x0 * CELL, wdt = st.w * CELL, zb = (st.zBot + 1) * CELL;
    for (let k = 0; k < N; k++) {
      const top = yA + (k + 1) * rise / N;
      const zc = zb - (k + 0.5) * run;
      B(g, wdt, top - yA, run, M.darkWood, x0 + wdt / 2, (top + yA) / 2, zc, 0x5a3a26);
      B(g, wdt + 0.02, 0.035, run + 0.03, M.wood, x0 + wdt / 2, top - 0.015, zc + 0.01, 0x7a5236);
      B(g, wdt * 0.62, 0.012, run + 0.02, M.fabric, x0 + wdt / 2, top + 0.004, zc, 0x5a1214);
    }
    // corrimão do lado do vão
    const railX = st.stringer * CELL + (st.stringer > st.x0 ? 0.02 : CELL - 0.02);
    for (let k = 0; k <= N; k += 3) {
      const yy = yA + k * rise / N, zz = zb - k * run;
      C(g, 0.025, 0.03, 0.95, M.darkWood, railX, yy + 0.47, zz, 0x3a2214, 8);
    }
    const len = Math.hypot(N * run, rise);
    const rail = mesh(new THREE.BoxGeometry(0.07, 0.06, len), M.darkWood, 0x3a2214);
    rail.position.set(railX, yA + rise / 2 + 0.95, zb - N * run / 2); rail.rotation.x = Math.atan2(rise, N * run); g.add(rail);
  }

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
    if (p.container !== undefined && g.userData.parts) {
      // v2: cada parte (gaveta / porta / tampa) é um alvo próprio com sua caixa de mira
      const c = map.containers[p.container];
      g.updateMatrixWorld(true);
      const whole = new THREE.Box3(new THREE.Vector3(p.x0 * CELL, LEVELS[p.level].y, p.z0 * CELL), new THREE.Vector3((p.x0 + p.sx) * CELL, LEVELS[p.level].y + (p.block === 'TALL' ? 2.1 : 1.0), (p.z0 + p.sz) * CELL));
      const parts = g.userData.parts.map((dy, i) => {
        const box = dy.type === 'drawer' ? new THREE.Box3().setFromObject(dy.part).expandByScalar(0.025) : whole;
        res.interact.push({ kind: 'container', id: c.id, part: i, level: p.level, box });
        return { idx: i, part: dy.part, extra: dy.extra, type: dy.type, amount: dy.amount, anchor: dy.anchor, label: dy.label, open: false, cur: 0, box };
      });
      res.containers[c.id] = { id: c.id, kind: c.kind, level: p.level, parts, box: whole, ax: c.ax, az: c.az, x: c.x, z: c.z, label: parts[0].label };
    }
  }
  // fusão por material (menos chamadas de desenho)
  for (let L = 0; L < 4; L++) mergeStatic(staticByLevel[L], levels[L], root);

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
    const leaves = [];
    for (const side of [-1, 1]) {
      const pv = new THREE.Group(); pv.position.set(side * half, 0, -0.05); g.add(pv);
      const lw = half - 0.01;
      B(pv, lw, dh, 0.1, M.wood, -side * lw / 2, dh / 2, 0, 0x3a2216);
      for (const yy of [0.3, dh / 2, dh - 0.3]) B(pv, lw, 0.08, 0.13, M.iron, -side * lw / 2, yy, 0, 0x222222);
      S(pv, 0.05, M.brass, -side * (lw - 0.1), dh * 0.45, 0.08);
      leaves.push({ pv, side });
    }
    // correntes e cadeados (um por chave necessária — escondidos conforme a coleta)
    const locks = [];
    const chain = new THREE.Group(); g.add(chain);
    for (let i = 0; i < 9; i++) { const l = mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 10), M.iron, 0x5a5650); l.position.set(-0.4 + i * 0.1, 1.2 + Math.sin(i * 0.5) * 0.05, 0.12); l.rotation.y = (i % 2) * Math.PI / 2; chain.add(l); }
    for (let i = 0; i < 3; i++) { const lk = new THREE.Group(); lk.position.set(-0.25 + i * 0.25, 1.05, 0.15); B(lk, 0.12, 0.12, 0.05, M.brass, 0, 0, 0, 0xa08030); const sh = mesh(new THREE.TorusGeometry(0.04, 0.01, 6, 12, Math.PI), M.iron); sh.position.y = 0.06; lk.add(sh); g.add(lk); locks.push(lk); }
    // exterior (visível quando a porta abre)
    const out = new THREE.Group(); levels[1].add(out);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 14), new THREE.MeshStandardMaterial({ color: 0x141a12, roughness: 1 })); ground.rotation.x = -Math.PI / 2; ground.position.set(e.x, -0.02, -7); out.add(ground);
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(40, 16), new THREE.MeshBasicMaterial({ color: 0x0c1428 })); sky.position.set(e.x, 6, -12); out.add(sky);
    const moon = new THREE.Mesh(new THREE.CircleGeometry(0.9, 24), new THREE.MeshBasicMaterial({ color: 0xdde4ff })); moon.position.set(e.x + 4, 7, -11.9); out.add(moon);
    res.exit = { g, leaves, locks, chain, open: false, cur: 0, x: e.x, z: e.z };
    res.interact.push({ kind: 'exit', id: 0, level: 1, box: new THREE.Box3(new THREE.Vector3(e.x - half - 0.2, 0, 0), new THREE.Vector3(e.x + half + 0.2, dh, 0.9)) });
  }
  // ---------- objetos derrubáveis ----------
  for (const k of map.knockables) {
    const g = buildKnockable(k.kind, M);
    g.position.set(k.x, LEVELS[k.level].y, k.z); g.rotation.y = k.rot; levels[k.level].add(g);
    const view = { id: k.id, kind: k.kind, g, knocked: false, t: 0, level: k.level, rot: k.rot };
    res.knockables[k.id] = view;
    res.interact.push({ kind: 'knock', id: k.id, level: k.level, box: new THREE.Box3(new THREE.Vector3(k.x - 0.25, LEVELS[k.level].y, k.z - 0.25), new THREE.Vector3(k.x + 0.25, LEVELS[k.level].y + (g.userData.h || 0.4) + 0.1, k.z + 0.25)) });
  }
  // ---------- janelas, quadros, tapetes, cortinas ----------
  const deco = [[], [], [], []];
  for (const wdw of map.windows) {
    const g = new THREE.Group(); g.position.set(wdw.x, LEVELS[wdw.level].y, wdw.z); g.rotation.y = wdw.rot; levels[wdw.level].add(g);
    const ww = wdw.small ? 0.6 : 1.0, wh = wdw.small ? 0.6 : 1.7, wy = wdw.small ? 1.4 : 1.75;
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh), M.windowGlass); glass.position.set(0, wy, 0.012); g.add(glass);
    const fr = new THREE.Group(); g.add(fr);
    B(fr, ww + 0.14, 0.08, 0.08, M.trim, 0, wy + wh / 2, 0.03); B(fr, ww + 0.2, 0.08, 0.14, M.trim, 0, wy - wh / 2, 0.05);
    B(fr, 0.07, wh, 0.08, M.trim, -ww / 2, wy, 0.03); B(fr, 0.07, wh, 0.08, M.trim, ww / 2, wy, 0.03);
    B(fr, 0.035, wh, 0.05, M.trim, 0, wy, 0.03); B(fr, ww, 0.035, 0.05, M.trim, 0, wy + wh * 0.15, 0.03);
    deco[wdw.level].push(fr);
    if (!wdw.small && !wdw.curtain && !wdw.noDrape) for (const s of [-1, 1]) {
      const geo = new THREE.PlaneGeometry(0.45, 2.4, 16, 1); const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 38) * 0.04);
      geo.computeVertexNormals();
      const c = new THREE.Mesh(geo, M.curtain); c.position.set(s * (ww / 2 + 0.2), wy - 0.2, 0.12); c.castShadow = true; g.add(c);
    }
    // luar
    res.lamps.push({ kind: 'moon', level: wdw.level, x: wdw.x + Math.sin(wdw.rot) * 0.8, y: LEVELS[wdw.level].y + wy, z: wdw.z + Math.cos(wdw.rot) * 0.8, color: 0x6a84c8, intensity: 1.1, range: 5.5, state: 'on' });
  }
  for (const dc of map.decor) {
    const y0 = LEVELS[dc.level].y;
    if (dc.kind === 'painting') {
      const g = new THREE.Group(); g.position.set(dc.x, y0 + dc.y, dc.z); g.rotation.y = dc.rot; levels[dc.level].add(g);
      B(g, dc.w + 0.1, dc.h + 0.1, 0.05, M.brass, 0, 0, 0.025, 0x8a6a30);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(dc.w, dc.h), new THREE.MeshStandardMaterial({ map: paintingTexture(dc.v), roughness: 0.7 })); p.position.z = 0.053; g.add(p);
      if (dc.v % 4 === 1) g.rotation.z = 0.06;
    } else if (dc.kind === 'rug' || dc.kind === 'runner') {
      const mat = M.T.carpets[(dc.v || 0) % 3];
      const m = new THREE.Mesh(new THREE.PlaneGeometry(dc.w, dc.d), new THREE.MeshStandardMaterial({ ...mat, roughness: 1 }));
      m.rotation.x = -Math.PI / 2; if (dc.kind === 'runner' || dc.w > dc.d) m.rotation.z = Math.PI / 2 * (dc.kind === 'runner' ? 1 : 0);
      if (dc.kind === 'runner') { m.geometry = new THREE.PlaneGeometry(dc.d, dc.w); m.rotation.z = Math.PI / 2; }
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
    if (lamp.bulb && l.state === 'flicker') { lamp.bulb.material = glowMat.clone(); res.flickerMeshes.push(lamp); }
    if (lamp.bulbs && l.state === 'flicker') { const mm = glowMat.clone(); lamp.bulbs.forEach(b => b.material = mm); res.flickerMeshes.push(lamp); }
    lamp.seed = Math.random() * 100;
    res.lamps.push(lamp);
  }
  return res;
}
function wdt2(h) { return h * 2; }

function mergeStatic(groups, parent, root) {
  const buckets = new Map();
  for (const g of groups) {
    g.updateMatrixWorld(true);
    const remove = [];
    g.traverse(o => {
      if (!o.isMesh) return;
      let a = o, dynamic = false;
      while (a && a !== g.parent) { if (a.userData.dynamic) { dynamic = true; break; } a = a.parent; }
      if (dynamic || !o.geometry.attributes.color || !o.geometry.attributes.uv || !o.geometry.index) return;
      const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
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
    const m = new THREE.Mesh(merged, mat); m.castShadow = true; m.receiveShadow = true;
    // as coordenadas já estão no espaço do mundo: o pai (nível) está na origem
    parent.add(m);
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
      s.l.color.setHex(lp.color); s.l.distance = lp.range * 0.75;
      // poças de luz quentes e pequenas: a lanterna é a luz principal
      s.l.intensity = lp.intensity * (lp.kind === 'moon' ? 1.0 : 0.42) * s.k * flicker(lp, t); // v2: luzes da casa mais fracas — a lanterna manda
    }
  }
}
export function flicker(lp, t) {
  if (lp.state === 'flicker') {
    const s = lp.seed || 0;
    if (lp.kind === 'candle' || lp.kind === 'fire') return 0.8 + 0.2 * Math.sin(t * 13 + s) * Math.sin(t * 7.3 + s * 2);
    const n = Math.sin(t * 23 + s) * Math.sin(t * 3.1 + s) + Math.sin(t * 57 + s * 3) * 0.3;
    return n > 0.55 ? 0.08 : 0.85 + 0.15 * Math.sin(t * 40 + s);
  }
  return 1;
}
