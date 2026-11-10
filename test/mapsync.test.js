// v3: o cliente gera a mansão SÓ com os parâmetros que o servidor manda no 'start' (msg.gen) e chega ao mesmo hash —
// em todos os caminhos de início: solo, sala criada + entrar (2 e 3 jogadores), reinício em sala de teste e reconexão.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/rooms.js';
import { generateFromParams } from '../shared/mapgen.js';
import { GEN_VERSION } from '../shared/config.js';

function fakeConn(name) {
  const c = { name, msgs: [], room: null, pid: null };
  c.ws = { readyState: 1, send: (s) => c.msgs.push(JSON.parse(s)), close() { } };
  return c;
}
const lastStart = (c) => [...c.msgs].reverse().find(m => m.t === 'start');
const joined = (c) => c.msgs.find(m => m.t === 'joined');

// o que o cliente faz em client/src/game.js: gera com msg.gen (sem cache, como num navegador novo) e compara o hash
function checkStart(msg, rm, label) {
  assert.ok(msg, label + ': recebeu start');
  assert.ok(msg.gen, label + ': start traz os parâmetros do gerador');
  assert.deepEqual(Object.keys(msg.gen).sort(), ['seed', 'size', 'version'], label + ': parâmetros completos');
  assert.equal(msg.gen.version, GEN_VERSION, label + ': versão do gerador');
  const room = [...rm.rooms.values()].find(r => r.match && r.match.map.hash === msg.mapHash);
  assert.ok(room, label + ': hash do start é o do mapa do servidor');
  assert.deepEqual(msg.gen, room.match.gen, label + ': mesmos parâmetros que o servidor usou');
  assert.deepEqual(msg.state.gen, room.match.gen, label + ': fullState também leva os parâmetros');
  const client = generateFromParams(msg.gen, { noCache: true });
  assert.equal(client.hash, msg.mapHash, label + ': cliente gera o mesmo mapa (' + JSON.stringify(msg.gen) + ')');
  return room;
}

test('mapa: parâmetros do start reproduzem o hash do servidor (solo, sala 2/3 jogadores, reinício, reconexão)', () => {
  const rm = new RoomManager({ tickMs: 1e9 });
  try {
    const seeds = ['sync-a', 'sync-b', '12345'];
    for (const seed of seeds) {
      // solo (aba TESTAR JOGO, semente fixa) → tamanho 1
      const s = fakeConn('solo');
      rm.handle(s, { t: 'solo', name: 'S', test: true, seed });
      const ms = lastStart(s);
      checkStart(ms, rm, 'solo ' + seed);
      assert.equal(ms.gen.size, 1); assert.equal(ms.gen.seed, seed);
      // solo do jogo normal (semente aleatória)
      const s2 = fakeConn('solo2'); rm.handle(s2, { t: 'solo', name: 'S2' });
      checkStart(lastStart(s2), rm, 'solo normal');
      // sala com 2 e 3 jogadores → tamanhos 2 e 3
      for (const n of [2, 3]) {
        const cs = Array.from({ length: n }, (_, i) => fakeConn('c' + i));
        rm.handle(cs[0], { t: 'create', name: 'H', test: true, seed });
        const code = joined(cs[0]).code;
        for (const c of cs.slice(1)) { rm.handle(c, { t: 'join', code, name: c.name }); rm.handle(c, { t: 'ready', ready: true }); }
        rm.handle(cs[0], { t: 'start' });
        for (const c of cs) { const m = checkStart(lastStart(c), rm, `sala ${n}p ${seed}`); assert.equal(m.match.gen.size, n); }
        // reinício (sala de teste) com outra semente
        rm.handle(cs[0], { t: 'restart', seed: seed + '-r' });
        for (const c of cs) { const m = lastStart(c); checkStart(m, rm, `reinício ${n}p`); assert.equal(m.gen.seed, seed + '-r'); assert.equal(m.gen.size, n); }
        // reconexão: o jogador 2 cai e volta com o token
        const j = joined(cs[1]); rm.disconnected(cs[1]);
        const back = fakeConn('volta'); rm.handle(back, { t: 'resume', code, token: j.token });
        const mr = lastStart(back); assert.equal(mr.resumed, true);
        checkStart(mr, rm, `reconexão ${n}p`); assert.equal(mr.gen.size, n);
      }
    }
  } finally { rm.close(); }
});
