// Página de laboratório (não faz parte do jogo): renderiza modelos isolados para inspeção visual.
import * as THREE from 'three';
import { buildMaterials } from './render/materials.js';
import { buildCreature } from './render/creature.js';
import { buildHand, HandAnimator } from './render/hand.js';
import { buildProp } from './render/props.js';
const q = new URLSearchParams(location.search);
const view = q.get('v') || 'creature';
const W = 1280, H = 720;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2; renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x15171c);
const cam = new THREE.PerspectiveCamera(45, W / H, 0.01, 100);
scene.add(new THREE.HemisphereLight(0x8090b0, 0x302010, 1.2));
const key = new THREE.DirectionalLight(0xffe0c0, 2.5); key.position.set(3, 5, 4); key.castShadow = true; scene.add(key);
const rim = new THREE.DirectionalLight(0x6080ff, 1.5); rim.position.set(-3, 3, -4); scene.add(rim);
const M = buildMaterials(512);
const fg = new THREE.PlaneGeometry(10, 10); fg.setAttribute('color', new THREE.Float32BufferAttribute(new Array(fg.attributes.position.count * 3).fill(1), 3));
const floor = new THREE.Mesh(fg, M.floorWood); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
if (view === 'creature') {
  const c = buildCreature(M); scene.add(c.root);
  const anim = q.get('a') || 'idle', at = +(q.get('t') || 0.3), speed = +(q.get('s') || 0);
  c.root.rotation.y = +(q.get('r') || 0.6);
  for (let i = 0; i < 60; i++) c.anim.update(1 / 30, { anim, animT: at, speed, headYaw: +(q.get('hy') || 0), headPitch: +(q.get('hp') || 0), yaw: 0 });
  cam.position.set(+(q.get('cx') || 0), +(q.get('cy') || 1.7), +(q.get('cz') || 5.2)); cam.lookAt(0, +(q.get('ly') || 1.5), 0);
} else if (view === 'hand') {
  scene.background = new THREE.Color(0x2a2420);
  const h = buildHand(M); cam.add(h.root); scene.add(cam); cam.position.set(0, 1.6, 2); cam.lookAt(0, 1.6, 0);
  const an = new HandAnimator(h); an.update(0.016, { on: q.get('on') !== '0' });
  cam.fov = 70; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
  const pl = new THREE.PointLight(0xffe0c0, 2, 3); pl.position.set(0.5, 2.2, 2); scene.add(pl);
  if (q.get('close')) { const c2 = new THREE.PerspectiveCamera(30, W / H, 0.01, 10); const hp = new THREE.Vector3(); h.grip.getWorldPosition(hp); c2.position.set(hp.x + 0.25, hp.y + 0.18, hp.z + 0.25); c2.lookAt(hp); renderer.render(scene, c2); window.__done = true; throw 'done'; }
} else {
  const g = buildProp(view, +(q.get('w') || 1.5), +(q.get('d') || 0.5), M, 1); scene.add(g);
  cam.position.set(2, 1.6, 3); cam.lookAt(0, 0.8, 0);
}
renderer.render(scene, cam);
window.__done = true;
