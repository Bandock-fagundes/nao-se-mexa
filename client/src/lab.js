// Página de laboratório (não faz parte do jogo): renderiza modelos isolados para inspeção visual.
import * as THREE from 'three';
import { buildMaterials } from './render/materials.js';
import { buildCreature } from './render/creature.js';
import { buildHand, HandAnimator } from './render/hand.js';
import { buildProp, buildKey } from './render/props.js';
import { buildTeammate, animateTeammate, setTeammateLOD, teammateTriangles, attachTeammateFlashlight } from './render/human.js';
import { sanitizeLook } from '../../shared/look.js';
import { accessoryTriangles } from './render/accessories.js';
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
} else if (view === 'grab') {
  // v6: agarrão — criatura em 'kill' + colega morto sendo segurado; ?T=segundos desde a morte
  const c = buildCreature(M); scene.add(c.root); c.root.position.set(0, 0, 0); c.root.rotation.y = 0;
  const t = buildTeammate(M, 1); scene.add(t.root); setTeammateLOD(t, 'hi');
  t.root.position.set(0.1, 0, 1.35); t.root.rotation.y = Math.PI; // de frente para a criatura
  const TT = +(q.get('T') || 1), fdt = 1 / 30;
  for (let i = 0; i < 30; i++) { c.anim.update(fdt, { anim: 'attack', animT: i * fdt, speed: 0, yaw: 0 }); animateTeammate(t, fdt, { speed: 0, alive: true, fl: true }); }
  for (let i = 0; i < Math.round(TT / fdt); i++) {
    c.anim.update(fdt, { anim: 'kill', animT: 0, speed: 0, yaw: 0 });
    const tt = i * fdt;
    animateTeammate(t, fdt, { speed: 0, alive: false, fl: false, grab: tt < 1.45 ? c.anim.grabPoint() : null, from: c.root.position.clone() });
  }
  console.log('grab', JSON.stringify(c.anim.grabPoint().toArray().map(v => +v.toFixed(2))));
  if (q.get('fp')) { // primeira pessoa da vítima
    c.root.updateMatrixWorld(true); const hb = c.bones.find(b => b.name === 'head'); const hp = new THREE.Vector3(0, 0, 0.18); hb.localToWorld(hp);
    cam.position.copy(hp).add(new THREE.Vector3(0, -0.12, 0.62)); cam.lookAt(hp); cam.fov = 72; cam.updateProjectionMatrix();
    const fl = new THREE.PointLight(0xfff0e0, 3, 4); fl.position.copy(cam.position).add(new THREE.Vector3(0.2, 0.15, 0)); scene.add(fl);
  } else { cam.position.set(+(q.get('cx') || 4.2), +(q.get('cy') || 1.6), +(q.get('cz') || 1.2)); cam.lookAt(0, +(q.get('ly') || 1.2), 0.8); }
} else if (view === 'strip') {
  // v6: tira de quadros do andar (cada boneco é o mesmo andar em instantes diferentes, andando de verdade)
  const N = +(q.get('N') || 6), sp = +(q.get('s') || 1.4), st = +(q.get('st') || 4), n0 = +(q.get('n') || 120), r = +(q.get('r') || Math.PI / 2);
  const gap = +(q.get('gap') || 0.75);
  for (let i = 0; i < N; i++) {
    const t = buildTeammate(M, i % 4); scene.add(t.root); t.root.rotation.y = r; setTeammateLOD(t, 'hi');
    const fx = Math.sin(r), fz = Math.cos(r); let px = 0, pz = 0;
    const turn = +(q.get('turn') || 0);
    for (let f = 0; f < n0 + i * st; f++) {
      const sp2 = q.get('stop') && f > n0 * 0.6 ? 0 : sp;
      t.root.rotation.y += turn / 60;
      px += Math.sin(t.root.rotation.y) * sp2 / 60; pz += Math.cos(t.root.rotation.y) * sp2 / 60; t.root.position.set(px, 0, pz);
      animateTeammate(t, 1 / 60, { speed: sp2, crouch: !!q.get('c'), alive: q.get('dead') && f > n0 * 0.5 ? false : true, fl: true, pitch: 0, from: q.get('dead') ? new THREE.Vector3(px - fx, 0, pz - fz) : null });
    }
    t.root.position.set((i - (N - 1) / 2) * gap, 0, 0);
    t.root.updateMatrixWorld(true);
  }
  cam.position.set(+(q.get('cx') || 0), +(q.get('cy') || 1.0), +(q.get('cz') || 4.6)); cam.lookAt(+(q.get('lx') || 0), +(q.get('ly') || 0.8), 0);
  if (q.get('fov')) { cam.fov = +q.get('fov'); cam.updateProjectionMatrix(); }
} else if (view === 'clip') {
  // prévia em vídeo: bonecos andando/correndo; câmera acompanha de lado. window.__frame() avança 1/30 s e renderiza.
  { const g = new THREE.PlaneGeometry(60, 10); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 6); g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(1), 3)); floor.geometry = g; floor.position.x = 0; floor.material = new THREE.MeshStandardMaterial({ color: 0x3a2c22, roughness: 0.85 }); }
  key.intensity = 3.2; scene.add(key.target);
  scene.background = new THREE.Color(0x0b0c10); scene.fog = new THREE.Fog(0x0b0c10, 8, 22);
  const sp = +(q.get('s') || 1.4), N = +(q.get('N') || 2), ang = +(q.get('ang') || 1.35), dist = +(q.get('dist') || 4.2);
  const ts = []; for (let i = 0; i < N; i++) { const t = buildTeammate(M, i % 4); setTeammateLOD(t, 'hi'); t.root.rotation.y = Math.PI / 2; t.root.position.set(-20 - i * 0.9, 0, i * 0.9 - (N - 1) * 0.45); scene.add(t.root); ts.push(t); }
  const step = () => { for (let k = 0; k < 2; k++) for (const t of ts) { t.root.position.x += sp / 60; animateTeammate(t, 1 / 60, { speed: sp, crouch: !!q.get('c'), alive: true, fl: true, pitch: 0 }); } };
  for (let i = 0; i < 40; i++) step();
  window.__frame = () => { step(); const cx = ts[0].root.position.x - 0.45 * (N - 1); key.position.set(cx + 3, 5, 4); key.target.position.set(cx, 0, 0); key.target.updateMatrixWorld();
    cam.position.set(cx + Math.cos(ang) * dist, +(q.get('cy') || 1.15), Math.sin(ang) * dist); cam.lookAt(cx, 0.85, 0); renderer.render(scene, cam); };
  window.__frame();
} else if (view === 'mate') {
  // v7: ?acc=scarf|hat|fedora|beanie &col=<hex> (aparência); &face=1 câmera no rosto/pescoço; &N=4 vários lado a lado
  const look = q.get('acc') ? sanitizeLook({ acc: q.get('acc'), col: q.get('col') || '8a2a24' }) : null;
  const t = buildTeammate(M, +(q.get('i') || 0), look); scene.add(t.root); t.root.rotation.y = +(q.get('r') || 0.6);
  const n = +(q.get('n') || 90), sp = +(q.get('s') || 0);
  for (let i = 0; i < n; i++) animateTeammate(t, 1 / 60, { speed: sp, crouch: !!q.get('c'), alive: q.get('dead') ? false : true, fl: true, pitch: +(q.get('p') || 0) });
  cam.position.set(+(q.get('cx') || 0), +(q.get('cy') || 1.2), +(q.get('cz') || 3.6)); cam.lookAt(+(q.get('lx') || 0), +(q.get('ly') || 0.95), +(q.get('lz') || 0));
  if (q.get('fov')) { cam.fov = +q.get('fov'); cam.updateProjectionMatrix(); }
  // v5: ?lod=lo força o nível baixo; &mfl=1 acende a luz da lanterna do próprio boneco; &room=1 paredes de um cômodo
  if (q.get('lod')) setTeammateLOD(t, q.get('lod'));
  console.log('tris hi', teammateTriangles(t, 'hi'), 'lo', teammateTriangles(t, 'lo'), 'acc hi', accessoryTriangles(t, 'hi'), 'lo', accessoryTriangles(t, 'lo'));
  if (q.get('mfl')) window.__mfl = () => attachTeammateFlashlight(t, { intensity: +(q.get('mfl')) * 30, shadow: true });
  if (q.get('room')) {
    for (const [x, z, ry] of [[0, -2.2, 0], [-2.4, 0, Math.PI / 2], [2.4, 0, -Math.PI / 2]]) {
      const wg = new THREE.PlaneGeometry(5, 3); wg.setAttribute('color', new THREE.Float32BufferAttribute(new Array(wg.attributes.position.count * 3).fill(1), 3));
      const w = new THREE.Mesh(wg, M.wallGreen); w.position.set(x, 1.5, z); w.rotation.y = ry; w.receiveShadow = true; scene.add(w);
    }
  }
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
if (window.__mfl) window.__mfl(); // depois do 'mood' (que escurece as luzes da cena)
renderer.render(scene, cam);
window.__done = true;
