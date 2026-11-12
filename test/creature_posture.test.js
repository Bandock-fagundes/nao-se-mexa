// v9b: criatura sempre ereta (cabeça alta); corrida só levemente inclinada; abaixa apenas para passar em
// portas/arcos/tetos baixos — o alto da cabeça nunca passa da verga ao atravessar portas de verdade do mapa.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { generateMansion } from '../shared/mapgen.js';
import { headroomY, overheadY } from '../shared/ceiling.js';
import { LEVELS, CELL } from '../shared/config.js';

const warn = console.warn; console.warn = () => { };
const { buildCreature } = await import('../client/src/render/creature.js');
console.warn = warn;

test('postura: ereta andando/parada, corrida pouco mais baixa', () => {
  const c = buildCreature({ T: { creatureSkin: {} } }), a = c.anim;
  const top = (anim, speed) => { let mn = 9, mx = 0; for (let i = 0; i < 200; i++) { a.update(1 / 60, { anim, speed, headroom: 99 }); if (i > 100) { mn = Math.min(mn, a.headTop); mx = Math.max(mx, a.headTop); } } return [mn, mx]; };
  const idle = top('idle', 0), walk = top('walk', 1.4), run = top('run', 4.2);
  assert.ok(idle[0] > 2.9, 'parada ereta ' + idle[0]);
  assert.ok(walk[0] > 2.88, 'andando ereta ' + walk[0]);
  assert.ok(run[0] > 2.6 && run[1] < walk[1], 'corrida só um pouco mais baixa ' + run[0]);
});

test('postura: atravessa portas (térreo, 2º, porão, sótão) sem a cabeça passar da verga', () => {
  const m = generateMansion('postura-1', { noCache: true });
  const byLevel = [0, 1, 2, 3].map(L => m.doors.filter(d => d.level === L).slice(0, 3)).flat();
  assert.ok(byLevel.length >= 6);
  for (const d of byLevel) {
    const c = buildCreature({ T: { creatureSkin: {} } }), a = c.anim, root = c.root;
    const ax = d.axis === 'x' ? 1 : 0, az = d.axis === 'x' ? 0 : 1; // atravessa perpendicular à parede
    const y0 = LEVELS[d.level].y;
    root.rotation.y = Math.atan2(ax, az);
    let worst = -9;
    for (let i = 0; i <= 240; i++) {
      const u = -2.4 + 4.8 * i / 240, x = d.x + ax * u, z = d.z + az * u;
      root.position.set(x, y0, z); root.updateMatrixWorld(true);
      const hr = headroomY(m, d.level, x, z, ax, az) - y0;
      a.update(1 / 60, { anim: 'walk', speed: 1.2, headroom: hr, yaw: root.rotation.y });
      // a cabeça fica ~0,1–0,4 m à frente da raiz: confere a verga sob a cabeça e sob a raiz
      for (const off of [0, 0.25, 0.5]) {
        const gx = Math.floor((x + ax * off) / CELL), gz = Math.floor((z + az * off) / CELL);
        const lim = overheadY(m, d.level, gx, gz) - y0;
        if (lim < 90) worst = Math.max(worst, a.headTop - lim);
      }
    }
    assert.ok(worst < 0.02, `porta ${d.id} (andar ${d.level}, ${d.axis}): cabeça passa ${worst.toFixed(3)} m da verga/teto`);
  }
});
