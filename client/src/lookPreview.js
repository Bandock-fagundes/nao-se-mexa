// v7: prévia 3D da APARÊNCIA (menu e sala de espera) — o boneco de madeira girando devagar com o acessório
// escolhido. Renderizador próprio num canvas pequeno; só desenha enquanto o canvas está visível na tela.
import * as THREE from 'three';
import { buildTeammate, animateTeammate, setTeammateLook, setTeammateLOD } from './render/human.js';

export class LookPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.r.toneMapping = THREE.ACESFilmicToneMapping; this.r.toneMappingExposure = 1.15;
    this.r.shadowMap.enabled = true; this.r.shadowMap.type = THREE.PCFSoftShadowMap;
    const sc = this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(28, 1, 0.05, 20);
    sc.add(new THREE.HemisphereLight(0x8a90a8, 0x2a1a10, 0.9));
    const key = new THREE.SpotLight(0xffd8b0, 13, 8, 0.6, 0.6, 1.4); key.position.set(1.3, 2.6, 1.9); key.target.position.set(0, 1.25, 0);
    key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0006; sc.add(key, key.target);
    const rim = new THREE.DirectionalLight(0x7890ff, 1.4); rim.position.set(-2, 2.2, -2.5); sc.add(rim);
    const fill = new THREE.PointLight(0xffa060, 1.2, 4, 1.5); fill.position.set(-1.2, 1.0, 1.4); sc.add(fill);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(0.9, 48), new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; sc.add(floor);
    this.t = null; this.yaw = 0.5; this.vel = 0; this.drag = null; this.last = 0; this.raf = 0; this.look = null;
    const down = (e) => { this.drag = e.clientX; this.vel = 0; canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId); };
    const move = (e) => { if (this.drag === null) return; const dx = e.clientX - this.drag; this.drag = e.clientX; this.yaw += dx * 0.012; this.vel = dx * 0.6; };
    const up = () => { this.drag = null; };
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  }
  setLook(look) {
    this.look = look;
    if (!this.t) { this.t = buildTeammate(null, 0, look); setTeammateLOD(this.t, 'hi'); this.scene.add(this.t.root); this.settle(); }
    else setTeammateLook(this.t, look);
    this.draw();
  }
  settle() { for (let i = 0; i < 60; i++) animateTeammate(this.t, 1 / 60, { speed: 0, alive: true, fl: false, pitch: 0.05 }); }
  start() {
    if (this.raf) return;
    this.last = performance.now();
    const loop = (now) => {
      this.raf = requestAnimationFrame(loop);
      if (!this.canvas.offsetParent) return; // escondido: não gasta GPU
      const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
      if (this.drag === null) { this.yaw += (0.35 + this.vel * 0.05) * dt; this.vel *= Math.pow(0.04, dt); }
      this.draw(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; }
  draw(dt = 0) {
    if (!this.t) return;
    const w = this.canvas.clientWidth || 210, h = this.canvas.clientHeight || 250;
    if (this.canvas.width !== Math.round(w * this.r.getPixelRatio()) || this.canvas.height !== Math.round(h * this.r.getPixelRatio())) { this.r.setSize(w, h, false); this.cam.aspect = w / h; this.cam.updateProjectionMatrix(); }
    this.t.root.rotation.y = this.yaw;
    if (dt) animateTeammate(this.t, dt, { speed: 0, alive: true, fl: false, pitch: 0.05 + 0.04 * Math.sin(performance.now() / 1700) });
    // enquadra do peito para cima (acessório em destaque)
    this.cam.position.set(0, 1.56, 1.6); this.cam.lookAt(0, 1.45, 0);
    this.r.render(this.scene, this.cam);
  }
}
