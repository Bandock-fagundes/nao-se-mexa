// Multiplayer real: servidor HTTP+WS e dois clientes WebSocket na mesma sala.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createGameServer } from '../server/index.js';
import { generateMansion } from '../shared/mapgen.js';
import { World } from '../shared/world.js';
// ponto livre ao lado de uma porta (para o comando de teleporte de teste)
function doorSide(map, door) {
  const w = new World(map);
  for (const k of [0.8, -0.8, 1.1, -1.1]) {
    const p = door.axis === 'z' ? { x: door.x, z: door.z + k } : { x: door.x + k, z: door.z };
    if (w.circleFree(door.level, p.x, p.z, 0.3)) return p;
  }
  return null;
}

let srv;
before(async () => { srv = await createGameServer({ port: 0 }); });
after(async () => { await srv.close(); });

class Client {
  constructor(name) { this.name = name; this.msgs = []; this.waiters = []; this.snap = null; this.events = []; }
  connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(`ws://localhost:${srv.port}/ws`);
      this.ws.on('open', res); this.ws.on('error', rej);
      this.ws.on('message', (d) => {
        const m = JSON.parse(d);
        if (m.t === 's') this.snap = m; else this.msgs.push(m);
        if (m.t === 'ev') this.events.push(...m.events);
        if (m.t === 'joined') { this.id = m.id; this.token = m.token; this.code = m.code; }
        for (const w of [...this.waiters]) if (w.pred(m)) { this.waiters.splice(this.waiters.indexOf(w), 1); const i = this.msgs.indexOf(m); if (i >= 0) this.msgs.splice(i, 1); w.res(m); break; }
      });
    });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  wait(pred, ms = 8000, label = '') {
    const found = this.msgs.find(pred);
    if (found) { this.msgs.splice(this.msgs.indexOf(found), 1); return Promise.resolve(found); }
    return new Promise((res, rej) => { const w = { pred, res }; this.waiters.push(w); setTimeout(() => rej(new Error(`${this.name}: tempo esgotado esperando ${label}`)), ms); });
  }
  waitEvent(pred, ms = 8000, label = '') {
    const e = this.events.find(pred); if (e) return Promise.resolve(e);
    return this.wait(m => m.t === 'ev' && m.events.some(pred), ms, label).then(m => m.events.find(pred));
  }
  close() { try { this.ws.close(); } catch { } }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function twoPlayers(phase = 1) {
  const A = new Client('A'), B = new Client('B');
  await A.connect(); await B.connect();
  A.send({ t: 'create', name: 'Ana', phase, test: true });
  const ja = await A.wait(m => m.t === 'joined', 5000, 'joined A');
  B.send({ t: 'join', code: ja.code, name: 'Beto' });
  await B.wait(m => m.t === 'joined', 5000, 'joined B');
  await A.wait(m => m.t === 'room' && m.room.players.length === 2, 5000, 'room 2 players');
  return { A, B, code: ja.code };
}
async function startMatch(A, B) {
  A.send({ t: 'start' });
  const err = await A.wait(m => m.t === 'error', 3000, 'erro de prontidão');
  assert.match(err.msg, /pronto/i, 'não inicia sem prontidão');
  B.send({ t: 'ready', ready: true });
  await A.wait(m => m.t === 'room' && m.room.players.every(p => p.isHost || p.ready), 5000, 'pronto');
  A.send({ t: 'start' });
  const sa = await A.wait(m => m.t === 'start', 8000, 'start A'), sb = await B.wait(m => m.t === 'start', 8000, 'start B');
  // estaciona a criatura longe para cenários controlados
  const map = generateMansion(sa.seed, { size: sa.size });
  A.send({ t: 'debug', cmd: 'creature', x: map.creatureSpawn.x, z: map.creatureSpawn.z, level: map.creatureSpawn.level, state: 'hold' });
  await sleep(150);
  return { sa, sb, map };
}

test('MP: dois clientes entram na mesma sala, mesma semente/mapa, movimento sincronizado', async () => {
  const { A, B } = await twoPlayers(1);
  const { sa, sb } = await startMatch(A, B);
  assert.equal(sa.seed, sb.seed); assert.equal(sa.mapHash, sb.mapHash);
  assert.equal(sa.size, 2, "2 jogadores → mansão média"); assert.equal(generateMansion(sa.seed, { size: sa.size }).hash, sa.mapHash, 'cliente gera o mesmo mapa a partir da semente');
  // A anda 1 m para o norte em passos válidos
  let x = sa.you.x, z = sa.you.z;
  for (let i = 0; i < 12; i++) { z += 0.1; A.send({ t: 'in', x, z, level: 1, yaw: Math.PI, pitch: 0, fl: true }); await sleep(55); }
  await sleep(250);
  const pa = B.snap.players.find(p => p.id === A.id);
  assert.ok(Math.abs(pa.z - z) < 0.05 && Math.abs(pa.x - x) < 0.05, 'B vê a nova posição de A');
  // criatura compartilhada: mesmo estado para os dois no mesmo instante de servidor
  await sleep(200);
  const ca = A.snap, cb = B.snap;
  if (ca.time === cb.time) assert.deepEqual(ca.creature, cb.creature);
  assert.ok(ca.creature && cb.creature);
  A.close(); B.close();
});

test('MP: portas, recipientes, chaves, morte e vitória sincronizados', async () => {
  const { A, B } = await twoPlayers(1);
  const { map } = await startMatch(A, B);
  // porta: A teleporta (comando de teste) para perto de uma porta e a alterna; B recebe o evento
  const door = map.doors.find(d => d.level === 1 && !d.corridor && doorSide(map, d));
  const nearDoor = doorSide(map, door);
  A.send({ t: 'debug', cmd: 'tp', x: nearDoor.x, z: nearDoor.z, level: 1 });
  assert.ok((await A.wait(m => m.t === 'dres', 3000, 'tp')).ok);
  A.send({ t: 'act', kind: 'door', id: door.id });
  const de = await B.waitEvent(e => e.type === 'door' && e.id === door.id, 4000, 'porta em B');
  assert.equal(de.open, !door.initialOpen, JSON.stringify({ de, door: { id: door.id, initialOpen: door.initialOpen }, evs: B.events.filter(e => e.type === 'door') }));
  // chaves (v2): 3 chaves, dentro de uma gaveta/porta específica ou sobre uma mesa; A pega todas
  A.send({ t: 'debug', cmd: 'keys' });
  const kr = await A.wait(m => m.t === 'dres' && m.keys, 3000, 'keys');
  assert.equal(kr.keys.length, 3);
  let n = 0;
  for (const k of kr.keys) {
    A.send({ t: 'debug', cmd: 'tp', x: k.ax, z: k.az, level: k.level });
    await A.wait(m => m.t === 'dres', 3000, 'tp2');
    if (k.id !== null) {
      A.send({ t: 'act', kind: 'container', id: k.id, part: k.part, open: true });
      const ce = await B.waitEvent(e => e.type === 'container' && e.id === k.id && e.part === k.part, 4000, 'recipiente em B');
      assert.equal(ce.open, true); assert.ok(ce.keys.includes(k.key));
    }
    A.send({ t: 'act', kind: 'key', key: k.key });
    const ke = await B.waitEvent(e => e.type === 'key' && e.key === k.key, 4000, 'chave em B');
    n++; assert.equal(ke.carried, n); assert.equal(ke.by, A.id);
    const r1 = await A.wait(m => m.t === 'ires' && m.req === 'key', 3000, 'ires 1');
    assert.equal(r1.ok, true);
  }
  // segunda coleta da mesma chave é recusada
  A.send({ t: 'act', kind: 'key', key: kr.keys[2].key });
  const r2 = await A.wait(m => m.t === 'ires' && m.req === 'key', 3000, 'ires');
  assert.equal(r2.ok, false);
  // morte de B: a criatura é colocada sobre ele
  const pb = A.snap.players.find(p => p.id === B.id);
  A.send({ t: 'debug', cmd: 'creature', x: pb.x + 0.6, z: pb.z, level: pb.level, state: 'hold' });
  // B se mexe encostado nela (v2: o toque mata quem se mexe ou foi percebido)
  for (let i = 1; i <= 4; i++) { B.send({ t: 'in', x: pb.x - 0.03 * i, z: pb.z, level: pb.level, yaw: 0, pitch: 0, fl: true }); await sleep(60); }
  const dA = await A.waitEvent(e => e.type === 'death' && e.id === B.id, 4000, 'morte vista por A');
  const dB = await B.waitEvent(e => e.type === 'death' && e.id === B.id, 4000, 'morte vista por B');
  assert.ok(dA && dB);
  // B morto não interage
  B.send({ t: 'act', kind: 'door', id: door.id });
  const rb = await B.wait(m => m.t === 'ires', 3000, 'ires B');
  assert.equal(rb.ok, false);
  // devolve a criatura para longe e A escapa
  A.send({ t: 'debug', cmd: 'creature', x: map.creatureSpawn.x, z: map.creatureSpawn.z, level: map.creatureSpawn.level, state: 'hold' });
  const e = map.exit;
  A.send({ t: 'debug', cmd: 'tp', x: e.x, z: e.z + 1.0, level: 1 });
  await A.wait(m => m.t === 'dres' && m.correction, 3000, 'tp exit');
  A.send({ t: 'act', kind: 'exit', id: 0 });
  const dep = await B.waitEvent(ev => ev.type === 'deposit', 4000, 'depósito em B');
  assert.equal(dep.n, 3); assert.equal(dep.total, 3);
  await B.waitEvent(ev => ev.type === 'exit', 4000, 'saída aberta em B');
  let z = e.z + 1.0;
  for (let i = 0; i < 16 && z > 0.2; i++) { z -= 0.12; A.send({ t: 'in', x: e.x, z, level: 1, yaw: 0, pitch: 0, fl: true }); await sleep(60); }
  const endA = await A.wait(m => m.t === 'end', 5000, 'fim A'), endB = await B.wait(m => m.t === 'end', 5000, 'fim B');
  assert.equal(endA.result, 'win'); assert.equal(endB.result, 'win');
  assert.ok(endB.stats.players.find(p => p.id === A.id).escaped);
  assert.equal(endB.stats.players.find(p => p.id === B.id).alive, false);
  // reinício com nova semente pelo anfitrião
  A.send({ t: 'restart' });
  const s2 = await B.wait(m => m.t === 'start', 8000, 'novo start');
  assert.ok(s2.seed);
  A.close(); B.close();
});

test('MP: desconexão e reconexão com token restauram o estado; anfitrião migra', async () => {
  const { A, B, code } = await twoPlayers(2);
  const { map } = await startMatch(A, B);
  const door = map.doors.find(d => d.level === 1 && doorSide(map, d));
  const near = doorSide(map, door);
  A.send({ t: 'debug', cmd: 'tp', x: near.x, z: near.z, level: 1 }); assert.ok((await A.wait(m => m.t === 'dres')).ok);
  A.send({ t: 'act', kind: 'door', id: door.id }); await A.waitEvent(e => e.type === 'door' && e.id === door.id);
  const tBefore = A.snap.time;
  // B cai
  const tokenB = B.token, idB = B.id;
  B.close();
  const dc = await A.waitEvent(e => e.type === 'disconnected' && e.id === idB, 4000, 'aviso de desconexão');
  assert.ok(dc);
  await sleep(400);
  assert.ok(A.snap.time > tBefore, 'a partida continua');
  // B volta
  const B2 = new Client('B2'); await B2.connect();
  B2.send({ t: 'resume', code, token: tokenB });
  const j = await B2.wait(m => m.t === 'joined', 4000, 'rejoin');
  assert.equal(j.id, idB); assert.equal(j.resumed, true);
  const st = await B2.wait(m => m.t === 'start' && m.resumed, 4000, 'estado restaurado');
  assert.equal(st.seed, map.seed);
  assert.equal(st.state.doors[door.id], door.initialOpen ? 0 : 1, 'porta no estado atual');
  assert.ok(st.state.t >= tBefore);
  await A.waitEvent(e => e.type === 'reconnected' && e.id === idB, 4000, 'aviso de reconexão');
  // token inválido é recusado
  const C = new Client('C'); await C.connect(); C.send({ t: 'resume', code, token: 'x' });
  await C.wait(m => m.t === 'resume_fail', 3000, 'resume_fail');
  // migração de anfitrião: A cai, B2 vira anfitrião após alguns segundos
  A.close();
  const h = await B2.wait(m => m.t === 'host', 15000, 'novo anfitrião');
  assert.equal(h.id, idB);
  B2.close(); C.close();
});

test('MP: sala inexistente, sala cheia e partida já iniciada', async () => {
  const X = new Client('X'); await X.connect();
  X.send({ t: 'join', code: 'ZZZZZ', name: 'x' });
  const e = await X.wait(m => m.t === 'error', 3000);
  assert.match(e.msg, /não encontrada/);
  const { A, B, code } = await twoPlayers(1);
  await startMatch(A, B);
  X.send({ t: 'join', code, name: 'x' });
  const e2 = await X.wait(m => m.t === 'error', 3000);
  assert.match(e2.msg, /começou/);
  A.close(); B.close(); X.close();
});

test('HTTP: serve o cliente compilado e a rota /testar (SPA) e /health', async () => {
  const r = await fetch(`http://localhost:${srv.port}/health`); const j = await r.json();
  assert.equal(j.ok, true);
  const t = await fetch(`http://localhost:${srv.port}/testar`); assert.equal(t.status, 200);
  const html = await t.text(); assert.match(html, /NÃO SE MEXA|Cliente não compilado/);
});
