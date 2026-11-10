// Chaves, saída e morte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, clearCorridor, wallSpot, run, stepPlayer } from './helpers.js';
import { visionCheck } from '../server/senses.js';
import { CREATURE, PLAYER, SOUND_TYPES } from '../shared/config.js';
import { Match } from '../server/match.js';

// v2: chaves dentro de uma gaveta/porta específica ou sobre uma mesa
const spotPos = (m, k) => m.keySpotPos(k);
const goTo = (m, id, k) => { const q = spotPos(m, k); m.debugPlacePlayer(id, q.ax, q.az, q.level); };
// abre a parte certa (se for dentro de móvel) e pega a chave
function grab(m, id, k) {
  goTo(m, id, k);
  if (k.spot.type === 'part') assert.ok(m.interact(id, { kind: 'container', id: k.spot.c, part: k.spot.part, open: true }).ok);
  const r = m.interact(id, { kind: 'key', key: k.id });
  assert.ok(r.ok, JSON.stringify(r));
  return r;
}

test('Chaves: sempre 3 por casa, em lugares válidos de cômodos diferentes; mudam a cada partida', () => {
  for (const phase of [1, 2, 3]) {
    for (const seed of ['k1', 'k2', 'k3', 'k4', 'k5', 'k6']) {
      const m = makeMatch(phase, seed);
      assert.equal(m.keysNeeded, 3);
      assert.equal(m.keys.length, 3, `fase ${phase} semente ${seed}`);
      const rooms = new Set(m.keys.map(k => k.spot.room));
      assert.equal(rooms.size, 3, 'cômodos diferentes');
      for (const k of m.keys) {
        const q = spotPos(m, k);
        assert.ok(m.world.circleFree(q.level, q.ax, q.az, PLAYER.radius), 'acesso livre');
        assert.notEqual(k.spot.room, m.map.exit.room, 'não fica no hall da saída');
        if (k.spot.type === 'part') { const c = m.map.containers[k.spot.c]; assert.ok(k.spot.part >= 0 && k.spot.part < c.parts); }
        else assert.ok(m.map.surfaces[k.spot.s], 'sobre uma mesa/tampo');
      }
    }
  }
  // mesma casa, partidas diferentes (keySeed aleatório) → posições diferentes
  const sig = (m) => m.keys.map(k => JSON.stringify(k.spot)).sort().join('|');
  const sigs = new Set();
  for (let i = 0; i < 6; i++) sigs.add(sig(new Match({ seed: 'mesma-casa', phase: 1, players: [{ id: 'p1', name: 'a' }], keySeed: 'r' + i })));
  assert.ok(sigs.size >= 5, 'posições das chaves variam entre reinícios (' + sigs.size + '/6)');
  // há chaves sobre mesas em parte das casas
  let surf = 0; for (let i = 0; i < 20; i++) surf += makeMatch(1, 'sf' + i).keys.filter(k => k.spot.type === 'surface').length;
  assert.ok(surf > 3 && surf < 40, 'mistura de chaves sobre mesas e dentro de móveis (' + surf + '/60)');
});

test('Gavetas: cada gaveta abre separadamente; a chave só aparece na gaveta certa', () => {
  const m = makeMatch(1, 'gav-1');
  const c = m.map.containers.find(c => c.parts >= 2);
  assert.ok(c, 'existe móvel com várias gavetas');
  // coloca uma chave na 2ª gaveta deste móvel
  const k = m.keys[0]; k.spot = { type: 'part', c: c.id, part: 1, room: c.room, level: c.level };
  m.debugPlacePlayer('p1', c.ax, c.az, c.level);
  let r = m.interact('p1', { kind: 'container', id: c.id, part: 0, open: true });
  assert.ok(r.ok && r.open && r.keys.length === 0, 'gaveta 0 vazia');
  assert.equal(m.partOpen[c.id][1], 0, 'a outra gaveta continua fechada');
  assert.equal(m.interact('p1', { kind: 'key', key: k.id }).ok, false, 'chave ainda escondida');
  r = m.interact('p1', { kind: 'container', id: c.id, part: 1, open: true });
  assert.ok(r.ok && r.keys.includes(k.id), 'gaveta 1 revela a chave');
  // pedido repetido "abrir" não fecha de volta (idempotente)
  r = m.interact('p1', { kind: 'container', id: c.id, part: 1, open: true });
  assert.ok(r.ok && r.open, 'continua aberta');
  assert.equal(m.events.filter(e => e.type === 'container' && e.part === 1).length, 1, 'um só evento');
  assert.equal(m.interact('p1', { kind: 'container', id: c.id, part: 99 }).ok, false, 'gaveta inexistente');
  assert.ok(m.interact('p1', { kind: 'key', key: k.id }).ok);
});

test('Chaves: proximidade, inventário por jogador e HUD ("Você tem N chave")', () => {
  const m = makeMatch(2, 'k-int', 2);
  const k = m.keys.find(q => q.spot.type === 'part') || m.keys[0];
  assert.equal(m.interact('p1', { kind: 'key', key: k.id }).ok, false, 'longe demais');
  const r = grab(m, 'p1', k);
  assert.equal(r.carried, 1);
  assert.equal(m.carriedBy('p1'), 1); assert.equal(m.carriedBy('p2'), 0);
  assert.ok(m.events.some(e => e.type === 'key' && e.key === k.id && e.carried === 1 && e.by === 'p1'));
  assert.equal(m.interact('p1', { kind: 'key', key: k.id }).ok, false, 'não pega duas vezes');
  assert.equal(m.snapshot().players.find(p => p.id === 'p1').k, 1, 'snapshot leva a contagem de chaves');
});

test('Saída: precisa de 3 chaves depositadas por qualquer jogador, em parcelas (2 + 1)', () => {
  const m = makeMatch(1, 'k-exit', 2);
  const e = m.map.exit;
  m.debugPlacePlayer('p1', e.x, e.z + 1.2, 1);
  let r = m.interact('p1', { kind: 'exit', id: 0 });
  assert.equal(r.ok, false); assert.match(r.msg, /trancada/);
  grab(m, 'p1', m.keys[0]); grab(m, 'p1', m.keys[1]); grab(m, 'p2', m.keys[2]);
  m.debugPlacePlayer('p1', e.x, e.z + 1.2, 1);
  r = m.interact('p1', { kind: 'exit', id: 0 });
  assert.ok(r.ok); assert.equal(m.deposited, 2); assert.equal(m.exitOpen, false, 'só 2 de 3');
  assert.equal(m.carriedBy('p1'), 0);
  m.debugPlacePlayer('p2', e.x + 0.3, e.z + 1.2, 1);
  r = m.interact('p2', { kind: 'exit', id: 0 });
  assert.ok(r.ok); assert.equal(m.deposited, 3); assert.equal(m.exitOpen, true);
  assert.ok(m.events.some(ev => ev.type === 'deposit' && ev.n === 2) && m.events.some(ev => ev.type === 'deposit' && ev.n === 1 && ev.total === 3));
  run(m, 2, (t, dt) => { stepPlayer(m, 'p1', 0, -2.4, dt); stepPlayer(m, 'p2', 0, -2.4, dt); });
  assert.equal(m.players.get('p1').escaped, true);
  assert.equal(m.ended, true); assert.equal(m.result, 'win');
});

test('Morte com chaves: o corpo guarda as chaves (fantasminha) e um colega pode pegá-las', () => {
  const m = makeMatch(2, 'k-death', 2);
  grab(m, 'p1', m.keys[0]);
  m.killPlayer(m.players.get('p1'), 'teste');
  const de = m.events.find(e => e.type === 'death' && e.id === 'p1');
  assert.equal(de.keys, 1, 'evento de morte informa as chaves do corpo');
  assert.equal(m.snapshot().players.find(p => p.id === 'p1').k, 1);
  assert.equal(m.ended, false, 'p2 continua');
  const p1 = m.players.get('p1');
  assert.equal(m.interact('p2', { kind: 'body', id: 'p1' }).ok, false, 'longe do corpo');
  m.debugPlacePlayer('p2', p1.x + 0.5, p1.z, p1.level);
  const r = m.interact('p2', { kind: 'body', id: 'p1' });
  assert.ok(r.ok && r.n === 1, JSON.stringify(r));
  assert.equal(m.carriedBy('p2'), 1); assert.equal(m.carriedBy('p1'), 0);
  assert.ok(m.events.some(e => e.type === 'bodykeys' && e.id === 'p1' && e.by === 'p2'));
  grab(m, 'p2', m.keys[1]); grab(m, 'p2', m.keys[2]);
  m.debugPlacePlayer('p2', m.map.exit.x, m.map.exit.z + 1.2, 1);
  assert.ok(m.interact('p2', { kind: 'exit', id: 0 }).ok);
  assert.equal(m.exitOpen, true);
  run(m, 2, (t, dt) => stepPlayer(m, 'p2', 0, -2.4, dt));
  assert.equal(m.result, 'win', 'vitória com sobrevivente que escapou');
});

test('Portas: pedido repetido não fecha logo depois de abrir (correção v2)', () => {
  const m = makeMatch(1, 'porta-1');
  const d = m.map.doors.find(d => d.level === 1 && !d.initialOpen);
  const side = d.axis === 'z' ? [d.x, d.z + 0.8] : [d.x + 0.8, d.z];
  const alt = d.axis === 'z' ? [d.x, d.z - 0.8] : [d.x - 0.8, d.z];
  const pos = m.world.circleFree(1, side[0], side[1], PLAYER.radius) ? side : alt;
  m.debugPlacePlayer('p1', pos[0], pos[1], 1);
  let r = m.interact('p1', { kind: 'door', id: d.id, open: true });
  assert.ok(r.ok && r.open);
  r = m.interact('p1', { kind: 'door', id: d.id, open: true }); // E repetido / mensagem duplicada
  assert.ok(r.ok && r.open); assert.equal(m.world.doorOpen[d.id], 1);
  // sem estado desejado: repique em < 0,6 s é ignorado
  r = m.interact('p1', { kind: 'door', id: d.id });
  assert.equal(m.world.doorOpen[d.id], 1, 'não fechou no repique');
  run(m, 0.7);
  r = m.interact('p1', { kind: 'door', id: d.id, open: false });
  assert.ok(r.ok && !r.open); assert.equal(m.world.doorOpen[d.id], 0);
});

test('Objetos: esbarrão leve balança; forte derruba com barulho (vidro/metal mais alto)', () => {
  const m = makeMatch(2, 'obj-1');
  const k = m.map.knockables.find(q => m.world.circleFree(q.level, q.x + 0.35, q.z, PLAYER.radius) && m.world.circleFree(q.level, q.x + 1.2, q.z, PLAYER.radius));
  assert.ok(k);
  // passa andando encostado: balança, não cai
  m.debugPlacePlayer('p1', k.x + 1.2, k.z, k.level);
  run(m, 0.45, (t, dt) => stepPlayer(m, 'p1', -1.9, 0, dt));
  assert.ok(m.events.some(e => e.type === 'knock' && e.id === k.id && e.state === 'wobble'), 'balançou');
  assert.equal(m.knocked[k.id], 0, 'não caiu');
  // esbarra de novo enquanto ainda balança → cai
  run(m, 0.4, (t, dt) => stepPlayer(m, 'p1', 1.9, 0, dt));
  run(m, 0.5, (t, dt) => stepPlayer(m, 'p1', -1.9, 0, dt));
  assert.equal(m.knocked[k.id], 1, 'caiu no segundo esbarrão');
  const snd = m.sounds.find(s => s.type === 'knock_' + k.kind);
  assert.ok(snd && snd.lvl, 'queda faz barulho com nível');
  assert.equal(SOUND_TYPES.knock_bucket.lvl, 'red'); assert.equal(SOUND_TYPES.knock_vase.lvl, 'yellow'); assert.equal(SOUND_TYPES.knock_box.lvl, 'low');
  // correndo derruba de primeira
  const m2 = makeMatch(2, 'obj-1');
  m2.debugPlacePlayer('p1', k.x + 1.2, k.z, k.level);
  run(m2, 0.5, (t, dt) => stepPlayer(m2, 'p1', -4.6, 0, dt, { run: true }));
  assert.equal(m2.knocked[k.id], 1, 'correndo derruba');
});

test('Morte: contato com a criatura mata instantaneamente', () => {
  const m = makeMatch(1, 'morte-1');
  const c = clearCorridor(m, 1, 30);
  m.debugPlacePlayer('p1', c.x0 + 6, c.z, c.L);
  m.debugPlaceCreature(c.x0 + 6 + CREATURE.contactDist - 0.1, c.z, c.L, -Math.PI / 2);
  m.players.get('p1').lastBodyMoveT = m.t; // o jogador se mexeu (encostou nela)
  m.tick(0.05);
  assert.equal(m.players.get('p1').alive, false);
  assert.ok(m.events.some(e => e.type === 'death' && e.id === 'p1'));
  assert.equal(m.ended, true); assert.equal(m.result, 'lose');
});

test('Morte (v2): jogador PARADO que ela não percebeu não morre por ela passar raspando; ela para e muda de rumo', () => {
  const m = makeMatch(1, 'morte-4');
  const c = clearCorridor(m, 1, 30);
  m.debugPlacePlayer('p1', c.x0 + 8, c.z, c.L);
  m.debugPlaceCreature(c.x0, c.z, c.L, Math.PI / 2);
  m.creature.setState('patrol'); m.creature.goTo(c.x0 + 14, c.z, c.L);
  let sawCloseCall = false;
  run(m, 8, () => { m.applyInput('p1', { x: m.players.get('p1').x, z: m.players.get('p1').z, yaw: 0, fl: false }); if (m.creature.tension) sawCloseCall = true; });
  assert.equal(m.players.get('p1').alive, true, 'continua vivo');
  assert.ok(sawCloseCall, 'parou perto dele (tensão) antes de mudar de rumo');
});

test('Morte: não ocorre através de paredes', () => {
  const m = makeMatch(1, 'morte-2');
  const w = wallSpot(m, 1); assert.ok(w);
  // centros a ~1,0 m, mas com a parede (0,5 m) entre eles
  m.debugPlacePlayer('p1', w.x, w.zRoom + 0.0, w.L);
  m.debugPlaceCreature(w.x, w.zCorr - 0.0, w.L, Math.PI);
  const d = Math.hypot(0, w.zCorr - w.zRoom);
  assert.ok(d <= CREATURE.contactDist, 'perto o bastante para contato se não houvesse parede (' + d + ')');
  m.tick(0.05); m.tick(0.05);
  assert.equal(m.players.get('p1').alive, true);
  // ataque também respeita paredes
  assert.deepEqual(m.attackStrike(m.creature), []);
});

test('Morte: jogador morto não interage, não emite som/cheiro e não é percebido (espectador)', () => {
  const m = makeMatch(3, 'morte-3', 2);
  const c = clearCorridor(m, 1, 30);
  m.debugPlacePlayer('p1', c.x0 + 6, c.z, c.L);
  m.killPlayer(m.players.get('p1'), 'teste');
  const p = m.players.get('p1');
  const r = m.interact('p1', { kind: 'door', id: 0 });
  assert.equal(r.ok, false);
  const before = m.sounds.length, scent = m.scent.size;
  for (let i = 0; i < 20; i++) { assert.ok(m.applyInput('p1', { x: p.x + i * 0.1, z: p.z }).ignored); m.tick(0.05); }
  assert.equal(m.sounds.length, before); assert.equal(m.scent.size, scent);
  m.debugPlaceCreature(c.x0, c.z, c.L, Math.PI / 2);
  assert.equal(visionCheck(m, m.creature, p).visible, false);
  assert.equal(m.ended, false, 'partida continua com o outro jogador');
});

test('Validação de movimento: velocidade impossível e atravessar paredes são corrigidos', () => {
  const m = makeMatch(1, 'mov-1');
  const w = wallSpot(m, 1);
  m.debugPlacePlayer('p1', w.x, w.zRoom, w.L);
  m.tick(0.05);
  let r = m.applyInput('p1', { x: w.x, z: w.zCorr + 0.5 });
  assert.ok(r.correction, 'atravessar parede → correção');
  r = m.applyInput('p1', { x: w.x + 9, z: w.zRoom });
  assert.ok(r.correction && r.correction.reason === 'velocidade');
  const p = m.players.get('p1');
  assert.equal(p.x, w.x); assert.equal(p.z, w.zRoom);
});
