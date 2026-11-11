// v5: efeitos baratos da lareira (fogo, brasas, faíscas, brilho no chão) e da janela (céu noturno pela direção do olhar,
// mancha de luar no piso). Tudo em shader próprio, sem textura de imagem e sem luz extra (a luz da lareira/luar continua
// sendo a do pool de luzes em mansion.js → obedece ao limite QUALITY.lights de renderer.js).
// Tempo: FX_TIME.value é atualizado por quem anima a cena (Game.update → setFxTime). O trailer usa o Game, então herda.
import * as THREE from 'three';

export const FX_TIME = { value: 0 };
export function setFxTime(t) { FX_TIME.value = t; }

// ruído de valor 2D + fbm (compartilhado pelos shaders)
const NOISE = /* glsl */`
  float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + 1.7; a *= 0.5; } return s; }
`;

// ---------------------------------------------------------------------------------------------
// FOGO: cada língua de fogo é um quad "billboard" preso no eixo Y (sempre de frente para a câmera, sem tombar).
// aCenter = centro da base do quad (espaço local), aSize = largura/altura, aSeed = variação.
// ---------------------------------------------------------------------------------------------
let flameMat = null;
export function flameMaterial() {
  if (flameMat) return flameMat;
  flameMat = new THREE.ShaderMaterial({
    uniforms: { uTime: FX_TIME, uBright: { value: 1.35 } },
    vertexShader: /* glsl */`
      attribute vec3 aCenter; attribute vec2 aSize; attribute float aSeed; attribute vec2 aCorner;
      varying vec2 vUv; varying float vSeed;
      void main(){
        vUv = aCorner; vSeed = aSeed;
        vec4 c = modelViewMatrix * vec4(aCenter, 1.0);
        vec3 up = normalize((modelViewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        vec3 right = normalize(cross(up, normalize(-c.xyz)));
        vec3 p = c.xyz + right * (aCorner.x - 0.5) * aSize.x + up * aCorner.y * aSize.y;
        gl_Position = projectionMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform float uBright; varying vec2 vUv; varying float vSeed;
      ${NOISE}
      void main(){
        float t = uTime * (1.0 + vSeed * 0.15);
        vec2 uv = vUv;
        float n = fbm(vec2(uv.x * 3.2 + vSeed * 7.0, uv.y * 2.6 - t * 2.4));
        float n2 = fbm(vec2(uv.x * 6.0 - vSeed * 3.0, uv.y * 5.0 - t * 4.1));
        // deforma mais no alto (a chama dança na ponta)
        float x = uv.x - 0.5 + (n - 0.5) * 0.55 * uv.y + sin(t * 3.0 + vSeed * 9.0) * 0.05 * uv.y;
        float width = 0.46 * pow(max(1.0 - uv.y, 0.0), 0.7) * (0.75 + 0.5 * n);
        float body = 1.0 - smoothstep(width * 0.55, width, abs(x));
        body *= smoothstep(0.0, 0.10, uv.y);
        // pedaços que se soltam na ponta
        body *= smoothstep(0.15, 0.55, n2 + (1.0 - uv.y) * 0.75);
        float i = body * (1.0 - uv.y * 0.55);
        vec3 col = mix(vec3(0.75, 0.10, 0.01), vec3(1.0, 0.42, 0.06), smoothstep(0.05, 0.45, i));
        col = mix(col, vec3(1.0, 0.72, 0.32), smoothstep(0.6, 1.0, i));
        // base azulada bem fraquinha (madeira queimando)
        col += vec3(0.05, 0.08, 0.25) * (1.0 - smoothstep(0.0, 0.12, uv.y)) * body;
        gl_FragColor = vec4(col * uBright * i, i);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });
  return flameMat;
}

// várias línguas de fogo numa malha só. flames: [{x,y,z,w,h,seed}]
export function buildFlames(flames) {
  const pos = [], cen = [], size = [], seed = [], corner = [], idx = [];
  flames.forEach((f, k) => {
    const o = k * 4;
    for (const [cx, cy] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      pos.push(f.x + (cx - 0.5) * f.w, f.y + cy * f.h, f.z); cen.push(f.x, f.y, f.z); size.push(f.w, f.h); seed.push(f.seed); corner.push(cx, cy);
    }
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aCenter', new THREE.Float32BufferAttribute(cen, 3));
  g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 2));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute(corner, 2));
  g.setIndex(idx);
  g.computeBoundingBox(); g.computeBoundingSphere(); g.boundingSphere.radius += 0.3; // o billboard gira: folga
  const m = new THREE.Mesh(g, flameMaterial());
  m.renderOrder = 5; m.castShadow = false; m.receiveShadow = false; m.userData.fx = 'flames';
  return m;
}

// ---------------------------------------------------------------------------------------------
// BRASAS: leito de carvão com rachaduras que pulsam (quad deitado, sem luz própria)
// ---------------------------------------------------------------------------------------------
let coalMat = null;
export function coalMaterial() {
  if (coalMat) return coalMat;
  coalMat = new THREE.ShaderMaterial({
    uniforms: { uTime: FX_TIME },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uTime; varying vec2 vUv; ${NOISE}
      void main(){
        vec2 p = vUv * vec2(9.0, 4.0);
        float cell = vn(p * 1.3 + 3.0);
        float crack = 1.0 - smoothstep(0.0, 0.18, abs(fbm(p) - 0.5));
        float pulse = 0.6 + 0.4 * fbm(p * 0.7 + vec2(uTime * 0.4, -uTime * 0.3));
        float edge = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x) * smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
        float hot = (crack * 0.8 + smoothstep(0.6, 0.95, cell) * 0.5) * pulse * edge * smoothstep(0.25, 0.65, fbm(p * 0.45 + 5.0) + edge * 0.3);
        vec3 ash = vec3(0.012, 0.010, 0.009) * (0.5 + 0.7 * cell);
        vec3 col = mix(vec3(0.006, 0.005, 0.005), ash, edge) + vec3(1.5, 0.36, 0.05) * hot * hot * 1.6;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    fog: false,
  });
  return coalMat;
}

// ---------------------------------------------------------------------------------------------
// FAÍSCAS: pontos que sobem da lenha e somem na chaminé (posição calculada no shader, laço infinito)
// ---------------------------------------------------------------------------------------------
let sparkMat = null;
export function buildSparks(n, x0, x1, y0, rise, z0, z1) {
  if (!sparkMat) sparkMat = new THREE.ShaderMaterial({
    uniforms: { uTime: FX_TIME, uPx: { value: 520 }, uRise: { value: 0.6 } },
    vertexShader: /* glsl */`
      uniform float uTime; uniform float uPx; uniform float uRise; attribute float aSeed; varying float vA;
      void main(){
        float sp = 0.35 + fract(aSeed * 7.13) * 0.4;
        float k = fract(uTime * sp + aSeed);
        vec3 p = position;
        p.y += k * uRise;
        p.x += sin(uTime * 3.0 + aSeed * 40.0) * 0.05 * k;
        p.z -= k * 0.18;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vA = (1.0 - k) * smoothstep(0.0, 0.08, k) * step(0.35, fract(aSeed * 3.7 + floor(uTime * sp + aSeed) * 0.618));
        gl_PointSize = (0.016 + fract(aSeed * 13.1) * 0.012) * uPx / max(0.05, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying float vA;
      void main(){ vec2 d = gl_PointCoord - 0.5; float r = 1.0 - smoothstep(0.15, 0.5, length(d));
        gl_FragColor = vec4(vec3(1.0, 0.55, 0.15) * 3.0 * r * vA, r * vA);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const pos = [], sd = [];
  for (let i = 0; i < n; i++) { const a = (i * 0.618034) % 1, b = (i * 0.414214 + 0.3) % 1; pos.push(x0 + (x1 - x0) * a, y0, z0 + (z1 - z0) * b); sd.push((i * 0.754877) % 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(sd, 1));
  g.computeBoundingSphere(); g.boundingSphere.radius += rise;
  const mat = sparkMat.clone(); mat.uniforms.uTime = FX_TIME; mat.uniforms.uRise = { value: rise };
  const p = new THREE.Points(g, mat); p.renderOrder = 6; p.userData.fx = 'sparks';
  return p;
}

// ---------------------------------------------------------------------------------------------
// BRILHO DO FOGO NO CHÃO (decalque aditivo, tremulando) — fica no cômodo, fora da pegada do móvel
// ---------------------------------------------------------------------------------------------
let glowMat = null;
export function fireGlowMaterial() {
  if (glowMat) return glowMat;
  glowMat = new THREE.ShaderMaterial({
    uniforms: { uTime: FX_TIME },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uTime; varying vec2 vUv;
      void main(){
        // origem na borda de trás (lareira) e no meio: meia-elipse que se abre para o cômodo
        vec2 p = vec2((vUv.x - 0.5) * 2.0, vUv.y);
        float d = length(vec2(p.x * 0.85, p.y * 1.05));
        float f = 0.82 + 0.12 * sin(uTime * 13.0) * sin(uTime * 7.3) + 0.06 * sin(uTime * 23.0 + 1.3);
        float a = exp(-d * d * 3.2) * f * smoothstep(0.0, 0.06, vUv.y);
        gl_FragColor = vec4(vec3(1.0, 0.36, 0.08) * a * 0.55, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  // fog: o ShaderMaterial precisa dos uniforms de névoa para fog:true; mais simples: sem névoa
  glowMat.fog = false;
  return glowMat;
}
// decalque no piso à frente da lareira. Local: origem no centro da frente da lareira, +z para o cômodo.
export function buildFireGlow(width = 2.4, depth = 1.7) {
  const g = new THREE.PlaneGeometry(width, depth); g.rotateX(-Math.PI / 2); g.translate(0, 0, depth / 2);
  // uv.y = 0 junto à lareira
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  const m = new THREE.Mesh(g, fireGlowMaterial()); m.renderOrder = 2; m.userData.fx = 'fireGlow';
  return m;
}

// ---------------------------------------------------------------------------------------------
// JANELA: "céu lá fora" calculado pela direção do olhar (fica no infinito → paralaxe certa sem geometria de fora).
// Céu degradê, halo e disco da lua (direção por janela: atributo aMoon), estrelas, nuvens finas e silhueta de
// árvores secas (panorama em canvas). Pode ser fundido num mesh por andar (o atributo viaja com os vértices).
// ---------------------------------------------------------------------------------------------
let skyMat = null;
export function windowSkyMaterial() {
  if (skyMat) return skyMat;
  skyMat = new THREE.ShaderMaterial({
    uniforms: { uTime: FX_TIME, uTrees: { value: treePanorama() } },
    vertexShader: /* glsl */`
      attribute vec3 aMoon; varying vec3 vWorld; varying vec3 vMoon;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vMoon = aMoon; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform sampler2D uTrees; varying vec3 vWorld; varying vec3 vMoon; ${NOISE}
      void main(){
        vec3 d = normalize(vWorld - cameraPosition);
        float el = asin(clamp(d.y, -1.0, 1.0));
        vec3 m = normalize(vMoon);
        float az = atan(d.x, d.z), maz = atan(m.x, m.z);
        float ang = acos(clamp(dot(d, m), -1.0, 1.0));
        vec3 col = mix(vec3(0.020, 0.030, 0.058), vec3(0.004, 0.007, 0.016), smoothstep(0.0, 0.9, el));
        col += vec3(0.020, 0.028, 0.045) * exp(-max(el, 0.0) * 6.0);           // névoa clara no horizonte
        float halo = exp(-ang * ang * 22.0) * 0.55 + exp(-ang * 3.2) * 0.12;
        col += vec3(0.32, 0.40, 0.62) * halo;
        // nuvens finas passando devagar, acesas perto da lua
        vec2 cp = vec2(az * 2.2 + uTime * 0.004, el * 7.0);
        float cl = smoothstep(0.5, 0.85, fbm(cp * vec2(1.0, 2.2))) * smoothstep(0.02, 0.25, el);
        col = mix(col, vec3(0.05, 0.06, 0.09) + vec3(0.30, 0.34, 0.45) * halo * 1.6, cl * 0.55);
        // estrelas (somem perto da lua e atrás das nuvens)
        vec2 sp = vec2(az * 70.0, el * 70.0); vec2 ci = floor(sp); float hs = h21(ci);
        float st = step(0.975, hs) * (1.0 - smoothstep(0.05, 0.28, length(fract(sp) - 0.5)));
        st *= 0.55 + 0.45 * sin(uTime * (1.5 + hs * 3.0) + hs * 60.0);
        col += vec3(0.75, 0.8, 1.0) * st * smoothstep(0.03, 0.2, el) * (1.0 - cl) * (1.0 - smoothstep(0.0, 0.4, halo));
        // disco da lua com manchas
        float disk = 1.0 - smoothstep(0.040, 0.046, ang);
        vec2 mq = vec2(az - maz, el - asin(m.y)) * 40.0;
        vec3 moon = vec3(2.1, 2.2, 2.4) * (0.78 + 0.22 * fbm(mq * 1.3));
        col = mix(col, moon, disk * (1.0 - cl * 0.7));
        // silhueta das árvores e chão
        float u = az / 6.2831853 + 0.5;
        float v = (el + 0.12) / 0.55;
        if (v > 0.0 && v < 1.0) { float a = texture2D(uTrees, vec2(u, v)).a; col = mix(col, vec3(0.006, 0.008, 0.012), a); }
        if (v <= 0.0) col = vec3(0.006, 0.008, 0.011) + vec3(0.01, 0.014, 0.022) * smoothstep(-0.5, 0.0, el);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    fog: false,
  });
  return skyMat;
}
// panorama (sem emenda em u) de árvores secas e cerca: alpha = silhueta. Em node (testes) não existe canvas.
function treePanorama() {
  if (typeof document === 'undefined') return null;
  const W = 2048, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  g.fillStyle = '#000';
  // linha da mata ao longe (bosque baixo)
  g.beginPath(); g.moveTo(0, H);
  for (let x = 0; x <= W; x += 8) { const y = H - 46 - 18 * Math.sin(x * 0.006) - 10 * Math.sin(x * 0.023 + 1) - r() * 8; g.lineTo(x, y); }
  g.lineTo(W, H); g.closePath(); g.fill();
  // árvores secas: tronco + galhos recursivos (desenhadas 2x para não ter emenda)
  const branch = (x, y, len, ang, w, depth) => {
    const x2 = x + Math.cos(ang) * len, y2 = y - Math.sin(ang) * len;
    g.lineWidth = w; g.strokeStyle = '#000'; g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
    if (depth <= 0 || w < 0.6) return;
    const k = 2 + (r() < 0.4 ? 1 : 0);
    for (let i = 0; i < k; i++) branch(x2, y2, len * (0.62 + r() * 0.2), ang + (r() - 0.5) * 1.3, w * 0.62, depth - 1);
  };
  for (let i = 0; i < 22; i++) {
    const x = r() * W, h = 60 + r() * 120, base = H - 30 - r() * 10;
    const seed = s;
    for (const off of [0, W, -W]) { s = seed; branch(x + off, base, h * 0.45, Math.PI / 2 + (r() - 0.5) * 0.2, 3 + r() * 4, 6); }
  }
  // cerca
  g.fillRect(0, H - 22, W, 3);
  for (let x = 0; x < W; x += 26) g.fillRect(x, H - 34, 3, 34);
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.anisotropy = 4;
  return t;
}

// geometria do céu de uma janela (quad ww×wh no espaço local da janela) com a direção da lua em todos os vértices
export function windowSkyGeometry(ww, wh, wy, z, moonDir) {
  const g = new THREE.PlaneGeometry(ww, wh); g.translate(0, wy, z);
  const a = []; for (let i = 0; i < 4; i++) a.push(moonDir.x, moonDir.y, moonDir.z);
  g.setAttribute('aMoon', new THREE.Float32BufferAttribute(a, 3));
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  return g;
}

// ---------------------------------------------------------------------------------------------
// MANCHA DE LUAR no piso: o desenho da janela (vidraças e caixilhos) projetado para dentro do cômodo
// ---------------------------------------------------------------------------------------------
let patchTex = null;
function moonPatchTexture() {
  if (patchTex || typeof document === 'undefined') return patchTex;
  const W = 128, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  g.filter = 'blur(5px)';
  const cols = 2, rows = 4, m = 10, bar = 7;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const x = m + i * (W - 2 * m) / cols + bar / 2, y = m + j * (H - 2 * m) / rows + bar / 2;
    const k = 0.75 + 0.25 * Math.sin(i * 3 + j * 1.7);
    g.fillStyle = `rgba(255,255,255,${k})`; g.fillRect(x, y, (W - 2 * m) / cols - bar, (H - 2 * m) / rows - bar);
  }
  g.filter = 'none';
  // some aos poucos longe da janela
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.7)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  patchTex = new THREE.CanvasTexture(c); patchTex.colorSpace = THREE.SRGBColorSpace;
  return patchTex;
}
let patchMat = null;
export function moonPatchMaterial() {
  if (patchMat) return patchMat;
  patchMat = new THREE.MeshBasicMaterial({ map: moonPatchTexture(), color: 0x6a84c0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  return patchMat;
}
// trapézio no piso (espaço local da janela): começa em z0 e vai até z1, alargando
export function moonPatchGeometry(ww, z0, z1) {
  const g = new THREE.BufferGeometry();
  const w0 = ww * 0.95, w1 = ww * 1.25;
  g.setAttribute('position', new THREE.Float32BufferAttribute([-w0 / 2, 0, z0, w0 / 2, 0, z0, w1 / 2, 0, z1, -w1 / 2, 0, z1], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  return g;
}

// vidro: leve, sujo e com reflexo (MeshStandard transparente; o reflexo vem da lanterna e das luzes do cômodo)
let glassMat = null;
export function windowGlassMaterial() {
  if (glassMat) return glassMat;
  glassMat = new THREE.MeshStandardMaterial({ color: 0x3a4450, roughness: 0.22, metalness: 0.0, transparent: true, opacity: 0.12, depthWrite: false, alphaMap: glassDirtTexture() });
  glassMat.opacity = glassMat.alphaMap ? 0.24 : 0.1; // v6: mais limpo — o quintal escuro lá fora aparece // escuro e fino: a lanterna faz um brilho, não deixa o vidro leitoso
  return glassMat;
}
function glassDirtTexture() {
  if (typeof document === 'undefined') return null;
  const W = 128, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = 'rgb(40,40,40)'; g.fillRect(0, 0, W, H);
  let s = 3; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 40; i++) { const x = r() * W, y = r() * H, rr = 8 + r() * 36; const gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, `rgba(150,150,150,${0.25 + r() * 0.3})`); gr.addColorStop(1, 'rgba(150,150,150,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H); }
  // pó acumulado nos cantos de baixo e escorridos
  const gb = g.createLinearGradient(0, H, 0, H * 0.75); gb.addColorStop(0, 'rgba(170,170,170,0.7)'); gb.addColorStop(1, 'rgba(170,170,170,0)'); g.fillStyle = gb; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 14; i++) { const x = r() * W; g.fillStyle = 'rgba(120,120,120,0.35)'; g.fillRect(x, r() * H * 0.5, 1.5, 30 + r() * 80); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; return t;
}
