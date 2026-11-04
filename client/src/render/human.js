// Colegas de equipe: boneco de madeira articulado (cabeça e mãos de madeira entalhada, como a mão em
// primeira pessoa) vestindo roupas escuras, com lanterna funcional. Animação por molas + ciclo de passos
// ligado à distância percorrida (sem pés deslizando).
import * as THREE from 'three';
import { sweep, dollWoodMaterial, capsule } from './hand.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ACCENTS = [0x8a2a24, 0x2a5a80, 0x7a6a24, 0x2f6a3a];

function grp(parent, x, y, z) { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }

// mão de madeira simplificada (palma + 4 dedos curvados + polegar); grip=true fecha em volta da lanterna
function woodHand(wood, joint, s, grip) {
  const h = new THREE.Group();
  const palm = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 12), wood); palm.scale.set(0.55, 1.0, 0.95); palm.position.y = -0.045; h.add(palm);
  for (let f = 0; f < 4; f++) {
    const z = (1.5 - f) * 0.017, L = [0.036, 0.04, 0.038, 0.03][f];
    const a = V(-s * 0.005, -0.085, z), curl = grip ? 1.25 : 0.45;
    const b = a.clone().add(V(-s * Math.sin(curl * 0.6) * L * 0.6, -Math.cos(curl * 0.6) * L * 0.6, 0));
    const c = b.clone().add(V(-s * Math.sin(curl * 1.3) * L * 0.55, -Math.cos(curl * 1.3) * L * 0.55, 0));
    h.add(capsule(a, b, 0.0085, 0.0078, wood, 10)); h.add(capsule(b, c, 0.0075, 0.0065, wood, 10));
    const j = new THREE.Mesh(new THREE.SphereGeometry(0.0072, 8, 6), joint); j.position.copy(b); h.add(j);
  }
  const t0 = V(-s * 0.012, -0.03, 0.035), t1 = t0.clone().add(V(-s * 0.018, -0.03, 0.02));
  h.add(capsule(t0, t1, 0.0095, 0.008, wood, 10));
  return h;
}

export function buildTeammate(M, idx = 0) {
  const accent = ACCENTS[idx % ACCENTS.length];
  const wood = dollWoodMaterial(0xf0dcc0, 0.5);
  const joint = dollWoodMaterial(0xd4b896, 0.45);
  const pin = new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.6 });
  const coat = new THREE.MeshStandardMaterial({ map: M.T.jacket.map, normalMap: M.T.jacket.normalMap, color: 0x868c96, roughness: 0.95 });
  const pantsM = new THREE.MeshStandardMaterial({ map: M.T.fabric.map, color: 0x34302a, roughness: 1 });
  const boot = new THREE.MeshStandardMaterial({ color: 0x15110d, roughness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.85 });
  const band = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.85, emissive: accent, emissiveIntensity: 0.06 });
  const root = new THREE.Group();
  const body = grp(root, 0, 0, 0);       // sobe/desce (agachar, balanço)
  const pelvis = grp(body, 0, 0.94, 0);
  const parts = {};
  // quadril (calça)
  pelvis.add(sweep([{ p: V(0, -0.07, 0), r: 0.125, sx: 1.25, sy: 0.85 }, { p: V(0, 0.06, 0), r: 0.13, sx: 1.22, sy: 0.82 }], pantsM, { radial: 18, up: V(0, 0, 1) }));
  // pernas: quadril → joelho → tornozelo, com bota
  for (const s of [-1, 1]) {
    const hip = grp(pelvis, s * 0.09, -0.04, 0);
    hip.add(sweep([{ p: V(0, 0.03, 0), r: 0.078 }, { p: V(0, -0.2, 0.008), r: 0.07 }, { p: V(0, -0.41, 0.0), r: 0.056 }], pantsM, { radial: 14 }));
    const knee = grp(hip, 0, -0.42, 0);
    knee.add(sweep([{ p: V(0, 0.01, 0), r: 0.057 }, { p: V(0, -0.2, -0.012), r: 0.05 }, { p: V(0, -0.38, 0), r: 0.045 }], pantsM, { radial: 14 }));
    const ankle = grp(knee, 0, -0.42, 0);
    const b1 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 14), boot); b1.position.y = 0.0; ankle.add(b1);
    const b2 = sweep([{ p: V(0, -0.045, -0.045), r: 0.048, sx: 0.8, sy: 1.15 }, { p: V(0, -0.055, 0.06), r: 0.046, sx: 0.65, sy: 1.1 }, { p: V(0, -0.06, 0.13), r: 0.034, sx: 0.6, sy: 1.0 }], boot, { radial: 14, up: V(1, 0, 0) });
    ankle.add(b2);
    parts['hip' + s] = hip; parts['knee' + s] = knee; parts['ankle' + s] = ankle;
  }
  // tronco (jaqueta)
  const spine = grp(pelvis, 0, 0.04, 0);
  const torso = grp(spine, 0, 0.0, 0);
  torso.add(sweep([{ p: V(0, -0.02, 0), r: 0.135, sx: 1.22, sy: 0.8 }, { p: V(0, 0.18, 0.01), r: 0.15, sx: 1.25, sy: 0.82 }, { p: V(0, 0.36, 0.0), r: 0.165, sx: 1.25, sy: 0.78 }, { p: V(0, 0.47, -0.01), r: 0.1, sx: 1.2, sy: 0.85 }], coat, { radial: 20, up: V(0, 0, 1) }));
  const hem = new THREE.Mesh(new THREE.CylinderGeometry(0.168, 0.185, 0.14, 22, 1, true), coat); hem.material.side = THREE.DoubleSide; hem.scale.set(1.22, 1, 0.84); hem.position.y = -0.07; torso.add(hem);
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.166, 0.012, 6, 28), dark); belt.rotation.x = Math.PI / 2; belt.scale.set(1.22, 0.84, 1); belt.position.y = 0.02; torso.add(belt);
  const zip = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.4, 0.006), dark); zip.position.set(0, 0.2, 0.128); zip.rotation.x = -0.05; torso.add(zip);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.32, 0.12), new THREE.MeshStandardMaterial({ color: 0x221d17, roughness: 0.95 })); pack.position.set(0, 0.24, -0.17); torso.add(pack);
  for (const s of [-1, 1]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.36, 0.012), dark); st.position.set(s * 0.09, 0.24, 0.124); torso.add(st); }
  // cachecol colorido (identifica o jogador)
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.03, 8, 20), band); scarf.rotation.x = Math.PI / 2; scarf.position.y = 0.5; torso.add(scarf);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.02), band); tail.position.set(0.05, 0.42, 0.075); tail.rotation.z = 0.15; torso.add(tail);
  // pescoço e cabeça de madeira (ovo entalhado, sem rosto) com touca escura
  const neckG = grp(torso, 0, 0.5, 0.0);
  neckG.add(capsule(V(0, -0.02, 0), V(0, 0.09, 0.01), 0.036, 0.034, wood, 14));
  const head = grp(neckG, 0, 0.1, 0.01);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.1, 28, 20), wood); skull.scale.set(0.86, 1.12, 0.96); skull.position.y = 0.1; head.add(skull);
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.065, 20, 14), wood); jaw.scale.set(0.95, 0.8, 0.9); jaw.position.set(0, 0.04, 0.025); head.add(jaw);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), wood); nose.scale.set(0.8, 1.4, 0.9); nose.position.set(0, 0.095, 0.094); head.add(nose);
  const beanie = new THREE.Mesh(new THREE.SphereGeometry(0.094, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.52), coat); beanie.scale.set(0.95, 1.05, 1.02); beanie.position.y = 0.135; beanie.rotation.x = -0.12; head.add(beanie);
  const brim = new THREE.Mesh(new THREE.TorusGeometry(0.087, 0.014, 8, 24), coat); brim.rotation.x = Math.PI / 2 - 0.12; brim.scale.set(0.95, 1.02, 1); brim.position.set(0, 0.135, 0.004); head.add(brim);
  // braços: ombro (junta) → cotovelo → mão de madeira
  for (const s of [-1, 1]) {
    const sh = grp(torso, s * 0.2, 0.39, 0);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), coat); sh.add(ball);
    sh.add(sweep([{ p: V(0, 0, 0), r: 0.058 }, { p: V(s * 0.01, -0.14, 0.0), r: 0.05 }, { p: V(0, -0.28, 0), r: 0.045 }], coat, { radial: 12 }));
    const el = grp(sh, 0, -0.28, 0);
    el.add(sweep([{ p: V(0, 0.01, 0), r: 0.045 }, { p: V(0, -0.13, 0.01), r: 0.042 }, { p: V(0, -0.24, 0.01), r: 0.038 }], coat, { radial: 12 }));
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.008, 6, 16), dark); cuff.rotation.x = Math.PI / 2; cuff.position.y = -0.245; el.add(cuff);
    const wr = grp(el, 0, -0.26, 0.01);
    const wj = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 10), joint); wr.add(wj);
    const pinM = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 8), pin); pinM.rotation.z = Math.PI / 2; wr.add(pinM);
    const hd = woodHand(wood, joint, s, s < 0); hd.position.y = -0.01; wr.add(hd);
    parts['sh' + s] = sh; parts['el' + s] = el; parts['wr' + s] = wr;
  }
  // lanterna na mão direita (lado -X do boneco, que olha para +Z)
  const fl = new THREE.Group(); fl.position.set(0.012, -0.075, 0.0); parts['wr-1'].add(fl);
  const flBody = new THREE.MeshStandardMaterial({ color: 0x26272b, metalness: 0.4, roughness: 0.45 });
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.15, 16), flBody); fl.add(barrel);
  const fhead = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.018, 0.045, 18), flBody); fhead.position.y = -0.095; fl.add(fhead);
  const lensMat = new THREE.MeshStandardMaterial({ color: 0xfff0d8, emissive: 0xfff0d8, emissiveIntensity: 3 });
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.023, 16), lensMat); lens.rotation.x = Math.PI / 2; lens.position.y = -0.118; fl.add(lens);
  fl.rotation.x = 0; // eixo da lanterna ao longo do antebraço (para baixo = frente quando o braço aponta)
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const S = () => ({ x: 0, v: 0 });
  return { root, body, pelvis, spine, torso, neck: neckG, head, parts, fl, lensMat, phase: 0, dead: 0, sp: {}, S, walk: 0, run: 0, crouch: 0, first: true };
}

function spr(st, target, om, ze, dt) {
  const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
  for (let i = 0; i < n; i++) { st.v += (om * om * (target - st.x) - 2 * ze * om * st.v) * h; st.x += st.v * h; }
  return st.x;
}
// anima a figura: passos (fase ligada à distância), braços, agachar, olhar, morte
export function animateTeammate(t, dt, s) {
  dt = Math.min(Math.max(dt, 0), 0.1); if (!dt) return;
  const speed = s.speed || 0;
  const k = (name, target, om = 12, ze = 0.7) => { const st = t.sp[name] || (t.sp[name] = { x: target, v: 0 }); if (t.first) { st.x = target; st.v = 0; } return spr(st, target, om, ze, dt); };
  t.walk += (clamp(speed / 1.4, 0, 1) - t.walk) * Math.min(1, dt * 6);
  t.run += ((speed > 3.2 ? 1 : 0) - t.run) * Math.min(1, dt * 4);
  t.crouch += ((s.crouch ? 1 : 0) - t.crouch) * Math.min(1, dt * 7);
  const stepLen = s.crouch ? 0.55 : speed > 3.2 ? 0.95 : 0.75;
  t.phase += dt * speed / stepLen * Math.PI; // meio ciclo por passo
  const ph = t.phase, w = t.walk, run = t.run, cr = t.crouch;
  const amp = Math.asin(clamp(stepLen / 1.72, 0, 0.95)) * w * (1 - 0.35 * cr);
  const sn = Math.sin(ph), cs = Math.cos(ph);
  // pernas
  const P = t.parts;
  P['hip-1'].rotation.x = k('hipL', -sn * amp - cr * 1.05 - run * 0.15, 16, 0.8);
  P['hip1'].rotation.x = k('hipR', sn * amp - cr * 1.05 - run * 0.15, 16, 0.8);
  P['knee-1'].rotation.x = k('kneeL', Math.max(0, cs) * (0.55 + run * 0.7) * w + cr * 1.75 + 0.04, 18, 0.8);
  P['knee1'].rotation.x = k('kneeR', Math.max(0, -cs) * (0.55 + run * 0.7) * w + cr * 1.75 + 0.04, 18, 0.8);
  P['ankle-1'].rotation.x = k('ankL', -Math.max(0, cs) * 0.3 * w - cr * 0.6 + Math.max(0, sn) * 0.2 * w, 18, 0.8);
  P['ankle1'].rotation.x = k('ankR', -Math.max(0, -cs) * 0.3 * w - cr * 0.6 + Math.max(0, -sn) * 0.2 * w, 18, 0.8);
  // corpo: balanço vertical (2x por ciclo), lateral, torção e inclinação
  const bob = -Math.abs(cs) * (0.025 + run * 0.03) * w;
  t.body.position.y = k('bodyY', -0.38 * cr + bob + (1 - Math.cos(amp)) * -0.06, 14, 0.75);
  t.pelvis.rotation.y = k('pelY', -sn * 0.12 * w, 12, 0.7); t.pelvis.rotation.z = k('pelZ', cs * 0.04 * w, 12, 0.7);
  t.spine.rotation.x = k('spX', cr * 0.42 + run * 0.28 + Math.abs(cs) * 0.03 * w, 10, 0.65);
  t.spine.rotation.y = k('spY', sn * 0.16 * w, 10, 0.6);
  // braço esquerdo balança oposto à perna esquerda; braço direito aponta a lanterna (com leve atraso)
  const pitch = s.pitch || 0;
  P['sh1'].rotation.x = k('shL', -sn * (0.45 + run * 0.6) * w - cr * 0.3 - run * 0.2, 9, 0.55);
  P['sh1'].rotation.z = k('shLz', 0.08 + run * 0.1, 9, 0.6);
  P['el1'].rotation.x = k('elL', -0.2 - Math.max(0, -sn) * 0.4 * w - run * 0.9 - cr * 0.3, 9, 0.5);
  P['sh-1'].rotation.x = k('shR', -1.3 - pitch * 0.85 + sn * 0.05 * w - t.spine.rotation.x - t.pelvis.rotation.x, 10, 0.6);
  P['sh-1'].rotation.z = k('shRz', -0.12, 10, 0.6);
  P['el-1'].rotation.x = k('elR', -0.28 - run * 0.25 + Math.abs(cs) * 0.04 * w, 10, 0.55);
  P['wr-1'].rotation.x = k('wrR', 0.0, 10, 0.6);
  // cabeça acompanha o olhar
  t.neck.rotation.x = k('nk', -pitch * 0.35 - t.spine.rotation.x * 0.7, 10, 0.7);
  t.head.rotation.x = k('hd', -pitch * 0.35, 12, 0.7);
  t.head.rotation.y = k('hdY', -sn * 0.06 * w, 10, 0.7);
  // morte: cai de lado (mola amortecida → sem estalo)
  t.dead = k('dead', s.alive ? 0 : 1, 6, 0.85);
  t.root.rotation.z = t.dead * 1.45;
  t.body.position.y -= t.dead * 0.2;
  t.lensMat.emissiveIntensity = s.fl ? 3 : 0;
  t.first = false;
}
