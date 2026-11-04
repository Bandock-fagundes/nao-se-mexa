// Mão em primeira pessoa (estilo boneco de madeira articulado) segurando a lanterna.
// Renderizada numa cena sobreposta (não atravessa paredes). Animação por molas amortecidas.
import * as THREE from 'three';
import { normalFromHeight } from './textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Tubo suave (pele contínua) ao longo de pontos com raio variável e seção elíptica (usado também pelos colegas)
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

// ---------- madeira entalhada (veios finos ao longo das peças) ----------
let woodCache = null;
export function dollWoodTextures() {
  if (woodCache) return woodCache;
  const W = 512, H = 512;
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return [c, c.getContext('2d', { willReadFrequently: true })]; };
  const [ca, a] = mk(), [ch, h] = mk(), [cr, ro] = mk();
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  a.fillStyle = '#c9a274'; a.fillRect(0, 0, W, H);
  h.fillStyle = '#808080'; h.fillRect(0, 0, W, H);
  ro.fillStyle = '#7a7a7a'; ro.fillRect(0, 0, W, H);
  // faixas largas de tom (cerne / alburno)
  for (let i = 0; i < 26; i++) { const x = rnd() * W, w = 10 + rnd() * 50; const g = a.createLinearGradient(x - w, 0, x + w, 0); const c = rnd() < 0.5 ? '120,80,45' : '230,200,160'; g.addColorStop(0, `rgba(${c},0)`); g.addColorStop(0.5, `rgba(${c},${0.08 + rnd() * 0.1})`); g.addColorStop(1, `rgba(${c},0)`); a.fillStyle = g; a.fillRect(x - w, 0, w * 2, H); }
  // veios finos ondulados (vertical = ao longo do comprimento da peça)
  for (let i = 0; i < 260; i++) {
    let x = rnd() * W; const dark = rnd();
    a.strokeStyle = `rgba(${90 + dark * 30},${55 + dark * 20},${30},${0.12 + rnd() * 0.22})`; a.lineWidth = 0.6 + rnd() * 1.4;
    h.strokeStyle = `rgba(60,60,60,${0.25 + rnd() * 0.3})`; h.lineWidth = a.lineWidth;
    const ph = rnd() * 6, amp = 1 + rnd() * 4, fq = 0.01 + rnd() * 0.02;
    for (const g of [a, h]) { g.beginPath(); for (let y = 0; y <= H; y += 8) { const xx = x + Math.sin(y * fq + ph) * amp; if (y === 0) g.moveTo(xx, y); else g.lineTo(xx, y); } g.stroke(); }
  }
  // poros alongados
  for (let i = 0; i < 2500; i++) { const x = rnd() * W, y = rnd() * H; a.fillStyle = `rgba(80,50,25,${rnd() * 0.25})`; a.fillRect(x, y, 1, 2 + rnd() * 5); h.fillStyle = 'rgba(70,70,70,0.4)'; h.fillRect(x, y, 1, 3); }
  // alguns "olhos" de veio
  for (let i = 0; i < 3; i++) { const cx = rnd() * W, cy = rnd() * H; for (let k = 1; k < 7; k++) { a.strokeStyle = `rgba(110,70,40,${0.18 - k * 0.02})`; a.lineWidth = 1; a.beginPath(); a.ellipse(cx, cy, 2 + k * 3, 6 + k * 9, 0, 0, 7); a.stroke(); } }
  for (let i = 0; i < 40; i++) { ro.fillStyle = `rgba(${rnd() < 0.5 ? '90,90,90' : '150,150,150'},0.2)`; ro.fillRect(rnd() * W, 0, 4 + rnd() * 30, H); }
  const tex = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  woodCache = { map: tex(ca, true), normalMap: tex(normalFromHeight(ch, 1.2), false), roughnessMap: tex(cr, false) };
  return woodCache;
}
export function dollWoodMaterial(tint = 0xffffff, rough = 0.5) {
  const T = dollWoodTextures();
  return new THREE.MeshStandardMaterial({ map: T.map, normalMap: T.normalMap, roughnessMap: T.roughnessMap, normalScale: new THREE.Vector2(0.35, 0.35), color: tint, roughness: rough, metalness: 0 });
}

// cápsula entalhada entre dois pontos (raios r0 → r1)
export function capsule(a, b, r0, r1, mat, seg = 18) {
  const len = a.distanceTo(b);
  const pts = [], n = 14;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let r = r0 + (r1 - r0) * t;
    // pontas arredondadas (hemisférios) — leve "barriga" no meio como peça torneada
    const e0 = Math.min(1, t * len / r0), e1 = Math.min(1, (1 - t) * len / r1);
    r *= Math.sqrt(Math.max(0, 1 - Math.pow(1 - e0, 2))) * Math.sqrt(Math.max(0, 1 - Math.pow(1 - e1, 2)));
    r *= 1 + 0.05 * Math.sin(t * Math.PI);
    pts.push(new THREE.Vector2(Math.max(0.00005, r), t * len));
  }
  const geo = new THREE.LatheGeometry(pts, seg);
  const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5 + (a.x * 7 % 1), uv.getY(i) * len * 6 + a.z * 3);
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(a);
  m.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}
// dobradiça: esfera da junta + pino escuro ao longo do eixo (paralelo à lanterna)
function hinge(p, r, axis, wood, pin) {
  const g = new THREE.Group(); g.position.copy(p);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), wood); g.add(ball);
  const pn = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.24, r * 0.24, r * 2.12, 10), pin);
  pn.quaternion.setFromUnitVectors(V(0, 1, 0), axis); g.add(pn);
  return g;
}

// ---------- lanterna (eixo -Z, origem no centro da empunhadura) ----------
const R = 0.0195;
// perfil [raio, z] ordenado de trás (+Z) para frente (-Z)
function lathe(profile, mat, seg = 40) {
  const g = new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r, -z)), seg);
  g.rotateX(-Math.PI / 2); // eixo Y → -Z
  const m = new THREE.Mesh(g, mat.side === THREE.DoubleSide ? mat : mat);
  return m;
}
function buildFlashlight(M) {
  const fl = new THREE.Group();
  const kn = M.T.knurl;
  const knurlMap = kn.map.clone(), knurlN = kn.normalMap.clone();
  for (const t of [knurlMap, knurlN]) { t.repeat.set(10, 3); t.needsUpdate = true; }
  const ano = new THREE.MeshStandardMaterial({ color: 0x2c2d31, roughness: 0.42, metalness: 0.35, side: THREE.DoubleSide });
  const knurl = new THREE.MeshStandardMaterial({ map: knurlMap, normalMap: knurlN, normalScale: new THREE.Vector2(1.4, 1.4), color: 0x9a9aa2, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide });
  const steel = new THREE.MeshStandardMaterial({ color: 0x8a8d94, roughness: 0.25, metalness: 0.75 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0f0f10, roughness: 0.9 });
  const reflMat = new THREE.MeshStandardMaterial({ color: 0xe8e8ea, roughness: 0.08, metalness: 1, emissive: 0x806850, emissiveIntensity: 0 });
  const lensMat = new THREE.MeshStandardMaterial({ color: 0xfff4dd, emissive: 0xfff0d0, emissiveIntensity: 2.5, roughness: 0.05 });
  // corpo serrilhado (o perfil vai de +Z para -Z, em ordem de y crescente no torno)
  const body = lathe([[0.0001, 0.07], [R * 1.04, 0.07], [R * 1.04, 0.062], [R * 0.97, 0.06], [R, 0.058], [R, -0.062], [R * 0.97, -0.064], [R * 1.04, -0.066], [R * 1.04, -0.072], [0.0001, -0.072]], knurl);
  fl.add(body);
  // anéis de aperto
  for (const z of [-0.064, 0.06]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 1.02, 0.0012, 6, 36), ano); ring.position.z = z; fl.add(ring); }
  // cabeça com aletas
  const head = lathe([[R * 1.02, -0.07], [R * 1.02, -0.082], [0.024, -0.098], [0.029, -0.112], [0.0295, -0.142], [0.028, -0.146]], ano);
  fl.add(head);
  for (let i = 0; i < 5; i++) { const fin = new THREE.Mesh(new THREE.TorusGeometry(0.0255 + i * 0.0008, 0.0011, 6, 36), ano); fin.position.z = -(0.103 + i * 0.006); fl.add(fin); }
  // aro (bezel) dentado
  const bez = new THREE.Group(); bez.position.z = -0.147; fl.add(bez);
  bez.add(new THREE.Mesh(new THREE.TorusGeometry(0.0272, 0.0028, 10, 48), steel));
  for (let i = 0; i < 8; i++) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.0035, 0.004), steel); const a = i / 8 * Math.PI * 2; t.position.set(Math.cos(a) * 0.0272, Math.sin(a) * 0.0272, -0.0028); t.rotation.z = a + Math.PI / 2; bez.add(t); }
  // refletor + lente brilhante
  const refl = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.018, 32, 1, true), reflMat); refl.rotation.x = -Math.PI / 2; refl.position.z = -0.137; refl.material.side = THREE.DoubleSide; fl.add(refl);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.0248, 32), lensMat); lens.position.z = -0.1465; lens.rotation.y = Math.PI; fl.add(lens);
  const ledCore = new THREE.Mesh(new THREE.CircleGeometry(0.006, 16), new THREE.MeshBasicMaterial({ color: 0xffffff })); ledCore.position.z = -0.1468; ledCore.rotation.y = Math.PI; fl.add(ledCore);
  // tampa traseira e botão de borracha
  const tail = lathe([[0.012, 0.094], [R * 1.06, 0.092], [R * 1.08, 0.08], [R * 1.06, 0.07]], ano);
  fl.add(tail);
  const tailBtn = new THREE.Mesh(new THREE.SphereGeometry(0.0115, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), rubber); tailBtn.rotation.x = Math.PI / 2; tailBtn.scale.set(1, 0.35, 1); tailBtn.position.z = 0.093; fl.add(tailBtn);
  // botão lateral (sob o polegar)
  const btnA = -0.5, btnZ = -0.05;
  const sideBtn = new THREE.Group(); sideBtn.position.set(Math.cos(btnA) * R, Math.sin(btnA) * R, btnZ); sideBtn.rotation.z = btnA - Math.PI / 2; fl.add(sideBtn);
  const sbBase = new THREE.Mesh(new THREE.CylinderGeometry(0.0062, 0.0066, 0.002, 18), ano); sideBtn.add(sbBase);
  const sb = new THREE.Mesh(new THREE.SphereGeometry(0.0052, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), rubber); sb.scale.set(1, 0.55, 1); sb.position.y = 0.001; sideBtn.add(sb);
  // presilha de bolso
  const clip = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.0012, 0.06), steel); clip.position.set(-0.004, R + 0.0018, 0.035); clip.rotation.z = 0.25; fl.add(clip);
  // brilho da lente
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,248,232,1)'); gr.addColorStop(0.2, 'rgba(255,235,200,0.55)'); gr.addColorStop(1, 'rgba(255,220,170,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 }));
  glow.scale.set(0.075, 0.075, 1); glow.position.z = -0.155; fl.add(glow);
  return { fl, lensMat, reflMat, glow, sideBtn: sb, ledCore, btn: { a: btnA, z: btnZ } };
}

// ---------- mão de boneco de madeira ----------
// Pegada: palma do lado direito da lanterna (dorso para fora/direita), quatro dedos passando por cima
// e descendo pelo lado esquerdo até embaixo; o polegar fica do outro lado (direita/baixo), sobre o botão.
export function buildHand(M) {
  const wood = dollWoodMaterial(0xf2e2cc, 0.5);
  const woodJ = dollWoodMaterial(0xe6cfae, 0.45); // juntas levemente mais escuras (madeira de topo)
  const pin = new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.6 });
  const T = M.T;
  const jacket = new THREE.MeshStandardMaterial({ map: T.jacket.map, normalMap: T.jacket.normalMap, roughness: 0.95, color: 0x55595f });
  const cuffMat = new THREE.MeshStandardMaterial({ map: T.jacket.map, normalMap: T.jacket.normalMap, roughness: 1, color: 0x3c3f45 });

  const root = new THREE.Group();     // segue a câmera
  const grip = new THREE.Group();     // lanterna + mão
  root.add(grip);
  const F = buildFlashlight(M); grip.add(F.fl);
  const hand = new THREE.Group(); grip.add(hand);
  const P2 = (th, rho, z) => V(Math.cos(th) * rho, Math.sin(th) * rho, z);
  const deg = Math.PI / 180;

  // palma: placa arredondada curvada em torno do cano (do calcanhar da mão até a linha dos nós)
  {
    const a0 = -78 * deg, a1 = 60 * deg, rIn = R + 0.0008, thick = 0.0235, z0 = -0.041, z1 = 0.039;
    const arcMid = (rIn + thick / 2) * (a1 - a0);
    const box = new THREE.BoxGeometry(arcMid, thick, z1 - z0, 28, 6, 14);
    const p = box.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      // arredonda as bordas (superelipse)
      const ex = Math.abs(x) / (arcMid / 2), ez = Math.abs(z) / ((z1 - z0) / 2);
      const edge = Math.max(0, Math.max(ex, ez) - 0.72) / 0.28;
      y *= Math.sqrt(Math.max(0.05, 1 - edge * edge));
      const th = a0 + (x / arcMid + 0.5) * (a1 - a0);
      // dorso mais espesso no centro (osso metacarpo) e afinando na base
      const rr = rIn + thick / 2 + y * (1 + 0.25 * Math.sin((x / arcMid + 0.5) * Math.PI));
      const zz = z0 + (z / (z1 - z0) + 0.5) * (z1 - z0) - 0.004 * Math.cos(th);
      p.setXYZ(i, Math.cos(th) * rr, Math.sin(th) * rr, zz);
    }
    box.computeVertexNormals();
    hand.add(new THREE.Mesh(box, wood));
  }
  // quatro dedos: falanges como peças torneadas, encostadas no cano (cada segmento tangente a ele)
  const fingers = [];
  const defs = [ // z, raio, comprimentos [prox, média, distal], ângulo do nó
    { z: -0.028, r: 0.0088, L: [0.043, 0.026, 0.021], th: 64 },
    { z: -0.0085, r: 0.0093, L: [0.047, 0.029, 0.022], th: 63 },
    { z: 0.011, r: 0.0088, L: [0.044, 0.027, 0.021], th: 61 },
    { z: 0.029, r: 0.0077, L: [0.035, 0.021, 0.018], th: 58 },
  ];
  for (const d of defs) {
    const f = new THREE.Group(); hand.add(f);
    const rc = R + d.r * 0.98; // linha central encostada no cano
    let p = P2(d.th * deg, Math.hypot(rc, d.L[0] / 2) + 0.0015, d.z);
    const joints = [p.clone()];
    for (let k = 0; k < 3; k++) {
      const rho = Math.hypot(p.x, p.y);
      const toC = V(-p.x / rho, -p.y / rho, 0);
      const beta = rho > rc ? Math.asin(rc / rho) : Math.PI / 2;
      const c = Math.cos(-beta), s = Math.sin(-beta);
      const dir = V(toC.x * c - toC.y * s, toC.x * s + toC.y * c, 0).normalize();
      dir.z = -0.06 + k * 0.03; dir.normalize();
      const L = d.L[k] * (k === 2 ? 0.98 : 1);
      const q = p.clone().addScaledVector(dir, L);
      if (k === 2) { const rq = Math.hypot(q.x, q.y); const want = R + d.r * 0.82; q.x *= want / rq; q.y *= want / rq; } // ponta pressionando
      joints.push(q); p = q;
    }
    const rs = [d.r * 1.0, d.r * 0.93, d.r * 0.86];
    for (let k = 0; k < 3; k++) {
      const a = joints[k], b = joints[k + 1], dirv = b.clone().sub(a).normalize();
      const gap = rs[k] * 0.22;
      const a2 = a.clone().addScaledVector(dirv, k === 0 ? 0 : gap), b2 = b.clone().addScaledVector(dirv, k === 2 ? 0 : -gap);
      f.add(capsule(a2, b2, rs[k], k === 2 ? rs[k] * 0.92 : rs[k] * 0.96, wood));
      if (k > 0) f.add(hinge(a, rs[k - 1] * 0.66, V(0, 0, 1), woodJ, pin));
    }
    f.add(hinge(joints[0], d.r * 0.8, V(0, 0, 1), woodJ, pin)); // nó do dedo
    fingers.push(f);
  }
  // polegar: do lado oposto (direita/baixo), estendido ao longo do cano até o botão lateral
  const thumb = new THREE.Group(); hand.add(thumb);
  const tb = P2(-46 * deg, R + 0.02, -0.036);
  // metacarpo do polegar (volume da base, dentro da palma)
  hand.add(capsule(P2(-70 * deg, R + 0.018, 0.0), tb, 0.0125, 0.0115, wood));
  thumb.position.copy(tb);
  const tipGroup = new THREE.Group();
  {
    const tr = 0.0098;
    const t1 = P2(-34 * deg, R + 0.0135, -0.056).sub(tb);
    const tip = P2(-29 * deg, R + 0.0088, -0.074).sub(tb);
    thumb.add(capsule(V(0, 0, 0), t1.clone().multiplyScalar(0.82), tr * 1.15, tr * 1.0, wood));
    thumb.add(hinge(V(0, 0, 0), tr * 0.95, V(Math.cos(-46 * deg + Math.PI / 2), Math.sin(-46 * deg + Math.PI / 2), 0), woodJ, pin));
    tipGroup.position.copy(t1); thumb.add(tipGroup);
    tipGroup.add(hinge(V(0, 0, 0), tr * 0.76, V(Math.cos(-34 * deg + Math.PI / 2), Math.sin(-34 * deg + Math.PI / 2), 0), woodJ, pin));
    const d2 = tip.clone().sub(t1);
    tipGroup.add(capsule(d2.clone().multiplyScalar(0.18), d2, tr * 0.95, tr * 0.85, wood));
  }
  // punho: junta esférica + antebraço que desce para a direita e para trás, entrando na manga
  const fd = V(0.42, -0.55, 0.72).normalize();
  const wrist = P2(-70 * deg, R + 0.024, 0.03);
  hand.add(hinge(wrist, 0.0158, V(0, 0, 1).cross(fd).normalize(), woodJ, pin));
  hand.add(capsule(wrist.clone().addScaledVector(fd, 0.012), wrist.clone().addScaledVector(fd, 0.11), 0.0185, 0.023, wood));
  // manga escura da jaqueta com punho canelado
  const sleeve = new THREE.Group(); hand.add(sleeve);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.034, 0.045, 32, 4, true), cuffMat);
  { const p = cuff.geometry.attributes.position; for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getZ(i), p.getX(i)); const k = 1 + 0.05 * Math.max(0, Math.sin(a * 24)); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); } cuff.geometry.computeVertexNormals(); }
  cuff.material.side = THREE.DoubleSide;
  const cuffEdge = new THREE.Mesh(new THREE.TorusGeometry(0.031, 0.0045, 8, 32), cuffMat);
  const sl = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.06, 0.42, 28, 12, true), jacket);
  { const p = sl.geometry.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); const a = Math.atan2(p.getZ(i), p.getX(i)); const k = 1 + 0.06 * Math.sin(y * 24 + a * 2) * Math.max(0, Math.sin(a * 3)) + 0.03 * Math.sin(y * 9); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); } sl.geometry.computeVertexNormals(); }
  sl.material.side = THREE.DoubleSide;
  const sPos = wrist.clone().addScaledVector(fd, 0.07);
  const qd = new THREE.Quaternion().setFromUnitVectors(V(0, -1, 0), fd);
  cuff.position.copy(sPos); cuff.quaternion.copy(qd); sleeve.add(cuff);
  cuffEdge.position.copy(sPos.clone().addScaledVector(fd, -0.022)); cuffEdge.quaternion.setFromUnitVectors(V(0, 0, 1), fd); sleeve.add(cuffEdge);
  sl.position.copy(sPos.clone().addScaledVector(fd, 0.23)); sl.quaternion.copy(qd); sleeve.add(sl);

  root.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
  // pose base: lanterna apontando para frente, levemente para dentro
  grip.rotation.set(0.05, 0.1, -0.26);
  root.position.set(0.15, -0.13, -0.30);
  return { root, grip, lens: F.lensMat, glow: F.glow, refl: F.reflMat, led: F.ledCore, sideBtn: F.sideBtn, thumb, thumbTip: tipGroup, fingers, fl: F.fl, hand };
}

// ---------- animação: molas para balanço, passos, olhar, respiração, agachar, clique e interação ----------
function spr(st, target, om, ze, dt) {
  const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
  for (let i = 0; i < n; i++) { st.v += (om * om * (target - st.x) - 2 * ze * om * st.v) * h; st.x += st.v * h; }
  return st.x;
}
const S3 = () => ({ x: { x: 0, v: 0 }, y: { x: 0, v: 0 }, z: { x: 0, v: 0 } });
export class HandAnimator {
  constructor(h) {
    this.h = h; this.t = 0; this.interact = 0; this.click = 0; this.base = h.root.position.clone(); this.baseRot = h.root.rotation.clone();
    this.pos = S3(); this.rot = S3(); this.lag = S3(); this.walkW = 0; this.phase = 0; this.lastStep = null; this.thumbS = { x: 0, v: 0 }; this.dead = 0;
  }
  trigger(kind) {
    if (kind === 'interact') this.interact = 1;
    if (kind === 'click') { this.click = 1; this.rot.x.v += 0.6; this.pos.y.v -= 0.08; }
  }
  // stepPhase: passos dados + fração do passo atual (sincroniza o balanço com o som dos passos)
  update(dt, { speed = 0, running = false, crouch = false, on = true, yawVel = 0, pitchVel = 0, dead = false, stepPhase = null } = {}) {
    dt = Math.min(Math.max(dt, 0), 0.1); if (!dt) return;
    this.t += dt;
    const h = this.h, t = this.t;
    const mv = clamp(speed / 2.6, 0, 1.6);
    this.walkW += ((speed > 0.15 ? 1 : 0) - this.walkW) * Math.min(1, dt * 6);
    if (stepPhase !== null) this.phase = stepPhase; else this.phase += dt * speed / (running ? 0.95 : 0.75);
    const ph = this.phase * Math.PI;           // π por passo
    const w = this.walkW * Math.min(1, mv);
    const runK = running ? 1 : 0;
    // balanço dos passos: mergulho a cada pisada, oscilação lateral a cada dois passos
    const dip = -(0.5 + 0.5 * Math.cos(2 * ph)) * (0.009 + 0.012 * runK) * w;
    const sway = Math.sin(ph) * (0.007 + 0.01 * runK) * w;
    // respiração em repouso
    const br = Math.sin(t * 1.5), br2 = Math.sin(t * 0.73 + 1);
    const idle = 1 - this.walkW * 0.7;
    this.interact = Math.max(0, this.interact - dt * 2.0);
    const raise = Math.sin(Math.min(1, this.interact) * Math.PI);
    this.click = Math.max(0, this.click - dt * 5.5);
    this.dead += ((dead ? 1 : 0) - this.dead) * Math.min(1, dt * 3);
    // alvos
    const tx = sway + br2 * 0.0018 * idle - raise * 0.025 + runK * w * 0.012;
    const ty = dip + br * 0.0028 * idle - (crouch ? 0.028 : 0) + raise * 0.05 - runK * w * 0.02 - this.dead * 0.5;
    const tz = -raise * 0.045 + runK * w * 0.015;
    const rx = br * 0.01 * idle + raise * 0.22 - (crouch ? 0.07 : 0) + dip * 1.8 - runK * w * 0.12;
    const ry = sway * 1.6 + runK * w * 0.08;
    const rz = -sway * 2.2 - (crouch ? 0.06 : 0) + runK * w * 0.1;
    const px = spr(this.pos.x, tx, 11, 0.7, dt), py = spr(this.pos.y, ty, 12, 0.6, dt), pz = spr(this.pos.z, tz, 10, 0.75, dt);
    const ox = spr(this.rot.x, rx, 11, 0.6, dt), oy = spr(this.rot.y, ry, 10, 0.65, dt), oz = spr(this.rot.z, rz, 10, 0.65, dt);
    // atraso do olhar (mola sub-amortecida → leve oscilação ao parar de girar)
    const ly = spr(this.lag.y, clamp(-yawVel * 0.022, -0.11, 0.11), 9, 0.55, dt);
    const lp = spr(this.lag.x, clamp(pitchVel * 0.018, -0.09, 0.09), 9, 0.55, dt);
    h.root.position.set(this.base.x + px + ly * 0.35, this.base.y + py - lp * 0.3, this.base.z + pz);
    h.root.rotation.set(this.baseRot.x + ox + lp, this.baseRot.y + oy + ly, this.baseRot.z + oz + ly * 0.6);
    // polegar pressiona o botão lateral (curva rápida de ida e volta)
    const press = this.click > 0 ? Math.sin((1 - this.click) * Math.PI) : 0;
    const th = spr(this.thumbS, press, 30, 0.6, dt);
    h.thumbTip.rotation.set(0, 0, 0);
    h.thumbTip.position.y = 0; // posição base fixa; aproxima a ponta do cano
    h.thumb.rotation.set(-th * 0.08, 0, th * 0.18);
    h.sideBtn.position.y = 0.001 - th * 0.0014;
    // dedos: aperto mínimo durante a corrida / clique
    const sq = (runK * w * 0.5 + press * 0.6) * 0.012;
    for (let i = 0; i < h.fingers.length; i++) h.fingers[i].rotation.z = -sq + Math.sin(t * 0.8 + i * 1.3) * 0.002;
    h.lens.emissiveIntensity = on ? 2.6 : 0.0;
    h.lens.color.setHex(on ? 0xfff4dd : 0x55575c);
    h.refl.emissiveIntensity = on ? 0.6 : 0;
    h.led.material.color.setHex(on ? 0xffffff : 0x3a3a3a);
    h.glow.visible = on;
  }
}
