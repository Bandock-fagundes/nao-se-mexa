// Navegação da criatura: grafo em grade com folga (3x3 células = 1,5 m), multiandar via escadas.
import { CELL, W, D, T } from './config.js';
import { cellOf } from './world.js';

const N = W * D;
const DIR8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];
const okType = (t) => t === T.FLOOR || t === T.DOOR || t === T.STAIR || t === T.CURTAIN;

class Heap {
  constructor() { this.k = []; this.v = []; }
  push(key, val) { const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val); while (i > 0) { const p = (i - 1) >> 1; if (v[p] <= v[i]) break; [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]]; i = p; } }
  pop() { const k = this.k, v = this.v; const top = k[0]; const lk = k.pop(), lv = v.pop(); if (k.length) { k[0] = lk; v[0] = lv; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < k.length && v[l] < v[m]) m = l; if (r < k.length && v[r] < v[m]) m = r; if (m === i) break; [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]]; i = m; } } return top; }
  get size() { return this.k.length; }
}

export class Nav {
  constructor(world) {
    this.world = world;
    const map = world.map;
    this.map = map;
    this.cwalk = [];
    for (let L = 0; L < 4; L++) {
      const g = map.levels[L].grid, cw = new Uint8Array(N);
      for (let z = 1; z < D - 1; z++) for (let x = 1; x < W - 1; x++) {
        let ok = true;
        for (let a = -1; a <= 1 && ok; a++) for (let b = -1; b <= 1; b++) if (!okType(g[(z + b) * W + x + a])) { ok = false; break; }
        cw[z * W + x] = ok ? 1 : 0;
      }
      this.cwalk.push(cw);
    }
  }
  canon(L, i) {
    const s = this.map.levels[L].stair[i];
    if (s >= 0) return this.map.stairs[s].lower * N + i;
    return L * N + i;
  }
  walkable(L, x, z) { return x > 0 && z > 0 && x < W - 1 && z < D - 1 && this.cwalk[L][z * W + x] === 1; }
  nodeLevels(L, i) {
    const s = this.map.levels[L].stair[i];
    if (s < 0) return [L];
    const st = this.map.stairs[s];
    return [st.lower, st.upper];
  }
  // célula navegável mais próxima (BFS em anel)
  nearest(L, x, z, maxR = 12) {
    const cx = cellOf(x), cz = cellOf(z);
    if (this.walkable(L, cx, cz)) return { L, cx, cz };
    for (let r = 1; r <= maxR; r++) {
      let best = null, bd = 1e9;
      for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
        if (Math.max(Math.abs(a), Math.abs(b)) !== r) continue;
        if (!this.walkable(L, cx + a, cz + b)) continue;
        // precisa de linha livre (não atravessar parede para "achar" o ponto)
        const wx = (cx + a + 0.5) * CELL, wz = (cz + b + 0.5) * CELL;
        if (!this.world.noWallBetween(L, x, z, wx, wz)) continue;
        const d = a * a + b * b; if (d < bd) { bd = d; best = { L, cx: cx + a, cz: cz + b }; }
      }
      if (best) return best;
    }
    return null;
  }
  findPath(L0, x0, z0, L1, x1, z1, opts = {}) {
    const s = this.nearest(L0, x0, z0), g = this.nearest(L1, x1, z1);
    if (!s || !g) return null;
    const world = this.world;
    const start = this.canon(s.L, s.cz * W + s.cx), goal = this.canon(g.L, g.cz * W + g.cx);
    const gx = g.cx, gz = g.cz;
    const gScore = new Map(), came = new Map();
    const open = new Heap();
    gScore.set(start, 0); open.push(start, 0);
    const maxIter = opts.maxIter || 30000;
    let it = 0;
    while (open.size && it++ < maxIter) {
      const cur = open.pop();
      if (cur === goal) break;
      const L = Math.floor(cur / N), i = cur % N, x = i % W, z = (i / W) | 0;
      const gc = gScore.get(cur);
      for (const LL of this.nodeLevels(L, i)) {
        for (const [dx, dz, c] of DIR8) {
          const nx = x + dx, nz = z + dz;
          if (!this.walkable(LL, nx, nz)) continue;
          if (dx && dz && (!this.walkable(LL, x + dx, z) || !this.walkable(LL, x, z + dz))) continue;
          const ni = nz * W + nx;
          const nk = this.canon(LL, ni);
          let cost = c;
          if (world.isDoorClosedCell(LL, nx, nz)) cost += opts.doorCost ?? 6;
          if (this.map.levels[LL].grid[ni] === T.EXIT) continue;
          const ng = gc + cost;
          if (ng < (gScore.get(nk) ?? Infinity)) {
            gScore.set(nk, ng); came.set(nk, cur);
            const h = Math.hypot(nx - gx, nz - gz) + Math.abs(Math.floor(nk / N) - g.L) * 10;
            open.push(nk, ng + h);
          }
        }
      }
    }
    if (!came.has(goal) && start !== goal) return null;
    const nodes = [];
    let c = goal;
    while (c !== undefined) { nodes.push(c); if (c === start) break; c = came.get(c); }
    nodes.reverse();
    const pts = nodes.map(k => {
      const L = Math.floor(k / N), i = k % N, x = i % W, z = (i / W) | 0;
      return { L, cx: x, cz: z, x: (x + 0.5) * CELL, z: (z + 0.5) * CELL, stair: this.map.levels[L].stair[i] >= 0, door: this.map.levels[L].door[i] };
    });
    return this.smooth(pts);
  }
  clearLine(L, a, b) {
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.ceil(dist / 0.2);
    for (let k = 1; k < steps; k++) {
      const x = a.x + (b.x - a.x) * k / steps, z = a.z + (b.z - a.z) * k / steps;
      const cx = cellOf(x), cz = cellOf(z);
      if (!this.walkable(L, cx, cz)) return false;
      const i = cz * W + cx;
      if (this.map.levels[L].stair[i] >= 0) return false;
      if (this.map.levels[L].door[i] >= 0) return false;
    }
    return true;
  }
  smooth(pts) {
    if (pts.length <= 2) return pts;
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      for (; j > i + 1; j--) {
        if (pts[j].L !== pts[i].L || pts[i].stair || pts[j].stair) continue;
        let same = true; for (let k = i; k <= j; k++) if (pts[k].L !== pts[i].L || pts[k].stair || pts[k].door >= 0) { same = false; break; }
        if (same && this.clearLine(pts[i].L, pts[i], pts[j])) break;
      }
      out.push(pts[j]); i = j;
    }
    return out;
  }
  // distâncias de caminho (m) a partir de um ponto, limitadas — usadas pelo olfato (não atravessa paredes)
  pathDistances(L, x, z, maxDist) {
    const world = this.world;
    const res = new Map();
    const cx = cellOf(x), cz = cellOf(z);
    const key = (L, i) => L * N + i;
    const q = [[L, cx, cz, 0]];
    res.set(key(L, cz * W + cx), 0);
    let head = 0;
    while (head < q.length) {
      const [l, x0, z0, d] = q[head++];
      if (d > maxDist) continue;
      const i0 = z0 * W + x0;
      const levels = [l];
      const s = this.map.levels[l].stair[i0];
      if (s >= 0) { const st = this.map.stairs[s]; levels.push(st.lower === l ? st.upper : st.lower); }
      for (const ll of levels) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x0 + dx, nz = z0 + dz;
        if (world.blocksMove(ll, nx, nz, true)) continue;
        const k = key(ll, nz * W + nx);
        if (res.has(k)) continue;
        const nd = d + CELL;
        res.set(k, nd);
        q.push([ll, nx, nz, nd]);
      }
    }
    return res;
  }
}
export const NAV_N = N;
