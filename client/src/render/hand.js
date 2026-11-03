// Mão em primeira pessoa segurando a lanterna (cena sobreposta, sem atravessar paredes).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Tubo suave (pele contínua) ao longo de pontos com raio variável e seção elíptica
export function sweep(pts, mat, { radial = 14, sub = 4, up = null, roundEnd = false } = {}) {
  const curve = new THREE.CatmullRomCurve3(pts.map(q => q.p), false, 'centripetal');
  const n = (pts.length - 1) * sub + 1;
  const pos = [], uv = [], idx = [];
  let prevN = null;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const seg = Math.min(pts.length - 2, Math.floor(u * (pts.length - 1)));
    const lt = u * (pts.length - 1) - seg, sm = lt * lt * (3 - 2 * lt);
    const A = pts[seg], Bq = pts[seg + 1];
    let r = A.r + (Bq.r - A.r) * sm;
    const sx = (A.sx ?? 1) + ((Bq.sx ?? 1) - (A.sx ?? 1)) * sm, sy = (A.sy ?? 1) + ((Bq.sy ?? 1) - (A.sy ?? 1)) * sm;
    if (roundEnd && u > 0.9) r *= Math.sqrt(Math.max(0.05, 1 - Math.pow((u - 0.9) / 0.1, 2)));
    const p = curve.getPointAt(u), tan = curve.getTangentAt(u).normalize();
    let nor;
    if (!prevN) { const upv = up || (Math.abs(tan.y) > 0.9 ? V(1, 0, 0) : V(0, 1, 0)); nor = new THREE.Vector3().crossVectors(tan, upv).normalize(); }
    else nor = prevN.clone().sub(tan.clone().multiplyScalar(prevN.dot(tan))).normalize();
    prevN = nor;
    const bin = new THREE.Vector3().crossVectors(tan, nor).normalize();
    for (let k = 0; k <= radial; k++) {
      const a = k / radial * Math.PI * 2;
      const q = p.clone().addScaledVector(nor, Math.cos(a) * r * sx).addScaledVector(bin, Math.sin(a) * r * sy);
      pos.push(q.x, q.y, q.z); uv.push(k / radial, u * 2);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < radial; k++) { const a = i * (radial + 1) + k, b = a + radial + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  // tampas
  for (const [ri, start] of [[0, true], [n - 1, false]]) {
    const c = pos.length / 3; let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < radial; k++) { const o = (ri * (radial + 1) + k) * 3; cx += pos[o]; cy += pos[o + 1]; cz += pos[o + 2]; }
    pos.push(cx / radial, cy / radial, cz / radial); uv.push(0.5, 0.5);
    for (let k = 0; k < radial; k++) { const a = ri * (radial + 1) + k; if (start) idx.push(c, a + 1, a); else idx.push(c, a, a + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

// Segmento de dedo afilado (cápsula alongada entre dois pontos)
function segment(a, b, r0, r1, mat) {
  const len = a.distanceTo(b);
  const pts = [];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let r = r0 + (r1 - r0) * t;
    // arredonda as pontas
    const e = Math.min(t, 1 - t);
    if (e < 0.2) r *= Math.sqrt(1 - Math.pow(1 - e / 0.2, 2)) * 0.85 + 0.15 * (e / 0.2);
    pts.push(new THREE.Vector2(Math.max(0.0005, r), t * len));
  }
  pts[0].x = 0.0004; pts[n].x = 0.0004;
  const geo = new THREE.LatheGeometry(pts, 14);
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(a);
  m.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

export function buildHand(M) {
  const T = M.T;
  const skin = new THREE.MeshStandardMaterial({ map: T.handSkin.map, normalMap: T.handSkin.normalMap, roughness: 0.88, color: 0xd8c4b8, normalScale: new THREE.Vector2(0.7, 0.7) });
  const nail = new THREE.MeshStandardMaterial({ color: 0xd8b8a8, roughness: 0.55 });
  const jacket = new THREE.MeshStandardMaterial({ map: T.jacket.map, normalMap: T.jacket.normalMap, roughness: 0.95, color: 0x7a7e86 });
  const cuffMat = new THREE.MeshStandardMaterial({ map: T.jacket.map, normalMap: T.jacket.normalMap, roughness: 1, color: 0x5a5e66 });
  const body = new THREE.MeshStandardMaterial({ map: T.knurl.map, normalMap: T.knurl.normalMap, roughness: 0.45, metalness: 0.75, color: 0xffffff });
  const alu = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.3, metalness: 0.9 });
  const lensMat = new THREE.MeshStandardMaterial({ color: 0xfff4dd, emissive: 0xfff0d0, emissiveIntensity: 2.5, roughness: 0.05 });
  const reflector = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.1, metalness: 1 });

  const root = new THREE.Group();     // segue a câmera (balanço, agachar, etc.)
  const grip = new THREE.Group();     // lanterna + mão
  root.add(grip);
  // ---------- lanterna (eixo -Z) ----------
  const R = 0.019;
  const fl = new THREE.Group(); grip.add(fl);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.15, 24), body); barrel.rotation.x = Math.PI / 2; barrel.position.z = 0.0; fl.add(barrel);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.026, R, 0.04, 24), alu); neck.rotation.x = Math.PI / 2; neck.position.z = -0.095; fl.add(neck);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.026, 0.04, 28), alu); head.rotation.x = Math.PI / 2; head.position.z = -0.135; fl.add(head);
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.0265, 0.003, 8, 28), reflector); bezel.position.z = -0.155; fl.add(bezel);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.024, 28), lensMat); lens.position.z = -0.1555; lens.rotation.y = Math.PI; fl.add(lens);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.05, R * 1.05, 0.03, 24), alu); tail.rotation.x = Math.PI / 2; tail.position.z = 0.09; fl.add(tail);
  const button = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.011, 0.008, 16), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 })); button.rotation.x = Math.PI / 2; button.position.z = 0.108; fl.add(button);
  // brilho da lente
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,245,225,1)'); gr.addColorStop(0.25, 'rgba(255,230,190,0.5)'); gr.addColorStop(1, 'rgba(255,220,170,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 }));
  glow.scale.set(0.06, 0.06, 1); glow.position.z = -0.165; fl.add(glow);

  // ---------- mão (pegada de punho: dorso para cima, dedos envolvendo pela esquerda) ----------
  const hand = new THREE.Group(); grip.add(hand);
  const deg = Math.PI / 180;
  const P = (theta, z, rad) => V(Math.cos(theta * deg) * rad, Math.sin(theta * deg) * rad, z);
  // dorso da mão: tubo achatado do punho até a linha dos nós dos dedos
  const knuckleC = P(72, -0.002, R + 0.02);
  const wristC = V(0.058, -0.004, 0.012);
  hand.add(sweep([
    { p: wristC.clone().add(V(0.012, -0.004, 0.006)), r: 0.024, sx: 1.25, sy: 0.75 },
    { p: wristC, r: 0.026, sx: 1.35, sy: 0.7 },
    { p: wristC.clone().lerp(knuckleC, 0.5).add(V(0, 0.008, 0)), r: 0.03, sx: 1.35, sy: 0.55 },
    { p: knuckleC, r: 0.031, sx: 1.3, sy: 0.5 },
  ], skin, { up: V(0, 0, 1), radial: 20, sub: 6 }));
  // eminência tenar e base do polegar (lado de baixo/direita)
  const thenar = new THREE.Mesh(new THREE.SphereGeometry(0.02, 18, 14), skin); thenar.scale.set(1.1, 0.8, 1.5); thenar.position.set(0.04, -0.02, -0.006); hand.add(thenar);
  // quatro dedos: nós no topo, envolvendo para a esquerda e por baixo
  const fingers = [];
  const defs = [[-0.031, 1.0, 0.0094], [-0.011, 1.07, 0.0097], [0.009, 1.0, 0.0092], [0.027, 0.84, 0.0084]];
  for (const [z, sc, fr] of defs) {
    const f = new THREE.Group(); hand.add(f);
    const rad = R + fr * 0.92;
    const lens3 = [0.046 * sc, 0.029 * sc, 0.023 * sc];
    let th = 78;
    const pts = [{ p: P(th - 6, z + 0.004, R + 0.026), r: fr * 1.12 }];
    const joints = [P(th, z, rad + 0.004)];
    pts.push({ p: joints[0], r: fr * 1.1 });
    for (let k = 0; k < 3; k++) {
      const a0 = th; th += (lens3[k] / rad) / deg;
      // ponto médio levemente para fora (curvatura natural da falange)
      const mid = P((a0 + th) / 2, z + 0.001 * k, rad + 0.0015);
      const j = P(th, z + 0.002 * (k + 1), rad - (k === 2 ? 0.002 : 0));
      pts.push({ p: mid, r: fr * (0.98 - k * 0.1) }, { p: j, r: fr * (0.9 - k * 0.12) * (k === 2 ? 0.75 : 1.02) });
      joints.push(j);
    }
    f.add(sweep(pts, skin, { radial: 12, sub: 3, roundEnd: true }));
    // unha
    const tip = joints[3], prev = pts[pts.length - 2].p;
    const nl = new THREE.Mesh(new THREE.SphereGeometry(fr * 0.78, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), nail);
    nl.position.copy(tip.clone().lerp(prev, 0.45)); nl.scale.set(1, 0.3, 1.25);
    nl.quaternion.setFromUnitVectors(V(0, 1, 0), V(tip.x, tip.y, 0).normalize()); f.add(nl);
    fingers.push(f);
  }
  // polegar: sai da base, passa por baixo/direita e aponta para frente
  const thumb = new THREE.Group(); hand.add(thumb);
  const tj = [V(0.045, -0.022, 0.0), V(0.036, -0.03, -0.022), V(0.024, -0.032, -0.046), V(0.012, -0.03, -0.064), V(0.004, -0.027, -0.077)];
  thumb.add(sweep([{ p: tj[0], r: 0.016 }, { p: tj[1], r: 0.0125 }, { p: tj[2], r: 0.011 }, { p: tj[3], r: 0.0095 }, { p: tj[4], r: 0.007 }], skin, { radial: 12, sub: 4, roundEnd: true }));
  { const nl = new THREE.Mesh(new THREE.SphereGeometry(0.007, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), nail); nl.position.copy(tj[4].clone().lerp(tj[3], 0.4)); nl.scale.set(1, 0.3, 1.3); nl.quaternion.setFromUnitVectors(V(0, 1, 0), V(tj[4].x * 0.3, tj[4].y, 0).normalize().negate()); thumb.add(nl); }
  // punho e antebraço (desce para a direita e para trás)
  const fd = V(0.62, -0.42, 0.66).normalize();
  const w0 = wristC.clone().add(V(0.012, -0.004, 0.006));
  hand.add(sweep([{ p: w0, r: 0.025, sx: 1.2, sy: 0.8 }, { p: w0.clone().addScaledVector(fd, 0.05), r: 0.027, sx: 1.15, sy: 0.85 }, { p: w0.clone().addScaledVector(fd, 0.07), r: 0.029 }], skin, { up: V(0, 0, 1), radial: 16, sub: 4 }));
  // manga da jaqueta com punho canelado
  const sleeve = new THREE.Group(); hand.add(sleeve);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.04, 0.05, 28, 6, true), cuffMat);
  { const p = cuff.geometry.attributes.position; for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getZ(i), p.getX(i)); const k = 1 + 0.05 * Math.max(0, Math.sin(a * 22)); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); } cuff.geometry.computeVertexNormals(); }
  cuff.material.side = THREE.DoubleSide;
  const sl = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.066, 0.42, 24, 10, true), jacket);
  { const p = sl.geometry.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); const a = Math.atan2(p.getZ(i), p.getX(i)); const k = 1 + 0.07 * Math.sin(y * 26 + a * 2) * Math.max(0, Math.sin(a * 3)); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); } sl.geometry.computeVertexNormals(); }
  sl.material.side = THREE.DoubleSide;
  const sPos = w0.clone().addScaledVector(fd, 0.035);
  cuff.position.copy(sPos); cuff.quaternion.setFromUnitVectors(V(0, -1, 0), fd); sleeve.add(cuff);
  sl.position.copy(sPos.clone().addScaledVector(fd, 0.23)); sl.quaternion.setFromUnitVectors(V(0, -1, 0), fd); sleeve.add(sl);

  root.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
  // pose: lanterna apontando para frente, um pouco para dentro e para cima
  grip.rotation.set(0.05, 0.1, -0.05);
  root.position.set(0.17, -0.15, -0.33);
  return { root, grip, lens: lensMat, glow, button, thumb, fingers, fl };
}

// Animação da mão: balanço, passos, agachar, interação, clique da lanterna
export class HandAnimator {
  constructor(h) { this.h = h; this.t = 0; this.bob = 0; this.interact = 0; this.click = 0; this.crouch = 0; this.base = h.root.position.clone(); this.lookLag = V(0, 0, 0); }
  trigger(kind) { if (kind === 'interact') this.interact = 1; if (kind === 'click') this.click = 1; }
  update(dt, { speed = 0, running = false, crouch = false, on = true, yawVel = 0, pitchVel = 0, dead = false }) {
    this.t += dt;
    const h = this.h;
    this.bob += dt * (speed > 0.1 ? (running ? 11 : 7.5) * Math.min(1, speed / 2.6 + 0.3) : 0);
    const amp = Math.min(1, speed / 2.6) * (running ? 1.6 : 1);
    this.crouch += ((crouch ? 1 : 0) - this.crouch) * Math.min(1, dt * 6);
    this.interact = Math.max(0, this.interact - dt * 2.2);
    this.click = Math.max(0, this.click - dt * 6);
    const idleX = Math.sin(this.t * 0.9) * 0.0035, idleY = Math.sin(this.t * 1.3) * 0.004;
    const bx = Math.cos(this.bob) * 0.012 * amp, by = -Math.abs(Math.sin(this.bob)) * 0.016 * amp;
    // atraso da mão ao girar a câmera
    this.lookLag.x += ((-yawVel * 0.004) - this.lookLag.x) * Math.min(1, dt * 8);
    this.lookLag.y += ((pitchVel * 0.004) - this.lookLag.y) * Math.min(1, dt * 8);
    const lag = this.lookLag;
    const raise = Math.sin(this.interact * Math.PI);
    h.root.position.set(this.base.x + idleX + bx + lag.x - raise * 0.03, this.base.y + idleY + by - this.crouch * 0.035 + raise * 0.06 + lag.y + (dead ? -0.5 : 0), this.base.z - raise * 0.05 - (running ? 0.02 : 0));
    h.root.rotation.set(-this.crouch * 0.08 + raise * 0.25 + by * 2, lag.x * 3, bx * 2 - this.crouch * 0.05);
    // polegar pressiona o botão (clique) – polegar desliza para trás
    h.thumb.position.z = this.click * 0.012;
    h.thumb.rotation.x = -this.click * 0.15;
    for (let i = 0; i < h.fingers.length; i++) h.fingers[i].rotation.z = Math.sin(this.t * 0.8 + i) * 0.01;
    h.lens.emissiveIntensity = on ? 2.5 : 0.0;
    h.lens.color.setHex(on ? 0xfff4dd : 0x666666);
    h.glow.visible = on;
  }
}
