// Tela de carregamento da partida: corredor escuro da mansão renderizado em Three.js (baixa resolução)
// com a criatura andando devagar ao fundo, título, nome da fase, dicas rotativas e barra de progresso
// ligada às etapas reais do carregamento.
import * as THREE from 'three';
import { buildCreature } from './render/creature.js';
import { flicker } from './render/mansion.js';
import { tint } from './render/props.js';

export const TIPS = [
  'Fique parado: na Fase 1 a criatura só vê movimento.',
  'Na Fase 2 ela escuta: correr faz barulho.',
  'Na Fase 3 ela fareja seu rastro.',
  'Use C para agachar.',
  'F liga e desliga a lanterna.',
];
const PHASE_NAMES = { 1: 'FASE 1 — A CRIATURA VÊ', 2: 'FASE 2 — A CRIATURA ESCUTA', 3: 'FASE 3 — A CRIATURA FAREJA' };
const RES_SCALE = 0.55; // resolução interna da cena de fundo (leve para PCs fracos)

// espera o navegador pintar um quadro (com limite, caso a aba esteja em segundo plano)
export const nextPaint = () => new Promise(res => { let ok = false; const f = () => { if (!ok) { ok = true; res(); } }; requestAnimationFrame(() => setTimeout(f, 0)); setTimeout(f, 80); });

export class LoadingScreen {
  constructor(root, { lite = false, music = null } = {}) {
    this.root = root; this.lite = lite; this.music = music;
    this.canvas = root.querySelector('#loadCanvas');
    this.fill = root.querySelector('#ldFill'); this.text = root.querySelector('#loadingText');
    this.tipEl = root.querySelector('#ldTip'); this.phaseEl = root.querySelector('#ldPhase');
    this.active = false; this.tipIdx = Math.floor(Math.random() * TIPS.length);
  }
  open(phase) {
    if (phase) this.setPhase(phase);
    if (this.active) return;
    this.active = true; this.t0 = performance.now(); this.progress = 0;
    this.root.classList.remove('leaving');
    this.setProgress(0.03, 'Abrindo as portas da mansão…');
    this.showTip(true);
    clearInterval(this.tipTimer); this.tipTimer = setInterval(() => this.showTip(), 3600);
    if (this.scene) this.startLoop();
  }
  setPhase(p) { if (this.phaseEl) this.phaseEl.textContent = PHASE_NAMES[p] || ''; }
  showTip(first) {
    const el = this.tipEl; if (!el) return;
    if (!first) this.tipIdx = (this.tipIdx + 1) % TIPS.length;
    const put = () => { el.classList.remove('in', 'out'); void el.offsetWidth; el.textContent = TIPS[this.tipIdx]; el.classList.add('in'); };
    if (first) put(); else { el.classList.add('out'); setTimeout(put, 350); }
  }
  setProgress(f, text) {
    this.progress = Math.max(this.progress || 0, f);
    if (this.fill) this.fill.style.width = (this.progress * 100).toFixed(1) + '%';
    if (text && this.text) this.text.textContent = text;
  }
  async step(f, text) { this.setProgress(f, text); await nextPaint(); }
  // espera o tempo mínimo de exibição
  async finish(minMs = 2500) {
    this.setProgress(1, 'Pronto. Não se mexa…');
    const left = minMs - (performance.now() - this.t0);
    if (left > 0) await new Promise(r => setTimeout(r, left));
    while (window.__loadHold) await new Promise(r => setTimeout(r, 100)); // capturas: segura a tela
  }
  // fecha com fade (a tela continua visível por cima do jogo durante a transição)
  leave() {
    if (!this.active) return;
    this.root.classList.add('leaving');
    setTimeout(() => { this.root.classList.remove('leaving'); this.close(); }, 800);
  }
  close() {
    this.active = false; clearInterval(this.tipTimer);
    cancelAnimationFrame(this.raf); this.raf = 0;
  }

  // ---------------- cena 3D ----------------
  setMaterials(M) {
    if (this.lite || this.scene || !M) return;
    try { this.build(M); if (this.active) this.startLoop(); } catch (e) { console.warn('cena de carregamento indisponível', e); this.lite = true; }
  }
  build(M) {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'low-power', preserveDrawingBuffer: !!window.__loadPreserve });
    r.setPixelRatio(1); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color(0x030305); s.fog = new THREE.FogExp2(0x050609, 0.055);
    const cam = this.camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 60);
    cam.position.set(-3.2, 1.6, 1.25); cam.lookAt(5, 1.3, -0.9);
    this.camBase = cam.position.clone(); this.camLook = new THREE.Vector3(5, 1.3, -0.9);
    // corredor ao longo de X: largura 3.4 m (z de -1.7 a 1.7), altura 3.3 m
    const LEN = 26, WID = 3.4, H = 3.3, WS = 1.05;
    const plane = (w, h, mat, color, uvw, uvh) => {
      const g = new THREE.PlaneGeometry(w, h); const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvw, uv.getY(i) * uvh);
      tint(g, color); return new THREE.Mesh(g, mat);
    };
    const floor = plane(LEN, WID, M.floorWood, 0x9a8a7a, LEN / 2, WID / 2); floor.rotation.x = -Math.PI / 2; s.add(floor);
    const ceil = plane(LEN, WID, M.ceilingDark || M.ceiling, 0x807870, LEN / 2, WID / 2); ceil.rotation.x = Math.PI / 2; ceil.position.y = H; s.add(ceil);
    // parede do fundo: papel de parede acima, lambri abaixo
    const back = plane(LEN, H - WS, M.wallRed, 0xc8b8a8, LEN / 2.2, (H - WS) / 2.2); back.position.set(0, WS + (H - WS) / 2, -WID / 2); s.add(back);
    const wain = plane(LEN, WS, M.wainscot, 0x9a8070, LEN / 1.6, 1); wain.position.set(0, WS / 2, -WID / 2 + 0.01); s.add(wain);
    const front = plane(LEN, H - WS, M.wallRed, 0xb0a090, LEN / 2.2, (H - WS) / 2.2); front.rotation.y = Math.PI; front.position.set(0, WS + (H - WS) / 2, WID / 2); s.add(front);
    const fwain = plane(LEN, WS, M.wainscot, 0x8a7060, LEN / 1.6, 1); fwain.rotation.y = Math.PI; fwain.position.set(0, WS / 2, WID / 2 - 0.01); s.add(fwain);
    const box = (w, h, d, mat, color, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); tint(g, color); const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); s.add(m); return m; };
    // rodameio, moldura do lambri e sanca
    for (const zz of [-1, 1]) {
      box(LEN, 0.05, 0.05, M.trim, 0x5a3a24, 0, WS, zz * (WID / 2 - 0.03));
      box(LEN, 0.14, 0.03, M.trim, 0x3a2416, 0, 0.07, zz * (WID / 2 - 0.02));
      box(LEN, 0.12, 0.08, M.trim, 0x4a3020, 0, H - 0.06, zz * (WID / 2 - 0.04));
    }
    // portas e pilares na parede do fundo
    for (const x of [-6.5, 4.6]) {
      box(1.1, 2.3, 0.06, M.darkWood, 0x4a2c1c, x, 1.15, -WID / 2 + 0.03);
      box(1.3, 0.12, 0.1, M.trim, 0x3a2416, x, 2.36, -WID / 2 + 0.05);
      for (const dx of [-0.6, 0.6]) box(0.1, 2.36, 0.1, M.trim, 0x3a2416, x + dx, 1.18, -WID / 2 + 0.05);
      box(0.06, 0.06, 0.06, M.brass, 0xffffff, x + 0.4, 1.05, -WID / 2 + 0.09);
    }
    // quadros
    const frame = (x, y, w, h, hue) => {
      box(w + 0.12, h + 0.12, 0.05, M.trim, 0x6a4a20, x, y, -WID / 2 + 0.03);
      const c = document.createElement('canvas'); c.width = 64; c.height = 80; const g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 0, 80); gr.addColorStop(0, hue); gr.addColorStop(1, '#0a0806'); g.fillStyle = gr; g.fillRect(0, 0, 64, 80);
      g.fillStyle = 'rgba(0,0,0,.55)'; g.beginPath(); g.ellipse(32, 44, 14, 20, 0, 0, 7); g.fill(); g.beginPath(); g.arc(32, 26, 9, 0, 7); g.fill();
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 })); m.position.set(x, y, -WID / 2 + 0.06); s.add(m);
    };
    frame(-2.2, 2.0, 0.7, 0.9, '#4a3a2a'); frame(1.2, 2.05, 0.6, 0.8, '#2a3440'); frame(7.6, 2.0, 0.7, 0.9, '#3a2a28');
    // aparador com vaso
    const AX = 1.7;
    box(1.3, 0.06, 0.4, M.darkWood, 0x5a3a24, AX, 0.86, -WID / 2 + 0.24);
    for (const dx of [-0.58, 0.58]) box(0.05, 0.84, 0.05, M.darkWood, 0x3a2416, AX + dx, 0.42, -WID / 2 + 0.24);
    const vase = new THREE.Mesh(tint(new THREE.CylinderGeometry(0.07, 0.1, 0.3, 12), 0xd8d0c0), M.porcelain); vase.position.set(AX - 0.3, 1.04, -WID / 2 + 0.24); s.add(vase);
    // arandelas com luz tremeluzente
    this.lamps = [];
    for (const [x, seed] of [[-4.1, 1.3], [2.9, 4.7], [9.5, 2.2]]) {
      box(0.08, 0.2, 0.06, M.brass, 0xffffff, x, 1.95, -WID / 2 + 0.05);
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.2, 14, 1, true), M.shade); shade.position.set(x, 2.15, -WID / 2 + 0.18); s.add(shade);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), M.glow); bulb.position.set(x, 2.1, -WID / 2 + 0.18); s.add(bulb);
      const l = new THREE.PointLight(0xffa860, 0, 7.5, 1.8); l.position.set(x, 2.15, -WID / 2 + 0.35); s.add(l);
      this.lamps.push({ l, bulb, lp: { state: 'flicker', kind: 'sconce', seed }, base: x === 2.9 ? 5.5 : 4.2 });
    }
    // luar frio vindo do fim do corredor + preenchimento muito fraco
    const moon = new THREE.DirectionalLight(0x6a80b0, 0.35); moon.position.set(12, 4, 2); s.add(moon);
    // contraluz fria no fim do corredor: recorta a silhueta da criatura
    const rim = new THREE.PointLight(0x7890c8, 6, 14, 1.6); rim.position.set(9, 2.4, 0.9); s.add(rim);
    s.add(new THREE.HemisphereLight(0x303848, 0x100c08, 0.5));
    // a criatura
    const cr = this.cr = buildCreature(M);
    cr.root.traverse(o => { o.castShadow = false; o.receiveShadow = false; });
    cr.root.position.set(-8, 0, -0.55);
    s.add(cr.root);
    this.crX = 1.5; this.walkT = 0;
    this.resize(); this._onResize = () => this.resize(); window.addEventListener('resize', this._onResize);
  }
  resize() {
    if (!this.renderer) return;
    const w = Math.max(320, Math.round(window.innerWidth * RES_SCALE)), h = Math.max(180, Math.round(window.innerHeight * RES_SCALE));
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  startLoop() {
    if (this.raf || !this.scene) return;
    this.last = performance.now(); this.root.classList.add('has3d');
    const loop = (now) => {
      if (!this.active) { this.raf = 0; return; }
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - this.last) / 1000);
      if (dt < 1 / 40 && !window.__loadPreserve) return; // ~30 fps bastam
      this.last = now;
      this.update(dt, now / 1000);
      this.renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(loop);
  }
  update(dt, t) {
    // criatura atravessa o corredor devagar, da esquerda para a direita, e recomeça
    const speed = 0.8;
    this.crX += speed * dt;
    if (this.crX > 12.5) this.crX = 0.5; // atravessa o fundo do corredor e recomeça na penumbra
    if (typeof window.__loadCrX === 'number') this.crX = window.__loadCrX;
    const c = this.cr, yaw = Math.PI / 2; // frente local +Z -> anda para +X
    c.root.position.set(this.crX, 0, -0.1); c.root.rotation.y = yaw;
    const st = { anim: 'walk', animT: (this.walkT += dt), speed, headYaw: Math.sin(t * 0.4) * 0.35, headPitch: -0.05, yaw, duck: 0 };
    try {
      if (c.anim && typeof c.anim.update === 'function') c.anim.update(dt, st);
      else if (typeof c.update === 'function') c.update(dt, st);
    } catch (e) { /* animação em evolução: ignora falhas */ }
    for (const L of this.lamps) { const k = flicker(L.lp, t); L.l.intensity = L.base * k; L.bulb.visible = k > 0.3; }
    // câmera respira levemente
    const cam = this.camera;
    cam.position.set(this.camBase.x + Math.sin(t * 0.3) * 0.06, this.camBase.y + Math.sin(t * 0.47) * 0.03, this.camBase.z);
    cam.lookAt(this.camLook.x + Math.sin(t * 0.21) * 0.15, this.camLook.y, this.camLook.z);
  }
}
