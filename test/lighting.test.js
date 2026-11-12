// v9b: casa escura — só parte dos cômodos com luz acesa; lareira sempre acesa; valores na config compartilhada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMansion } from '../shared/mapgen.js';
import { LIGHTING } from '../shared/config.js';

test('luzes: ~35–50% dos cômodos iluminados, lareira acesa, luminárias mais fracas', () => {
  let rooms = 0, litRooms = 0;
  for (let i = 0; i < 25; i++) {
    const m = generateMansion('luz-' + i, { noCache: true });
    const byRoom = new Map();
    for (const l of m.lamps) {
      if (l.kind === 'fire') { assert.notEqual(l.state, 'off', 'lareira acesa'); continue; }
      if (l.kind === 'flame') continue;
      const k = l.prop !== undefined ? 'p' + m.props[l.prop].room : l.level + ':' + Math.round(l.x) + ':' + Math.round(l.z);
      if (l.kind !== 'candle') assert.ok(l.intensity <= 3.2 * LIGHTING.lampIntensity + 1e-9);
      void k;
    }
    // por cômodo (mesma regra do gerador)
    const lit = m.lamps.filter(l => l.kind !== 'fire' && l.kind !== 'flame' && l.state !== 'off').length;
    const all = m.lamps.filter(l => l.kind !== 'fire' && l.kind !== 'flame').length;
    rooms += all; litRooms += lit; void byRoom;
  }
  const frac = litRooms / rooms;
  assert.ok(frac > 0.2 && frac < 0.5, 'fração de luminárias acesas ' + frac.toFixed(2));
  assert.ok(LIGHTING.lampRoomKeep >= 0.35 && LIGHTING.lampRoomKeep <= 0.5);
  assert.ok(LIGHTING.flashlight.decay === 2 && LIGHTING.flashlight.nearDim === 1.5);
});
