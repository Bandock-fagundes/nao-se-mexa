// Fase 3 — visão + audição + olfato.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, clearCorridor, run, stepPlayer, strafe, cc } from './helpers.js';
import { ScentGrid } from '../server/scent.js';
import { AI, CREATURE, CELL } from '../shared/config.js';
import { hearingCheck, makeSoundEvent } from '../server/senses.js';

const SEED = 'fase-tres-5';
const hide = (m, id = 'p1') => { const r = m.map.rooms.find(r => r.level === 3 && r.type !== 'corridor' && r.type !== 'stairs'); m.debugPlacePlayer(id, cc(Math.floor((r.x0 + r.x1) / 2)), cc(Math.floor((r.z0 + r.z1) / 2)), 3); };

test('F3: comportamentos anteriores continuam (visão e audição ativas)', () => {
  const m = makeMatch(3, SEED);
  assert.ok(m.phaseCfg.vision && m.phaseCfg.hearing && m.phaseCfg.smell);
  const c = clearCorridor(m, 1, 30);
  m.debugPlaceCreature(c.x0, c.z, 1, Math.PI / 2);
  m.debugPlacePlayer('p1', c.x0 + 9, c.z, 1);
  run(m, 1.2, strafe(m, 'p1'));
  assert.ok(['alert', 'chase'].includes(m.creature.state));
  const h = hearingCheck(m, m.creature, makeSoundEvent(m, 'step_walk', c.x0 + 5, 0, c.z, 1));
  assert.equal(h.heard, true);
});

test('F3: o farejamento ocorre periodicamente (20–30 s com variação)', () => {
  const m = makeMatch(3, SEED);
  hide(m);
  m.creature.nextSniffT = m.t + 20 + Math.random() * 10;
  m.creature.pickPatrol();
  const sniffs = [];
  let prev = null;
  run(m, 95, () => { if (m.creature.state === 'sniff' && prev !== 'sniff' && !m.creature.sniffLocal) sniffs.push(m.t); prev = m.creature.state; });
  assert.ok(sniffs.length >= 3, 'farejou ' + sniffs.length + ' vezes');
  for (let i = 1; i < sniffs.length; i++) { const d = sniffs[i] - sniffs[i - 1]; assert.ok(d >= 19.5 && d <= 36, 'intervalo ' + d.toFixed(1)); }
});

test('F3: rastros recentes podem ser detectados e perdem intensidade com o tempo', () => {
  const g = new ScentGrid(45);
  g.deposit(1, 10, 10, 0.5, 0);
  const v0 = g.value(1, 10, 10, 0), v45 = g.value(1, 10, 10, 45), v120 = g.value(1, 10, 10, 120);
  assert.ok(Math.abs(v0 - 0.5) < 1e-6);
  assert.ok(Math.abs(v45 - 0.25) < 0.01, 'meia-vida');
  assert.ok(v120 < v0 / 5);
  g.prune(400); assert.equal(g.size, 0, 'rastros velhos são descartados (memória limitada)');
  // na partida: jogador anda, some; a criatura fareja e encontra o rastro
  const m = makeMatch(3, SEED);
  const c = clearCorridor(m, 1, 30);
  m.debugPlacePlayer('p1', c.x0 + 3, c.z, 1);
  run(m, 2.5, (t, dt) => stepPlayer(m, 'p1', 2.4, 0, dt));
  assert.ok(m.scent.size > 3, 'deixou rastro');
  hide(m);
  m.debugPlaceCreature(c.x0, c.z, 1, -Math.PI / 2);
  m.creature.setState('patrol'); m.creature.path = null;
  m.creature.nextSniffT = m.t;
  run(m, AI.sniffDuration + 0.3);
  assert.equal(m.creature.state, 'track', 'detectou o rastro: ' + m.creature.state);
  assert.ok(m.creature.sniffInfo.found);
});

test('F3: a criatura segue uma sequência de rastros, sem posição exata do jogador', () => {
  const m = makeMatch(3, SEED);
  const c = clearCorridor(m, 1, 30);
  m.debugPlacePlayer('p1', c.x0 + 2, c.z, 1);
  run(m, 5.5, (t, dt) => stepPlayer(m, 'p1', 2.5, 0, dt)); // trilha de ~13 m
  const trailEnd = { x: m.players.get('p1').x, z: m.players.get('p1').z };
  hide(m); // vai para outro lugar sem deixar trilha até lá (teleporte de teste)
  const playerNow = { x: m.players.get('p1').x, z: m.players.get('p1').z, level: 3 };
  m.debugPlaceCreature(c.x0, c.z, 1, Math.PI / 2);
  m.creature.setState('patrol'); m.creature.path = null; m.creature.nextSniffT = m.t;
  const targets = [];
  run(m, 30, () => { if (m.creature.track && (!targets.length || targets[targets.length - 1] !== m.creature.track)) targets.push(m.creature.track); });
  assert.ok(targets.length >= 2, 'seguiu ' + targets.length + ' sinais');
  const reached = Math.min(...m.creature.trace.map(s => Math.hypot(s.x - trailEnd.x, s.z - trailEnd.z)));
  assert.ok(reached < 4, 'chegou perto do fim da trilha (' + reached.toFixed(2) + ')');
  for (const tg of targets) assert.ok(tg.L !== playerNow.level || Math.hypot(tg.x - playerNow.x, tg.z - playerNow.z) > 2, 'nunca mirou a posição atual do jogador');
});

test('F3: a criatura não atravessa paredes nem se teletransporta', () => {
  const m = makeMatch(3, SEED);
  m.creature.pickPatrol();
  m.creature.nextSniffT = m.t + 5;
  const c = clearCorridor(m, 1, 30);
  m.debugPlacePlayer('p1', c.x0, c.z, 1);
  const trace = [];
  run(m, 60, (t, dt) => { if (t < 20) stepPlayer(m, 'p1', Math.sin(t) * 2, 0, dt); const cr = m.creature; trace.push({ x: cr.x, z: cr.z, level: cr.level, t }); });
  const maxStep = 5.0 * 0.05 * 1.5;
  let moved = 0;
  for (let i = 1; i < trace.length; i++) {
    const a = trace[i - 1], b = trace[i];
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    moved += d;
    assert.ok(d <= maxStep, `salto de ${d.toFixed(3)} m em um tick`);
    if (a.level === b.level) assert.ok(m.world.noWallBetween(a.level, a.x, a.z, b.x, b.z) || m.world.circleFree(b.level, b.x, b.z, 0.3), 'atravessou parede');
    assert.ok(m.world.circleFree(b.level, b.x, b.z, 0.3, true), 'posição dentro de parede/móvel');
  }
  assert.ok(moved > 10, 'a criatura se moveu de verdade (' + moved.toFixed(1) + ' m)');
  void CREATURE;
});

test('F3: a criatura abandona uma investigação sem resultados', () => {
  const m = makeMatch(3, SEED);
  hide(m);
  // nenhum rastro: farejar → nada encontrado → volta a explorar
  m.creature.setState('patrol'); m.creature.nextSniffT = m.t;
  run(m, AI.sniffDuration + 0.5);
  assert.equal(m.creature.sniffInfo.state, 'nada encontrado');
  assert.ok(['patrol', 'wander', 'look'].includes(m.creature.state));
  // rastro que acaba: segue e depois desiste
  const c = clearCorridor(m, 1, 30);
  m.debugPlacePlayer('p1', c.x0, c.z, 1);
  run(m, 2, (t, dt) => stepPlayer(m, 'p1', 2.4, 0, dt));
  hide(m);
  m.debugPlaceCreature(c.x0, c.z, 1, Math.PI / 2);
  m.creature.setState('patrol'); m.creature.path = null; m.creature.nextSniffT = m.t;
  let tracked = false, abandoned = false;
  run(m, 70, () => { if (m.creature.state === 'track') tracked = true; if (tracked && ['return', 'patrol', 'wander', 'recover'].includes(m.creature.state) && !m.creature.track) abandoned = true; if (m.creature.nextSniffT - m.t > 40) m.creature.nextSniffT = m.t + 25; });
  assert.ok(tracked, 'chegou a rastrear');
  assert.ok(abandoned, 'abandonou o rastro: ' + m.creature.sniffInfo.state);
});
