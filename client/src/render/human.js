// Colegas de equipe: figura escura estilizada (capuz, casaco) com lanterna funcional.
import * as THREE from 'three';
import { sweep } from './hand.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ACCENTS = [0x7a2a2a, 0x2a5a7a, 0x6a6a2a, 0x3a6a3a];

export function buildTeammate(M, idx = 0) {
  const accent = ACCENTS[idx % ACCENTS.length];
  // tecidos foscos sem especular (Lambert): silhueta escura mesmo sob a lanterna
  const coat = new THREE.MeshLambertMaterial({ map: M.T.jacket.map, normalMap: M.T.jacket.normalMap, color: 0x8a8e98 });
  const pants = new THREE.MeshLambertMaterial({ map: M.T.fabric.map, color: 0x2a2620 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x050506 });
  const skin = new THREE.MeshStandardMaterial({ map: M.T.handSkin.map, color: 0x6a4c3e, roughness: 0.9 });
  const glove = new THREE.MeshLambertMaterial({ color: 0x15130f });
  const band = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.8, emissive: accent, emissiveIntensity: 0.05 });
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const parts = {};
  // pernas (quadril → joelho → tornozelo) em grupos para animar
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(s * 0.1, 0.92, 0); body.add(hip);
    hip.add(sweep([{ p: V(0, 0.02, 0), r: 0.085 }, { p: V(0, -0.22, 0.01), r: 0.075 }, { p: V(0, -0.44, 0.0), r: 0.06 }], pants, { radial: 12 }));
    const knee = new THREE.Group(); knee.position.set(0, -0.44, 0); hip.add(knee);
    knee.add(sweep([{ p: V(0, 0, 0), r: 0.058 }, { p: V(0, -0.2, -0.01), r: 0.052 }, { p: V(0, -0.4, 0), r: 0.045 }], pants, { radial: 12 }));
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.08, 0.26), dark); shoe.position.set(0, -0.44, 0.05); knee.add(shoe);
    parts['hip' + s] = hip; parts['knee' + s] = knee;
  }
  // tronco com casaco
  const torso = new THREE.Group(); torso.position.y = 0.95; body.add(torso);
  torso.add(sweep([{ p: V(0, -0.05, 0), r: 0.17, sx: 1.2, sy: 0.8 }, { p: V(0, 0.2, 0), r: 0.18, sx: 1.25, sy: 0.8 }, { p: V(0, 0.45, 0.0), r: 0.19, sx: 1.25, sy: 0.75 }, { p: V(0, 0.56, 0.0), r: 0.1, sx: 1.1, sy: 0.9 }], coat, { radial: 18, up: V(0, 0, 1) }));
  const sash = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.022, 6, 24), band); sash.rotation.x = Math.PI / 2; sash.scale.set(1.2, 0.8, 1); sash.position.y = 0.05; torso.add(sash);
  // barra do casaco (abre um pouco abaixo da cintura) e gola
  const hem = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.235, 0.36, 20, 1, true), coat); hem.material.side = THREE.DoubleSide; hem.scale.set(1.2, 1, 0.82); hem.position.y = -0.2; torso.add(hem);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.035, 8, 20), coat); collar.rotation.x = Math.PI / 2; collar.scale.set(1.15, 1, 1); collar.position.y = 0.56; torso.add(collar);
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.04, 20, 1, true), dark); belt.scale.set(1.2, 1, 0.82); belt.position.y = 0.0; torso.add(belt);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.36, 0.14), new THREE.MeshStandardMaterial({ color: 0x1e1a14, roughness: 0.95 })); pack.position.set(0, 0.28, -0.2); torso.add(pack);
  // cabeça com capuz (rosto em sombra)
  const head = new THREE.Group(); head.position.y = 0.68; torso.add(head);
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.135, 20, 16), coat); hood.scale.set(0.95, 1.1, 1.05); hood.position.z = -0.015; head.add(hood);
  // abertura do capuz: rosto em sombra visível pela frente, com borda do capuz e queixo
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), dark); face.scale.set(0.82, 1.0, 0.7); face.position.set(0, -0.02, 0.085); head.add(face);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.088, 0.022, 8, 24), coat); rim.scale.set(0.95, 1.18, 1); rim.position.set(0, -0.01, 0.12); head.add(rim);
  const chin = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), skin); chin.position.set(0, -0.075, 0.115); chin.scale.set(1, 0.65, 0.6); head.add(chin);
  const drape = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.17, 0.16, 18, 1, true), coat); drape.position.set(0, -0.12, -0.02); head.add(drape);
  // braços
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(s * 0.22, 0.45, 0); torso.add(sh);
    sh.add(sweep([{ p: V(0, 0, 0), r: 0.07 }, { p: V(s * 0.02, -0.15, 0.0), r: 0.06 }, { p: V(s * 0.03, -0.3, 0), r: 0.052 }], coat, { radial: 12 }));
    const el = new THREE.Group(); el.position.set(s * 0.03, -0.3, 0); sh.add(el);
    el.add(sweep([{ p: V(0, 0, 0), r: 0.05 }, { p: V(0, -0.14, 0.02), r: 0.046 }, { p: V(0, -0.27, 0.03), r: 0.04 }], coat, { radial: 12 }));
    const hd = new THREE.Mesh(new THREE.SphereGeometry(0.042, 12, 10), glove); hd.position.set(0, -0.31, 0.03); hd.scale.set(0.9, 1.1, 0.8); el.add(hd);
    parts['sh' + s] = sh; parts['el' + s] = el;
  }
  // lanterna na mão direita
  const fl = new THREE.Group(); fl.position.set(0, -0.31, 0.06); parts['el1'].add(fl);
  const flb = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.2, 12), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.8, roughness: 0.4 })); flb.rotation.x = Math.PI / 2; fl.add(flb);
  const lensMat = new THREE.MeshStandardMaterial({ color: 0xfff0d8, emissive: 0xfff0d8, emissiveIntensity: 3 });
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.022, 14), lensMat); lens.position.z = 0.101; fl.add(lens);
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, body, torso, head, parts, fl, lensMat, phase: 0, dead: 0 };
}

// anima a figura: passos, agachar, morte (cai), apontar lanterna pelo pitch
export function animateTeammate(t, dt, s) {
  const sp = Math.min(1, (s.speed || 0) / 2.6);
  t.phase += dt * (s.speed || 0) * 2.6;
  const a = Math.sin(t.phase) * 0.55 * sp;
  t.parts['hip-1'].rotation.x = a; t.parts['hip1'].rotation.x = -a;
  t.parts['knee-1'].rotation.x = Math.max(0, -Math.cos(t.phase)) * 0.7 * sp; t.parts['knee1'].rotation.x = Math.max(0, Math.cos(t.phase)) * 0.7 * sp;
  t.parts['sh-1'].rotation.x = -a * 0.7;
  // braço direito aponta a lanterna para frente
  t.parts['sh1'].rotation.x = -1.25 - (s.pitch || 0) * 0.8; t.parts['el1'].rotation.x = -0.25;
  const crouch = s.crouch ? 1 : 0;
  t.body.position.y += ((-0.45 * crouch) - t.body.position.y) * Math.min(1, dt * 8);
  t.parts['hip-1'].rotation.x -= crouch * 1.1; t.parts['hip1'].rotation.x -= crouch * 1.1; t.parts['knee-1'].rotation.x += crouch * 1.6; t.parts['knee1'].rotation.x += crouch * 1.6;
  t.torso.rotation.x = crouch * 0.35 + Math.abs(Math.sin(t.phase)) * 0.04 * sp;
  t.head.rotation.x = -(s.pitch || 0) * 0.6 - crouch * 0.3;
  // morte: cai de lado
  t.dead += ((s.alive ? 0 : 1) - t.dead) * Math.min(1, dt * 3);
  t.root.rotation.z = t.dead * 1.45;
  t.lensMat.emissiveIntensity = s.fl ? 3 : 0;
}
