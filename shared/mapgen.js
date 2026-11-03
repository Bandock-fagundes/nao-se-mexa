// Gerador procedural controlado da mansão (determinístico por semente + versão).
// Mesmo módulo é usado pelo servidor e pelo cliente.
import { makeRng, hashString } from './rng.js';
import { GEN_VERSION, FALLBACK_SEED, CELL, W, D, ROWS, STAIR_LEN, STAIR_W, STAIR_SLOT, LEVELS, T } from './config.js';

export const ROOM_INFO = {
  hall: { name: 'Hall de entrada', floor: 'wood', wall: 'red' },
  living: { name: 'Sala principal', floor: 'wood', wall: 'green' },
  dining: { name: 'Sala de jantar', floor: 'wood', wall: 'red' },
  kitchen: { name: 'Cozinha', floor: 'tile', wall: 'plain' },
  pantry: { name: 'Despensa', floor: 'stone', wall: 'plain' },
  study: { name: 'Escritório', floor: 'wood', wall: 'green' },
  bedroom: { name: 'Quarto', floor: 'carpet', wall: 'blue' },
  master: { name: 'Quarto principal', floor: 'carpet', wall: 'red' },
  bathroom: { name: 'Banheiro', floor: 'tile', wall: 'tile' },
  music: { name: 'Sala de música', floor: 'wood', wall: 'gold' },
  library: { name: 'Biblioteca (sala adicional)', floor: 'wood', wall: 'green' },
  nursery: { name: 'Quarto infantil', floor: 'carpet', wall: 'gold' },
  linen: { name: 'Rouparia', floor: 'wood', wall: 'plain' },
  storage: { name: 'Depósito', floor: 'wood', wall: 'plain' },
  corridor: { name: 'Corredor', floor: 'wood', wall: 'red' },
  stairs: { name: 'Escadaria', floor: 'wood', wall: 'red' },
  cellar: { name: 'Adega', floor: 'stone', wall: 'stone' },
  boiler: { name: 'Casa da caldeira', floor: 'stone', wall: 'stone' },
  laundry: { name: 'Lavanderia', floor: 'stone', wall: 'stone' },
  bstorage: { name: 'Depósito do porão', floor: 'stone', wall: 'stone' },
  attic: { name: 'Sótão', floor: 'wood', wall: 'attic' },
};

// Móveis: w = largura ao longo da parede, d = profundidade (células de 0,5 m)
const F = (kind, w, d, block, n, opts = {}) => ({ kind, w, d, block, n, p: 1, place: 'wall', ...opts });
const TEMPLATES = {
  hall: [F('cabinet', 2, 1, 'TALL', [1, 1], { container: 'wardrobe' }), F('console', 3, 1, 'LOW', [1, 2], { container: 'drawer' }), F('clock', 1, 1, 'TALL', [1, 1]), F('bench', 3, 1, 'LOW', [0, 1]), F('plant', 1, 1, 'LOW', [1, 2])],
  living: [F('fireplace', 4, 1, 'TALL', [1, 1]), F('bookshelf', 3, 1, 'TALL', [1, 2], { container: 'shelf' }), F('sofa', 4, 2, 'LOW', [1, 1]), F('armchair', 2, 2, 'LOW', [1, 2]), F('coffee_table', 3, 2, 'LOW', [1, 1], { place: 'center' }), F('cabinet', 2, 1, 'TALL', [0, 1], { container: 'wardrobe' }), F('side_table', 1, 1, 'LOW', [1, 1], { container: 'drawer' }), F('plant', 1, 1, 'LOW', [0, 1])],
  dining: [F('dining_table', 8, 4, 'LOW', [1, 1], { place: 'center' }), F('sideboard', 4, 1, 'LOW', [1, 1], { container: 'drawer' }), F('china_cabinet', 3, 1, 'TALL', [1, 1], { container: 'cabinet' }), F('plant', 1, 1, 'LOW', [0, 2]), F('clock', 1, 1, 'TALL', [0, 1])],
  kitchen: [F('counter', 3, 1, 'LOW', [2, 3], { container: 'cabinet' }), F('stove', 2, 1, 'LOW', [1, 1]), F('kshelf', 3, 1, 'TALL', [1, 1], { container: 'shelf' }), F('ktable', 4, 3, 'LOW', [1, 1], { place: 'center' }), F('barrel', 1, 1, 'LOW', [0, 1])],
  pantry: [F('pshelf', 3, 1, 'TALL', [2, 3], { container: 'shelf' }), F('crate', 2, 2, 'LOW', [1, 2], { container: 'crate' }), F('barrel', 1, 1, 'LOW', [1, 2]), F('sack', 1, 1, 'LOW', [1, 2])],
  study: [F('desk', 3, 2, 'LOW', [1, 1], { container: 'drawer' }), F('bookshelf', 3, 1, 'TALL', [2, 3], { container: 'shelf' }), F('cabinet', 2, 1, 'TALL', [0, 1], { container: 'wardrobe' }), F('chest', 2, 1, 'LOW', [0, 1], { container: 'chest' }), F('globe', 1, 1, 'LOW', [0, 1]), F('armchair', 2, 2, 'LOW', [0, 1])],
  bedroom: [F('bed', 3, 4, 'LOW', [1, 1]), F('wardrobe', 3, 1, 'TALL', [1, 1], { container: 'wardrobe' }), F('nightstand', 1, 1, 'LOW', [1, 2], { container: 'drawer' }), F('dresser', 3, 1, 'LOW', [0, 1], { container: 'drawer' }), F('chest', 2, 1, 'LOW', [0, 1], { container: 'chest' }), F('armchair', 2, 2, 'LOW', [0, 1])],
  master: [F('bed_big', 4, 5, 'LOW', [1, 1]), F('wardrobe', 3, 1, 'TALL', [1, 2], { container: 'wardrobe' }), F('nightstand', 1, 1, 'LOW', [2, 2], { container: 'drawer' }), F('dresser', 3, 1, 'LOW', [1, 1], { container: 'drawer' }), F('chest', 2, 1, 'LOW', [0, 1], { container: 'chest' }), F('armchair', 2, 2, 'LOW', [0, 1])],
  bathroom: [F('bathtub', 4, 2, 'LOW', [1, 1]), F('sink', 2, 1, 'LOW', [1, 1], { container: 'cabinet' }), F('toilet', 1, 1, 'LOW', [1, 1]), F('bcabinet', 2, 1, 'TALL', [0, 1], { container: 'cabinet' })],
  music: [F('piano', 4, 3, 'LOW', [1, 1]), F('armchair', 2, 2, 'LOW', [1, 2]), F('bookshelf', 3, 1, 'TALL', [1, 1], { container: 'shelf' }), F('cabinet', 2, 1, 'TALL', [0, 1], { container: 'wardrobe' }), F('side_table', 1, 1, 'LOW', [0, 1], { container: 'drawer' })],
  library: [F('bookshelf', 3, 1, 'TALL', [3, 5], { container: 'shelf' }), F('reading_table', 3, 2, 'LOW', [1, 1], { place: 'center', container: 'drawer' }), F('armchair', 2, 2, 'LOW', [1, 2]), F('globe', 1, 1, 'LOW', [0, 1])],
  nursery: [F('crib', 3, 2, 'LOW', [1, 1]), F('chest', 2, 1, 'LOW', [1, 1], { container: 'chest' }), F('rocking_horse', 1, 2, 'LOW', [0, 1]), F('wardrobe', 3, 1, 'TALL', [1, 1], { container: 'wardrobe' }), F('dresser', 3, 1, 'LOW', [0, 1], { container: 'drawer' })],
  linen: [F('wardrobe', 3, 1, 'TALL', [2, 3], { container: 'wardrobe' }), F('pshelf', 3, 1, 'TALL', [0, 1], { container: 'shelf' }), F('chest', 2, 1, 'LOW', [0, 1], { container: 'chest' })],
  storage: [F('crate', 2, 2, 'LOW', [2, 4], { container: 'crate' }), F('pshelf', 3, 1, 'TALL', [1, 2], { container: 'shelf' }), F('sheet', 2, 2, 'LOW', [1, 2]), F('chest', 2, 1, 'LOW', [0, 1], { container: 'chest' })],
  cellar: [F('winerack', 3, 1, 'TALL', [2, 4], { container: 'shelf' }), F('barrel_big', 2, 2, 'LOW', [2, 3]), F('crate', 2, 2, 'LOW', [1, 2], { container: 'crate' })],
  boiler: [F('boiler', 3, 3, 'TALL', [1, 1]), F('mshelf', 3, 1, 'TALL', [1, 2], { container: 'shelf' }), F('chest', 2, 1, 'LOW', [1, 1], { container: 'chest' }), F('crate', 2, 2, 'LOW', [0, 2], { container: 'crate' })],
  laundry: [F('washtub', 2, 1, 'LOW', [1, 2]), F('mshelf', 3, 1, 'TALL', [1, 2], { container: 'shelf' }), F('crate', 2, 2, 'LOW', [1, 2], { container: 'crate' }), F('sack', 1, 1, 'LOW', [1, 2])],
  bstorage: [F('crate', 2, 2, 'LOW', [2, 4], { container: 'crate' }), F('mshelf', 3, 1, 'TALL', [1, 3], { container: 'shelf' }), F('chest', 2, 1, 'LOW', [0, 1], { container: 'chest' }), F('barrel', 1, 1, 'LOW', [0, 2])],
  attic: [F('crate', 2, 2, 'LOW', [3, 5], { container: 'crate' }), F('sheet', 2, 2, 'LOW', [1, 3]), F('oldwardrobe', 3, 1, 'TALL', [1, 1], { container: 'wardrobe' }), F('chest', 2, 1, 'LOW', [1, 2], { container: 'chest' }), F('mannequin', 1, 1, 'TALL', [0, 1]), F('rocking_chair', 2, 2, 'LOW', [0, 1])],
  corridor: [F('console', 3, 1, 'LOW', [1, 3], { container: 'drawer' }), F('plant', 1, 1, 'LOW', [1, 3]), F('clock', 1, 1, 'TALL', [0, 1])],
  stairs: [],
  bcorridor: [F('mshelf', 3, 1, 'TALL', [1, 2], { container: 'shelf' }), F('barrel', 1, 1, 'LOW', [1, 2])],
  acorridor: [F('crate', 2, 1, 'LOW', [1, 2], { container: 'crate' }), F('sheet', 2, 1, 'LOW', [1, 2])],
};

const KNOCK_KINDS = ['vase', 'vase', 'bottles', 'candelabrum', 'bucket', 'box', 'box'];
const DOOR_TYPES = ['wood', 'wood', 'wood', 'heavy', 'rusty'];

export const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const ix = (cx, cz) => cz * W + cx;

function mkLevel() {
  return {
    grid: new Uint8Array(W * D), room: new Int16Array(W * D).fill(-1),
    door: new Int16Array(W * D).fill(-1), stair: new Int16Array(W * D).fill(-1),
    fx0: 1, fx1: W - 2,
  };
}

// ---------------- geração ----------------
function chooseStairs(rng) {
  const labels = ['B', 'U1', 'U2', 'A'];
  for (let tries = 0; tries < 400; tries++) {
    const xs = labels.map(() => rng.int(1, W - 2 - (STAIR_SLOT - 1)));
    const order = labels.map((l, i) => ({ l, x: xs[i] })).sort((a, b) => a.x - b.x);
    let ok = true;
    for (let i = 1; i < order.length; i++) {
      const g = order[i].x - order[i - 1].x;
      if (!(g === STAIR_SLOT + 1 || g >= STAIR_SLOT + 10)) { ok = false; break; }
    }
    if (!ok) continue;
    const pos = Object.fromEntries(order.map(o => [o.l, o.x]));
    if (Math.abs(pos.U1 - pos.U2) < 24) continue;
    if (!runsFor([{ x: pos.B }, { x: pos.U1 }, { x: pos.U2 }], 1, W - 2)) continue;
    if (!runsFor([{ x: pos.U1 }, { x: pos.U2 }, { x: pos.A }], 1, W - 2)) continue;
    return pos;
  }
  return null;
}

// Checa se as faixas livres entre slots fixos de um andar têm largura 0 ou >= 8
function runsFor(slots, fx0, fx1) {
  const s = slots.slice().sort((a, b) => a.x - b.x);
  const runs = [];
  let cur = fx0;
  for (const sl of s) {
    const leftWall = sl.x - 1, rightWall = sl.x + STAIR_SLOT;
    if (leftWall < fx0 - 1 || rightWall > fx1 + 1) return null;
    if (leftWall < cur - 1) return null;
    if (leftWall - 1 >= cur) runs.push([cur, leftWall - 1]);
    cur = rightWall + 1;
  }
  if (fx1 >= cur) runs.push([cur, fx1]);
  for (const r of runs) if (r[1] - r[0] + 1 < 8) return null;
  return runs;
}

function splitWidths(rng, total, prefs) {
  // prefs: [[min,max],...]; total colunas incluindo partições entre salas (n-1)
  const n = prefs.length;
  const avail = total - (n - 1);
  let ws = prefs.map(([a, b]) => rng.int(a, b));
  let sum = ws.reduce((a, b) => a + b, 0);
  let guard = 0;
  while (sum !== avail && guard++ < 2000) {
    const i = rng.int(0, n - 1);
    if (sum < avail) { ws[i]++; sum++; }
    else if (ws[i] > 8) { ws[i]--; sum--; }
  }
  return sum === avail ? ws : null;
}

function splitRun(rng, a, b) {
  const n = b - a + 1;
  if (n <= 18) return [[a, b]];
  const k = Math.ceil((n + 1) / 17);
  const ws = splitWidths(rng, n, new Array(k).fill([8, 16]));
  if (!ws) return [[a, b]];
  const out = []; let c = a;
  for (const w of ws) { out.push([c, c + w - 1]); c += w + 1; }
  return out;
}

class Gen {
  constructor(seed, attempt) {
    this.rng = makeRng(hashString(seed + '|' + GEN_VERSION + '|' + attempt));
    this.map = {
      seed: String(seed), version: GEN_VERSION, attempt,
      levels: [mkLevel(), mkLevel(), mkLevel(), mkLevel()],
      rooms: [], doors: [], stairs: [], props: [], containers: [], knockables: [],
      lamps: [], windows: [], decor: [], spawns: [], creatureSpawn: null, exit: null,
    };
    this.reserved = [new Uint8Array(W * D), new Uint8Array(W * D), new Uint8Array(W * D), new Uint8Array(W * D)];
  }
  set(L, cx, cz, t) { this.map.levels[L].grid[ix(cx, cz)] = t; }
  get(L, cx, cz) { if (cx < 0 || cz < 0 || cx >= W || cz >= D) return T.VOID; return this.map.levels[L].grid[ix(cx, cz)]; }
  rect(L, x0, z0, x1, z1, t) { for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(L, x, z, t); }
  addRoom(L, type, x0, z0, x1, z1, extra = {}) {
    const info = ROOM_INFO[type];
    const r = { id: this.map.rooms.length, level: L, type, name: info.name, floor: info.floor, wall: info.wall, x0, z0, x1, z1, ...extra };
    if (L === 0 && type !== 'stairs') { r.floor = 'stone'; r.wall = 'stone'; }
    if (L === 0 && type === 'stairs') { r.floor = 'stone'; r.wall = 'stone'; }
    if (L === 3) { r.floor = 'wood'; r.wall = 'attic'; }
    this.map.rooms.push(r);
    const lv = this.map.levels[L];
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) { const i = ix(x, z); if (lv.grid[i] === T.FLOOR || lv.grid[i] === T.STAIR) lv.room[i] = r.id; }
    return r;
  }
  addDoor(L, cells, axis, opts = {}) {
    const lv = this.map.levels[L];
    if (opts.arch) { for (const [x, z] of cells) { lv.grid[ix(x, z)] = T.FLOOR; } return null; }
    const id = this.map.doors.length;
    const type = opts.type || this.rng.pick(L === 0 ? ['rusty', 'rusty', 'heavy', 'wood'] : DOOR_TYPES);
    const cx = cells.reduce((s, c) => s + c[0], 0) / cells.length, cz = cells.reduce((s, c) => s + c[1], 0) / cells.length;
    const d = {
      id, level: L, cells, axis, type, x: (cx + 0.5) * CELL, z: (cz + 0.5) * CELL,
      initialOpen: opts.open !== undefined ? opts.open : this.rng.chance(0.45),
      hinge: this.rng.chance(0.5) ? 1 : -1, swing: this.rng.chance(0.5) ? 1 : -1, corridor: !!opts.corridor,
    };
    for (const [x, z] of cells) { lv.grid[ix(x, z)] = T.DOOR; lv.door[ix(x, z)] = id; }
    this.map.doors.push(d);
    // reserva área de abertura (ambos os lados)
    for (const [x, z] of cells) for (let k = -3; k <= 3; k++) for (let j = -1; j <= 1; j++) {
      const xx = axis === 'z' ? x + j : x + k, zz = axis === 'z' ? z + k : z + j;
      if (xx >= 0 && zz >= 0 && xx < W && zz < D) this.reserved[L][ix(xx, zz)] = 1;
    }
    return d;
  }
  reserveAround(L, cells, depth, axis) {
    for (const [x, z] of cells) for (let k = -depth; k <= depth; k++) for (let j = -1; j <= 1; j++) {
      const xx = axis === 'z' ? x + j : x + k, zz = axis === 'z' ? z + k : z + j;
      if (xx >= 0 && zz >= 0 && xx < W && zz < D) this.reserved[L][ix(xx, zz)] = 1;
    }
  }

  build() {
    const rng = this.rng, m = this.map;
    const st = chooseStairs(rng);
    if (!st) return null;
    this.stairPos = st;
    // pegadas (footprints) de cada andar
    const fp = [null, [1, W - 2], [1, W - 2], null];
    for (let t = 0; t < 60 && !fp[0]; t++) {
      const w = rng.int(40, 50); let x0 = st.B - rng.int(4, w - STAIR_SLOT - 4);
      x0 = Math.max(1, Math.min(W - 2 - w + 1, x0));
      const f = [x0, x0 + w - 1];
      if (runsFor([{ x: st.B }], f[0], f[1])) fp[0] = f;
    }
    for (let t = 0; t < 60 && !fp[3]; t++) {
      const w = rng.int(36, 46); let x0 = st.A - rng.int(4, w - STAIR_SLOT - 4);
      x0 = Math.max(1, Math.min(W - 2 - w + 1, x0));
      const f = [x0, x0 + w - 1];
      if (runsFor([{ x: st.A }], f[0], f[1])) fp[3] = f;
    }
    if (!fp[0] || !fp[3]) return null;
    // slots fixos de escada por andar
    const slots = [
      [{ x: st.B, s: 'B', side: 'lower' }],
      [{ x: st.B, s: 'B', side: 'upper' }, { x: st.U1, s: 'U1', side: 'lower' }, { x: st.U2, s: 'U2', side: 'lower' }],
      [{ x: st.U1, s: 'U1', side: 'upper' }, { x: st.U2, s: 'U2', side: 'upper' }, { x: st.A, s: 'A', side: 'lower' }],
      [{ x: st.A, s: 'A', side: 'upper' }],
    ];
    const northRuns = [];
    for (let L = 0; L < 4; L++) {
      const r = runsFor(slots[L], fp[L][0], fp[L][1]);
      if (!r) return null;
      northRuns.push(r);
    }
    // escadas (lado da passagem escolhido por semente)
    const stairDefs = { B: [0, 1], U1: [1, 2], U2: [1, 2], A: [2, 3] };
    const stairObj = {};
    for (const k of ['B', 'U1', 'U2', 'A']) {
      const x = st[k];
      const left = rng.chance(0.5);
      const sx0 = left ? x : x + 4; // colunas da rampa
      const s = { id: m.stairs.length, key: k, lower: stairDefs[k][0], upper: stairDefs[k][1], x0: sx0, w: STAIR_W, zTop: ROWS.northA, zBot: ROWS.northA + STAIR_LEN - 1, slotX: x, stringer: x + 3, walk0: left ? x + 4 : x };
      m.stairs.push(s); stairObj[k] = s;
    }
    this.stairObj = stairObj;

    const southPlans = {
      1: () => {
        const others = ['living', 'diningKitchen', 'studyBath'];
        rng.shuffle(others);
        const seq = others.slice();
        seq.splice(rng.int(1, 2), 0, 'hall');
        // expande dining+kitchen (adjacentes)
        const out = [];
        for (const s of seq) {
          if (s === 'diningKitchen') { if (rng.chance(0.5)) out.push('dining', 'kitchen|pantry'); else out.push('kitchen|pantry', 'dining'); }
          else if (s === 'studyBath') out.push(rng.chance(0.5) ? 'study|bathroom' : 'bathroom|study');
          else out.push(s);
        }
        return out;
      },
      2: () => rng.shuffle(['master|bathroom', 'bedroom', 'library', rng.chance(0.5) ? 'nursery' : 'bedroom', 'bathroom|bedroom']),
      0: () => rng.shuffle(['cellar', 'boiler', 'bstorage']),
      3: () => rng.shuffle(['attic', 'attic', 'attic']),
    };
    const northQueues = {
      0: ['laundry', 'bstorage', 'cellar'],
      1: rng.shuffle(['bedroom', 'bathroom', 'music', 'storage', 'study']),
      2: rng.shuffle(['bedroom', 'bathroom', 'linen', 'storage', 'bedroom']),
      3: ['attic', 'attic', 'attic'],
    };
    const PREF = { hall: [14, 18], living: [14, 18], dining: [12, 16], 'kitchen|pantry': [12, 15], 'study|bathroom': [12, 16], 'bathroom|study': [12, 16], 'master|bathroom': [14, 18], bedroom: [10, 14], library: [12, 16], nursery: [10, 13], 'bathroom|bedroom': [10, 13], cellar: [10, 16], boiler: [10, 14], bstorage: [10, 16], attic: [10, 14] };

    for (let L = 0; L < 4; L++) {
      const [fx0, fx1] = fp[L];
      const lv = m.levels[L]; lv.fx0 = fx0; lv.fx1 = fx1;
      this.rect(L, fx0 - 1, 0, fx1 + 1, D - 1, T.WALL);
      this.rect(L, fx0, 1, fx1, D - 2, T.FLOOR);
      this.rect(L, fx0, ROWS.wallS, fx1, ROWS.wallS, T.WALL);
      this.rect(L, fx0, ROWS.wallN, fx1, ROWS.wallN, T.WALL);
      const corr = this.addRoom(L, 'corridor', fx0, ROWS.corrA, fx1, ROWS.corrB);
      // ---- faixa sul ----
      const plan = southPlans[L]();
      const ws = splitWidths(rng, fx1 - fx0 + 1, plan.map(p => PREF[p] || [10, 14]));
      if (!ws) return null;
      let c = fx0;
      const southRooms = [];
      plan.forEach((p, i) => {
        const x0 = c, x1 = c + ws[i] - 1;
        if (i < plan.length - 1) this.rect(L, x1 + 1, ROWS.southA, x1 + 1, ROWS.southB, T.WALL);
        c = x1 + 2;
        if (p.includes('|')) {
          const [back, front] = p.split('|');
          const zs = rng.int(11, 15);
          this.rect(L, x0, zs, x1, zs, T.WALL);
          const rb = this.addRoom(L, back, x0, zs + 1, x1, ROWS.southB);
          const rf = this.addRoom(L, front, x0, ROWS.southA, x1, zs - 1);
          southRooms.push(rb, rf);
          // porta entre frente e fundo
          const dx = rng.int(x0 + 1, x1 - 3);
          this.addDoor(L, [[dx, zs], [dx + 1, zs], [dx + 2, zs]], 'z');
          rb.split = rf.id;
        } else {
          southRooms.push(this.addRoom(L, p, x0, ROWS.southA, x1, ROWS.southB));
        }
      });
      // ---- faixa norte ----
      const q = northQueues[L].slice();
      const northRooms = [];
      for (const [a, b] of northRuns[L]) {
        const parts = splitRun(rng, a, b);
        parts.forEach(([x0, x1], i) => {
          if (i < parts.length - 1) this.rect(L, x1 + 1, ROWS.northA, x1 + 1, ROWS.northB, T.WALL);
          const type = q.length ? q.shift() : (L === 3 ? 'attic' : L === 0 ? 'bstorage' : 'storage');
          northRooms.push(this.addRoom(L, type, x0, ROWS.northA, x1, ROWS.northB));
        });
      }
      // ---- slots de escada ----
      for (const sl of slots[L]) {
        const s = stairObj[sl.s];
        // paredes do slot
        if (sl.x - 1 >= fx0) this.rect(L, sl.x - 1, ROWS.northA, sl.x - 1, ROWS.northB, T.WALL);
        if (sl.x + STAIR_SLOT <= fx1) this.rect(L, sl.x + STAIR_SLOT, ROWS.northA, sl.x + STAIR_SLOT, ROWS.northB, T.WALL);
        if (sl.side === 'lower') {
          this.rect(L, sl.x, ROWS.northA, sl.x + STAIR_SLOT - 1, ROWS.northB, T.FLOOR);
          this.rect(L, s.stringer, s.zTop, s.stringer, s.zBot, T.WALL);
          for (let z = s.zTop; z <= s.zBot; z++) for (let x = s.x0; x < s.x0 + STAIR_W; x++) { this.set(L, x, z, T.STAIR); lv.stair[ix(x, z)] = s.id; }
          const r = this.addRoom(L, 'stairs', sl.x, ROWS.northA, sl.x + STAIR_SLOT - 1, ROWS.northB, { stair: s.id });
          // arco do corredor para a passagem
          const arch = [[s.walk0, ROWS.wallN], [s.walk0 + 1, ROWS.wallN], [s.walk0 + 2, ROWS.wallN]];
          this.addDoor(L, arch, 'z', { arch: true });
          this.reserveAround(L, arch, 3, 'z');
          for (let z = ROWS.northA; z <= ROWS.northB; z++) for (let x = sl.x; x < sl.x + STAIR_SLOT; x++) this.reserved[L][ix(x, z)] = 1;
          r.archCells = arch;
        } else {
          this.rect(L, sl.x, ROWS.northA, sl.x + STAIR_SLOT - 1, ROWS.northB, T.HOLE);
          for (let z = s.zTop; z <= s.zBot; z++) for (let x = s.x0; x < s.x0 + STAIR_W; x++) { this.set(L, x, z, T.STAIR); lv.stair[ix(x, z)] = s.id; }
          const r = this.addRoom(L, 'stairs', s.x0, s.zTop, s.x0 + STAIR_W - 1, s.zBot, { stair: s.id, top: true });
          const arch = [[s.x0, ROWS.wallN], [s.x0 + 1, ROWS.wallN], [s.x0 + 2, ROWS.wallN]];
          this.addDoor(L, arch, 'z', { arch: true });
          this.reserveAround(L, arch, 3, 'z');
          r.archCells = arch;
        }
      }
      // ---- portas para o corredor ----
      const corridorDoorCols = [];
      for (const s of slots[L]) { const so = stairObj[s.s]; corridorDoorCols.push(s.side === 'lower' ? so.walk0 : so.x0); }
      const southCorr = southRooms.filter(r => r.z1 === ROWS.southB);
      for (const r of southCorr) {
        if (r.type === 'hall') {
          const aw = Math.min(8, r.x1 - r.x0 - 3);
          const ax = r.x0 + Math.floor((r.x1 - r.x0 + 1 - aw) / 2);
          const cells = []; for (let x = ax; x < ax + aw; x++) cells.push([x, ROWS.wallS]);
          this.addDoor(L, cells, 'z', { arch: true }); this.reserveAround(L, cells, 3, 'z');
          r.archCells = cells; corridorDoorCols.push(ax, ax + aw - 3);
        } else {
          const dx = rng.int(r.x0 + 1, r.x1 - 3);
          this.addDoor(L, [[dx, ROWS.wallS], [dx + 1, ROWS.wallS], [dx + 2, ROWS.wallS]], 'z');
          corridorDoorCols.push(dx);
        }
      }
      for (const r of northRooms) {
        const dx = rng.int(r.x0 + 1, r.x1 - 3);
        this.addDoor(L, [[dx, ROWS.wallN], [dx + 1, ROWS.wallN], [dx + 2, ROWS.wallN]], 'z');
        corridorDoorCols.push(dx);
      }
      // ---- portas extras entre salas vizinhas (rotas alternativas) ----
      const bandRooms = [southRooms, northRooms];
      for (const band of bandRooms) {
        const sorted = band.slice().sort((a, b) => a.x0 - b.x0);
        for (let i = 0; i < sorted.length; i++) for (let j = 0; j < sorted.length; j++) {
          const a = sorted[i], b = sorted[j];
          if (a.x1 + 2 !== b.x0) continue;
          const z0 = Math.max(a.z0, b.z0) + 1, z1 = Math.min(a.z1, b.z1) - 3;
          if (z1 < z0) continue;
          if (!rng.chance(L === 1 || L === 2 ? 0.5 : 0.4)) continue;
          const dz = rng.int(z0, z1);
          this.addDoor(L, [[a.x1 + 1, dz], [a.x1 + 1, dz + 1], [a.x1 + 1, dz + 2]], 'x');
        }
      }
      // ---- porta atravessando o corredor ----
      if ((L === 1 || L === 2 || L === 0) && rng.chance(0.55)) {
        for (let t = 0; t < 40; t++) {
          const cx = rng.int(fx0 + 6, fx1 - 6);
          if (corridorDoorCols.some(dc => cx >= dc - 3 && cx <= dc + 5)) continue;
          this.addDoor(L, [[cx, ROWS.corrA], [cx, ROWS.corrA + 1], [cx, ROWS.corrA + 2]], 'x', { corridor: true, open: rng.chance(0.3) });
          this.set(L, cx, ROWS.corrB, T.WALL);
          break;
        }
      }
      // ---- saída (térreo, hall) ----
      if (L === 1) {
        const hall = southRooms.find(r => r.type === 'hall');
        const ex = Math.floor((hall.x0 + hall.x1) / 2) - 1;
        const cells = [[ex, 0], [ex + 1, 0], [ex + 2, 0]];
        for (const [x, z] of cells) this.set(L, x, z, T.EXIT);
        m.exit = { level: 1, cells, x: (ex + 1.5) * CELL, z: 0.5 * CELL, room: hall.id };
        this.reserveAround(L, cells, 4, 'z');
        // spawns no hall
        const hx = (hall.x0 + hall.x1 + 1) / 2 * CELL;
        const pts = [[-1.0, 0], [1.0, 0], [-1.0, 1.4], [1.0, 1.4]];
        for (const [ox, oz] of pts) m.spawns.push({ level: 1, x: hx + ox, z: 4.2 + oz, yaw: Math.PI });
        for (const s of m.spawns) this.reserved[1][ix(Math.floor(s.x / CELL), Math.floor(s.z / CELL))] = 1;
        for (let z = 7; z <= 12; z++) for (let x = Math.floor(hx / CELL) - 3; x <= Math.floor(hx / CELL) + 2; x++) this.reserved[1][ix(x, z)] = 1;
      }
    }
    // reaplica ids de sala em células de porta/arco ficam -1 (são de transição)
    return true;
  }

  // ---------- móveis ----------
  placeFurniture() {
    const m = this.map, rng = this.rng;
    for (const room of m.rooms) {
      const tpl = (room.type === 'corridor' && room.level === 0) ? TEMPLATES.bcorridor : (room.type === 'corridor' && room.level === 3) ? TEMPLATES.acorridor : (TEMPLATES[room.type] || []);
      if (room.type === 'stairs') continue;
      for (const item of tpl) {
        let n = rng.int(item.n[0], item.n[1]);
        if (room.type === 'corridor') n = Math.min(n + Math.floor((room.x1 - room.x0) / 30), 4);
        for (let k = 0; k < n; k++) {
          for (let t = 0; t < 30; t++) { if (this.tryPlace(room, item)) break; }
        }
      }
    }
  }
  roomWallSides(room) { return ['S', 'N', 'W', 'E']; }
  tryPlace(room, item) {
    const rng = this.rng, L = room.level, lv = this.map.levels[L];
    let rect, facing, behind = [], front = [];
    if (item.place === 'center') {
      const horiz = rng.chance(0.5) || room.type === 'corridor';
      const sx = horiz ? item.w : item.d, sz = horiz ? item.d : item.w;
      const cx0 = room.x0 + 2, cx1 = room.x1 - 1 - sx, cz0 = room.z0 + 2, cz1 = room.z1 - 1 - sz;
      if (cx1 < cx0 || cz1 < cz0) return false;
      const mx = Math.floor((room.x0 + room.x1 + 1 - sx) / 2), mz = Math.floor((room.z0 + room.z1 + 1 - sz) / 2);
      const x0 = Math.max(cx0, Math.min(cx1, mx + rng.int(-2, 2))), z0 = Math.max(cz0, Math.min(cz1, mz + rng.int(-2, 2)));
      rect = [x0, z0, sx, sz]; facing = horiz ? (rng.chance(0.5) ? 0 : 2) : (rng.chance(0.5) ? 1 : 3);
    } else {
      let sides = ['S', 'N', 'W', 'E'];
      if (room.type === 'corridor') sides = ['S', 'N'];
      const side = rng.pick(sides);
      const w = item.w, d = item.d;
      if (side === 'S' || side === 'N') {
        const a0 = room.x0, a1 = room.x1 - w + 1; if (a1 < a0) return false;
        const a = rng.int(a0, a1);
        const z0 = side === 'S' ? room.z0 : room.z1 - d + 1;
        rect = [a, z0, w, d]; facing = side === 'S' ? 0 : 2;
        const bz = side === 'S' ? room.z0 - 1 : room.z1 + 1, fz = side === 'S' ? z0 + d : z0 - 1;
        for (let x = a; x < a + w; x++) { behind.push([x, bz]); front.push([x, fz]); }
      } else {
        const a0 = room.z0, a1 = room.z1 - w + 1; if (a1 < a0) return false;
        const a = rng.int(a0, a1);
        const x0 = side === 'W' ? room.x0 : room.x1 - d + 1;
        rect = [x0, a, d, w]; facing = side === 'W' ? 1 : 3;
        const bx = side === 'W' ? room.x0 - 1 : room.x1 + 1, fx = side === 'W' ? x0 + d : x0 - 1;
        for (let z = a; z < a + w; z++) { behind.push([bx, z]); front.push([fx, z]); }
      }
      for (const [x, z] of behind) if (this.get(L, x, z) !== T.WALL) return false;
    }
    const [x0, z0, sx, sz] = rect;
    const cells = [];
    for (let z = z0; z < z0 + sz; z++) for (let x = x0; x < x0 + sx; x++) {
      if (x < room.x0 || x > room.x1 || z < room.z0 || z > room.z1) return false;
      const i = ix(x, z);
      if (lv.grid[i] !== T.FLOOR || this.reserved[L][i] || lv.room[i] !== room.id) return false;
      cells.push(i);
    }
    // acesso frontal para recipientes: célula livre e reservada
    let access = null;
    if (item.container) {
      if (item.place === 'center') {
        // acesso por qualquer lado livre
        const cand = [];
        for (let x = x0; x < x0 + sx; x++) { cand.push([x, z0 - 1], [x, z0 + sz]); }
        for (let z = z0; z < z0 + sz; z++) { cand.push([x0 - 1, z], [x0 + sx, z]); }
        front = cand;
      }
      const ok = front.filter(([x, z]) => this.get(L, x, z) === T.FLOOR && !this.reserved[L][ix(x, z)] && lv.room[ix(x, z)] === room.id);
      if (!ok.length) return false;
      access = ok[Math.floor(ok.length / 2)];
    }
    const t = item.block === 'TALL' ? T.TALL : T.LOW;
    for (const i of cells) lv.grid[i] = t;
    if (!this.roomStillOk(room, access)) { for (const i of cells) lv.grid[i] = T.FLOOR; return false; }
    // reserva o espaço à frente para não ser bloqueado depois
    for (const [x, z] of front) if (x >= 0 && z >= 0 && x < W && z < D && lv.room[ix(x, z)] === room.id) this.reserved[L][ix(x, z)] = 1;
    const prop = { id: this.map.props.length, kind: item.kind, level: L, room: room.id, x0, z0, sx, sz, facing, block: item.block, variant: rng.int(0, 999) };
    prop.x = (x0 + sx / 2) * CELL; prop.z = (z0 + sz / 2) * CELL;
    this.map.props.push(prop);
    if (item.container) {
      const c = { id: this.map.containers.length, prop: prop.id, kind: item.container, level: L, room: room.id, x: prop.x, z: prop.z, access, ax: (access[0] + 0.5) * CELL, az: (access[1] + 0.5) * CELL };
      this.map.containers.push(c);
      prop.container = c.id;
    }
    return true;
  }
  // Valida que a sala continua conectada: entradas, todas as células livres e o acesso ao recipiente
  roomStillOk(room, access) {
    const L = room.level, g = this.map.levels[L].grid;
    if (!this.stampA) { this.stampA = new Int32Array(W * D); this.stampB = new Int32Array(W * D); this.stampN = 0; this.stack = new Int32Array(W * D); }
    const sid = ++this.stampN;
    const { x0, x1, z0, z1 } = room;
    const inRoom = (x, z) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
    const freeI = (i) => g[i] === T.FLOOR || g[i] === T.CURTAIN;
    const openT = (t) => t === T.DOOR || t === T.FLOOR || t === T.EXIT || t === T.STAIR;
    // entradas: células internas livres vizinhas a porta/arco/escada fora da sala
    let first = -1, nFree = 0;
    const entries = [];
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const i = z * W + x; if (!freeI(i)) continue; nFree++;
      if ((x === x0 && openT(g[i - 1])) || (x === x1 && openT(g[i + 1])) || (z === z0 && openT(g[i - W])) || (z === z1 && openT(g[i + W]))) { entries.push(i); if (first < 0) first = i; }
    }
    if (first < 0) return true;
    // BFS de jogador (4-vizinhos)
    const st = this.stack, seen = this.stampA;
    let sp = 0, count = 0; st[sp++] = first; seen[first] = sid;
    while (sp) {
      const i = st[--sp]; count++;
      const x = i % W, z = (i / W) | 0;
      if (x > x0 && seen[i - 1] !== sid && freeI(i - 1)) { seen[i - 1] = sid; st[sp++] = i - 1; }
      if (x < x1 && seen[i + 1] !== sid && freeI(i + 1)) { seen[i + 1] = sid; st[sp++] = i + 1; }
      if (z > z0 && seen[i - W] !== sid && freeI(i - W)) { seen[i - W] = sid; st[sp++] = i - W; }
      if (z < z1 && seen[i + W] !== sid && freeI(i + W)) { seen[i + W] = sid; st[sp++] = i + W; }
    }
    if (count !== nFree) return false;
    if (access && seen[access[1] * W + access[0]] !== sid) return false;
    // BFS da criatura (folga 3x3) entre entradas
    const cOk = (t) => t === T.FLOOR || t === T.DOOR || t === T.STAIR || t === T.CURTAIN || t === T.EXIT;
    const cfree = (x, z) => { if (!inRoom(x, z)) return false; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const xx = x + a, zz = z + b; if (xx < 0 || zz < 0 || xx >= W || zz >= D || !cOk(g[zz * W + xx])) return false; } return true; };
    const cEntries = entries.filter(i => cfree(i % W, (i / W) | 0));
    if (!cEntries.length) return false;
    const seen2 = this.stampB; let csz = 0;
    sp = 0; st[sp++] = cEntries[0]; seen2[cEntries[0]] = sid;
    while (sp) {
      const i = st[--sp]; csz++;
      const x = i % W, z = (i / W) | 0;
      for (const [dx, dz] of DIRS4) { const nx = x + dx, nz = z + dz, k = nz * W + nx; if (seen2[k] !== sid && cfree(nx, nz)) { seen2[k] = sid; st[sp++] = k; } }
    }
    const groups = this.roomEntryGroups(room);
    for (const gr of groups) if (!gr.some(([x, z]) => x >= 0 && z >= 0 && x < W && z < D && seen2[z * W + x] === sid)) return false;
    return csz >= 4;
  }
  roomEntryGroups(room) {
    // agrupa células internas adjacentes a cada porta/arco
    const L = room.level, groups = [];
    const inRoom = (x, z) => x >= room.x0 && x <= room.x1 && z >= room.z0 && z <= room.z1;
    const doorIds = new Map();
    for (let z = room.z0 - 1; z <= room.z1 + 1; z++) for (let x = room.x0 - 1; x <= room.x1 + 1; x++) {
      if (inRoom(x, z)) continue;
      const t = this.get(L, x, z);
      if (t !== T.DOOR && t !== T.FLOOR && t !== T.STAIR && t !== T.EXIT) continue;
      const key = t === T.DOOR ? 'd' + this.map.levels[L].door[ix(x, z)] : 'a' + (z === room.z0 - 1 || z === room.z1 + 1 ? 'z' + z : 'x' + x);
      if (!doorIds.has(key)) doorIds.set(key, []);
      // célula interna adjacente + uma mais para dentro
      for (const [dx, dz] of DIRS4) { const nx = x + dx, nz = z + dz; if (inRoom(nx, nz)) { doorIds.get(key).push([nx, nz]); doorIds.get(key).push([nx + dx, nz + dz]); } }
    }
    for (const g of doorIds.values()) if (g.length) groups.push(g);
    return groups;
  }

  // ---------- cortinas, quadros, janelas, luzes, objetos derrubáveis ----------
  decorate() {
    const m = this.map, rng = this.rng;
    for (const room of m.rooms) {
      const L = room.level, lv = m.levels[L];
      if (room.type === 'stairs' && room.top) continue;
      // janelas em paredes externas (térreo e 2º andar; sótão: janelinhas)
      if (L >= 1) {
        const sides = [];
        if (room.z0 === 1) sides.push('S'); if (room.z1 === D - 2) sides.push('N');
        if (room.x0 === lv.fx0) sides.push('W'); if (room.x1 === lv.fx1) sides.push('E');
        for (const side of sides) {
          const horiz = side === 'S' || side === 'N';
          const a0 = (horiz ? room.x0 : room.z0) + 2, a1 = (horiz ? room.x1 : room.z1) - 2;
          for (let a = a0 + 1; a <= a1 - 1; a += L === 3 ? 12 : 7) {
            const wx = horiz ? a : (side === 'W' ? room.x0 - 1 : room.x1 + 1);
            const wz = horiz ? (side === 'S' ? 0 : D - 1) : a;
            if (this.get(L, wx, wz) !== T.WALL) continue;
            const fx = horiz ? wx : (side === 'W' ? wx + 1 : wx - 1), fz = horiz ? (side === 'S' ? 1 : D - 2) : wz;
            if (this.get(L, fx, fz) === T.TALL) continue;
            if (m.exit && L === 1 && side === 'S' && Math.abs(wx - m.exit.cells[1][0]) < 4) continue;
            const rot = side === 'S' ? 0 : side === 'N' ? Math.PI : side === 'W' ? Math.PI / 2 : -Math.PI / 2;
            const px = horiz ? (wx + 0.5) * CELL : (side === 'W' ? (wx + 1) * CELL : wx * CELL);
            const pz = horiz ? (side === 'S' ? CELL : (D - 1) * CELL) : (wz + 0.5) * CELL;
            const win = { level: L, x: px, z: pz, rot, room: room.id, small: L === 3 };
            m.windows.push(win);
            // cortina-esconderijo na frente de algumas janelas
            if (L <= 2 && ['living', 'bedroom', 'master', 'library', 'music', 'dining', 'study', 'nursery'].includes(room.type) && rng.chance(0.35)) {
              const cc = [];
              for (let k = 0; k < 2; k++) {
                const cx = horiz ? wx + k - 1 + 1 : fx, cz = horiz ? fz : wz + k;
                cc.push([cx, cz]);
              }
              if (cc.every(([x, z]) => this.get(L, x, z) === T.FLOOR && !this.reserved[L][ix(x, z)])) {
                for (const [x, z] of cc) this.set(L, x, z, T.CURTAIN);
                if (this.roomStillOk(room, null)) { win.curtain = true; m.decor.push({ kind: 'curtain_alcove', level: L, cells: cc, rot, x: px, z: pz }); }
                else for (const [x, z] of cc) this.set(L, x, z, T.FLOOR);
              }
            }
          }
        }
      }
      // quadros nas paredes
      if (L >= 1 && L <= 2 && room.type !== 'bathroom') {
        const n = room.type === 'corridor' ? 6 : rng.int(1, 3);
        for (let k = 0; k < n; k++) {
          const p = this.wallSpot(room, 1.6);
          if (p) m.decor.push({ kind: 'painting', level: L, ...p, w: rng.float(0.5, 0.9), h: rng.float(0.6, 1.0), v: rng.int(0, 7) });
        }
      }
      // tapetes
      if (['hall', 'living', 'dining', 'bedroom', 'master', 'library', 'study', 'music', 'nursery'].includes(room.type)) {
        const w = (room.x1 - room.x0 + 1) * CELL, d = (room.z1 - room.z0 + 1) * CELL;
        m.decor.push({ kind: 'rug', level: L, x: (room.x0 + room.x1 + 1) / 2 * CELL, z: (room.z0 + room.z1 + 1) / 2 * CELL, w: Math.max(1.5, w * 0.55), d: Math.max(1.5, d * 0.5), v: rng.int(0, 2) });
      }
      if (room.type === 'corridor' && L >= 1) {
        m.decor.push({ kind: 'runner', level: L, x: (room.x0 + room.x1 + 1) / 2 * CELL, z: (room.z0 + room.z1 + 1) / 2 * CELL, w: (room.x1 - room.x0 + 1) * CELL - 1.5, d: 1.1 });
      }
      // luzes
      this.lightRoom(room);
    }
    // objetos derrubáveis
    const want = rng.int(12, 18);
    let placed = 0;
    for (let t = 0; t < 600 && placed < want; t++) {
      const room = rng.pick(m.rooms.filter(r => r.type !== 'stairs'));
      const L = room.level, lv = m.levels[L];
      const x = rng.int(room.x0, room.x1), z = rng.int(room.z0, room.z1);
      if (lv.grid[ix(x, z)] !== T.FLOOR || this.reserved[L][ix(x, z)]) continue;
      // encostado em parede ou móvel
      let adj = false;
      for (const [dx, dz] of DIRS4) { const tt = this.get(L, x + dx, z + dz); if (tt === T.WALL || tt === T.LOW || tt === T.TALL) adj = true; }
      if (!adj) continue;
      if (m.knockables.some(k => k.level === L && Math.abs(k.cx - x) < 4 && Math.abs(k.cz - z) < 4)) continue;
      const kind = room.type === 'kitchen' || room.type === 'cellar' ? rng.pick(['bottles', 'bucket', 'vase']) : L === 0 ? rng.pick(['bucket', 'box', 'bottles']) : rng.pick(KNOCK_KINDS);
      m.knockables.push({ id: m.knockables.length, kind, level: L, cx: x, cz: z, x: (x + 0.5) * CELL, z: (z + 0.5) * CELL, room: room.id, rot: rng.float(0, 6.28) });
      this.reserved[L][ix(x, z)] = 1;
      placed++;
    }
  }
  wallSpot(room, y) {
    const rng = this.rng, L = room.level;
    for (let t = 0; t < 20; t++) {
      const side = rng.pick(['S', 'N', 'W', 'E']);
      const horiz = side === 'S' || side === 'N';
      const a = horiz ? rng.int(room.x0 + 1, room.x1 - 1) : rng.int(room.z0 + 1, room.z1 - 1);
      const wx = horiz ? a : side === 'W' ? room.x0 - 1 : room.x1 + 1;
      const wz = horiz ? (side === 'S' ? room.z0 - 1 : room.z1 + 1) : a;
      const fx = horiz ? a : side === 'W' ? room.x0 : room.x1;
      const fz = horiz ? (side === 'S' ? room.z0 : room.z1) : a;
      if (this.get(L, wx, wz) !== T.WALL) continue;
      // vizinhos da parede também precisam ser parede (não perto de porta)
      const n1 = horiz ? this.get(L, wx - 1, wz) : this.get(L, wx, wz - 1), n2 = horiz ? this.get(L, wx + 1, wz) : this.get(L, wx, wz + 1);
      if (n1 !== T.WALL || n2 !== T.WALL) continue;
      const ft = this.get(L, fx, fz);
      if (ft === T.TALL || ft === T.CURTAIN) continue;
      const key = L + ':' + wx + ':' + wz;
      this.usedWall = this.usedWall || new Set();
      if (this.usedWall.has(key)) continue;
      this.usedWall.add(key);
      const rot = side === 'S' ? 0 : side === 'N' ? Math.PI : side === 'W' ? Math.PI / 2 : -Math.PI / 2;
      const x = horiz ? (a + 0.5) * CELL : (side === 'W' ? room.x0 * CELL : (room.x1 + 1) * CELL);
      const z = horiz ? (side === 'S' ? room.z0 * CELL : (room.z1 + 1) * CELL) : (a + 0.5) * CELL;
      return { x, z, y, rot, side };
    }
    return null;
  }
  lightRoom(room) {
    const m = this.map, rng = this.rng, L = room.level, base = LEVELS[L].y, h = LEVELS[L].h;
    const state = () => { const r = rng.next(); return r < 0.18 ? 'off' : r < 0.36 ? 'flicker' : 'on'; };
    const cx = (room.x0 + room.x1 + 1) / 2 * CELL, cz = (room.z0 + room.z1 + 1) / 2 * CELL;
    if (room.type === 'corridor') {
      for (let x = room.x0 + 4; x < room.x1 - 2; x += 14) {
        const p = this.wallSpotAt(room, x);
        if (L === 0) m.lamps.push({ kind: 'emergency', level: L, x: (x + 0.5) * CELL, y: base + h - 0.35, z: (ROWS.corrA) * CELL + 0.1, rot: 0, color: 0xff2a1a, intensity: 1.6, range: 7, state: rng.chance(0.3) ? 'flicker' : 'on' });
        else if (p) m.lamps.push({ kind: 'wall', level: L, ...p, y: base + 2.0, color: 0xffa050, intensity: 2.2, range: 7, state: state() });
      }
      return;
    }
    if (room.type === 'stairs') {
      if (!room.top) m.lamps.push({ kind: 'emergency', level: L, x: cx, y: base + 2.6, z: (ROWS.northB) * CELL + 0.2, rot: Math.PI, color: L === 0 ? 0xff2a1a : 0xff5530, intensity: 1.4, range: 8, state: 'on' });
      return;
    }
    if (['hall', 'dining', 'living', 'master'].includes(room.type)) {
      m.lamps.push({ kind: 'chandelier', level: L, x: cx, y: base + h - 0.9, z: cz, color: 0xffb060, intensity: 3.2, range: 10, state: rng.chance(0.2) ? 'flicker' : 'on' });
    }
    if (L === 0 || L === 3) {
      m.lamps.push({ kind: 'bulb', level: L, x: cx + rng.float(-1, 1), y: base + h - 0.5, z: cz + rng.float(-1, 1), color: L === 0 ? 0xffa050 : 0xffc080, intensity: 1.8, range: 7, state: rng.chance(0.35) ? 'flicker' : rng.chance(0.25) ? 'off' : 'on' });
      return;
    }
    const n = room.type === 'bathroom' || room.type === 'pantry' || room.type === 'linen' ? 1 : rng.int(1, 2);
    for (let k = 0; k < n; k++) {
      const p = this.wallSpot(room, 2.0);
      if (p) m.lamps.push({ kind: 'wall', level: L, x: p.x, z: p.z, rot: p.rot, y: base + 2.0, color: rng.chance(0.15) ? 0xff7733 : 0xffa555, intensity: 2.0, range: 7, state: state() });
    }
    if (room.type === 'living') {
      const fp = m.props.find(p => p.room === room.id && p.kind === 'fireplace');
      if (fp) m.lamps.push({ kind: 'fire', level: L, x: fp.x + [0, 0.3, 0, -0.3][fp.facing], y: base + 0.5, z: fp.z + [0.3, 0, -0.3, 0][fp.facing], color: 0xff6a20, intensity: 2.6, range: 8, state: 'flicker' });
    }
    for (const p of m.props.filter(p => p.room === room.id && ['desk', 'reading_table', 'nightstand', 'sideboard', 'dining_table'].includes(p.kind))) {
      if (rng.chance(0.6)) m.lamps.push({ kind: 'candle', level: L, x: p.x, y: base + (p.kind === 'nightstand' ? 0.62 : 0.82), z: p.z, color: 0xff9040, intensity: 0.9, range: 4, state: 'flicker', prop: p.id });
    }
  }
  wallSpotAt(room, x) {
    const L = room.level;
    for (const side of ['S', 'N']) {
      const wz = side === 'S' ? room.z0 - 1 : room.z1 + 1;
      if (this.get(L, x, wz) === T.WALL && this.get(L, x - 1, wz) === T.WALL && this.get(L, x + 1, wz) === T.WALL) {
        return { x: (x + 0.5) * CELL, z: side === 'S' ? room.z0 * CELL : (room.z1 + 1) * CELL, rot: side === 'S' ? 0 : Math.PI };
      }
    }
    return null;
  }
  creatureSpawn() {
    const m = this.map, rng = this.rng;
    const cands = m.rooms.filter(r => (r.level === 2 || r.level === 0) && r.type !== 'stairs' && r.type !== 'corridor');
    rng.shuffle(cands);
    for (const r of cands) {
      const L = r.level;
      for (let t = 0; t < 30; t++) {
        const x = rng.int(r.x0 + 1, r.x1 - 1), z = rng.int(r.z0 + 1, r.z1 - 1);
        let ok = true;
        for (let a = -1; a <= 1 && ok; a++) for (let b = -1; b <= 1; b++) if (this.get(L, x + a, z + b) !== T.FLOOR) { ok = false; break; }
        if (ok) { m.creatureSpawn = { level: L, x: (x + 0.5) * CELL, z: (z + 0.5) * CELL, yaw: rng.float(0, 6.28), room: r.id }; return true; }
      }
    }
    return false;
  }
}

function tryGenerate(seed, attempt) {
  const g = new Gen(seed, attempt);
  if (!g.build()) return null;
  g.placeFurniture();
  g.decorate();
  if (!g.creatureSpawn()) return null;
  // ids de sala para células de porta/arco (para superfície/sons) — usa sala vizinha
  return g.map;
}

// ---------------- validação ----------------
export function validateMap(map) {
  const errors = [];
  const lv = map.levels;
  const get = (L, x, z) => (x < 0 || z < 0 || x >= W || z >= D) ? T.VOID : lv[L].grid[ix(x, z)];
  const pWalk = (L, x, z) => { const t = get(L, x, z); return t === T.FLOOR || t === T.DOOR || t === T.STAIR || t === T.CURTAIN; };
  const neighbors = (L, x, z, walk) => {
    const out = [];
    const s = lv[L].stair[ix(x, z)];
    const levelsHere = [L];
    if (s >= 0) { const st = map.stairs[s]; levelsHere.push(st.lower === L ? st.upper : st.lower); }
    for (const LL of levelsHere) for (const [dx, dz] of DIRS4) if (walk(LL, x + dx, z + dz)) out.push([LL, x + dx, z + dz]);
    return out;
  };
  const bfs = (start, walk) => {
    const seen = new Uint8Array(4 * W * D);
    const key = (L, x, z) => L * W * D + ix(x, z);
    const q = [start]; seen[key(...start)] = 1;
    while (q.length) {
      const [L, x, z] = q.pop();
      for (const n of neighbors(L, x, z, walk)) { const k = key(...n); if (!seen[k]) { seen[k] = 1; q.push(n); } }
    }
    return (L, x, z) => !!seen[key(L, x, z)];
  };
  // 1. pontos de aparecimento
  if (!map.spawns.length) errors.push('sem spawns');
  for (const s of map.spawns) {
    const cx = Math.floor(s.x / CELL), cz = Math.floor(s.z / CELL);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (!pWalk(s.level, cx + a, cz + b)) errors.push('spawn obstruído');
  }
  const s0 = map.spawns[0];
  const reach = bfs([s0.level, Math.floor(s0.x / CELL), Math.floor(s0.z / CELL)], pWalk);
  // 2. todas as salas acessíveis
  for (const r of map.rooms) {
    let any = false;
    for (let z = r.z0; z <= r.z1 && !any; z++) for (let x = r.x0; x <= r.x1; x++) if (reach(r.level, x, z)) { any = true; break; }
    if (!any) errors.push(`sala inacessível ${r.name} L${r.level}`);
  }
  // 3. saída acessível
  if (!map.exit) errors.push('sem saída');
  else { const c = map.exit.cells[1]; if (!reach(1, c[0], c[1] + 1)) errors.push('saída inacessível'); }
  // 4. recipientes (esconderijos de chave) acessíveis
  for (const c of map.containers) if (!reach(c.level, c.access[0], c.access[1])) errors.push('recipiente inacessível ' + c.id);
  if (map.containers.length < 12) errors.push('poucos recipientes');
  // 5. escadas conectadas nas duas pontas
  for (const st of map.stairs) {
    if (!reach(st.lower, st.x0 + 1, st.zBot)) errors.push('escada sem base ' + st.key);
    if (!reach(st.upper, st.x0 + 1, st.zTop - 1)) errors.push('escada sem topo ' + st.key);
  }
  // cada andar alcançável
  for (let L = 0; L < 4; L++) if (!map.rooms.some(r => r.level === L && r.type === 'corridor' && reach(L, r.x0 + 2, r.z0 + 1))) errors.push('andar inacessível ' + L);
  // 6. navegação da criatura (folga 3x3, portas abertas)
  const cWalk = (L, x, z) => { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const t = get(L, x + a, z + b); if (!(t === T.FLOOR || t === T.DOOR || t === T.STAIR || t === T.CURTAIN)) return false; } return true; };
  const cs = map.creatureSpawn;
  if (!cs) errors.push('sem spawn da criatura');
  else {
    const creach = bfs([cs.level, Math.floor(cs.x / CELL), Math.floor(cs.z / CELL)], cWalk);
    for (const r of map.rooms) if (r.type === 'corridor') { if (!creach(r.level, r.x0 + 3, r.z0 + 2)) errors.push('criatura não alcança corredor L' + r.level); }
    for (const st of map.stairs) if (!creach(st.lower, st.x0 + 1, st.zBot) || !creach(st.upper, st.x0 + 1, st.zTop)) errors.push('criatura não usa escada ' + st.key);
    const hall = map.rooms[map.exit.room];
    let hallOk = false;
    for (let z = hall.z0; z <= hall.z1 && !hallOk; z++) for (let x = hall.x0; x <= hall.x1; x++) if (creach(1, x, z)) { hallOk = true; break; }
    if (!hallOk) errors.push('criatura não alcança o hall');
  }
  // 7. objetos não sobrepostos e dentro de suas salas
  const occ = new Map();
  for (const p of map.props) for (let z = p.z0; z < p.z0 + p.sz; z++) for (let x = p.x0; x < p.x0 + p.sx; x++) {
    const k = p.level + ':' + x + ':' + z;
    if (occ.has(k)) errors.push('móveis sobrepostos');
    occ.set(k, p.id);
    const t = get(p.level, x, z);
    if (t !== T.LOW && t !== T.TALL) errors.push('móvel fora da grade');
  }
  for (const k of map.knockables) if (get(k.level, k.cx, k.cz) !== T.FLOOR) errors.push('objeto derrubável em célula inválida');
  // 8. portas: os dois lados livres (sem móveis bloqueando)
  for (const d of map.doors) {
    for (const [x, z] of d.cells) {
      const sides = d.axis === 'z' ? [[x, z - 1], [x, z + 1]] : [[x - 1, z], [x + 1, z]];
      for (const [a, b] of sides) { const t = get(d.level, a, b); if (!(t === T.FLOOR || t === T.DOOR || t === T.CURTAIN || t === T.STAIR)) errors.push('porta bloqueada ' + d.id); }
    }
  }
  // 9. rotas alternativas: grafo de salas tem ciclo
  const edges = new Set(); const nodes = new Set();
  for (let L = 0; L < 4; L++) for (let z = 1; z < D - 1; z++) for (let x = 1; x < W - 1; x++) {
    const t = get(L, x, z); if (t !== T.DOOR && t !== T.FLOOR) continue;
    if (lv[L].room[ix(x, z)] >= 0) continue;
    // célula de transição: liga as salas dos dois lados
    const pairs = [[[x - 1, z], [x + 1, z]], [[x, z - 1], [x, z + 1]]];
    for (const [[ax, az], [bx, bz]] of pairs) {
      const ra = lv[L].room[ix(ax, az)], rb = lv[L].room[ix(bx, bz)];
      if (ra >= 0 && rb >= 0 && ra !== rb) { edges.add(Math.min(ra, rb) + '-' + Math.max(ra, rb)); nodes.add(ra); nodes.add(rb); }
    }
  }
  // escadas ligam salas de escada entre andares
  for (const st of map.stairs) {
    const a = map.rooms.find(r => r.stair === st.id && r.level === st.lower), b = map.rooms.find(r => r.stair === st.id && r.level === st.upper);
    if (a && b) { edges.add(a.id + '-' + b.id); nodes.add(a.id); nodes.add(b.id); }
  }
  if (edges.size < nodes.size) errors.push('sem rotas alternativas');
  map.stats = { rooms: map.rooms.length, doors: map.doors.length, containers: map.containers.length, props: map.props.length, edges: edges.size };
  return { ok: errors.length === 0, errors };
}

export function mapHash(map) {
  let h = 2166136261 >>> 0;
  const mix = (v) => { h ^= v & 0xff; h = Math.imul(h, 16777619) >>> 0; };
  for (const lv of map.levels) for (let i = 0; i < lv.grid.length; i++) mix(lv.grid[i]);
  for (const c of map.containers) { mix(c.prop); mix(c.access[0]); mix(c.access[1]); }
  return (h >>> 0).toString(16) + '-' + map.containers.length + '-' + map.props.length;
}

const cache = new Map();
export function generateMansion(seed, { noCache = false } = {}) {
  seed = String(seed);
  if (!noCache && cache.has(seed)) return cache.get(seed);
  let map = null, validation = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const m = tryGenerate(seed, attempt);
    if (!m) continue;
    const v = validateMap(m);
    if (v.ok) { map = m; validation = v; break; }
  }
  if (!map) {
    // configuração previamente validada
    for (let attempt = 0; attempt < 12 && !map; attempt++) { const m = tryGenerate(FALLBACK_SEED, attempt); if (m && validateMap(m).ok) map = m; }
    map.fallbackFrom = seed;
  }
  map.hash = mapHash(map);
  if (!noCache) { cache.set(seed, map); if (cache.size > 30) cache.delete(cache.keys().next().value); }
  return map;
}
