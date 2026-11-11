// v6 — LADO DE FORA DA CASA (o que se vê pelas janelas e pela porta de saída aberta).
// A casa fica perdida no meio do mato, à noite: quintal de capim alto e moitas, muitas árvores (copas densas,
// pinheiros e árvores secas) cada vez mais fechadas ao longe, e uma estrada cinza de asfalto velho passando em
// frente à porta principal (sul), com postes de luz amarela — alguns piscando.
// Tudo é geometria de verdade (paralaxe e profundidade reais) com iluminação "assada" nas cores de vértice
// (luar frio por cima, tudo muito escuro) e névoa do jogo apagando a distância. Materiais sem luz dinâmica:
// nada daqui ilumina o interior da casa e as luzes do jogo não precisam tocar nada daqui.
// Céu: cúpula que acompanha a câmera (degradê, lua com halo, estrelas, nuvens finas e a linha da mata ao longe).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FX_TIME } from './fx.js';
import { W, D, CELL, T } from '../../../shared/config.js';

const MOON = new THREE.Vector3(-0.35, 0.42, -0.84).normalize(); // lua baixa ao sul (atrás da estrada)
function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
// cor por vértice: albedo × (ambiente + luar pela normal), com leve variação
function bake(geo, albedo, { amb = 0.35, moon = 0.65, top = 0, jitter = 0.08, seed = 1 } = {}) {
  geo = geo.index ? geo.toNonIndexed() : geo; geo.computeVertexNormals();
  const n = geo.attributes.normal, p = geo.attributes.position, c = new Float32Array(p.count * 3), r = rng(seed);
  const a = new THREE.Color(albedo);
  for (let i = 0; i < p.count; i++) {
    const d = Math.max(0, n.getX(i) * MOON.x + n.getY(i) * MOON.y + n.getZ(i) * MOON.z);
    const k = (amb + moon * d + top * Math.max(0, n.getY(i))) * (1 - jitter + 2 * jitter * r());
    c[i * 3] = a.r * k; c[i * 3 + 1] = a.g * k; c[i * 3 + 2] = a.b * k * 1.08;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  geo.deleteAttribute('uv');
  return geo;
}
const basic = (opts = {}) => new THREE.MeshBasicMaterial({ vertexColors: true, fog: true, ...opts });

// ------------------------------------------------------------------ árvores (modelos base, instanciados)
function trunk(h, r0, r1, seg = 6) { const g = new THREE.CylinderGeometry(r1, r0, h, seg, 3); g.translate(0, h / 2, 0); return g; }
function blobAt(x, y, z, r, sy = 1, detail = 1, seed = 1) {
  const g = new THREE.IcosahedronGeometry(r, detail); const p = g.attributes.position, rr = rng(seed);
  for (let i = 0; i < p.count; i++) { const k = 0.82 + rr() * 0.36; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * sy, p.getZ(i) * k); }
  g.translate(x, y, z); return g;
}
function branch(out, a, b, r0, r1) {
  const len = a.distanceTo(b); const g = new THREE.CylinderGeometry(r1, r0, len, 5, 1); g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q); g.translate(a.x, a.y, a.z); out.push(g);
}
function treeModels() {
  const bark = 0x1a1714, leaf = 0x101a12, leaf2 = 0x0e1712, pine = 0x0c1611;
  const models = [];
  // 1) copa densa (folhosa): tronco + 6–8 bolas de folhagem
  for (let v = 0; v < 2; v++) {
    const r = rng(11 + v); const parts = [bake(trunk(3.2, 0.24, 0.16), bark, { seed: 3 })];
    const leaves = [];
    for (let i = 0; i < 7 + v; i++) { const a = r() * 6.28, d = 0.6 + r() * 1.2; leaves.push(blobAt(Math.cos(a) * d, 3.4 + r() * 2.2, Math.sin(a) * d, 1.1 + r() * 0.7, 0.85, 1, 20 + i)); }
    leaves.push(blobAt(0, 5.4, 0, 1.4, 0.9, 1, 9));
    parts.push(bake(mergeGeometries(leaves.map(g => g.toNonIndexed())), v ? leaf2 : leaf, { amb: 0.3, moon: 0.8, top: 0.25, jitter: 0.18, seed: 7 + v }));
    models.push(mergeGeometries(parts));
  }
  // 2) pinheiro: tronco fino + cones empilhados
  { const parts = [bake(trunk(6.5, 0.18, 0.08), bark, { seed: 4 })]; const cones = [];
    for (let i = 0; i < 5; i++) { const h = 2.2 - i * 0.25, rr = 1.6 - i * 0.28; const c = new THREE.ConeGeometry(rr, h, 8, 1); c.translate(0, 1.6 + i * 1.05 + h / 2, 0); cones.push(c.toNonIndexed()); }
    parts.push(bake(mergeGeometries(cones), pine, { amb: 0.28, moon: 0.85, top: 0.2, jitter: 0.15, seed: 13 }));
    models.push(mergeGeometries(parts)); }
  // 3) árvore seca: tronco torto e galhos recursivos (silhueta contra o céu)
  { const r = rng(5); const gs = [];
    const grow = (a, dir, len, rad, depth) => {
      const b = a.clone().addScaledVector(dir, len); branch(gs, a, b, rad, rad * 0.7);
      if (depth <= 0) return;
      const k = 2 + (r() < 0.35 ? 1 : 0);
      for (let i = 0; i < k; i++) { const d = dir.clone().add(new THREE.Vector3((r() - 0.5) * 1.3, 0.25 + r() * 0.4, (r() - 0.5) * 1.3)).normalize(); grow(b, d, len * (0.62 + r() * 0.15), rad * 0.62, depth - 1); }
    };
    grow(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.08, 1, 0.03).normalize(), 2.6, 0.2, 4);
    models.push(bake(mergeGeometries(gs.map(g => g.toNonIndexed())), 0x1c1814, { amb: 0.35, moon: 0.7, seed: 6 })); }
  return models;
}
// tufo de capim alto: lâminas finas curvadas
function grassTuft(seed) {
  const r = rng(seed), pos = [];
  for (let i = 0; i < 9; i++) {
    const a = r() * 6.28, d = r() * 0.18, x = Math.cos(a) * d, z = Math.sin(a) * d, h = 0.55 + r() * 0.75, wdt = 0.035 + r() * 0.02;
    const la = r() * 6.28, lean = 0.15 + r() * 0.35, lx = Math.cos(la) * lean * h, lz = Math.sin(la) * lean * h;
    const px = -Math.sin(la) * wdt, pz = Math.cos(la) * wdt;
    const m = [x + lx * 0.45, h * 0.55, z + lz * 0.45];
    pos.push(x - px, 0, z - pz, x + px, 0, z + pz, m[0] + px * 0.6, m[1], m[2] + pz * 0.6);
    pos.push(x - px, 0, z - pz, m[0] + px * 0.6, m[1], m[2] + pz * 0.6, m[0] - px * 0.6, m[1], m[2] - pz * 0.6);
    pos.push(m[0] - px * 0.6, m[1], m[2] - pz * 0.6, m[0] + px * 0.6, m[1], m[2] + pz * 0.6, x + lx, h, z + lz);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  // cor por altura (base escura, pontas pegando luar)
  const c = []; for (let i = 0; i < pos.length; i += 3) { const k = 0.2 + 0.8 * Math.min(1, pos[i + 1] / 1.1); c.push(0.016 * k, 0.024 * k, 0.017 * k); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  return g;
}
// ------------------------------------------------------------------ texturas do chão
function canvasTex(w, h, draw, rep = 1) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.repeat.set(rep, rep); return t;
}
function grassTex() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#1a2216'; g.fillRect(0, 0, w, h); const r = rng(17);
    for (let i = 0; i < 9000; i++) { const x = r() * w, y = r() * h, l = 3 + r() * 9; const v = 18 + r() * 34; g.strokeStyle = `rgb(${v * 0.8 | 0},${v | 0},${v * 0.7 | 0})`; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 4, y - l); g.stroke(); }
    for (let i = 0; i < 60; i++) { const x = r() * w, y = r() * h, rr = 10 + r() * 40; const gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, 'rgba(30,24,16,0.5)'); gr.addColorStop(1, 'rgba(30,24,16,0)'); g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
  }, 1);
}
function asphaltTex() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#4a4a4c'; g.fillRect(0, 0, w, h); const r = rng(23);
    for (let i = 0; i < 26000; i++) { const v = 50 + r() * 50; g.fillStyle = `rgba(${v},${v},${v + 3},${0.35 + r() * 0.4})`; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
    for (let i = 0; i < 30; i++) { const x = r() * w, y = r() * h, rr = 20 + r() * 70; const gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, 'rgba(25,25,27,0.45)'); gr.addColorStop(1, 'rgba(25,25,27,0)'); g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
    g.strokeStyle = 'rgba(20,20,20,0.8)'; g.lineWidth = 1.5; // rachaduras
    for (let i = 0; i < 14; i++) { let x = r() * w, y = r() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 8; k++) { x += (r() - 0.5) * 40; y += (r() - 0.5) * 40; g.lineTo(x, y); } g.stroke(); }
    // faixa central tracejada, gasta (a estrada corre ao longo de u)
    for (let x = 0; x < w; x += 128) { g.fillStyle = 'rgba(205,180,90,0.55)'; g.fillRect(x + 8, h / 2 - 5, 70, 10); }
    for (let i = 0; i < 400; i++) { g.fillStyle = 'rgba(70,70,72,0.9)'; g.fillRect(r() * w, h / 2 - 6 + r() * 12, 2 + r() * 4, 2 + r() * 3); }
    // bordas de terra
    const ge = g.createLinearGradient(0, 0, 0, 40); ge.addColorStop(0, 'rgba(40,34,26,0.95)'); ge.addColorStop(1, 'rgba(40,34,26,0)'); g.fillStyle = ge; g.fillRect(0, 0, w, 40);
    const gb = g.createLinearGradient(0, h, 0, h - 40); gb.addColorStop(0, 'rgba(40,34,26,0.95)'); gb.addColorStop(1, 'rgba(40,34,26,0)'); g.fillStyle = gb; g.fillRect(0, h - 40, w, 40);
  }, 1);
}
function dirtTex() {
  return canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#2e2820'; g.fillRect(0, 0, w, h); const r = rng(29); for (let i = 0; i < 5000; i++) { const v = 30 + r() * 40; g.fillStyle = `rgba(${v * 1.1 | 0},${v | 0},${v * 0.8 | 0},0.6)`; g.fillRect(r() * w, r() * h, 1.5, 1.5); } }, 1);
}
function glowTex() {
  return canvasTex(128, 128, (g, w) => { const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); }, 1);
}

// ------------------------------------------------------------------ céu (cúpula presa à câmera)
function skyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: FX_TIME, uMoon: { value: MOON.clone() } },
    vertexShader: /* glsl */`varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uMoon; varying vec3 vDir;
      float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + 1.7; a *= 0.5; } return s; }
      void main(){
        vec3 d = normalize(vDir); float el = asin(clamp(d.y, -1.0, 1.0));
        vec3 m = normalize(uMoon); float az = atan(d.x, d.z), maz = atan(m.x, m.z);
        float ang = acos(clamp(dot(d, m), -1.0, 1.0));
        vec3 col = mix(vec3(0.016, 0.022, 0.040), vec3(0.003, 0.005, 0.012), smoothstep(0.0, 0.9, el));
        col += vec3(0.014, 0.018, 0.028) * exp(-max(el, 0.0) * 7.0);
        float halo = exp(-ang * ang * 22.0) * 0.5 + exp(-ang * 3.2) * 0.1;
        col += vec3(0.26, 0.32, 0.5) * halo;
        vec2 cp = vec2(az * 2.2 + uTime * 0.004, el * 7.0);
        float cl = smoothstep(0.5, 0.85, fbm(cp * vec2(1.0, 2.2))) * smoothstep(0.02, 0.25, el);
        col = mix(col, vec3(0.04, 0.05, 0.075) + vec3(0.26, 0.3, 0.4) * halo * 1.6, cl * 0.55);
        vec2 sp = vec2(az * 70.0, el * 70.0); vec2 ci = floor(sp); float hs = h21(ci);
        float st = step(0.976, hs) * (1.0 - smoothstep(0.05, 0.28, length(fract(sp) - 0.5)));
        st *= 0.55 + 0.45 * sin(uTime * (1.5 + hs * 3.0) + hs * 60.0);
        col += vec3(0.7, 0.75, 0.95) * st * smoothstep(0.06, 0.25, el) * (1.0 - cl) * (1.0 - smoothstep(0.0, 0.4, halo));
        float disk = 1.0 - smoothstep(0.040, 0.046, ang);
        vec2 mq = vec2(az - maz, el - asin(m.y)) * 40.0;
        col = mix(col, vec3(1.9, 2.0, 2.2) * (0.78 + 0.22 * fbm(mq * 1.3)), disk * (1.0 - cl * 0.7));
        // mata fechada no horizonte (além das árvores de verdade): copas irregulares, quase pretas
        float u = az * 9.0;
        float ridge = 0.035 + 0.03 * fbm(vec2(u * 0.7, 1.3)) + 0.05 * pow(fbm(vec2(u * 2.3, 7.1)), 2.0) + 0.02 * vn(vec2(u * 9.0, 3.0));
        if (el < ridge) col = vec3(0.004, 0.006, 0.008) + vec3(0.006, 0.008, 0.012) * smoothstep(-0.2, ridge, el);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  });
}

// ------------------------------------------------------------------ montagem
export function buildExterior(map) {
  const g = new THREE.Group(); g.name = 'exterior';
  const L1 = map.levels[1];
  // pegada da casa (térreo) em metros
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) if (L1.grid[z * W + x] !== T.VOID) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  if (x0 > x1) { x0 = 0; x1 = W - 1; z0 = 0; z1 = D - 1; }
  const hx0 = x0 * CELL, hx1 = (x1 + 1) * CELL, hz0 = z0 * CELL, hz1 = (z1 + 1) * CELL;
  const ex = map.exit ? map.exit.x : (hx0 + hx1) / 2;
  const cx = (hx0 + hx1) / 2, cz = (hz0 + hz1) / 2;
  const ROAD_Z = hz0 - 10.5, ROAD_W = 6.5;
  const insideHouse = (x, z, m) => x > hx0 - m && x < hx1 + m && z > hz0 - m && z < hz1 + m;
  const onRoad = (x, z, m = 0) => Math.abs(z - ROAD_Z) < ROAD_W / 2 + m;
  const onPath = (x, z, m = 0) => z < hz0 + 0.5 && z > ROAD_Z && Math.abs(x - ex) < 1.1 + m;
  // céu
  const sky = new THREE.Mesh(new THREE.SphereGeometry(44, 40, 20), skyMaterial()); sky.renderOrder = -1000; sky.frustumCulled = false; g.add(sky);
  // chão: grama (grande), estrada, caminho de terra
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshBasicMaterial({ map: grassTex(), color: 0x2e342a, fog: true }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(cx, -0.03, cz); if (ground.material.map) ground.material.map.repeat.set(60, 60); g.add(ground);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(160, ROAD_W), new THREE.MeshBasicMaterial({ map: asphaltTex(), color: 0x6e7076, fog: true, polygonOffset: true, polygonOffsetFactor: -1 }));
  road.rotation.x = -Math.PI / 2; road.position.set(cx, -0.02, ROAD_Z); if (road.material.map) road.material.map.repeat.set(160 / 9, 1); g.add(road);
  const pathLen = hz0 - ROAD_Z - ROAD_W / 2;
  const path = new THREE.Mesh(new THREE.PlaneGeometry(2.0, pathLen), new THREE.MeshBasicMaterial({ map: dirtTex(), color: 0x6a6258, fog: true, polygonOffset: true, polygonOffsetFactor: -1 }));
  path.rotation.x = -Math.PI / 2; path.position.set(ex, -0.02, hz0 - pathLen / 2); if (path.material.map) path.material.map.repeat.set(1, pathLen / 2); g.add(path);
  // degraus da varanda e cerca velha de madeira na divisa (com o portão caído no caminho)
  const fenceParts = [];
  const fz = ROAD_Z + ROAD_W / 2 + 1.2;
  for (let x = cx - 60; x < cx + 60; x += 2.2) {
    if (Math.abs(x - ex) < 1.6) continue;
    const rr = rng(Math.floor(x * 10 + 500) * 7919 + 99991); rr(); const r = rr(); if (r < 0.12) continue; // tábuas faltando
    const p = new THREE.BoxGeometry(0.1, 1.1 + r * 0.2, 0.1); p.rotateZ((r - 0.5) * 0.18); p.translate(x, 0.55, fz); fenceParts.push(p.toNonIndexed());
    const rail = new THREE.BoxGeometry(2.2, 0.08, 0.05); rail.translate(x + 1.1, 0.85, fz); if (r > 0.25) fenceParts.push(rail.toNonIndexed());
    const rail2 = new THREE.BoxGeometry(2.2, 0.08, 0.05); rail2.rotateZ((r - 0.5) * 0.12); rail2.translate(x + 1.1, 0.38, fz); fenceParts.push(rail2.toNonIndexed());
  }
  if (fenceParts.length) g.add(new THREE.Mesh(bake(mergeGeometries(fenceParts), 0x3a332a, { amb: 0.35, moon: 0.7, seed: 41 }), basic()));
  // ----- árvores -----
  const models = treeModels(), r = rng(map.hash ? (parseInt(String(map.hash).slice(0, 6), 16) || 77) : 77);
  const pts = models.map(() => []);
  const tries = 2400; let placed = 0;
  for (let i = 0; i < tries && placed < 330; i++) {
    const x = cx + (r() - 0.5) * 120, z = cz + (r() - 0.5) * 110;
    if (insideHouse(x, z, 4.5) || onRoad(x, z, 1.6) || onPath(x, z, 1.5)) continue;
    if (z < hz0 && z > ROAD_Z && Math.abs(x - ex) < 7.5) continue; // quintal da frente aberto: da porta se vê a estrada
    // densidade: quintal mais aberto perto da casa, mata fechada a partir de ~12 m
    const dist = Math.max(Math.max(hx0 - x, x - hx1, 0), Math.max(hz0 - z, z - hz1, 0));
    if (r() > Math.min(1, 0.18 + dist / 14)) continue;
    if (z < ROAD_Z - ROAD_W / 2 && z > ROAD_Z - ROAD_W / 2 - 2.5) continue; // acostamento do outro lado
    const kind = r(); const m = kind < 0.42 ? (r() < 0.5 ? 0 : 1) : kind < 0.8 ? 2 : 3;
    pts[m].push([x, z, 0.75 + r() * 0.75, r() * 6.28, (r() - 0.5) * 0.08]); placed++;
  }
  const dummy = new THREE.Object3D();
  const treeMat = basic();
  models.forEach((geo, mi) => {
    if (!pts[mi].length) return;
    const im = new THREE.InstancedMesh(geo, treeMat, pts[mi].length);
    pts[mi].forEach(([x, z, s, ry, tilt], i) => { dummy.position.set(x, -0.05, z); dummy.rotation.set(tilt, ry, tilt * 0.6); dummy.scale.set(s, s * (0.9 + (i % 5) * 0.06), s); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); });
    im.computeBoundingSphere(); g.add(im);
  });
  // ----- capim alto e moitas (mais denso encostado na casa e no quintal) -----
  const tufts = [grassTuft(1), grassTuft(2), grassTuft(3)], tp = tufts.map(() => []);
  for (let i = 0; i < 9000 && tp.reduce((a, b) => a + b.length, 0) < 3600; i++) {
    const x = cx + (r() - 0.5) * 80, z = cz + (r() - 0.5) * 70;
    if (insideHouse(x, z, 1.4) || onRoad(x, z, 0.2) || onPath(x, z, 0.1)) continue;
    const dist = Math.max(Math.max(hx0 - x, x - hx1, 0), Math.max(hz0 - z, z - hz1, 0));
    if (r() > (dist < 18 ? 0.75 : 0.25)) continue;
    tp[i % 3].push([x, z, 0.45 + r() * 0.6 + Math.min(0.4, dist / 20), r() * 6.28]);
  }
  const grassMat = basic({ side: THREE.DoubleSide });
  tufts.forEach((geo, mi) => {
    const im = new THREE.InstancedMesh(geo, grassMat, tp[mi].length);
    tp[mi].forEach(([x, z, s, ry], i) => { dummy.position.set(x, -0.03, z); dummy.rotation.set(0, ry, 0); dummy.scale.set(s, s, s); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); });
    im.computeBoundingSphere(); g.add(im);
  });
  const bushGeo = bake(blobAt(0, 0.35, 0, 0.75, 0.65, 1, 3), 0x0f1810, { amb: 0.3, moon: 0.8, top: 0.2, jitter: 0.2, seed: 5 });
  const bp = [];
  for (let i = 0; i < 1500 && bp.length < 220; i++) { const x = cx + (r() - 0.5) * 90, z = cz + (r() - 0.5) * 80; if (insideHouse(x, z, 2.2) || onRoad(x, z, 1) || onPath(x, z, 0.8)) continue; bp.push([x, z, 0.6 + r() * 1.1, r() * 6.28]); }
  { const im = new THREE.InstancedMesh(bushGeo, basic(), bp.length); bp.forEach(([x, z, s, ry], i) => { dummy.position.set(x, -0.05, z); dummy.rotation.set(0, ry, 0); dummy.scale.set(s * 1.2, s, s); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); }); im.computeBoundingSphere(); g.add(im); }
  // ----- postes de luz ao longo da estrada (lado de lá), alguns piscando -----
  const lamps = [], poleParts = [];
  const glow = glowTex();
  const coneTex = canvasTex(4, 128, (g2, w, h) => { const gr = g2.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#fff'); gr.addColorStop(0.35, '#555'); gr.addColorStop(1, '#000'); g2.fillStyle = gr; g2.fillRect(0, 0, w, h); }, 1);
  if (coneTex) { coneTex.colorSpace = THREE.NoColorSpace; coneTex.repeat.set(1, 1); }
  const LZ = ROAD_Z - ROAD_W / 2 - 0.9;
  let li = 0;
  for (let x = ex - 64 + 5; x < ex + 64; x += 14, li++) {
    const p = new THREE.CylinderGeometry(0.07, 0.11, 5.6, 8); p.translate(x, 2.8, LZ); poleParts.push(p.toNonIndexed());
    const arm = new THREE.CylinderGeometry(0.04, 0.05, 1.7, 6); arm.rotateX(Math.PI / 2 - 0.15); arm.translate(x, 5.5, LZ + 0.8); poleParts.push(arm.toNonIndexed());
    const head = new THREE.BoxGeometry(0.28, 0.12, 0.55); head.translate(x, 5.55, LZ + 1.6); poleParts.push(head.toNonIndexed());
    const flick = [2, 5, 7].includes(li % 8) ? (li % 3) + 1 : 0;           // ~1 em cada 3 pisca, cada um do seu jeito
    const dead = li % 8 === 4;                                              // um queimado
    const bulbMat = new THREE.MeshBasicMaterial({ color: dead ? 0x221a10 : 0xffd9a0, fog: true });
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.42), bulbMat); bulb.position.set(x, 5.47, LZ + 1.6); g.add(bulb);
    const gm = new THREE.SpriteMaterial({ map: glow, color: 0xffc070, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true, opacity: dead ? 0 : 0.9 });
    const gs = new THREE.Sprite(gm); gs.scale.set(2.6, 2.6, 1); gs.position.set(x, 5.4, LZ + 1.6); g.add(gs);
    // cone de luz (névoa iluminada) e mancha no asfalto
    const coneMat = new THREE.MeshBasicMaterial({ color: 0xffb860, alphaMap: coneTex, transparent: true, opacity: dead ? 0 : 0.11, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: true });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(2.7, 5.4, 20, 1, true), coneMat); cone.position.set(x, 2.7, LZ + 1.6); g.add(cone);
    const poolMat = new THREE.MeshBasicMaterial({ map: glow, color: 0xffa850, transparent: true, opacity: dead ? 0 : 0.55, depthWrite: false, blending: THREE.AdditiveBlending, fog: true, polygonOffset: true, polygonOffsetFactor: -2 });
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(8.5, 8.5), poolMat); pool.rotation.x = -Math.PI / 2; pool.position.set(x, 0.0, LZ + 1.8); g.add(pool);
    lamps.push({ flick, dead, bulbMat, gm, coneMat, poolMat, seed: li * 1.37 });
  }
  if (poleParts.length) g.add(new THREE.Mesh(bake(mergeGeometries(poleParts), 0x3a3c40, { amb: 0.4, moon: 0.6, top: 0.3, seed: 51 }), basic()));
  g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return { g, sky, lamps, road: { z: ROAD_Z, w: ROAD_W }, house: { x0: hx0, x1: hx1, z0: hz0, z1: hz1 } };
}
// por quadro: céu segue a câmera; postes que piscam
export function updateExterior(ext, camera, t) {
  if (!ext) return;
  ext.sky.position.copy(camera.position);
  for (const l of ext.lamps) {
    if (!l.flick || l.dead) continue;
    let k = 1;
    const s = l.seed;
    if (l.flick === 1) { const ph = (t + s) % 4.3; k = ph < 0.5 ? (Math.sin(ph * 70) > 0.1 ? 1 : 0.08) : 1; }
    else if (l.flick === 2) { k = 0.55 + 0.45 * Math.sin(t * 31 + s) * Math.sin(t * 7.3 + s * 2); k = (t + s) % 6.1 < 1.2 ? 0.05 : Math.max(0.2, k); }
    else { const ph = (t * 1.0 + s) % 2.7; k = ph < 0.18 || (ph > 0.3 && ph < 0.36) ? 0.06 : 1; }
    l.bulbMat.color.setHex(0xffd9a0).multiplyScalar(0.15 + 0.85 * k);
    l.gm.opacity = 0.9 * k; l.coneMat.opacity = 0.11 * k; l.poolMat.opacity = 0.55 * k;
  }
}
