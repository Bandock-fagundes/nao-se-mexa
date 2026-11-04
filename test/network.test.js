// v2 — robustez de rede: limite de 3 jogadores, heartbeat, erro numa sala não derruba o servidor,
// aviso de reinício (deploy) e descarte de snapshots para clientes lentos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createGameServer } from '../server/index.js';
import { RoomManager } from '../server/rooms.js';
import { MAX_PLAYERS, SERVER } from '../shared/config.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function client(port, opts = {}) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`, opts);
    const c = { ws, msgs: [], closed: false };
    ws.on('message', (d) => c.msgs.push(JSON.parse(d)));
    ws.on('close', () => { c.closed = true; });
    ws.on('open', () => res(c)); ws.on('error', rej);
  });
}
async function waitFor(c, pred, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const m = c.msgs.find(pred); if (m) return m; await sleep(20); }
  throw new Error('tempo esgotado');
}
const send = (c, m) => c.ws.send(JSON.stringify(m));

test('Rede: sala aceita no máximo 3 jogadores', async () => {
  assert.equal(MAX_PLAYERS, 3);
  const srv = await createGameServer({ port: 0 });
  try {
    const cs = [];
    for (let i = 0; i < 4; i++) cs.push(await client(srv.port));
    send(cs[0], { t: 'create', name: 'A' });
    const j = await waitFor(cs[0], m => m.t === 'joined');
    for (let i = 1; i < 3; i++) { send(cs[i], { t: 'join', code: j.code, name: 'J' + i }); await waitFor(cs[i], m => m.t === 'joined'); }
    send(cs[3], { t: 'join', code: j.code, name: 'X' });
    const e = await waitFor(cs[3], m => m.t === 'error');
    assert.match(e.msg, /cheia \(máximo 3\)/);
    const info = cs[0].msgs.filter(m => m.t === 'room').pop();
    assert.equal(info.room.max, 3);
    for (const c of cs) c.ws.close();
  } finally { await srv.close(); }
});

test('Rede: heartbeat encerra conexão morta (3 pings sem resposta) e mantém a viva (quem manda mensagens fica)', async () => {
  const srv = await createGameServer({ port: 0, heartbeatMs: 250 });
  try {
    const dead = await client(srv.port, { autoPong: false });     // não responde aos pings
    const alive = await client(srv.port);                         // responde (padrão)
    const chatty = await client(srv.port, { autoPong: false });   // não dá pong, mas manda ping de aplicação
    const iv = setInterval(() => { try { send(chatty, { t: 'ping', c: 1 }); } catch { } }, 100);
    await sleep(1700); // encerra só após 3 pings seguidos sem resposta
    clearInterval(iv);
    assert.equal(dead.closed, true, 'conexão morta encerrada');
    assert.equal(alive.closed, false, 'conexão viva mantida');
    assert.equal(chatty.closed, false, 'cliente que manda mensagens é mantido');
    alive.ws.close(); chatty.ws.close();
  } finally { await srv.close(); }
});

test('Rede: erro na simulação de uma sala não derruba o servidor nem desconecta ninguém', async () => {
  const srv = await createGameServer({ port: 0 });
  const errs = []; const oldErr = console.error; console.error = (...a) => errs.push(a.join(' '));
  try {
    const a = await client(srv.port), b = await client(srv.port);
    send(a, { t: 'solo', name: 'A' }); await waitFor(a, m => m.t === 'start');
    send(b, { t: 'solo', name: 'B' }); await waitFor(b, m => m.t === 'start');
    const roomA = [...srv.manager.rooms.values()].find(r => r.players.size && [...r.players.values()][0].name === 'A');
    let n = 0; const orig = roomA.match.tick.bind(roomA.match);
    roomA.match.tick = (dt) => { if (n++ < 5) throw new Error('falha simulada'); return orig(dt); };
    await sleep(600);
    const before = a.msgs.filter(m => m.t === 's').length;
    await sleep(300);
    assert.ok(a.msgs.filter(m => m.t === 's').length > before, 'sala com erro continua mandando estado');
    assert.ok(b.msgs.filter(m => m.t === 's').length > 10, 'outra sala segue normal');
    assert.equal(a.closed || b.closed, false);
    assert.ok(errs.some(e => /falha simulada/.test(e)), 'erro registrado no log');
    const h = await (await fetch(`http://localhost:${srv.port}/health`)).json();
    assert.equal(h.ok, true); assert.equal(h.players, 2);
    a.ws.close(); b.ws.close();
  } finally { console.error = oldErr; await srv.close(); }
});

test('Rede: aviso de reinício chega aos jogadores antes de o servidor cair (deploy)', async () => {
  const srv = await createGameServer({ port: 0 });
  try {
    const a = await client(srv.port);
    send(a, { t: 'solo', name: 'A' }); await waitFor(a, m => m.t === 'start');
    srv.manager.notifyAll({ t: 'server_restart', msg: 'reiniciando' });
    const m = await waitFor(a, x => x.t === 'server_restart');
    assert.equal(m.msg, 'reiniciando');
    a.ws.close();
  } finally { await srv.close(); }
});

test('Rede: cliente lento — snapshots descartáveis são pulados quando a fila de envio enche; eventos não', () => {
  const mgr = new RoomManager({ tickMs: 1e9 }); mgr.close();
  const sent = [];
  const fast = { readyState: 1, bufferedAmount: 0, send: (s) => sent.push(['fast', s]) };
  const slow = { readyState: 1, bufferedAmount: SERVER.maxBuffered + 1, send: (s) => sent.push(['slow', s]) };
  const room = { players: new Map([['a', { conn: { ws: fast } }], ['b', { conn: { ws: slow } }]]) };
  mgr.broadcast(room, { t: 's' }, true);
  assert.deepEqual(sent.map(x => x[0]), ['fast'], 'snapshot pulado para o lento');
  mgr.broadcast(room, { t: 'ev', events: [] });
  assert.deepEqual(sent.map(x => x[0]), ['fast', 'fast', 'slow'], 'evento importante vai para todos');
  assert.equal(room.players.get('b').dropped, 1);
});

test('Rede: cliente que "engasga" (para de ler o socket por um tempo, como um PC lento numa casa grande) não é derrubado', async () => {
  // O Chrome só lê o socket quando a página consome as mensagens; com a página travada, o ping do servidor
  // fica parado no buffer e o pong atrasa. Antes (1 ping perdido = queda) isso desconectava o jogador.
  const srv = await createGameServer({ port: 0, heartbeatMs: 250 });
  try {
    const c = await client(srv.port);
    send(c, { t: 'solo', name: 'Lento' }); await waitFor(c, m => m.t === 'start');
    c.ws._socket.pause();            // trava a leitura (snapshots e pings acumulam)
    await sleep(650);                // ~2,5 intervalos de heartbeat sem pong
    c.ws._socket.resume();
    await sleep(700);
    assert.equal(c.closed, false, 'continua conectado depois do engasgo');
    const room = [...srv.manager.rooms.values()][0];
    assert.equal([...room.players.values()][0].connected, true);
    c.ws.close();
  } finally { await srv.close(); }
});
