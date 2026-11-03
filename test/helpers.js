// Utilidades dos testes: partidas controladas e localização de trechos do mapa.
import { Match } from '../server/match.js';
import { CELL, T, W, D, ROWS, PLAYER } from '../shared/config.js';

export function makeMatch(phase = 1, seed = 'teste-1', nPlayers = 1) {
  const players = [];
  for (let i = 0; i < nPlayers; i++) players.push({ id: 'p' + (i + 1), name: 'J' + (i + 1) });
  const m = new Match({ seed, phase, players, test: true });
  // estaciona a criatura (estado de teste "hold") para cenários controlados
  m.creature.setState('hold', 999);
  if (m.phaseCfg.smell) m.creature.nextSniffT = Infinity;
  return m;
}
export const cc = (c) => (c + 0.5) * CELL;
// trecho reto e livre do corredor do térreo (linha central), sem portas nem móveis
export function clearCorridor(m, L = 1, len = 30) {
  const lv = m.map.levels[L];
  for (const row of [ROWS.corrA + 1, ROWS.corrA + 2]) {
    let start = null;
    for (let x = lv.fx0; x <= lv.fx1; x++) {
      let ok = true;
      for (let dz = -1; dz <= 1; dz++) { const t = lv.grid[(row + dz) * W + x]; if (t !== T.FLOOR) ok = false; }
      if (ok) { if (start === null) start = x; if (x - start + 1 >= len + 4) return { L, z: cc(row) + 0.25, x0: cc(start + 2), x1: cc(x - 2), row }; }
      else start = null;
    }
  }
  return null;
}
// coluna onde a parede sul do corredor é sólida (sem porta) com sala livre atrás
export function wallSpot(m, L = 1) {
  const lv = m.map.levels[L], g = (x, z) => lv.grid[z * W + x];
  for (let x = lv.fx0 + 4; x < lv.fx1 - 4; x++) {
    let ok = true;
    for (let k = -3; k <= 3; k++) if (g(x + k, ROWS.wallS) !== T.WALL) ok = false;
    for (let k = -1; k <= 1; k++) for (const z of [ROWS.wallS - 1, ROWS.wallS - 2]) if (g(x + k, z) !== T.FLOOR) ok = false;
    for (let k = -2; k <= 2; k++) for (const z of [ROWS.corrA, ROWS.corrA + 1, ROWS.corrA + 2]) if (g(x + k, z) !== T.FLOOR) ok = false;
    if (ok) return { L, x: cc(x), zRoom: cc(ROWS.wallS - 1), zCorr: cc(ROWS.corrA) };
  }
  return null;
}
// célula navegável a uma distância de caminho entre a e b metros de um ponto
export function navAtDistance(m, L, x, z, a, b) {
  const d = m.nav.pathDistances(L, x, z, b + 1);
  for (const [k, dist] of d) {
    if (dist < a || dist > b) continue;
    const LL = Math.floor(k / (W * D)), i = k % (W * D), cx = i % W, cz = Math.floor(i / W);
    if (LL === L && m.nav.walkable(L, cx, cz)) return { x: cc(cx), z: cc(cz), dist };
  }
  return null;
}

// avança a simulação; opcionalmente move um jogador a velocidade constante (entrada validada)
export function run(m, seconds, mover) {
  const dt = 0.05; const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) { if (mover) mover(m.t, dt); m.tick(dt); }
}
export function stepPlayer(m, id, vx, vz, dt, extra = {}) {
  const p = m.players.get(id);
  const r = m.world.move(p.level, p.x, p.z, vx * dt, vz * dt, PLAYER.radius);
  return m.applyInput(id, { x: r.x, z: r.z, yaw: p.yaw, pitch: p.pitch, fl: extra.fl ?? p.flashlight, crouch: !!extra.crouch, run: !!extra.run });
}
export function strafe(m, id, speed = 1.6, amp = 0.5, extra = {}) {
  // anda de um lado para o outro no lugar (movimento real do corpo)
  return (t, dt) => stepPlayer(m, id, 0, Math.sin(t * speed / amp) * speed, dt, extra);
}
