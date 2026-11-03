// Fase 2 — visão + audição.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, clearCorridor, wallSpot, run, stepPlayer, strafe, navAtDistance } from './helpers.js';
import { LEVELS } from '../shared/config.js';
import { hearingCheck, makeSoundEvent } from '../server/senses.js';
import { SOUND_TYPES } from '../shared/config.js';

const SEED = 'fase-dois-3';

test('F2: comportamentos da fase 1 continuam (visão por movimento, sem ver através de paredes)', () => {
  const m = makeMatch(2, SEED);
  const c = clearCorridor(m, 1, 30);
  m.debugPlaceCreature(c.x0, c.z, 1, Math.PI / 2);
  m.debugPlacePlayer('p1', c.x0 + 9, c.z, 1);
  run(m, 2, () => m.applyInput('p1', { x: m.players.get('p1').x, z: m.players.get('p1').z, yaw: 1, fl: false }));
  assert.equal(m.creature.state, 'hold', 'parado e silencioso: não detectado');
  run(m, 1.2, strafe(m, 'p1', 1.2, 0.4));
  assert.ok(['alert', 'chase'].includes(m.creature.state));
  const m2 = makeMatch(2, SEED);
  const w = wallSpot(m2, 1);
  m2.debugPlaceCreature(w.x, w.zCorr, 1, Math.PI);
  m2.debugPlacePlayer('p1', w.x, w.zRoom - 1, 1);
  assert.equal(m2.world.lineOfSight(1, w.x, w.zCorr, w.x, w.zRoom - 1), false);
});

test('F2: detecta sons dentro do alcance configurado e investiga a origem aproximada', () => {
  const m = makeMatch(2, SEED);
  const c = clearCorridor(m, 1, 30);
  m.debugPlaceCreature(c.x0 + 14, c.z, 1, Math.PI / 2); // olhando +x
  m.debugPlacePlayer('p1', c.x0 + 9, c.z, 1); // 5 m atrás dela: fora do campo de visão
  run(m, 0.5, (t, dt) => stepPlayer(m, 'p1', -1.8, 0, dt)); // um passo normal
  const basement = m.map.rooms.find(r => r.level === 0 && r.type === 'corridor');
  m.debugPlacePlayer('p1', (basement.x0 + 3) * 0.5, (basement.z0 + 2) * 0.5, 0); // some sem fazer barulho
  run(m, 0.3);
  const cr = m.creature;
  assert.ok(cr.lastSound, 'ouviu algo');
  assert.equal(cr.lastSound.type, 'step_walk');
  assert.ok(['hear', 'investigate', 'inspect'].includes(cr.state), 'reagiu: ' + cr.state);
  assert.ok(cr.target === null, 'som não dá alvo exato');
  const inv = cr.invest;
  const err = Math.hypot(inv.x - inv.srcX, inv.z - inv.srcZ);
  assert.ok(err <= Math.min(3, 0.12 * 8 + 0.4) + 0.8, 'origem aproximada (erro ' + err.toFixed(2) + ')');
  // vai até a região
  const target = { x: inv.x, z: inv.z };
  let minD = 1e9;
  run(m, 8, () => { minD = Math.min(minD, Math.hypot(cr.x - target.x, cr.z - target.z)); });
  assert.ok(minD < 1.0, 'caminhou até a região do som (' + minD.toFixed(2) + ')');
});

test('F2: sons mais intensos têm alcance maior; agachar reduz e correr aumenta o ruído', () => {
  const m = makeMatch(2, SEED);
  const c = clearCorridor(m, 1, 30);
  m.debugPlaceCreature(c.x0, c.z, 1, Math.PI / 2);
  const at = (d, type) => hearingCheck(m, m.creature, makeSoundEvent(m, type, c.x0 + d, 0, c.z, 1));
  assert.ok(SOUND_TYPES.step_run.range > SOUND_TYPES.step_walk.range && SOUND_TYPES.step_walk.range > SOUND_TYPES.step_crouch.range);
  assert.equal(at(12, 'step_walk').heard, false, 'passo normal a 12 m não é ouvido');
  assert.equal(at(12, 'step_run').heard, true, 'corrida a 12 m é ouvida');
  assert.equal(at(5, 'step_crouch').heard, false, 'agachado a 5 m não é ouvido');
  assert.equal(at(5, 'step_walk').heard, true, 'andando a 5 m é ouvido');
  assert.ok(at(20, 'knock_bucket').heard, 'balde de metal a 20 m é ouvido');
  // o servidor classifica os passos pela velocidade real do corpo
  const m2 = makeMatch(2, SEED);
  const c2 = clearCorridor(m2, 1, 30);
  m2.debugPlacePlayer('p1', c2.x0, c2.z, 1);
  run(m2, 1.5, (t, dt) => stepPlayer(m2, 'p1', 1.2, 0, dt, { crouch: true }));
  assert.ok(m2.sounds.every(s => s.type === 'step_crouch'), 'agachado → step_crouch');
  m2.sounds.length = 0;
  run(m2, 1.5, (t, dt) => stepPlayer(m2, 'p1', 4.8, 0, dt, { run: true }));
  assert.ok(m2.sounds.some(s => s.type === 'step_run'), 'correndo → step_run');
  // trapaça: declarar agachado correndo não reduz o ruído
  m2.sounds.length = 0;
  run(m2, 1.0, (t, dt) => stepPlayer(m2, 'p1', -4.8, 0, dt, { crouch: true }));
  assert.ok(m2.sounds.some(s => s.type === 'step_run'));
});

test('F2: paredes e portas fechadas atenuam o som', () => {
  const m = makeMatch(2, SEED);
  const w = wallSpot(m, 1);
  m.debugPlaceCreature(w.x, w.zCorr + 1.0, 1, 0);
  const open = hearingCheck(m, m.creature, makeSoundEvent(m, 'step_walk', w.x + 6, 0, w.zCorr + 1.0, 1));
  const wall = hearingCheck(m, m.creature, makeSoundEvent(m, 'step_walk', w.x, 0, w.zRoom - 4.5, 1));
  assert.equal(open.walls, 0); assert.ok(wall.walls >= 1);
  assert.ok(wall.effRange < open.effRange * 0.5);
});

test('F2: objetos derrubados atraem a criatura', () => {
  const m = makeMatch(2, SEED);
  const k = m.map.knockables.find(k => k.level === 1) || m.map.knockables[0];
  // criatura a 7–10 m (de caminho) do objeto
  const pos = navAtDistance(m, k.level, k.x, k.z, 7, 10);
  m.debugPlaceCreature(pos.x, pos.z, k.level, 0);
  const d0 = Math.hypot(pos.x - k.x, pos.z - k.z);
  m.debugPlacePlayer('p1', k.x + 0.6, k.z, k.level);
  const r = m.interact('p1', { kind: 'knock', id: k.id });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(m.knocked[k.id], 1);
  m.debugPlacePlayer('p1', m.map.spawns[0].x, m.map.spawns[0].z, 1); // sai de perto (sem ruído)
  run(m, 0.2);
  const cr = m.creature;
  assert.ok(cr.lastSound && cr.lastSound.type.startsWith('knock_'), 'ouviu o objeto cair');
  let minD = 1e9;
  run(m, 10, () => { minD = Math.min(minD, Math.hypot(cr.x - k.x, cr.z - k.z)); });
  assert.ok(minD < 3.6 || minD < d0 * 0.45, `foi até perto do objeto (${d0.toFixed(1)} → ${minD.toFixed(2)})`);
});

test('F2: a criatura não recebe a posição exata do jogador ao ouvi-lo', () => {
  const m = makeMatch(2, SEED);
  const c = clearCorridor(m, 1, 30);
  m.debugPlaceCreature(c.x0 + 16, c.z, 1, Math.PI / 2);
  m.debugPlacePlayer('p1', c.x0 + 9, c.z, 1);
  run(m, 0.8, (t, dt) => stepPlayer(m, 'p1', -2.0, 0, dt));
  const src = { x: m.creature.invest.srcX, z: m.creature.invest.srcZ };
  // jogador é levado para longe sem fazer barulho: a criatura continua indo à origem do som
  const far = m.map.spawns[0];
  m.debugPlacePlayer('p1', far.x, far.z, 1);
  run(m, 1.0);
  const inv = m.creature.invest;
  assert.ok(Math.hypot(inv.srcX - src.x, inv.srcZ - src.z) < 0.01);
  assert.ok(Math.hypot(inv.x - far.x, inv.z - far.z) > 5, 'alvo da investigação não é a nova posição do jogador');
});

test('F2: a criatura não persegue sons que não foram detectados', () => {
  const m = makeMatch(2, SEED);
  const c = clearCorridor(m, 1, 30);
  m.debugPlaceCreature(c.x0, c.z, 1, Math.PI / 2);
  // som baixo e longe
  m.emitSound('step_crouch', c.x0 + 9, 0, c.z, 1, { source: 'player' });
  // passo normal dois andares acima
  m.emitSound('step_walk', c.x0, LEVELS[3].y, c.z, 3, { source: 'player' });
  run(m, 2);
  assert.equal(m.creature.state, 'hold');
  assert.equal(m.creature.lastSound, null);
});
