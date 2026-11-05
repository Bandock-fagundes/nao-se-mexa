// v2: a pasta public-eva/ é servida em /eva/ (página da EVA ENGINE), sem atrapalhar o jogo nem o /health.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../server/index.js';

test('rota /eva/ serve public-eva/ e não vaza outros arquivos', async () => {
  const s = await createGameServer({ port: 0 });
  const b = `http://localhost:${s.port}`;
  try {
    const r1 = await fetch(b + '/eva', { redirect: 'manual' });
    assert.equal(r1.status, 301); assert.equal(r1.headers.get('location'), '/eva/');
    const r2 = await fetch(b + '/eva/');
    assert.equal(r2.status, 200); assert.match(await r2.text(), /EVA ENGINE/);
    const r3 = await fetch(b + '/eva/nao-existe.js');
    assert.equal(r3.status, 404);
    const r4 = await fetch(b + '/eva/%2e%2e/server/index.js');
    assert.doesNotMatch(await r4.text(), /createGameServer/, 'não pode sair da pasta public-eva');
    const r5 = await fetch(b + '/health');
    assert.equal(r5.status, 200);
  } finally { await s.close(); }
});
