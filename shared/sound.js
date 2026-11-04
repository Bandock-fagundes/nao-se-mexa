// Níveis de som da v2 (compartilhado: servidor decide o que a criatura ouve; cliente desenha a onda).
//   VERMELHO → ouvido de qualquer lugar da casa
//   AMARELO  → ouvido no mesmo andar (qualquer lugar) ou no andar logo ABAIXO da origem
//   BAIXO    → ouvido no mesmo cômodo ou num cômodo vizinho (ligado por porta/arco);
//              sons com "below" (rangido, corrida, aterrissagem) também chegam ao cômodo logo abaixo
import { CELL, W, D, T, SOUND_TYPES } from './config.js';

export const LEVEL_INFO = {
  red: { name: 'MUITO ALTO', color: '#ff2a2a', rank: 3 },
  yellow: { name: 'MÉDIO', color: '#ffc21a', rank: 2 },
  low: { name: 'BAIXO', color: '#c8d2dc', rank: 1 },
};
export const soundLevel = (type) => (SOUND_TYPES[type] ? SOUND_TYPES[type].lvl : null);

// Grafo de vizinhança entre cômodos do mesmo andar (calculado uma vez por mapa e guardado fora do hash).
export function roomGraph(map) {
  if (map._roomGraph) return map._roomGraph;
  const adj = map.rooms.map(() => new Set());
  for (let L = 0; L < 4; L++) {
    const lv = map.levels[L];
    const g = (x, z) => (x < 0 || z < 0 || x >= W || z >= D) ? T.VOID : lv.grid[z * W + x];
    const r = (x, z) => (x < 0 || z < 0 || x >= W || z >= D) ? -1 : lv.room[z * W + x];
    for (let z = 1; z < D - 1; z++) for (let x = 1; x < W - 1; x++) {
      const t = g(x, z);
      if (t !== T.DOOR && t !== T.FLOOR && t !== T.CURTAIN && t !== T.STAIR) continue;
      const here = r(x, z);
      // célula de passagem (porta/arco, sem cômodo) liga os dois lados; célula de cômodo liga ao vizinho direto
      for (const [[ax, az], [bx, bz]] of [[[x - 1, z], [x + 1, z]], [[x, z - 1], [x, z + 1]]]) {
        const ra = here >= 0 ? here : r(ax, az), rb = r(bx, bz);
        const rc = here >= 0 ? r(ax, az) : -1;
        for (const [p, q] of [[ra, rb], [here, rc]]) if (p >= 0 && q >= 0 && p !== q) { adj[p].add(q); adj[q].add(p); }
      }
    }
  }
  Object.defineProperty(map, '_roomGraph', { value: adj, enumerable: false });
  return adj;
}

// Cômodo de um ponto; em portas/arcos (sem cômodo) usa o cômodo mais próximo em até 3 células.
export function roomNear(map, L, x, z) {
  const lv = map.levels[L]; if (!lv) return -1;
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  for (let rad = 0; rad <= 3; rad++) for (let a = -rad; a <= rad; a++) for (let b = -rad; b <= rad; b++) {
    if (Math.max(Math.abs(a), Math.abs(b)) !== rad) continue;
    const xx = cx + a, zz = cz + b; if (xx < 0 || zz < 0 || xx >= W || zz >= D) continue;
    const id = lv.room[zz * W + xx]; if (id >= 0) return id;
  }
  return -1;
}

// O som (tipo/nível + posição/andar) alcança um ouvinte (andar + posição)?
// Retorna { heard, why } — why é usado no diagnóstico e nos testes.
export function soundReaches(map, ev, lis) {
  const lvl = ev.lvl !== undefined ? ev.lvl : soundLevel(ev.type);
  if (!lvl) return { heard: false, why: 'silencioso' };
  if (lvl === 'red') return { heard: true, why: 'vermelho: casa inteira' };
  if (lvl === 'yellow') {
    if (lis.level === ev.level) return { heard: true, why: 'amarelo: mesmo andar' };
    if (lis.level === ev.level - 1) return { heard: true, why: 'amarelo: andar logo abaixo' };
    return { heard: false, why: 'amarelo: outro andar' };
  }
  // baixo
  const st = SOUND_TYPES[ev.type] || {};
  const dist = Math.hypot(ev.x - lis.x, ev.z - lis.z);
  if (lis.level === ev.level) {
    if (dist < 3) return { heard: true, why: 'baixo: bem perto' };
    if (dist > 18) return { heard: false, why: 'baixo: longe demais' };
    const ra = roomNear(map, ev.level, ev.x, ev.z), rb = roomNear(map, lis.level, lis.x, lis.z);
    if (ra < 0 || rb < 0) return { heard: dist < 6, why: 'baixo: passagem' };
    if (ra === rb) return { heard: true, why: 'baixo: mesmo cômodo' };
    if (roomGraph(map)[ra].has(rb)) return { heard: true, why: 'baixo: cômodo vizinho' };
    return { heard: false, why: 'baixo: cômodo distante' };
  }
  if ((ev.below || st.below) && lis.level === ev.level - 1 && dist < 5.5) return { heard: true, why: 'baixo: logo abaixo' };
  return { heard: false, why: 'baixo: outro andar' };
}
