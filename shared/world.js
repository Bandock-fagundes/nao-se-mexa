// Consulta de mundo compartilhada: colisão, linha de visão, atenuação de som, escadas.
// Usada pelo servidor (autoridade) e pelo cliente (predição) com o mesmo código.
import { CELL, W, D, T, LEVELS } from './config.js';

export const idx = (cx, cz) => cz * W + cx;
export const cellOf = (v) => Math.floor(v / CELL);
export const cellCenter = (c) => (c + 0.5) * CELL;

export class World {
  constructor(map) {
    this.map = map;
    this.doorOpen = new Uint8Array(map.doors.length);
    map.doors.forEach((d, i) => { this.doorOpen[i] = d.initialOpen ? 1 : 0; });
    this.exitOpen = false;
  }
  cell(L, cx, cz) {
    if (L < 0 || L > 3 || cx < 0 || cz < 0 || cx >= W || cz >= D) return T.VOID;
    return this.map.levels[L].grid[idx(cx, cz)];
  }
  doorAt(L, cx, cz) {
    if (cx < 0 || cz < 0 || cx >= W || cz >= D) return -1;
    return this.map.levels[L].door[idx(cx, cz)];
  }
  stairAt(L, cx, cz) {
    if (L < 0 || L > 3 || cx < 0 || cz < 0 || cx >= W || cz >= D) return -1;
    return this.map.levels[L].stair[idx(cx, cz)];
  }
  isDoorClosedCell(L, cx, cz) {
    const t = this.cell(L, cx, cz);
    if (t === T.DOOR) { const d = this.doorAt(L, cx, cz); return d >= 0 && !this.doorOpen[d]; }
    if (t === T.EXIT) return !this.exitOpen;
    return false;
  }
  // bloqueia movimento de jogador/criatura (portas fechadas bloqueiam)
  blocksMove(L, cx, cz, ignoreDoors = false) {
    const t = this.cell(L, cx, cz);
    switch (t) {
      case T.FLOOR: case T.STAIR: case T.CURTAIN: return false;
      case T.DOOR: return ignoreDoors ? false : !this.doorOpen[this.doorAt(L, cx, cz)];
      case T.EXIT: return !this.exitOpen;
      default: return true;
    }
  }
  blocksSight(L, cx, cz) {
    const t = this.cell(L, cx, cz);
    switch (t) {
      case T.FLOOR: case T.STAIR: case T.LOW: case T.HOLE: return false;
      case T.DOOR: return !this.doorOpen[this.doorAt(L, cx, cz)];
      case T.EXIT: return !this.exitOpen;
      default: return true; // WALL, VOID, TALL, CURTAIN
    }
  }
  stairT(st, z) {
    const zTop = st.zTop * CELL, zBot = (st.zBot + 1) * CELL;
    return Math.max(0, Math.min(1, (zBot - z) / (zBot - zTop)));
  }
  floorY(L, x, z) {
    const s = this.stairAt(L, cellOf(x), cellOf(z));
    if (s >= 0) {
      const st = this.map.stairs[s];
      const t = this.stairT(st, z);
      return LEVELS[st.lower].y + t * (LEVELS[st.upper].y - LEVELS[st.lower].y);
    }
    return LEVELS[L].y;
  }
  resolveLevel(L, x, z) {
    const s = this.stairAt(L, cellOf(x), cellOf(z));
    if (s < 0) return L;
    const st = this.map.stairs[s];
    return this.stairT(st, z) >= 0.5 ? st.upper : st.lower;
  }
  circleFree(L, x, z, r, ignoreDoors = false) {
    const c0 = cellOf(x - r), c1 = cellOf(x + r), r0 = cellOf(z - r), r1 = cellOf(z + r);
    for (let cz = r0; cz <= r1; cz++) for (let cx = c0; cx <= c1; cx++) {
      if (!this.blocksMove(L, cx, cz, ignoreDoors)) continue;
      // círculo vs AABB
      const bx0 = cx * CELL, bz0 = cz * CELL;
      const nx = Math.max(bx0, Math.min(x, bx0 + CELL)), nz = Math.max(bz0, Math.min(z, bz0 + CELL));
      const dx = x - nx, dz = z - nz;
      if (dx * dx + dz * dz < r * r - 1e-6) return false;
    }
    return true;
  }
  // Move um círculo com deslizamento por eixo. Retorna nova posição e andar.
  move(L, x, z, dx, dz, r, ignoreDoors = false) {
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(dist / 0.1));
    const sx = dx / steps, sz = dz / steps;
    let hit = false;
    for (let i = 0; i < steps; i++) {
      if (this.circleFree(L, x + sx, z, r, ignoreDoors)) x += sx; else hit = true;
      if (this.circleFree(L, x, z + sz, r, ignoreDoors)) z += sz; else hit = true;
      L = this.resolveLevel(L, x, z);
    }
    return { x, z, level: L, hit };
  }
  // Verifica se um deslocamento reto de a→b é fisicamente possível (validação no servidor)
  segmentFree(L, x0, z0, x1, z1, r) {
    const dist = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.max(1, Math.ceil(dist / 0.15));
    let lvl = L;
    for (let i = 1; i <= steps; i++) {
      const x = x0 + (x1 - x0) * i / steps, z = z0 + (z1 - z0) * i / steps;
      if (!this.circleFree(lvl, x, z, r * 0.8)) return { ok: false, level: lvl };
      lvl = this.resolveLevel(lvl, x, z);
    }
    return { ok: true, level: lvl };
  }
  // Percorre células entre dois pontos (DDA). cb(cx,cz) retorna true para parar.
  walkCells(x0, z0, x1, z1, cb) {
    let cx = cellOf(x0), cz = cellOf(z0);
    const ex = cellOf(x1), ez = cellOf(z1);
    const dx = x1 - x0, dz = z1 - z0;
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDX = dx !== 0 ? Math.abs(CELL / dx) : Infinity;
    const tDZ = dz !== 0 ? Math.abs(CELL / dz) : Infinity;
    let tMX = dx !== 0 ? ((stepX > 0 ? (cx + 1) * CELL - x0 : x0 - cx * CELL) / Math.abs(dx)) : Infinity;
    let tMZ = dz !== 0 ? ((stepZ > 0 ? (cz + 1) * CELL - z0 : z0 - cz * CELL) / Math.abs(dz)) : Infinity;
    let n = 0;
    while (!(cx === ex && cz === ez) && n++ < 400) {
      if (Math.min(tMX, tMZ) > 1 + 1e-9) break;
      if (Math.abs(tMX - tMZ) < 1e-9) {
        // passa exatamente pelo canto: testa as duas vizinhas (evita vazamento diagonal)
        if (cb(cx + stepX, cz) && cb(cx, cz + stepZ)) return true;
        cx += stepX; cz += stepZ; tMX += tDX; tMZ += tDZ;
      } else if (tMX < tMZ) { cx += stepX; tMX += tDX; }
      else { cz += stepZ; tMZ += tDZ; }
      if (cb(cx, cz)) return true;
    }
    return false;
  }
  lineOfSight(L, x0, z0, x1, z1) {
    return !this.walkCells(x0, z0, x1, z1, (cx, cz) => this.blocksSight(L, cx, cz));
  }
  // Sem parede sólida entre dois pontos (usado na checagem de morte — portas fechadas também contam)
  noWallBetween(L, x0, z0, x1, z1) {
    return !this.walkCells(x0, z0, x1, z1, (cx, cz) => {
      const t = this.cell(L, cx, cz);
      return t === T.WALL || t === T.VOID || this.isDoorClosedCell(L, cx, cz);
    });
  }
  // Multiplicador de alcance por obstáculos (paredes, portas fechadas, móveis altos)
  soundAttenuation(L, x0, z0, x1, z1) {
    let walls = 0, doors = 0, talls = 0;
    let prevBlock = false;
    this.walkCells(x0, z0, x1, z1, (cx, cz) => {
      const t = this.cell(L, cx, cz);
      let block = false;
      if (t === T.WALL || t === T.VOID) { if (!prevBlock) walls++; block = true; }
      else if (this.isDoorClosedCell(L, cx, cz)) { if (!prevBlock) doors++; block = true; }
      else if (t === T.TALL) talls++;
      prevBlock = block;
      return false;
    });
    return { walls, doors, talls };
  }
  roomAt(L, x, z) {
    const cx = cellOf(x), cz = cellOf(z);
    if (cx < 0 || cz < 0 || cx >= W || cz >= D) return -1;
    return this.map.levels[L].room[idx(cx, cz)];
  }
  surfaceAt(L, x, z) {
    const r = this.roomAt(L, x, z);
    if (r < 0) return L === 0 ? 'stone' : 'wood';
    return this.map.rooms[r].floor;
  }
}
