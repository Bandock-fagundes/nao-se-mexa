// v9: criatura — esqueleto com articulações extras, LOD, animação estável em todos os estados e eventos de som
// (passos, estalos de osso, fungadas) emitidos pelo animador.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const warn = console.warn; console.warn = () => { };
const { buildCreature } = await import('../client/src/render/creature.js');
const c = buildCreature({ T: { creatureSkin: {} } });
console.warn = warn;
const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;

test('esqueleto: coluna em 4 segmentos, pescoço em 2, 3 falanges, filhas', () => {
  const names = new Set(c.bones.map(b => b.name));
  for (const n of ['spine1', 'spine2', 'spine3', 'chest', 'neck', 'neck2', 'head', 'f0cL', 'f3cR', 'kidA1', 'kidA2', 'kidA3', 'kidB1', 'kidB3', 'kidHeadA', 'kidHeadB', 'thighL', 'shinL', 'footL', 'toesL'])
    assert.ok(names.has(n), 'falta o osso ' + n);
  assert.equal(c.bones.find(b => b.name === 'chest').parent.name, 'spine3');
  assert.equal(c.bones.find(b => b.name === 'head').parent.name, 'neck2');
});

test('LOD: malha detalhada e leve dentro do orçamento, mesmo esqueleto', () => {
  assert.ok(tris(c.mesh.geometry) < 45000, 'alto ' + tris(c.mesh.geometry));
  assert.ok(tris(c.lo.geometry) < 12000, 'baixo ' + tris(c.lo.geometry));
  assert.equal(c.mesh.skeleton, c.lo.skeleton);
  assert.equal(c.lod.levels.length, 2);
});

test('animação: todos os estados ficam finitos, pés no chão andando/correndo, eventos de som', () => {
  const ev = { step: 0, crack: 0, sniff: 0 };
  c.anim.evCb = (type) => { if (type in ev) ev[type]++; };
  const foot = c.bones.find(b => b.name === 'toesL'), p = new THREE.Vector3();
  const states = [['idle', 0], ['walk', 1.45], ['investigate_walk', 1.9], ['run', 4.6], ['hear', 0], ['sniff', 0], ['look', 0], ['turn', 0], ['stop', 0], ['inspect', 0], ['attack', 0], ['kill', 0], ['door', 0], ['recover', 0]];
  for (const [anim, speed] of states) {
    let minY = 9, maxY = -9;
    for (let i = 0; i < 240; i++) {
      c.anim.update(1 / 60, { anim, animT: i / 60, speed, headYaw: 0.6, headPitch: 0, yaw: 0 });
      if (i > 120 && (anim === 'walk' || anim === 'run')) { c.root.updateMatrixWorld(true); foot.getWorldPosition(p); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    }
    for (const b of c.bones) {
      assert.ok(Number.isFinite(b.quaternion.x + b.quaternion.y + b.quaternion.z + b.quaternion.w), `${anim}: ${b.name} NaN`);
      assert.ok(Number.isFinite(b.position.x + b.position.y + b.position.z), `${anim}: ${b.name} pos NaN`);
    }
    if (anim === 'walk' || anim === 'run') {
      assert.ok(minY > -0.06 && minY < 0.12, `${anim}: pé afunda/flutua (mín ${minY.toFixed(3)})`);
      assert.ok(maxY > minY + 0.05, `${anim}: o pé não sobe`);
    }
  }
  assert.ok(ev.step > 6, 'passos ' + ev.step);
  assert.ok(ev.crack > 0, 'estalos ' + ev.crack);
  assert.ok(ev.sniff >= 3, 'fungadas ' + ev.sniff);
  c.anim.evCb = null;
});
