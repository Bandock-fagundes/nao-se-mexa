// v9b: plano de tetos (compartilhado entre o render e os testes).
// Regra: toda célula andável/aberta (não WALL/VOID) tem um teto acima — no próprio andar — a não ser que a célula
// de cima seja a continuação de uma abertura de escada que SOBE deste andar (HOLE do andar de cima, ou STAIR do
// andar de cima pertencente a uma escada cujo andar de baixo é este). Nesse caso a cobertura é a do andar de cima
// (que por sua vez tem teto). No sótão (andar 3) a "cobertura" é o telhado de duas águas.
// Antes da v9b as células HOLE e STAIR nunca recebiam teto → poço de escada aberto para o céu.
import { T, W, D } from './config.js';

export function openAbove(map, L, x, z) {
  if (L >= 3) return false;
  const i = z * W + x, up = map.levels[L + 1];
  const t = up.grid[i];
  if (t === T.HOLE) return true;
  if (t === T.STAIR) { const s = map.stairs[up.stair[i]]; return !!s && s.lower === L; }
  return false;
}

// devolve [Uint8Array(W*D) × 4]: 1 = teto (ou telhado, no sótão) sobre a célula neste andar
export function ceilingPlan(map) {
  const out = [];
  for (let L = 0; L < 4; L++) {
    const g = map.levels[L].grid, c = new Uint8Array(W * D);
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
      const t = g[z * W + x];
      if (t === T.WALL || t === T.VOID) continue;
      if (!openAbove(map, L, x, z)) c[z * W + x] = 1;
    }
    out.push(c);
  }
  return out;
}

// sótão: caixa do telhado (células internas), cumeeira ao longo de X no meio de Z
export function atticRoofBox(map) {
  const lv = map.levels[3];
  let x0 = W, x1 = -1, z0 = D, z1 = -1;
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) { const t = lv.grid[z * W + x]; if (t !== T.VOID) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; } }
  return x1 < 0 ? null : { x0, x1, z0, z1 }; // inclui as paredes externas
}

// verificação usada pelo teste: lista de células descobertas
export function ceilingGaps(map) {
  const plan = ceilingPlan(map), gaps = [];
  for (let L = 0; L < 4; L++) {
    const g = map.levels[L].grid;
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
      const t = g[z * W + x]; if (t === T.WALL || t === T.VOID) continue;
      let k = L, ok = false;
      while (k < 4) { if (plan[k][z * W + x]) { ok = true; break; } if (!openAbove(map, k, x, z)) break; k++; if (k < 4 && map.levels[k].grid[z * W + x] === T.VOID) break; }
      if (!ok) gaps.push({ L, x, z, t });
    }
  }
  return gaps;
}
