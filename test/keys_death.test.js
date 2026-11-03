// Chaves, saída e morte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, clearCorridor, wallSpot, run, stepPlayer } from './helpers.js';
import { visionCheck } from '../server/senses.js';
import { CREATURE, PLAYER } from '../shared/config.js';

const goTo = (m, id, c) => m.debugPlacePlayer(id, c.ax, c.az, c.level);

test('Chaves: quantidade correta por fase (1/2/3) em esconderijos válidos e salas diferentes', () => {
  for (const [phase, n] of [[1, 1], [2, 2], [3, 3]]) {
    for (const seed of ['k1', 'k2', 'k3', 'k4', 'k5']) {
      const m = makeMatch(phase, seed);
      assert.equal(m.keysNeeded, n);
      assert.equal(m.keyContainers.length, n, `fase ${phase} semente ${seed}`);
      const rooms = new Set(m.keyContainers.map(id => m.map.containers[id].room));
      assert.equal(rooms.size, n, 'salas diferentes');
      for (const id of m.keyContainers) {
        const c = m.map.containers[id];
        assert.ok(['drawer', 'wardrobe', 'cabinet', 'chest', 'crate', 'shelf'].includes(c.kind));
        assert.ok(m.world.circleFree(c.level, c.ax, c.az, PLAYER.radius), 'acesso livre ao esconderijo');
        assert.notEqual(c.room, m.map.exit.room, 'não fica no hall da saída');
      }
    }
  }
});

test('Chaves: interação exige proximidade; abrir/fechar recipiente; pegar a chave', () => {
  const m = makeMatch(2, 'k-int');
  const cid = m.keyContainers[0], c = m.map.containers[cid];
  let r = m.interact('p1', { kind: 'container', id: cid });
  assert.equal(r.ok, false, 'longe demais');
  goTo(m, 'p1', c);
  r = m.interact('p1', { kind: 'key', id: cid });
  assert.equal(r.ok, false, 'precisa abrir antes');
  r = m.interact('p1', { kind: 'container', id: cid });
  assert.ok(r.ok && r.open && r.key !== null, 'abriu e revelou a chave');
  assert.ok(m.events.some(e => e.type === 'container' && e.id === cid && e.key !== null));
  r = m.interact('p1', { kind: 'key', id: cid });
  assert.ok(r.ok);
  assert.equal(m.keysCollected.length, 1);
  assert.ok(m.events.some(e => e.type === 'key' && e.count === 1 && e.needed === 2));
  // não pode coletar a mesma chave duas vezes
  r = m.interact('p1', { kind: 'key', id: cid });
  assert.equal(r.ok, false);
  assert.equal(m.keysCollected.length, 1);
  r = m.interact('p1', { kind: 'container', id: cid });
  assert.ok(r.ok && r.open === false, 'fechou');
  // recipiente sem chave
  const other = m.map.containers.find(x => !m.keyContainers.includes(x.id));
  goTo(m, 'p1', other);
  r = m.interact('p1', { kind: 'container', id: other.id });
  assert.ok(r.ok && r.key === null);
});

test('Saída: não abre antes de todas as chaves; abre depois; jogador escapa e a partida termina com vitória', () => {
  const m = makeMatch(2, 'k-exit');
  const e = m.map.exit;
  m.debugPlacePlayer('p1', e.x, e.z + 1.2, 1);
  let r = m.interact('p1', { kind: 'exit', id: 0 });
  assert.equal(r.ok, false); assert.match(r.msg, /trancada/);
  for (const cid of m.keyContainers) { const c = m.map.containers[cid]; goTo(m, 'p1', c); m.interact('p1', { kind: 'container', id: cid }); assert.ok(m.interact('p1', { kind: 'key', id: cid }).ok); }
  assert.equal(m.keysCollected.length, 2);
  m.debugPlacePlayer('p1', e.x, e.z + 1.2, 1);
  r = m.interact('p1', { kind: 'exit', id: 0 });
  assert.ok(r.ok); assert.equal(m.exitOpen, true);
  run(m, 2, (t, dt) => stepPlayer(m, 'p1', 0, -2.4, dt));
  assert.equal(m.players.get('p1').escaped, true);
  assert.equal(m.ended, true); assert.equal(m.result, 'win');
});

test('Chaves coletadas permanecem válidas após a morte de quem coletou', () => {
  const m = makeMatch(2, 'k-death', 2);
  const cid = m.keyContainers[0], c = m.map.containers[cid];
  goTo(m, 'p1', c); m.interact('p1', { kind: 'container', id: cid }); m.interact('p1', { kind: 'key', id: cid });
  m.killPlayer(m.players.get('p1'), 'teste');
  assert.equal(m.keysCollected.length, 1);
  assert.equal(m.ended, false, 'p2 continua');
  const c2 = m.map.containers[m.keyContainers[1]];
  goTo(m, 'p2', c2); m.interact('p2', { kind: 'container', id: c2.id }); assert.ok(m.interact('p2', { kind: 'key', id: c2.id }).ok);
  assert.equal(m.keysCollected.length, 2);
  m.debugPlacePlayer('p2', m.map.exit.x, m.map.exit.z + 1.2, 1);
  assert.ok(m.interact('p2', { kind: 'exit', id: 0 }).ok);
  run(m, 2, (t, dt) => stepPlayer(m, 'p2', 0, -2.4, dt));
  assert.equal(m.result, 'win', 'vitória com sobrevivente que escapou');
});

test('Morte: contato com a criatura mata instantaneamente', () => {
  const m = makeMatch(1, 'morte-1');
  const c = clearCorridor(m, 1, 30);
  m.debugPlacePlayer('p1', c.x0 + 6, c.z, 1);
  m.debugPlaceCreature(c.x0 + 6 + CREATURE.contactDist - 0.1, c.z, 1, -Math.PI / 2);
  m.tick(0.05);
  assert.equal(m.players.get('p1').alive, false);
  assert.ok(m.events.some(e => e.type === 'death' && e.id === 'p1'));
  assert.equal(m.ended, true); assert.equal(m.result, 'lose');
});

test('Morte: não ocorre através de paredes', () => {
  const m = makeMatch(1, 'morte-2');
  const w = wallSpot(m, 1); assert.ok(w);
  // centros a ~1,0 m, mas com a parede (0,5 m) entre eles
  m.debugPlacePlayer('p1', w.x, w.zRoom + 0.0, 1);
  m.debugPlaceCreature(w.x, w.zCorr - 0.0, 1, Math.PI);
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
  m.debugPlacePlayer('p1', c.x0 + 6, c.z, 1);
  m.killPlayer(m.players.get('p1'), 'teste');
  const p = m.players.get('p1');
  const r = m.interact('p1', { kind: 'door', id: 0 });
  assert.equal(r.ok, false);
  const before = m.sounds.length, scent = m.scent.size;
  for (let i = 0; i < 20; i++) { assert.ok(m.applyInput('p1', { x: p.x + i * 0.1, z: p.z }).ignored); m.tick(0.05); }
  assert.equal(m.sounds.length, before); assert.equal(m.scent.size, scent);
  m.debugPlaceCreature(c.x0, c.z, 1, Math.PI / 2);
  assert.equal(visionCheck(m, m.creature, p).visible, false);
  assert.equal(m.ended, false, 'partida continua com o outro jogador');
});

test('Validação de movimento: velocidade impossível e atravessar paredes são corrigidos', () => {
  const m = makeMatch(1, 'mov-1');
  const w = wallSpot(m, 1);
  m.debugPlacePlayer('p1', w.x, w.zRoom, 1);
  m.tick(0.05);
  let r = m.applyInput('p1', { x: w.x, z: w.zCorr + 0.5 });
  assert.ok(r.correction, 'atravessar parede → correção');
  r = m.applyInput('p1', { x: w.x + 9, z: w.zRoom });
  assert.ok(r.correction && r.correction.reason === 'velocidade');
  const p = m.players.get('p1');
  assert.equal(p.x, w.x); assert.equal(p.z, w.zRoom);
});
