// Renderizador, pós-processamento e configurações de qualidade (Baixa / Média / Alta / Ultra).
//
// v4 — "estilo DLSS" honesto para WebGL (não existe DLSS de verdade no navegador):
//  1) RESOLUÇÃO DINÂMICA: a cena 3D é desenhada numa imagem MENOR que a tela (escala 50%–100%) e essa escala
//     se ajusta a cada ~0,5 s para segurar o FPS alvo (30/60/120/sem limite). Tem histerese e "espera crescente"
//     depois de uma subida que não deu certo, para não ficar oscilando.
//  2) UPSCALE + NITIDEZ (estilo FSR 1): a imagem pequena é ampliada para a resolução da tela com filtro
//     bicúbico Catmull-Rom com anti-anel (limitado ao mín/máx dos 4 texels vizinhos, como o EASU) e depois
//     recebe nitidez adaptativa ao contraste no mesmo passe (fórmula do RCAS da AMD). Antes disso, FXAA ou SMAA
//     na resolução de render tiram o serrilhado.
//  3) A interface (HUD, menus) é HTML e continua sempre na resolução nativa da tela.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

// cap = máximo de pixels da imagem 3D (antes do upscale); minScale = menor escala que a resolução dinâmica usa
export const QUALITY = {
  low: { shadows: false, shadowSize: 512, bloom: false, ssao: false, lights: 4, aa: 'none', tex: 256, cap: 1280 * 720, minScale: 0.5 },
  medium: { shadows: true, shadowSize: 1024, bloom: true, ssao: false, lights: 6, aa: 'fxaa', tex: 512, cap: 1920 * 1080, minScale: 0.5 },
  high: { shadows: true, shadowSize: 2048, bloom: true, ssao: true, lights: 8, aa: 'smaa', tex: 512, cap: 2560 * 1440, minScale: 0.55 },
  ultra: { shadows: true, shadowSize: 2048, bloom: true, ssao: true, lights: 10, aa: 'smaa', tex: 1024, cap: 3840 * 2160, minScale: 0.6 },
};
// "Resolução máxima" da tela de saída (altura em pixels; 0 = nativa do monitor)
export const MAX_RES = { '1080': 1080, '1440': 1440, '2160': 2160, native: 0 };

// Upscale Catmull-Rom (5 leituras bilineares, versão otimizada) + anti-anel + nitidez RCAS, num passe só.
const UpscaleShader = {
  uniforms: { tSrc: { value: null }, uSrcSize: { value: new THREE.Vector2(1, 1) }, uDstSize: { value: new THREE.Vector2(1, 1) }, uSharp: { value: 0.5 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `precision highp float;
    uniform sampler2D tSrc; uniform vec2 uSrcSize; uniform vec2 uDstSize; uniform float uSharp; varying vec2 vUv;
    // bicúbico Catmull-Rom com 5 leituras bilineares (cantos ignorados: diferença invisível)
    vec3 catmull(vec2 uv){
      vec2 sp = uv * uSrcSize; vec2 tc = floor(sp - 0.5) + 0.5; vec2 f = sp - tc;
      vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f)); vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
      vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f)); vec2 w3 = f * f * (-0.5 + 0.5 * f);
      vec2 w12 = w1 + w2; vec2 tc0 = (tc - 1.0) / uSrcSize; vec2 tc3 = (tc + 2.0) / uSrcSize; vec2 tc12 = (tc + w2 / w12) / uSrcSize;
      vec3 c = texture2D(tSrc, vec2(tc12.x, tc0.y)).rgb * (w12.x * w0.y)
             + texture2D(tSrc, vec2(tc0.x, tc12.y)).rgb * (w0.x * w12.y)
             + texture2D(tSrc, tc12).rgb * (w12.x * w12.y)
             + texture2D(tSrc, vec2(tc3.x, tc12.y)).rgb * (w3.x * w12.y)
             + texture2D(tSrc, vec2(tc12.x, tc3.y)).rgb * (w12.x * w3.y);
      float ws = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
      c /= ws;
      // anti-anel (como o EASU): não passa do mín/máx dos 4 texels mais próximos — sem halos escuros/claros
      vec2 t0 = (tc) / uSrcSize, d = 1.0 / uSrcSize;
      vec3 a = texture2D(tSrc, t0).rgb, b = texture2D(tSrc, t0 + vec2(d.x, 0.0)).rgb, e = texture2D(tSrc, t0 + vec2(0.0, d.y)).rgb, g = texture2D(tSrc, t0 + d).rgb;
      return clamp(c, min(min(a, b), min(e, g)), max(max(a, b), max(e, g)));
    }
    void main(){
      vec2 px = 1.0 / uDstSize;
      vec3 e = catmull(vUv);
      if (uSharp <= 0.001) { gl_FragColor = vec4(e, 1.0); return; }
      // RCAS (AMD FidelityFX FSR 1): nitidez limitada pelo contraste local — não estoura bordas
      // vizinhos da imagem ampliada: leitura bilinear (1 leitura cada) — barato e suficiente para medir o contraste
      vec3 b = texture2D(tSrc, vUv + vec2(0.0, -px.y)).rgb, d = texture2D(tSrc, vUv + vec2(-px.x, 0.0)).rgb, f = texture2D(tSrc, vUv + vec2(px.x, 0.0)).rgb, h = texture2D(tSrc, vUv + vec2(0.0, px.y)).rgb;
      vec3 mn4 = min(min(b, d), min(f, h)), mx4 = max(max(b, d), max(f, h));
      vec3 hitMin = mn4 / (4.0 * mx4 + 1e-4);
      vec3 hitMax = (1.0 - mx4) / (4.0 * mn4 - 4.0 - 1e-4);
      vec3 lobeRGB = max(-hitMin, hitMax);
      float lobe = max(-0.1875, min(max(lobeRGB.r, max(lobeRGB.g, lobeRGB.b)), 0.0)) * uSharp;
      vec3 c = (lobe * (b + d + f + h) + e) / (4.0 * lobe + 1.0);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

export class Renderer {
  constructor(container, settings) {
    this.container = container;
    this.settings = settings;
    this.q = QUALITY[settings.quality] || QUALITY.medium;
    // antialias do canvas desligado: a cena vai para alvos de render (o MSAA do canvas não pegava nada) e o AA é FXAA/SMAA
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!settings.preserve });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.9;
    r.shadowMap.enabled = this.q.shadows; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.setPixelRatio(1); // controlamos o tamanho em pixels nós mesmos (saída e render)
    container.appendChild(r.domElement);
    r.domElement.id = 'gl';
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050608);
    this.scene.fog = new THREE.FogExp2(0x07080b, 0.05);
    // v4: far 120 → 50 m. Com a névoa exp² 0,05 nada além de ~35 m aparece (fator < 5%), e os pedaços
    // da casa mais longe que isso deixam de ser desenhados (recorte por frustum).
    this.camera = new THREE.PerspectiveCamera(settings.fov || 72, 1, 0.04, 50);
    this.scene.add(this.camera);
    this.handScene = new THREE.Scene();
    this.hemi = new THREE.HemisphereLight(0x4a5674, 0x1a130c, 0.5); this.scene.add(this.hemi); // v2: mais escuro (antes 0.7)
    this.amb = new THREE.AmbientLight(0x22262f, 0.22); this.scene.add(this.amb);
    // luzes da cena da mão
    this.handHemi = new THREE.HemisphereLight(0x8090b0, 0x2a1c14, 0.9); this.handScene.add(this.handHemi);
    this.handKey = new THREE.DirectionalLight(0xffd8b0, 0.6); this.handKey.position.set(0.5, 1, 0.6); this.handScene.add(this.handKey);
    this.handSpill = new THREE.PointLight(0xfff0d8, 0.6, 0.6, 1.2); this.handSpill.position.set(0.12, -0.05, -0.55); this.handScene.add(this.handSpill);
    this.handCam = this.camera.clone(); this.handCam.near = 0.01; this.handCam.far = 5;
    // passe final de upscale + nitidez (desenha no canvas)
    this.upMat = new THREE.ShaderMaterial({ ...UpscaleShader, uniforms: THREE.UniformsUtils.clone(UpscaleShader.uniforms), depthTest: false, depthWrite: false });
    this.upQuad = new FullScreenQuad(this.upMat);
    // estado da resolução dinâmica
    this.scale = settings.resScale || 1; this.out = { w: 1, h: 1 }; this.rw = 1; this.rh = 1;
    this.dyn = { acc: 0, lastT: 0, upHold: 2, sinceUp: 99, sinceChange: 0, okT: 0, ceil: 1, ceilT: 0, ceilHold: 7.5, refresh: 1000 / 60, dts: [] };
    this.frameStats = { fps: 0, ms: 0, calls: 0, tris: 0 }; this.fpsAcc = { t: 0, n: 0 };
    this.renderer.info.autoReset = false;
    this.buildComposer();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }
  buildComposer() {
    const r = this.renderer;
    this.composer = new EffectComposer(r);
    this.composer.renderToScreen = false; // o resultado fica no alvo; o passe de upscale desenha na tela
    this.mainPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.mainPass);
    this.gtao = null; this.bloom = null; this.fxaa = null; this.smaa = null;
    if (this.q.ssao) {
      this.gtao = new GTAOPass(this.scene, this.camera, 400, 300);
      this.gtao.output = GTAOPass.OUTPUT.Default;
      this.gtao.blendIntensity = 0.8;
      this.gtao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.5, thickness: 1, scale: 1.2, samples: 12 });
      this.composer.addPass(this.gtao);
    }
    this.handPass = new RenderPass(this.handScene, this.handCam);
    this.handPass.clear = false; this.handPass.clearDepth = true;
    this.composer.addPass(this.handPass);
    if (this.q.bloom) { this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.32, 0.4, 0.92); this.composer.addPass(this.bloom); }
    this.composer.addPass(new OutputPass());
    // AA depois do tone mapping (em espaço sRGB, como o FXAA/SMAA esperam), na resolução de render
    if (this.q.aa === 'fxaa') { this.fxaa = new ShaderPass(FXAAShader); this.composer.addPass(this.fxaa); }
    else if (this.q.aa === 'smaa') { this.smaa = new SMAAPass(); this.composer.addPass(this.smaa); }
    this.composer.setPixelRatio(1);
    this.lastRW = 0; this.lastRH = 0;
  }
  applySettings(settings) {
    const prevQ = this.q;
    this.settings = settings;
    this.q = QUALITY[settings.quality] || QUALITY.medium;
    this.renderer.shadowMap.enabled = this.q.shadows;
    this.camera.fov = settings.fov || 72; this.handCam.fov = this.camera.fov;
    if (prevQ !== this.q) { this.composer.dispose?.(); this.buildComposer(); this.renderer.shadowMap.needsUpdate = true; this.onQualityChange && this.onQualityChange(this.q); }
    if (!settings.dynRes) this.scale = settings.resScale || 1;
    this.dyn.ceilT = 0; this.dyn.ceilHold = 7.5; this.dyn.sinceChange = 0; // configuração mudou: pode testar de novo
    this.resize();
  }
  // resolução de saída (canvas) e a maior resolução de render permitida pelo preset
  outputSize() {
    const cw = this.container.clientWidth || window.innerWidth, ch = this.container.clientHeight || window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    let w = Math.round(cw * dpr), h = Math.round(ch * dpr);
    const capH = MAX_RES[this.settings.maxRes] || 0;
    if (capH && h > capH) { w = Math.round(w * capH / h); h = capH; }
    return { w: Math.max(1, w), h: Math.max(1, h), cw, ch };
  }
  maxRenderScale() { const o = this.out; return Math.min(1, Math.sqrt(this.q.cap / (o.w * o.h))); }
  resize() {
    const o = this.outputSize();
    this.out = o;
    this.renderer.setSize(o.w, o.h, false); // o CSS (100%) estica o canvas na tela
    const ar = o.cw / o.ch;
    this.camera.aspect = ar; this.camera.updateProjectionMatrix();
    this.handCam.aspect = ar; this.handCam.fov = this.camera.fov; this.handCam.updateProjectionMatrix();
    this.applyScale(true);
  }
  // escala efetiva (fração da saída) = escala pedida × teto do preset
  applyScale(force) {
    const smax = this.maxRenderScale();
    const s = Math.min(1, Math.max(0.25, this.scale)) * smax;
    const rw = Math.max(64, Math.round(this.out.w * s)), rh = Math.max(36, Math.round(this.out.h * s));
    if (!force && rw === this.lastRW && rh === this.lastRH) return;
    this.lastRW = rw; this.lastRH = rh; this.rw = rw; this.rh = rh;
    this.composer.setSize(rw, rh);
    if (this.bloom) this.bloom.setSize(rw / 2, rh / 2); // mesma aparência de antes (bloom em 1/4)
    if (this.fxaa) this.fxaa.material.uniforms.resolution.value.set(1 / rw, 1 / rh);
    this.upMat.uniforms.uSrcSize.value.set(rw, rh);
    this.upMat.uniforms.uDstSize.value.set(this.out.w, this.out.h);
  }
  // limite de FPS (30 / 60 / 120): devolve false quando o quadro deve ser pulado
  shouldRender(now) {
    const t = this.settings.fpsTarget ?? 60;
    if (!t || this.settings.preserve) return true;
    const step = 1000 / t, slack = this.dyn.refresh * 0.5;
    if (step <= this.dyn.refresh * 1.05) return true; // a tela já é mais lenta que o alvo
    if (this.nextAt && now < this.nextAt - slack) return false;
    this.nextAt = Math.max((this.nextAt || now) + step, now - step);
    return true;
  }
  // controlador da resolução dinâmica: mede o tempo entre quadros e mexe na escala a cada ~0,5 s
  updateDynamic(now) {
    const D = this.dyn, st = this.settings;
    const dt = D.lastT ? now - D.lastT : 0; D.lastT = now;
    if (!dt || dt > 2500) return; // aba escondida (o rAF para), carregamento: ignora
    const d = Math.min(dt, 250); // um engasgo isolado não derruba a escala de uma vez
    D.dts.push(d); D.acc += d;
    if (D.acc < 500) return;
    // período da tela (vsync): menor mediana já vista — 60 Hz, 144 Hz…
    const sorted = D.dts.slice().sort((a, b) => a - b), med = sorted[sorted.length >> 1];
    D.refresh = Math.max(1000 / 240, Math.min(D.refresh, med));
    const avg = D.acc / D.dts.length; D.dts.length = 0; D.acc = 0;
    if (!st.dynRes || st.preserve) return;
    const t = st.fpsTarget ?? 60, target = Math.max(t ? 1000 / t : D.refresh, D.refresh * 0.98);
    const minS = this.q.minScale;
    D.sinceUp += 0.5; D.sinceChange += 0.5;
    let s = this.scale;
    if (D.ceilT > 0) D.ceilT -= 0.5;
    if (avg > target * 1.1) {
      if (D.sinceUp < 3) {
        // a subida que acabamos de fazer não coube: volta um degrau e marca um "teto" que só é testado de novo
        // depois de 15 s, 30 s, 60 s… (até 2 min) — é isso que evita o sobe-desce
        D.ceil = s; D.ceilHold = Math.min(120, (D.ceilHold || 7.5) * 2); D.ceilT = D.ceilHold;
        s -= 0.05; D.sinceUp = 99;
      } else {
        // ficou lento por outro motivo (cena mais pesada): desce proporcional (custo ∝ escala²), 1 a 3 degraus
        s = Math.max(s - 0.15, Math.min(s - 0.05, s * Math.sqrt(target / avg)));
      }
      D.okT = 0;
    } else if (avg < target * 1.04) {
      D.okT += 0.5;
      const blocked = D.ceilT > 0 && s + 0.05 >= D.ceil - 1e-6;
      if (D.okT >= D.upHold && s < 1 && !blocked) { s += 0.05; D.sinceUp = 0; D.okT = 0; }
      if (D.sinceChange > 60) D.ceilHold = Math.max(7.5, (D.ceilHold || 7.5) / 2); // estável há tempo: volta a testar mais cedo
    } else D.okT = 0;
    s = Math.round(Math.min(1, Math.max(minS, s)) * 20) / 20;
    if (s !== this.scale) { this.scale = s; D.sinceChange = 0; this.applyScale(false); }
  }
  render() {
    const now = performance.now();
    this.updateDynamic(now);
    const info = this.renderer.info; info.reset();
    this.handCam.projectionMatrix.copy(this.camera.projectionMatrix);
    this.composer.render();
    const calls = info.render.calls, tris = info.render.triangles;
    // upscale + nitidez → canvas
    const r = this.renderer;
    this.upMat.uniforms.tSrc.value = this.composer.readBuffer.texture;
    const sh = this.settings.sharpness ?? 0.5;
    this.upMat.uniforms.uSharp.value = sh;
    r.setRenderTarget(null);
    this.upQuad.render(r);
    // estatísticas para o painel F3
    const F = this.fpsAcc; F.n++;
    if (!F.t) F.t = now;
    if (now - F.t >= 500) { this.frameStats.fps = F.n * 1000 / (now - F.t); this.frameStats.ms = (now - F.t) / F.n; F.t = now; F.n = 0; }
    this.frameStats.calls = calls; this.frameStats.tris = tris;
  }
  stats() { return { ...this.frameStats, rw: this.rw, rh: this.rh, ow: this.out.w, oh: this.out.h, scale: this.rw / this.out.w, dyn: !!this.settings.dynRes }; }
}

// Cone volumétrico barato (aditivo) para o feixe da lanterna
export function makeBeamCone(length = 7.5, angle = 0.4, strength = 0.07) {
  const radius = Math.tan(angle) * length;
  const geo = new THREE.ConeGeometry(radius, length, 32, 8, true);
  geo.translate(0, -length / 2, 0); geo.rotateX(-Math.PI / 2); // ápice na origem, abrindo em -Z
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uStrength: { value: strength }, uLen: { value: length }, uColor: { value: new THREE.Color(0xe6eeff) }, uTime: { value: 0 } },
    vertexShader: `varying vec3 vPos; varying vec3 vN; varying vec3 vView; varying vec3 vAxis; void main(){ vPos = position; vec4 mv = modelViewMatrix * vec4(position,1.0); vView = normalize(-mv.xyz); vN = normalize(normalMatrix * normal); vAxis = normalize((modelViewMatrix * vec4(0.0,0.0,-1.0,0.0)).xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uStrength; uniform float uLen; uniform vec3 uColor; uniform float uTime; varying vec3 vPos; varying vec3 vN; varying vec3 vView; varying vec3 vAxis;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
      void main(){ float d = clamp(-vPos.z / uLen, 0.0, 1.0); float fade = pow(1.0 - d, 1.6) * smoothstep(0.0, 0.08, d);
        float edge = pow(abs(dot(vN, vView)), 1.4);
        float dust = 0.85 + 0.15 * sin(vPos.z * 3.0 + uTime * 0.7 + vPos.x * 5.0);
        // feixe apontado para a câmera (lanterna de um colega): evita névoa branca na tela inteira
        float facing = 1.0 - smoothstep(0.2, 0.85, dot(vAxis, vView));
        gl_FragColor = vec4(uColor * uStrength * fade * edge * dust * facing, 1.0); }`,
  });
  const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = 10;
  return m;
}
