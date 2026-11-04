// v2 fase 2: NADA atravessa nada. Varre muitas casas geradas e confere, em 3D (modelos reais dos móveis),
// que móveis, quadros, janelas/cortinas, luminárias, velas e objetos derrubáveis não se sobrepõem.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { generateMansion, PROP_HEIGHT } from '../shared/mapgen.js';
import { buildProp } from '../client/src/render/props.js';
import { findOverlaps } from './overlap.js';

test('v2 fase 2: nenhum objeto atravessa outro (60 casas, varredura 3D)', () => {
  const bad = [];
  for (let i = 0; i < 60; i++) for (const b of findOverlaps(generateMansion('ov' + i, { noCache: true }))) bad.push(`ov${i}: ${b.a} × ${b.b} @${b.at} L${b.level}`);
  assert.deepEqual(bad.slice(0, 10), []);
});

test('v2 fase 2: tabela de alturas dos móveis (usada pelo gerador) cobre os modelos 3D', () => {
  const mat = new THREE.MeshBasicMaterial(); const M = new Proxy({}, { get: (t, k) => t[k] || (t[k] = mat) });
  const bad = [];
  for (let i = 0; i < 20; i++) for (const p of generateMansion('ht' + i, { noCache: true }).props) {
    const horiz = p.facing === 0 || p.facing === 2;
    const b = new THREE.Box3().setFromObject(buildProp(p.kind, (horiz ? p.sx : p.sz) * 0.5, (horiz ? p.sz : p.sx) * 0.5, M, p.variant));
    if (!(p.kind in PROP_HEIGHT) || b.max.y > PROP_HEIGHT[p.kind] + 0.01) bad.push(`${p.kind}: modelo ${b.max.y.toFixed(2)} > tabela ${PROP_HEIGHT[p.kind]}`);
  }
  assert.deepEqual([...new Set(bad)], []);
});
