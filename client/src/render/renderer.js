// Renderizador, pós-processamento e configurações de qualidade (Baixa / Média / Alta).
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';

export const QUALITY = {
  low: { shadows: false, shadowSize: 512, pixelRatio: 0.75, bloom: false, ssao: false, lights: 4, antialias: false, tex: 256 },
  medium: { shadows: true, shadowSize: 1024, pixelRatio: 1.0, bloom: true, ssao: false, lights: 6, antialias: true, tex: 512 },
  high: { shadows: true, shadowSize: 2048, pixelRatio: 1.5, bloom: true, ssao: true, lights: 8, antialias: true, tex: 512 },
};

export class Renderer {
  constructor(container, settings) {
    this.container = container;
    this.settings = settings;
    this.q = QUALITY[settings.quality] || QUALITY.medium;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: this.q.antialias, powerPreference: 'high-performance', preserveDrawingBuffer: !!settings.preserve });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.9;
    r.shadowMap.enabled = this.q.shadows; r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(r.domElement);
    r.domElement.id = 'gl';
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050608);
    this.scene.fog = new THREE.FogExp2(0x07080b, 0.05);
    this.camera = new THREE.PerspectiveCamera(settings.fov || 72, 1, 0.04, 120);
    this.scene.add(this.camera);
    this.handScene = new THREE.Scene();
    this.hemi = new THREE.HemisphereLight(0x4a5674, 0x1a130c, 0.5); this.scene.add(this.hemi); // v2: mais escuro (antes 0.7)
    this.amb = new THREE.AmbientLight(0x22262f, 0.22); this.scene.add(this.amb);
    // luzes da cena da mão
    this.handHemi = new THREE.HemisphereLight(0x8090b0, 0x2a1c14, 0.9); this.handScene.add(this.handHemi);
    this.handKey = new THREE.DirectionalLight(0xffd8b0, 0.6); this.handKey.position.set(0.5, 1, 0.6); this.handScene.add(this.handKey);
    this.handSpill = new THREE.PointLight(0xfff0d8, 0.6, 0.6, 1.2); this.handSpill.position.set(0.12, -0.05, -0.55); this.handScene.add(this.handSpill);
    this.handCam = this.camera.clone(); this.handCam.near = 0.01; this.handCam.far = 5;
    this.buildComposer();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }
  buildComposer() {
    const r = this.renderer;
    this.composer = new EffectComposer(r);
    this.mainPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.mainPass);
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
  }
  applySettings(settings) {
    const prevQ = this.q;
    this.settings = settings;
    this.q = QUALITY[settings.quality] || QUALITY.medium;
    this.renderer.shadowMap.enabled = this.q.shadows;
    this.camera.fov = settings.fov || 72; this.handCam.fov = this.camera.fov;
    if (prevQ !== this.q) { this.composer.dispose?.(); this.buildComposer(); this.renderer.shadowMap.needsUpdate = true; this.onQualityChange && this.onQualityChange(this.q); }
    this.resize();
  }
  resize() {
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.q.pixelRatio) * (this.settings.resScale || 1);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.handCam.aspect = w / h; this.handCam.fov = this.camera.fov; this.handCam.updateProjectionMatrix();
    if (this.bloom) this.bloom.setSize(w * pr / 2, h * pr / 2);
  }
  render() {
    this.handCam.projectionMatrix.copy(this.camera.projectionMatrix);
    this.composer.render();
  }
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
