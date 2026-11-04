// Fase 2 — visão + audição.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, clearCorridor, wallSpot, run, stepPlayer, strafe, navAtDistance } from './helpers.js';
import { LEVELS } from '../shared/config.js';
import { hearingCheck, makeSoundEvent } from '../server/senses.js';
import { SOUND_TYPES } from '../shared/config.js';
import { soundReaches, roomGraph } from '../shared/sound.js';

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

test('F2: passos de corrida são ouvidos e a criatura investiga a origem aproximada', () => {
  const m = makeMatch(2, SEED);
  const c = clearCorridor(m, 1, 30);
  m.debugPlaceCreature(c.x0 + 14, c.z, 1, Math.PI / 2); // olhando +x
  m.debugPlacePlayer('p1', c.x0 + 9, c.z, 1); // 5 m atrás dela: fora do campo de visão
  run(m, 0.5, (t, dt) => stepPlayer(m, 'p1', -4.6, 0, dt, { run: true })); // corre (pá pá pá)
  const basement = m.map.rooms.find(r => r.level === 0 && r.type === 'corridor');
  m.debugPlacePlayer('p1', (basement.x0 + 3) * 0.5, (basement.z0 + 2) * 0.5, 0); // some sem fazer barulho
  run(m, 0.3);
  const cr = m.creature;
  assert.ok(cr.lastSound, 'ouviu algo');
  assert.equal(cr.lastSound.type, 'step_run');
  assert.ok(['hear', 'investigate', 'inspect'].includes(cr.state), 'reagiu: ' + cr.state);
  assert.ok(cr.target === null, 'som não dá alvo exato');
  const inv = cr.invest;
  const err = Math.hypot(inv.x - inv.srcX, inv.z - inv.srcZ);
  assert.ok(err <= 3.8, 'origem aproximada (erro ' + err.toFixed(2) + ')');
  const target = { x: inv.x, z: inv.z };
  let minD = 1e9;
  run(m, 8, () => { minD = Math.min(minD, Math.hypot(cr.x - target.x, cr.z - target.z)); });
  assert.ok(minD < 1.0, 'caminhou até a região do som (' + minD.toFixed(2) + ')');
});

test('F2: andar normal não é ouvido nem lado a lado; agachado é silêncio total; a madeira range às vezes', () => {
  const m = makeMatch(2, SEED);
  const c = clearCorridor(m, 1, 30);
  m.debugPlaceCreature(c.x0, c.z, 1, Math.PI / 2);
  const at = (d, type) => hearingCheck(m, m.creature, makeSoundEvent(m, type, c.x0 + d, 0, c.z, 1));
  assert.equal(at(1, 'step_walk').heard, false, 'andar normal ao lado: não ouve');
  assert.equal(at(1, 'step_crouch').heard, false, 'agachado ao lado: não ouve');
  assert.equal(at(6, 'creak').heard, true, 'rangido no mesmo cômodo: ouve');
  assert.equal(at(12, 'step_run').heard, true, 'corrida no mesmo cômodo: ouve');
  // estatística real dos passos: andar faz rangidos (só às vezes), correr nunca range, agachar não faz nada
  const m2 = makeMatch(2, SEED);
  const c2 = clearCorridor(m2, 1, 30);
  const cnt = (mode, v) => {
    m2.sounds.length = 0; const seen = {};
    m2.debugPlacePlayer('p1', c2.x0, c2.z, 1);
    let dir = 1;
    run(m2, 12, (t, dt) => { const p = m2.players.get('p1'); if (p.x > c2.x1 - 1) dir = -1; if (p.x < c2.x0 + 1) dir = 1; stepPlayer(m2, 'p1', dir * v, 0, dt, mode); for (const s of m2.sounds.splice(0)) seen[s.type] = (seen[s.type] || 0) + 1; });
    return seen;
  };
  const walk = cnt({}, 2.4), runS = cnt({ run: true }, 4.8), crouch = cnt({ crouch: true }, 1.25);
  if (m2.world.surfaceAt(1, c2.x0, c2.z) === 'wood') assert.ok((walk.creak || 0) >= 1 && walk.creak < walk.step_walk, 'andando: rangidos ocasionais ' + JSON.stringify(walk));
  assert.ok(!runS.creak && runS.step_run > 10, 'correndo: sem rangido, passos ouvíveis ' + JSON.stringify(runS));
  assert.equal(Object.keys(crouch).filter(k => k !== 'step_crouch').length, 0, 'agachado: nada audível ' + JSON.stringify(crouch));
});

test('F2: níveis de som — vermelho (casa toda), amarelo (andar + abaixo), baixo (cômodo e vizinhos)', () => {
  const m = makeMatch(2, SEED);
  const map = m.map;
  const room = (L, type) => map.rooms.find(r => r.level === L && (!type || r.type === type) && r.type !== 'stairs');
  const mid = (r) => ({ x: (r.x0 + r.x1 + 1) / 2 * 0.5, z: (r.z0 + r.z1 + 1) / 2 * 0.5 });
  const lis = (r) => ({ level: r.level, ...mid(r) });
  const ev = (type, r) => ({ type, lvl: SOUND_TYPES[type].lvl, level: r.level, ...mid(r) });
  const g = roomGraph(map);
  const attic = room(3), basement = room(0, 'corridor'), corr1 = room(1, 'corridor'), corr2 = room(2, 'corridor');
  // vermelho: do sótão ao porão
  assert.equal(soundReaches(map, ev('knock_bucket', attic), lis(basement)).heard, true);
  // amarelo: mesmo andar (qualquer cômodo) e o andar logo abaixo; não acima, nem dois abaixo
  const far1 = map.rooms.filter(r => r.level === 1 && r.type !== 'stairs' && r.id !== corr1.id && !g[corr1.id].has(r.id));
  const a = far1[0] || corr1;
  assert.equal(soundReaches(map, ev('knock_vase', a), lis(corr1)).heard, true, 'amarelo mesmo andar');
  assert.equal(soundReaches(map, ev('knock_vase', corr2), lis(corr1)).heard, true, 'amarelo andar de cima → ouvido embaixo');
  assert.equal(soundReaches(map, ev('knock_vase', corr1), lis(corr2)).heard, false, 'amarelo não sobe');
  assert.equal(soundReaches(map, ev('knock_vase', attic), lis(corr1)).heard, false, 'amarelo não desce dois andares');
  // baixo: mesmo cômodo e vizinho sim; cômodo distante não
  const nb = [...g[corr1.id]].map(i => map.rooms[i]).find(r => r.level === 1 && r.type !== 'stairs');
  assert.equal(soundReaches(map, ev('door_wood', nb), lis(corr1)).heard, true, 'baixo: vizinho');
  const nonNb = map.rooms.find(r => r.level === 1 && r.type !== 'stairs' && r.type !== 'corridor' && r.id !== nb.id && !g[nb.id].has(r.id) && Math.hypot(mid(r).x - mid(nb).x, mid(r).z - mid(nb).z) > 6);
  if (nonNb) assert.equal(soundReaches(map, ev('door_wood', nb), lis(nonNb)).heard, false, 'baixo: distante');
  // baixo com "below": rangido ouvido logo abaixo
  const p = mid(corr2);
  assert.equal(soundReaches(map, { type: 'creak', lvl: 'low', level: 2, ...p }, { level: 1, ...p }).heard, true, 'rangido ouvido logo abaixo');
  assert.equal(soundReaches(map, { type: 'door_wood', lvl: 'low', level: 2, ...p }, { level: 1, ...p }).heard, false, 'porta de madeira não desce');
});

test('F2: som distante → corre; perto desacelera; depois circula e confere cômodos vizinhos', () => {
  const m = makeMatch(2, SEED);
  const c = clearCorridor(m, 1, 30);
  m.debugPlaceCreature(c.x0, c.z, 1, Math.PI / 2);
  m.creature.setState('patrol'); m.creature.path = null;
  // balde caindo (vermelho) longe, no outro extremo do corredor
  const k = { x: c.x1, z: c.z };
  m.emitSound('knock_bucket', k.x, 0.3, k.z, 1, { source: 'object' });
  let maxSp = 0, sawRush = false, slowNear = false, sawCheck = false; const rooms = new Set();
  run(m, 30, () => {
    const cr = m.creature;
    if (cr.state === 'investigate' && cr.rushing) { sawRush = true; maxSp = Math.max(maxSp, cr.speed); }
    if (cr.state === 'investigate' && !cr.rushing && Math.hypot(cr.x - k.x, cr.z - k.z) < 9 && cr.speed < 2.2) slowNear = true;
    if (cr.state === 'check') { sawCheck = true; rooms.add(m.world.roomAt(cr.level, cr.x, cr.z)); }
  });
  assert.ok(sawRush && maxSp > 3.3, 'correu até o som (v máx ' + maxSp.toFixed(2) + ')');
  assert.ok(slowNear, 'desacelerou ao chegar perto');
  assert.ok(sawCheck, 'circulou/conferiu em volta');
  assert.ok(rooms.size >= 2, 'conferiu mais de um cômodo (' + [...rooms].join(',') + ')');
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
  run(m, 0.8, (t, dt) => stepPlayer(m, 'p1', -4.6, 0, dt, { run: true }));
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
