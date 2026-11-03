// Grade de rastros de cheiro: células de 1 m por andar, decaimento exponencial,
// conjunto ativo limitado (memória fixa: 4 andares × 42 × 25 células).
import { W, D, CELL, AI } from '../shared/config.js';

export const SCENT_CELL = 1.0;
const SW = Math.ceil(W * CELL / SCENT_CELL), SD = Math.ceil(D * CELL / SCENT_CELL);

export class ScentGrid {
  constructor(halfLife = AI.scentHalfLife) {
    this.halfLife = halfLife;
    this.i0 = new Float32Array(4 * SW * SD);
    this.t0 = new Float32Array(4 * SW * SD);
    this.firstT = new Float32Array(4 * SW * SD);
    this.active = new Set();
    this.lastPrune = 0;
  }
  key(L, x, z) {
    const sx = Math.max(0, Math.min(SW - 1, Math.floor(x / SCENT_CELL))), sz = Math.max(0, Math.min(SD - 1, Math.floor(z / SCENT_CELL)));
    return L * SW * SD + sz * SW + sx;
  }
  decode(k) { const L = Math.floor(k / (SW * SD)), r = k % (SW * SD); return { L, x: (r % SW + 0.5) * SCENT_CELL, z: (Math.floor(r / SW) + 0.5) * SCENT_CELL }; }
  valueAt(k, t) {
    if (!this.active.has(k)) return 0;
    return this.i0[k] * Math.pow(0.5, (t - this.t0[k]) / this.halfLife);
  }
  value(L, x, z, t) { return this.valueAt(this.key(L, x, z), t); }
  deposit(L, x, z, amount, t) {
    const k = this.key(L, x, z);
    const cur = this.valueAt(k, t);
    if (!this.active.has(k)) this.firstT[k] = t;
    this.i0[k] = Math.min(1, cur + amount);
    this.t0[k] = t;
    this.active.add(k);
  }
  prune(t) {
    for (const k of this.active) if (this.valueAt(k, t) < 0.02) this.active.delete(k);
    this.lastPrune = t;
  }
  entries(t) {
    const out = [];
    for (const k of this.active) { const v = this.valueAt(k, t); if (v >= 0.02) out.push({ k, v, t: this.t0[k], ...this.decode(k) }); }
    return out;
  }
  get size() { return this.active.size; }
}
