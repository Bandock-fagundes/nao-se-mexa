// Página de laboratório (não faz parte do jogo): renderiza modelos isolados para inspeção visual.
import * as THREE from 'three';
import { buildMaterials } from './render/materials.js';
import { buildCreature } from './render/creature.js';
import { buildHand, HandAnimator } from './render/hand.js';
import { buildProp, buildKey } from './render/props.js';
import { buildTeammate, animateTeammate } from './render/human.js';
const q = new URLSearchParams(location.search);
const view = q.get('v') || 'creature';
const W = 1280, H = 720;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2; renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x15171c);
const cam = new THREE.PerspectiveCamera(45, W / H, 0.01, 100);
scene.add(new THREE.HemisphereLight(0x8090b0, 0x302010, 1.2));
const key = new THREE.DirectionalLight(q.get('neutral') ? 0xfff4ea : 0xffe0c0, 2.5); key.position.set(3, 5, 4); key.castShadow = true; scene.add(key);
const rim = new THREE.DirectionalLight(0x6080ff, 1.5); rim.position.set(-3, 3, -4); scene.add(rim);
const M = buildMaterials(512);
const fg = new THREE.PlaneGeometry(10, 10); fg.setAttribute('color', new THREE.Float32BufferAttribute(new Array(fg.attributes.position.count * 3).fill(1), 3));
const floor = new THREE.Mesh(fg, M.floorWood); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
if (view === 'creature') {
  const c = buildCreature(M); scene.add(c.root);
  const anim = q.get('a') || 'idle', at = +(q.get('t') || 0.3), speed = +(q.get('s') || 0);
  c.root.rotation.y = +(q.get('r') || 0.6);
  const n = +(q.get('n') || 120), fdt = +(q.get('dt') || 1 / 60);
  for (let i = 0; i < n; i++) c.anim.update(fdt, { anim, animT: at + i * fdt, speed, headYaw: +(q.get('hy') || 0), headPitch: +(q.get('hp') || 0), yaw: 0 });
  window.__step = (k, dt2 = fdt) => { for (let i = 0; i < k; i++) c.anim.update(dt2, { anim, animT: at, speed, headYaw: 0, headPitch: 0, yaw: 0 }); renderer.render(scene, cam); };
  cam.position.set(+(q.get('cx') || 0), +(q.get('cy') || 1.7), +(q.get('cz') || 5.2)); cam.lookAt(0, +(q.get('ly') || 1.5), 0);
  if (q.get('face')) {
    // close no rosto: câmera à frente da cabeça (posição real do osso depois da animação)
    c.root.updateMatrixWorld(true);
    const hb = c.bones.find(b => b.name === 'head'); const hp = new THREE.Vector3(0, -0.08, 0.3); hb.localToWorld(hp);
    const fw = new THREE.Vector3(0, 0, 1).applyQuaternion(hb.getWorldQuaternion(new THREE.Quaternion()));
    const side = +(q.get('side') || 0.25);
    cam.position.copy(hp).addScaledVector(fw, +(q.get('dist') || 0.75)).add(new THREE.Vector3(side, 0.08, 0)); cam.lookAt(hp);
    const fl = new THREE.PointLight(0xfff0e0, 3, 4); fl.position.copy(cam.position).add(new THREE.Vector3(0.2, 0.15, 0)); scene.add(fl);
  }
} else if (view === 'hand') {
  scene.background = new THREE.Color(0x2a2420);
  const h = buildHand(M); cam.add(h.root); scene.add(cam); cam.position.set(0, 1.6, 2); cam.lookAt(0, 1.6, 0);
  const an = new HandAnimator(h); an.update(0.016, { on: q.get('on') !== '0' });
  cam.fov = 70; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
  const pl = new THREE.PointLight(0xffe0c0, 2, 3); pl.position.set(0.5, 2.2, 2); scene.add(pl);
  if (q.get('close')) { const c2 = new THREE.PerspectiveCamera(30, W / H, 0.01, 10); const hp = new THREE.Vector3(); h.grip.getWorldPosition(hp); c2.position.set(hp.x + 0.25, hp.y + 0.18, hp.z + 0.25); c2.lookAt(hp); renderer.render(scene, c2); window.__done = true; throw 'done'; }
} else if (view === 'mate') {
  const t = buildTeammate(M, +(q.get('i') || 0)); scene.add(t.root); t.root.rotation.y = +(q.get('r') || 0.6);
  const n = +(q.get('n') || 90), sp = +(q.get('s') || 0);
  for (let i = 0; i < n; i++) animateTeammate(t, 1 / 60, { speed: sp, crouch: !!q.get('c'), alive: q.get('dead') ? false : true, fl: true, pitch: +(q.get('p') || 0) });
  cam.position.set(+(q.get('cx') || 0), +(q.get('cy') || 1.2), +(q.get('cz') || 3.6)); cam.lookAt(0, +(q.get('ly') || 0.95), 0);
} else {
  const g = buildProp(view, +(q.get('w') || 1.5), +(q.get('d') || 0.5), M, +(q.get('var') || 1)); scene.add(g);
  // v3: ?open=1 abre portas/gavetas; &key=1 mostra o armário da chave (vazio, chave no ganchinho)
  if (q.get('open') && g.userData.parts) for (const pt of g.userData.parts) {
    if (pt.type === 'door') { pt.part.rotation.y = pt.amount * 0.9; if (pt.extra) pt.extra.rotation.y = -pt.amount * 0.85; }
    else if (pt.type === 'drawer') pt.part.position.z += pt.amount;
    else if (pt.type === 'lid') pt.part.rotation.x = pt.amount;
  }
  if (q.get('key') && g.userData.parts) {
    const pt = g.userData.parts[0], k = buildKey(M);
    if (pt.hang) { k.rotation.set(0, 0, -Math.PI / 2); if (g.userData.hook) g.userData.hook.visible = true; if (g.userData.clothes) g.userData.clothes.removeFromParent(); }
    else k.rotation.set(-Math.PI / 2, 0, 0.6);
    pt.anchor.add(k); k.userData.halo.visible = true; k.userData.halo.material.opacity = 0.8; k.userData.halo.scale.set(0.1, 0.1, 1);
    M.keyGold.emissiveIntensity = 0.9;
  }
  cam.position.set(+(q.get('cx') || 2), +(q.get('cy') || 1.6), +(q.get('cz') || 3)); cam.lookAt(+(q.get('lx') || 0), +(q.get('ly') || 0.8), +(q.get('lz') || 0));
  if (q.get('fov')) { cam.fov = +q.get('fov'); cam.updateProjectionMatrix(); }
}
if (q.get('mood')) {
  // clima do jogo: escuro, lanterna saindo da câmera, luz quente fraca ao fundo
  scene.background = new THREE.Color(0x040405); scene.fog = new THREE.FogExp2(0x07080b, 0.05);
  scene.traverse(o => { if (o.isLight) o.intensity *= 0.12; });
  const sp = new THREE.SpotLight(0xe8f0ff, +(q.get('fl') || 28), 30, 0.5, 0.5, 1.0); sp.castShadow = true; sp.shadow.mapSize.set(1024, 1024);
  sp.position.copy(cam.position).add(new THREE.Vector3(0.25, -0.15, 0)); const tg = new THREE.Vector3(); cam.getWorldDirection(tg); sp.target.position.copy(cam.position).addScaledVector(tg, 6);
  scene.add(sp, sp.target);
  const lamp = new THREE.PointLight(0xffa860, 6, 10, 1.6); lamp.position.set(-2.5, 2.4, -2.5); scene.add(lamp);
  renderer.toneMappingExposure = 0.95; renderer.outputColorSpace = THREE.SRGBColorSpace;
}
renderer.render(scene, cam);
window.__done = true;
