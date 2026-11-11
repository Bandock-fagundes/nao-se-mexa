// v7: aparência dos jogadores — o acessório/cor vai no 'create'/'join', o servidor limpa, guarda e repassa
// (na sala e no 'start'); quem não manda nada (cliente antigo) ganha cachecol na cor da sua vaga.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createGameServer } from '../server/index.js';
import { sanitizeLook, defaultLook, SLOT_COLORS } from '../shared/look.js';

let srv;
before(async () => { srv = await createGameServer({ port: 0 }); });
after(async () => { await srv.close(); });

function client() {
  const c = { msgs: [], waiters: [] };
  c.ws = new WebSocket(`ws://localhost:${srv.port}/ws`);
  c.ws.on('message', (d) => {
    const m = JSON.parse(d); c.msgs.push(m);
    for (const w of [...c.waiters]) if (w.pred(m)) { c.waiters.splice(c.waiters.indexOf(w), 1); w.res(m); }
  });
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.wait = (pred, ms = 6000) => new Promise((res, rej) => {
    const f = c.msgs.find(pred); if (f) { c.msgs.splice(c.msgs.indexOf(f), 1); return res(f); }
    const w = { pred: (m) => { if (pred(m)) { c.msgs.splice(c.msgs.indexOf(m), 1); return true; } return false; }, res };
    c.waiters.push(w); setTimeout(() => rej(new Error('timeout')), ms);
  });
  c.open = new Promise((r) => c.ws.on('open', r));
  return c;
}

test('sanitizeLook limpa entradas e aceita apelidos', () => {
  assert.deepEqual(sanitizeLook({ acc: 'hat', col: '#1C5A64' }), { acc: 'fedora', col: 0x1c5a64 });
  assert.deepEqual(sanitizeLook({ acc: 'beanie', col: 0x553070 }), { acc: 'beanie', col: 0x553070 });
  assert.equal(sanitizeLook({ acc: 'capa', col: 0x123456 }), null);
  assert.equal(sanitizeLook({ acc: 'scarf', col: 'vermelho' }), null);
  assert.equal(sanitizeLook({ acc: 'scarf', col: 0x1000000 }), null);
  assert.equal(sanitizeLook('x'), null);
  assert.deepEqual(defaultLook(1), { acc: 'scarf', col: SLOT_COLORS[1] });
});

test('aparência vai para a sala, muda no lobby e chega no start; cliente antigo ganha o padrão da vaga', async () => {
  const A = client(), B = client(), C = client();
  await Promise.all([A.open, B.open, C.open]);
  A.send({ t: 'create', name: 'Ana', look: { acc: 'hat', col: '#6a1a26' } });
  const ja = await A.wait(m => m.t === 'joined');
  assert.deepEqual(ja.room.players[0].look, { acc: 'fedora', col: 0x6a1a26 });
  B.send({ t: 'join', code: ja.code, name: 'Beto', look: { acc: 'beanie', col: 0xc0901c, lixo: '<script>' } });
  const jb = await B.wait(m => m.t === 'joined');
  const bInfo = jb.room.players.find(p => p.id === jb.id);
  assert.deepEqual(bInfo.look, { acc: 'beanie', col: 0xc0901c });
  // cliente antigo (sem 'look')
  C.send({ t: 'join', code: ja.code, name: 'Velho' });
  const jc = await C.wait(m => m.t === 'joined');
  const cInfo = jc.room.players.find(p => p.id === jc.id);
  assert.deepEqual(cInfo.look, { acc: 'scarf', col: SLOT_COLORS[cInfo.slot] });
  assert.equal(new Set(jc.room.players.map(p => p.slot)).size, 3, 'vagas diferentes');
  // A vê a aparência de B na sala
  const r = await A.wait(m => m.t === 'room' && m.room.players.some(p => p.id === jb.id && p.look && p.look.acc === 'beanie'));
  assert.ok(r);
  // B troca no lobby → todos recebem; troca inválida é ignorada
  B.send({ t: 'look', look: { acc: 'scarf', col: '#22305e' } });
  await A.wait(m => m.t === 'room' && m.room.players.some(p => p.id === jb.id && p.look.acc === 'scarf' && p.look.col === 0x22305e));
  B.send({ t: 'look', look: { acc: 'armadura', col: 1 } });
  // start: mapa de aparências por id
  for (const c of [B, C]) c.send({ t: 'ready', ready: true });
  await A.wait(m => m.t === 'room' && m.room.players.filter(p => p.ready).length === 2);
  A.send({ t: 'start' });
  const st = await A.wait(m => m.t === 'start', 15000);
  assert.deepEqual(st.looks[ja.id], { acc: 'fedora', col: 0x6a1a26 });
  assert.deepEqual(st.looks[jb.id], { acc: 'scarf', col: 0x22305e });
  assert.equal(st.looks[jc.id].acc, 'scarf');
  const stB = await B.wait(m => m.t === 'start', 15000);
  assert.deepEqual(stB.looks, st.looks);
  for (const c of [A, B, C]) c.ws.close();
});
