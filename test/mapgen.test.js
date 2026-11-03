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
