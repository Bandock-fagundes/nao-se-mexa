// Geração procedural da mansão: 500+ sementes, determinismo, variação, validação, reserva.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMansion, validateMap } from '../shared/mapgen.js';
import { FALLBACK_SEED, T, W, D } from '../shared/config.js';
import { World } from '../shared/world.js';
import { Nav } from '../shared/nav.js';

test('Geração: 500 sementes produzem mansões válidas (conectividade, chaves, saída, spawns, navegação da criatura, colisões)', () => {
  let fallbacks = 0, totalRooms = 0;
  const types = new Set();
  for (let i = 0; i < 500; i++) {
    const seed = 'semente-' + i;
    const m = generateMansion(seed, { noCache: true });
    const v = validateMap(m);
    assert.ok(v.ok, `semente ${seed}: ${v.errors.join('; ')}`);
    if (m.fallbackFrom) fallbacks++;
    totalRooms += m.rooms.length;
    for (const r of m.rooms) types.add(r.type);
    assert.equal(m.levels.length, 4, 'porão, térreo, 2º andar e sótão');
    assert.equal(m.stairs.length, 4, 'escadas conectando todos os andares');
    assert.ok(m.containers.length >= 12);
    assert.ok(m.spawns.length >= 4 && m.creatureSpawn && m.exit);
  }
  for (const t of ['hall', 'living', 'dining', 'kitchen', 'pantry', 'study', 'bedroom', 'bathroom', 'corridor', 'stairs', 'library', 'cellar', 'attic']) assert.ok(types.has(t), 'tipo de cômodo presente: ' + t);
  assert.ok(fallbacks < 5, 'reserva raramente usada (' + fallbacks + ')');
  assert.ok(totalRooms / 500 > 30);
});

test('Geração: determinística por semente + versão; sementes diferentes variam', () => {
  const a = generateMansion('igual', { noCache: true }), b = generateMansion('igual', { noCache: true });
  assert.equal(a.hash, b.hash);
  assert.deepEqual(a.props.map(p => p.kind + p.x0 + ',' + p.z0), b.props.map(p => p.kind + p.x0 + ',' + p.z0));
  const hashes = new Set();
  for (let i = 0; i < 30; i++) hashes.add(generateMansion('var-' + i, { noCache: true }).hash);
  assert.equal(hashes.size, 30, 'todas diferentes');
  // posições das escadas e da sala do hall variam
  const stairsX = new Set(), hallX = new Set();
  for (let i = 0; i < 30; i++) { const m = generateMansion('var-' + i); stairsX.add(m.stairs[1].x0); hallX.add(m.rooms[m.exit.room].x0); }
  assert.ok(stairsX.size > 5 && hallX.size > 3);
});

test('Geração: configuração de reserva conhecida é válida', () => {
  const m = generateMansion(FALLBACK_SEED, { noCache: true });
  assert.ok(validateMap(m).ok);
});

test('Geração: a criatura consegue navegar entre andares (escadas) respeitando portas', () => {
  const m = generateMansion('nav-1', { noCache: true });
  const w = new World(m), nav = new Nav(w);
  const hall = m.rooms[m.exit.room];
  const cs = m.creatureSpawn;
  const p = nav.findPath(cs.level, cs.x, cs.z, 1, (hall.x0 + 3) * 0.5, (hall.z0 + 3) * 0.5);
  assert.ok(p && p.length > 2, 'caminho até o hall');
  const levels = new Set(p.map(q => q.L));
  if (cs.level !== 1) assert.ok(levels.size >= 2, 'usou escada');
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i];
    if (a.L === b.L && !a.stair && !b.stair) assert.ok(w.noWallBetween(a.L, a.x, a.z, b.x, b.z) || Math.hypot(a.x - b.x, a.z - b.z) < 0.8, 'segmento sem parede');
  }
  // fechar todas as portas aumenta o custo mas não impede (ela abre portas)
  for (let i = 0; i < w.doorOpen.length; i++) w.doorOpen[i] = 0;
  const p2 = nav.findPath(cs.level, cs.x, cs.z, 1, (hall.x0 + 3) * 0.5, (hall.z0 + 3) * 0.5);
  assert.ok(p2, 'ainda há caminho (porta fechada custa mais)');
  void T; void W; void D;
});

// ---------------- v2: casa muda a cada partida, cômodos completos, móveis sem se atravessar ----------------
import * as THREE from 'three';
import { buildProp } from '../client/src/render/props.js';
import { REQUIRED_FURNITURE } from '../shared/mapgen.js';

test('v2: cada cômodo tem seus móveis obrigatórios (ex.: quarto com cama, guarda-roupa e criado-mudo)', () => {
  let rooms = 0;
  for (let i = 0; i < 80; i++) {
    const m = generateMansion('req-' + i, { noCache: true });
    for (const r of m.rooms) for (const k of (REQUIRED_FURNITURE[r.type] || [])) { rooms++; assert.ok(m.props.some(p => p.room === r.id && p.kind === k), `semente req-${i}: falta ${k} em ${r.name}`); }
  }
  assert.ok(rooms > 1000);
});

test('v2: semente diferente → casa diferente (mesmos tipos de cômodo, layout/móveis variam)', () => {
  const a = generateMansion('casa-A', { noCache: true }), b = generateMansion('casa-B', { noCache: true });
  assert.notEqual(a.hash, b.hash);
  const types = (m) => new Set(m.rooms.map(r => r.type));
  for (const t of ['hall', 'living', 'dining', 'kitchen', 'bedroom', 'bathroom', 'attic', 'cellar']) { assert.ok(types(a).has(t) && types(b).has(t), 'cômodo ' + t + ' presente nas duas'); }
});

test('v2: o modelo 3D de cada móvel cabe na pegada da grade (nada se atravessa)', () => {
  const mat = new THREE.MeshBasicMaterial();
  const M = new Proxy({}, { get: (t, k) => t[k] || (t[k] = mat) });
  const seen = new Set(); const bad = [];
  for (let i = 0; i < 30; i++) {
    const m = generateMansion('pb' + i, { noCache: true });
    for (const p of m.props) {
      const horiz = p.facing === 0 || p.facing === 2;
      const w = (horiz ? p.sx : p.sz) * 0.5, d = (horiz ? p.sz : p.sx) * 0.5;
      const key = p.kind + ':' + w + 'x' + d; if (seen.has(key)) continue; seen.add(key);
      const g = buildProp(p.kind, w, d, M, p.variant); g.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(g);
      // encostados na parede: laterais e fundo dentro da pegada; a frente pode avançar até 0,45 m (fileira da frente
      // fica reservada). Centro (mesas): anel livre de 0,5 m reservado em volta.
      const center = ['dining_table', 'ktable', 'reading_table', 'coffee_table'].includes(p.kind);
      const side = Math.max(-w / 2 - b.min.x, b.max.x - w / 2), back = -d / 2 - b.min.z, front = b.max.z - d / 2;
      const lim = center ? 0.45 : 0.035;
      if (side > lim || back > lim || front > 0.45) bad.push(`${key} lado ${side.toFixed(2)} fundo ${back.toFixed(2)} frente ${front.toFixed(2)}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('v2: cliente e servidor concordam no número de gavetas de cada móvel', () => {
  const mat = new THREE.MeshBasicMaterial();
  const M = new Proxy({}, { get: (t, k) => t[k] || (t[k] = mat) });
  let n = 0;
  for (let i = 0; i < 10; i++) {
    const m = generateMansion('gv' + i, { noCache: true });
    for (const c of m.containers) {
      const p = m.props[c.prop]; const horiz = p.facing === 0 || p.facing === 2;
      const g = buildProp(p.kind, (horiz ? p.sx : p.sz) * 0.5, (horiz ? p.sz : p.sx) * 0.5, M, p.variant);
      assert.equal(g.userData.parts.length, c.parts, `${p.kind}: cliente ${g.userData.parts.length} × servidor ${c.parts}`); n++;
    }
  }
  assert.ok(n > 500);
});
