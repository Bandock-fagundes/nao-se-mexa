// v2 — IA da criatura: vê de longe → aproxima-se aos poucos; parado não é perseguido; nunca some; bastidores.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, clearCorridor, run, strafe } from './helpers.js';
import { Match } from '../server/match.js';
import { AI, CREATURE } from '../shared/config.js';

const SEED = 'ia-v2-1';

test('IA v2: viu alguém se mexer MUITO longe → vai andando na direção (não dispara na hora)', () => {
  const m = makeMatch(1, SEED);
  const c = clearCorridor(m, 1, 30);
  m.debugPlaceCreature(c.x0, c.z, c.L, Math.PI / 2);
  m.debugPlacePlayer('p1', c.x0 + AI.stalkRange + 3, c.z, c.L);
  run(m, 0.6, strafe(m, 'p1'));
  assert.equal(m.creature.state, 'stalk', 'aproximando-se: ' + m.creature.state);
  // parado: ela segue até o ponto visto, devagar, e não persegue
  let maxSp = 0, chased = false;
  run(m, 3, () => { maxSp = Math.max(maxSp, m.creature.speed); if (m.creature.state === 'chase') chased = true; });
  assert.ok(!chased, 'jogador parado não é perseguido');
  assert.ok(maxSp <= CREATURE.speed.investigate * 1.2, 'anda, não corre (' + maxSp.toFixed(2) + ')');
  // se o jogador volta a se mexer quando ela já está mais perto → percebe e persegue
  const m2 = makeMatch(1, SEED);
  m2.debugPlaceCreature(c.x0, c.z, c.L, Math.PI / 2);
  m2.debugPlacePlayer('p1', c.x0 + 8, c.z, c.L);
  run(m2, 1.2, strafe(m2, 'p1'));
  assert.ok(['alert', 'chase'].includes(m2.creature.state), 'perto: alerta/perseguição (' + m2.creature.state + ')');
});

test('IA v2: jogador parado e silencioso não é perseguido; perder a visão por 1 s faz esquecer quem ficou parado', () => {
  const m = makeMatch(1, SEED);
  const c = clearCorridor(m, 1, 30);
  m.debugPlaceCreature(c.x0, c.z, c.L, Math.PI / 2);
  m.debugPlacePlayer('p1', c.x0 + 7, c.z, c.L);
  m.creature.setState('patrol');
  run(m, 4, () => m.applyInput('p1', { x: m.players.get('p1').x, z: m.players.get('p1').z, yaw: 0, fl: false }));
  assert.ok(!['alert', 'chase', 'attack'].includes(m.creature.state), 'parado: ' + m.creature.state);
  assert.equal(AI.detectionMemory <= 2.0, true);
});

test('IA v2: a criatura nunca some — passa perto dos jogadores com frequência, mesmo com ameaça baixa', () => {
  for (const seed of ['nunca-1', 'nunca-2', 'nunca-3']) {
    const m = new Match({ seed, phase: 1, players: [{ id: 'p1', name: 'a' }], keySeed: 'x' });
    m.director.override = 0; // ameaça mínima o tempo todo
    // jogador escondido parado (não é visto nem ouvido) num cômodo do térreo
    const r = m.map.rooms.find(q => q.level === 1 && q.type === 'bedroom') || m.map.rooms.find(q => q.level === 1 && q.type !== 'corridor' && q.type !== 'stairs' && q.type !== 'hall');
    const p = m.creature.roomPoint(r);
    m.debugPlacePlayer('p1', p.x, p.z, 1);
    let maxGap = 0, nears = 0, wasNear = false;
    for (let i = 0; i < 20 * 300; i++) {
      m.tick(0.05);
      maxGap = Math.max(maxGap, m.director.gap);
      const near = m.creature.minPlayerDist < 14;
      if (near && !wasNear) nears++;
      wasNear = near;
    }
    assert.ok(maxGap < 150, `${seed}: tempo máximo sem chegar perto ${maxGap.toFixed(0)} s`);
    assert.ok(nears >= 2, `${seed}: chegou perto ${nears}× em 5 min`);
  }
});

test('IA v2: bastidores — longe e sem ninguém vendo, ela anda mais rápido (some e reaparece sem teleporte)', () => {
  const m = new Match({ seed: SEED, phase: 1, players: [{ id: 'p1', name: 'a' }], keySeed: 'x' });
  const s = m.map.spawns[0];
  m.debugPlacePlayer('p1', s.x, s.z, 1);
  let fast = 0, slowNear = true, jumps = 0, prev = null;
  for (let i = 0; i < 20 * 120; i++) {
    m.tick(0.05);
    const cr = m.creature;
    if (cr.unseenFar && cr.speed > CREATURE.speed.patrol * 1.5) fast++;
    if (['patrol', 'wander', 'return'].includes(cr.state) && cr.minPlayerDist < 10 && cr.speed > CREATURE.speed.patrol * 1.3) slowNear = false;
    if (prev && Math.hypot(cr.x - prev.x, cr.z - prev.z) > 0.6) jumps++;
    prev = { x: cr.x, z: cr.z };
  }
  assert.ok(fast > 20, 'andou rápido nos bastidores (' + fast + ' ticks)');
  assert.ok(slowNear, 'perto dos jogadores patrulha devagar');
  assert.equal(jumps, 0, 'sem teletransporte');
});
