// Fase 1 — visão: detecção por movimento, linha de visão, sem audição/olfato, perseguição, última posição.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, clearCorridor, wallSpot, run, stepPlayer, strafe, cc } from './helpers.js';
import { visionCheck } from '../server/senses.js';
import { CELL } from '../shared/config.js';

const SEED = 'fase-um-7';

test('F1: a criatura detecta um jogador em movimento dentro do campo de visão', () => {
  const m = makeMatch(1, SEED);
  const c = clearCorridor(m, 1, 30); assert.ok(c, 'corredor livre');
  m.debugPlaceCreature(c.x0, c.z, c.L, Math.PI / 2); // olhando +x
  m.debugPlacePlayer('p1', c.x0 + 10, c.z, c.L);
  run(m, 1.5, strafe(m, 'p1'));
  assert.ok(['alert', 'chase'].includes(m.creature.state), 'estado = ' + m.creature.state);
  assert.equal(m.creature.target, 'p1');
});

test('F1: a criatura não enxerga através de paredes', () => {
  const m = makeMatch(1, SEED);
  const w = wallSpot(m, 1); assert.ok(w, 'parede encontrada');
  m.debugPlaceCreature(w.x, w.zCorr, w.L, Math.PI); // olhando -z, direto para a parede
  m.debugPlacePlayer('p1', w.x, w.zRoom - 0.5, w.L);
  const v = visionCheck(m, m.creature, m.players.get('p1'));
  assert.equal(v.inFov, true); assert.equal(v.inRange, true); assert.equal(v.los, false);
  run(m, 3, (t, dt) => stepPlayer(m, 'p1', Math.sin(t * 4) * 2, 0, dt));
  assert.equal(m.creature.state, 'hold');
  assert.deepEqual(m.creature.vis.fresh, []);
});

test('F1: jogador imóvel não é detectado apenas por estar visível (rotação de câmera não conta)', () => {
  const m = makeMatch(1, SEED);
  const c = clearCorridor(m, 1, 30);
  m.debugPlaceCreature(c.x0, c.z, c.L, Math.PI / 2);
  m.debugPlacePlayer('p1', c.x0 + 8, c.z, c.L);
  const p = m.players.get('p1');
  // o jogador gira a câmera sem mover o corpo (lanterna desligada: o feixe é outra regra, testada abaixo)
  run(m, 5, (t) => m.applyInput('p1', { x: p.x, z: p.z, yaw: Math.sin(t * 3) * 2, pitch: Math.cos(t * 2) * 0.6, fl: false }));
  const v = visionCheck(m, m.creature, p);
  assert.equal(v.visible, true, 'está visível');
  assert.equal(v.moving, false, 'não conta como movimento');
  assert.equal(m.creature.state, 'hold');
});

test('F1: lanterna — feixe na criatura com jogador parado só atrai investigação, não detecção', () => {
  const m = makeMatch(1, SEED);
  const c = clearCorridor(m, 1, 30);
  m.debugPlaceCreature(c.x0, c.z, c.L, Math.PI / 2);
  m.debugPlacePlayer('p1', c.x0 + 9, c.z, c.L, Math.PI / 2); // yaw π/2 → olha para -x (na direção da criatura)
  const p = m.players.get('p1');
  run(m, 1.0, () => m.applyInput('p1', { x: p.x, z: p.z, yaw: Math.PI / 2, pitch: 0.12, fl: true }));
  const v = visionCheck(m, m.creature, p);
  assert.equal(v.beamOnCreature, true);
  assert.notEqual(m.creature.state, 'chase');
  assert.ok(['hear', 'investigate'].includes(m.creature.state), 'investiga a luz: ' + m.creature.state);
  assert.equal(m.creature.target, null);
  // lanterna desligada: alcance de visão menor que ligada
  const on = visionCheck(m, m.creature, { ...p, flashlight: true });
  m.litLamps = [];
  const off = visionCheck(m, m.creature, { ...p, flashlight: false, yaw: 0 });
  assert.ok(off.lit === false && on.lit === true);
});

test('F1: a criatura não usa audição para localizar jogadores', () => {
  const m = makeMatch(1, SEED);
  const c = clearCorridor(m, 1, 30);
  m.debugPlaceCreature(c.x0 + 12, c.z, c.L, Math.PI / 2); // olhando +x
  m.debugPlacePlayer('p1', c.x0 + 6, c.z, c.L); // atrás dela
  run(m, 3, strafe(m, 'p1', 4.5, 0.6, { run: true }));
  const k = m.map.knockables[0];
  m.emitSound('knock_bucket', m.creature.x - 3, 0.3, m.creature.z, m.creature.level, { source: 'object' });
  run(m, 2);
  assert.equal(m.creature.state, 'hold');
  assert.equal(m.creature.lastSound, null);
  assert.ok(m.sounds.length > 0, 'os sons existem, mas a criatura não os usa');
  void k;
});

test('F1: a criatura não usa olfato para localizar jogadores', () => {
  const m = makeMatch(1, SEED);
  assert.equal(m.creature.nextSniffT, Infinity);
  m.creature.pickPatrol();
  const c = clearCorridor(m, 1, 30);
  m.debugPlacePlayer('p1', c.x0, c.z, c.L);
  let sniffed = false;
  run(m, 60, (t, dt) => { if (m.creature.state === 'sniff' || m.creature.state === 'track') sniffed = true; if (t < 10) stepPlayer(m, 'p1', 1.5, 0, dt); });
  assert.equal(sniffed, false);
  assert.equal(m.creature.sniffInfo.state, 'inativo');
});

test('F1: a criatura persegue um alvo detectado por caminho válido', () => {
  const m = makeMatch(1, SEED);
  const c = clearCorridor(m, 1, 30);
  m.debugPlaceCreature(c.x0, c.z, c.L, Math.PI / 2);
  m.debugPlacePlayer('p1', c.x0 + 12, c.z, c.L);
  run(m, 1.0, strafe(m, 'p1'));
  assert.ok(['alert', 'chase'].includes(m.creature.state));
  const d0 = Math.hypot(m.creature.x - m.players.get('p1').x, m.creature.z - m.players.get('p1').z);
  run(m, 1.5);
  const d1 = Math.hypot(m.creature.x - m.players.get('p1').x, m.creature.z - m.players.get('p1').z);
  assert.ok(m.creature.state === 'chase' || !m.players.get('p1').alive, 'perseguindo: ' + m.creature.state);
  assert.ok(d1 < d0 - 2, `aproximou-se (${d0.toFixed(1)} → ${d1.toFixed(1)})`);
  run(m, 5);
  assert.equal(m.players.get('p1').alive, false, 'alcançou e matou o jogador parado');
});

test('F1: a criatura investiga a última posição conhecida quando perde o alvo', () => {
  const m = makeMatch(1, SEED);
  const c = clearCorridor(m, 1, 30);
  m.debugPlaceCreature(c.x0, c.z, c.L, Math.PI / 2);
  m.debugPlacePlayer('p1', c.x0 + 9, c.z, c.L);
  run(m, 0.8, strafe(m, 'p1'));
  assert.ok(['alert', 'chase'].includes(m.creature.state));
  const lk = { x: m.players.get('p1').x, z: m.players.get('p1').z };
  // o jogador some da visão (outro andar, longe) — a criatura não recebe a nova posição
  const s = m.map.spawns[0];
  m.debugPlacePlayer('p1', m.map.creatureSpawn.level === 2 ? s.x : s.x, s.z, 1);
  const far = m.map.rooms.find(r => r.level === (c.L === 0 ? 3 : 0) && r.type !== 'stairs' && r.type !== 'corridor');
  m.debugPlacePlayer('p1', cc(Math.floor((far.x0 + far.x1) / 2)), cc(Math.floor((far.z0 + far.z1) / 2)), far.level);
  let sawSearch = false, minD = 1e9;
  run(m, 14, () => { if (['search', 'look'].includes(m.creature.state)) sawSearch = true; minD = Math.min(minD, Math.hypot(m.creature.x - lk.x, m.creature.z - lk.z)); });
  assert.ok(sawSearch, 'entrou em busca');
  assert.ok(minD < 3.5, 'foi até a última posição conhecida (dist mín ' + minD.toFixed(2) + ')');
  assert.ok(m.creature.lastInvestigated && /última posição/.test(m.creature.lastInvestigated.reason));
  void CELL;
});
