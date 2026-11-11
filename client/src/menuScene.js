// v8: fundo 3D do MENU INICIAL — a sala de jantar da mansão em tempo real, bem barata:
// câmera derivando devagar, velas e lareira tremulando, poeira no ar e, de vez em quando, a silhueta da
// criatura parada lá no fundo, no vão da porta (a luz da vela "engasga", ela aparece; engasga de novo, sumiu).
// Leve para celular/PC fraco: resolução interna baixa (≤ 55% e no máx. ~900 px de largura), pixelRatio 1,
// 30 FPS, sem sombras, texturas 256. Se o aparelho não aguentar (< ~17 FPS), baixa a resolução; se ainda
// assim não aguentar, congela num quadro estático. Pausa sozinha quando o menu não está visível.
// Uso: const ms = new MenuScene(canvas); ms.start(); ms.stop();   window.__menuScene (capturas)
import * as THREE from 'three';
import { buildMaterials } from './render/materials.js';
import { buildProp, buildChair, tint } from './render/props.js';
import { buildCreature } from './render/creature.js';
import { buildFlames, buildFireGlow, setFxTime } from './render/fx.js';

const FPS = 30;
const SCALES = [0.55, 0.38];       // resolução interna (fração da tela); a 2ª é o degrau de economia
const MAX_W = 900;                 // teto da largura interna (telas grandes não pagam mais)
const ROOM = { x0: -2.6, x1: 2.6, z0: -6.0, z1: 4.2, h: 3.4 }; // sala de jantar: comprimento ao longo de -Z
const DOOR = { x: 1.05, w: 1.15, h: 2.35 }; // vão da porta na parede do fundo (lado direito: a UI fica à esquerda)

export class MenuScene {
  constructor(canvas) {
    this.canvas = canvas; this.running = false; this.frozen = false; this.ready = false;
    this.scaleIdx = 0; this.t = 0; this.perf = { n: 0, acc: 0, checks: 0 };
    this.nextGhost = 9 + Math.random() * 4; this.ghost = null; // aparição da criatura
  }
  // monta a cena (pode lançar: quem chama cai no fundo estático em CSS)
  build() {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'low-power', alpha: false, preserveDrawingBuffer: !!window.__menuPreserve });
    r.setPixelRatio(1); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.45;
    const M = this.M = buildMaterials(256);
    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color(0x030304); s.fog = new THREE.FogExp2(0x070608, 0.05);
    this.camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.1, 40);
    const { x0, x1, z0, z1, h } = ROOM, L = z1 - z0, Wd = x1 - x0, WS = 1.1;
    const plane = (w, hh, mat, color, uw, uh) => {
      const g = new THREE.PlaneGeometry(w, hh); const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uw, uv.getY(i) * uh);
      tint(g, color); return new THREE.Mesh(g, mat);
    };
    const box = (w, hh, d, mat, color, x, y, z, ry = 0) => { const g = new THREE.BoxGeometry(w, hh, d); tint(g, color); const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); m.rotation.y = ry; s.add(m); return m; };
    // piso, teto
    const floor = plane(Wd, L, M.floorWood, 0x8a7a6a, Wd / 2, L / 2); floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, (z0 + z1) / 2); s.add(floor);
    const ceil = plane(Wd, L, M.ceilingDark, 0x6a6058, Wd / 2, L / 2); ceil.rotation.x = Math.PI / 2; ceil.position.set(0, h, (z0 + z1) / 2); s.add(ceil);
    // paredes laterais (papel de parede verde-escuro + lambri)
    for (const sx of [-1, 1]) {
      const x = sx > 0 ? x1 : x0;
      const up = plane(L, h - WS, M.wallGreen, 0xa8a898, L / 2.2, (h - WS) / 2.2); up.rotation.y = -sx * Math.PI / 2; up.position.set(x, WS + (h - WS) / 2, (z0 + z1) / 2); s.add(up);
      const wa = plane(L, WS, M.wainscot, 0x8a7060, L / 1.6, 1); wa.rotation.y = -sx * Math.PI / 2; wa.position.set(x - sx * 0.01, WS / 2, (z0 + z1) / 2); s.add(wa);
      box(0.05, 0.05, L, M.trim, 0x4a3020, x - sx * 0.03, WS, (z0 + z1) / 2);
      box(0.03, 0.14, L, M.trim, 0x2a1810, x - sx * 0.02, 0.07, (z0 + z1) / 2);
      box(0.08, 0.12, L, M.trim, 0x3a2416, x - sx * 0.04, h - 0.06, (z0 + z1) / 2);
    }
    // parede do fundo com o vão da porta (3 pedaços: esquerda, direita, verga)
    const backWall = (xa, xb, ya, yb) => {
      const w = xb - xa, hh = yb - ya; if (w <= 0 || hh <= 0) return;
      const upY = Math.max(ya, WS);
      if (yb > upY) { const p = plane(w, yb - upY, M.wallGreen, 0x9a9a8a, w / 2.2, (yb - upY) / 2.2); p.position.set((xa + xb) / 2, (upY + yb) / 2, z0); s.add(p); }
      if (ya < WS) { const p = plane(w, Math.min(WS, yb) - ya, M.wainscot, 0x806858, w / 1.6, 1); p.position.set((xa + xb) / 2, (ya + Math.min(WS, yb)) / 2, z0 + 0.01); s.add(p); }
    };
    const dl = DOOR.x - DOOR.w / 2, dr = DOOR.x + DOOR.w / 2;
    backWall(x0, dl, 0, h); backWall(dr, x1, 0, h); backWall(dl, dr, DOOR.h, h);
    // batentes e guarnição da porta, folha entreaberta para dentro do corredor
    for (const xx of [dl - 0.05, dr + 0.05]) box(0.1, DOOR.h + 0.1, 0.12, M.trim, 0x3a2214, xx, (DOOR.h + 0.1) / 2, z0 + 0.04);
    box(DOOR.w + 0.2, 0.12, 0.12, M.trim, 0x3a2214, DOOR.x, DOOR.h + 0.06, z0 + 0.04);
    { const leaf = new THREE.Group(); const lg = new THREE.BoxGeometry(DOOR.w - 0.04, DOOR.h - 0.03, 0.05); tint(lg, 0x3a2216); const lm = new THREE.Mesh(lg, M.darkWood); lm.position.set((DOOR.w - 0.04) / 2, (DOOR.h - 0.03) / 2, 0); leaf.add(lm);
      leaf.position.set(dl + 0.02, 0, z0 - 0.06); leaf.rotation.y = 1.25; s.add(leaf); }
    // corredor escuro atrás da porta (só o suficiente para dar profundidade) com luz fria de contraluz
    { const cz0 = z0 - 4.2;
      const cf = plane(2.4, 4.2, M.floorWood, 0x5a5048, 1.2, 2.1); cf.rotation.x = -Math.PI / 2; cf.position.set(DOOR.x, 0.001, (z0 + cz0) / 2); s.add(cf);
      const cb = plane(2.4, h, M.wallRed, 0x6a5a58, 1.1, 1.5); cb.position.set(DOOR.x, h / 2, cz0); s.add(cb);
      for (const sx of [-1, 1]) { const w = plane(4.2, h, M.wallRed, 0x5a4a48, 1.9, 1.5); w.rotation.y = -sx * Math.PI / 2; w.position.set(DOOR.x + sx * 1.2, h / 2, (z0 + cz0) / 2); s.add(w); }
      const cc = plane(2.4, 4.2, M.ceilingDark, 0x403a36, 1, 1); cc.rotation.x = Math.PI / 2; cc.position.set(DOOR.x, h, (z0 + cz0) / 2); s.add(cc);
      this.rim = new THREE.PointLight(0x6f88c8, 6, 8, 1.3); this.rim.position.set(DOOR.x + 0.3, 2.3, cz0 + 0.7); s.add(this.rim); }
    // mesa de jantar comprida (com cadeiras, pratos, toalha e candelabro) — comprimento ao longo de Z
    const table = buildProp('dining_table', 4.6, 2.2, M); table.rotation.y = Math.PI / 2; table.position.set(-0.15, 0, -1.2); s.add(table);
    // velas do candelabro: chamas (shader) + luz quente tremulante
    const cx = -0.15, cz = -1.2;
    const fl = []; for (const dz of [-0.12, 0, 0.12]) fl.push({ x: cx, y: 1.19, z: cz + dz, w: 0.045, h: 0.11, seed: 3 + dz * 20 });
    s.add(buildFlames(fl));
    this.candle = new THREE.PointLight(0xffa050, 4.5, 8, 1.4); this.candle.position.set(cx, 1.42, cz); s.add(this.candle);
    // castiçal extra perto da câmera (fora de foco) + aparador
    box(1.4, 0.06, 0.45, M.darkWood, 0x4a2c1a, x1 - 0.26, 0.9, 1.6, 0);
    for (const dz of [-0.6, 0.6]) for (const dx of [-0.16, 0.16]) box(0.05, 0.88, 0.05, M.darkWood, 0x2a160c, x1 - 0.26 + dx, 0.44, 1.6 + dz);
    // lareira acesa na parede esquerda (virada para +X)
    const fp = buildProp('fireplace', 2.2, 0.5, M); fp.rotation.y = -Math.PI / 2; fp.position.set(x1 - 0.25, 0, -0.7); s.add(fp);
    if (fp.userData.firebox) { const glow = buildFireGlow(2.2, 1.6); glow.position.set(0, 0.009, fp.userData.firebox.zf - 0.05); fp.add(glow); }
    this.fire = new THREE.PointLight(0xff7a30, 7, 9, 1.5); this.fire.position.set(x1 - 0.9, 0.6, -0.7); s.add(this.fire);
    // relógio de pé e cristaleira na parede direita, quadros
    const clock = buildProp('clock', 0.5, 0.5, M); clock.rotation.y = Math.PI / 2; clock.position.set(x0 + 0.25, 0, -3.6); s.add(clock);
    const cab = buildProp('china_cabinet', 1.5, 0.5, M); cab.rotation.y = Math.PI / 2; cab.position.set(x0 + 0.25, 0, -0.9); s.add(cab);
    const frame = (x, y, z, ry, w, hh, hue) => {
      box(w + 0.12, hh + 0.12, 0.05, M.trim, 0x6a4a20, x, y, z, ry);
      const c = document.createElement('canvas'); c.width = 48; c.height = 64; const g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, hue); gr.addColorStop(1, '#0a0806'); g.fillStyle = gr; g.fillRect(0, 0, 48, 64);
      g.fillStyle = 'rgba(0,0,0,.6)'; g.beginPath(); g.ellipse(24, 36, 11, 16, 0, 0, 7); g.fill(); g.beginPath(); g.arc(24, 21, 7, 0, 7); g.fill();
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 }));
      m.position.set(x, y, z); m.rotation.y = ry; m.translateZ(0.03); s.add(m);
    };
    frame(x0 + 0.03, 2.15, -2.4, Math.PI / 2, 0.7, 0.9, '#3a3024'); frame(x0 + 0.03, 2.05, 3.0, Math.PI / 2, 0.55, 0.7, '#2a3038');
    frame(-1.3, 2.05, z0 + 0.03, 0, 0.8, 1.0, '#40302a'); frame(x1 - 0.03, 2.25, -0.7, -Math.PI / 2, 0.6, 0.75, '#302a28'); frame(x1 - 0.03, 2.1, -3.4, -Math.PI / 2, 0.5, 0.65, '#2a2a30');
    // lustre apagado sobre a mesa
    { const ch = new THREE.Group(); const brass = M.brass;
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.7, 6), brass); rod.position.y = h - 0.35; ch.add(rod);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.018, 6, 28), brass); ring.rotation.x = Math.PI / 2; ring.position.y = h - 0.75; ch.add(ring);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const cnd = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.1, 6), M.paper); cnd.position.set(Math.cos(a) * 0.42, h - 0.69, Math.sin(a) * 0.42); ch.add(cnd); }
      ch.position.set(cx, 0, cz); s.add(ch); }
    // preenchimento muito fraco (lua pela janela que não se vê)
    s.add(new THREE.HemisphereLight(0x3a4458, 0x140e08, 1.1));
    const moon = new THREE.DirectionalLight(0x5a70a8, 0.25); moon.position.set(3, 4, 2); s.add(moon);
    // a criatura, parada no corredor (aparece de vez em quando)
    try {
      const cr = this.cr = buildCreature(M);
      cr.root.traverse(o => { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; });
      cr.root.position.set(DOOR.x + 0.05, 0, z0 - 1.4); cr.root.rotation.y = 0; // de frente para a sala (+Z)
      cr.root.visible = false; s.add(cr.root);
    } catch (e) { console.warn('criatura do menu indisponível', e); this.cr = null; }
    // poeira no ar (pontos macios, deriva no shader)
    s.add(this.dust = makeDust(260));
    this.resize(); this._onResize = () => this.resize(); window.addEventListener('resize', this._onResize);
    this.ready = true;
  }
  resize() {
    if (!this.renderer) return;
    const k = SCALES[this.scaleIdx];
    let w = Math.round(window.innerWidth * k), h = Math.round(window.innerHeight * k);
    if (w > MAX_W) { h = Math.round(h * MAX_W / w); w = MAX_W; }
    w = Math.max(200, w); h = Math.max(150, h);
    this.renderer.setSize(w, h, false);
    const a = w / h; this.camera.aspect = a;
    this.camera.fov = a < 1 ? 74 : a < 1.4 ? 62 : 52; // retrato: abre o campo para caber a sala
    this.camera.updateProjectionMatrix();
    if (this.dust) this.dust.material.uniforms.uPx.value = h * 0.9;
    if (this.frozen) this.renderOnce();
  }
  start() {
    if (this.running || !this.ready) return;
    this.running = true; this.last = performance.now();
    if (this.frozen) { this.renderOnce(); return; }
    if (window.__menuManual) { window.__menuStep = (dt) => { this.update(dt); this.renderer.render(this.scene, this.camera); if (!this.shown) { this.shown = true; this.onFirstFrame && this.onFirstFrame(); } }; return; } // capturas: passo fixo
    const loop = (now) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const el = now - this.last;
      if (el < 1000 / FPS - 2 && !window.__menuPreserve) return;
      this.last = now;
      const dt = Math.min(0.1, el / 1000);
      this.watchPerf(el);
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
      if (!this.shown) { this.shown = true; this.onFirstFrame && this.onFirstFrame(); }
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }
  renderOnce() { if (!this.ready) return; this.update(0); this.renderer.render(this.scene, this.camera); if (!this.shown) { this.shown = true; this.onFirstFrame && this.onFirstFrame(); } }
  // aparelho fraco: mede o intervalo real entre quadros (após aquecer) e economiza em degraus
  watchPerf(el) {
    const p = this.perf; if (this.frozen || window.__menuPreserve) return;
    if (this.t < 1.5) return; // compila shaders etc.
    if (el > 400) return;      // aba voltou do segundo plano
    p.n++; p.acc += el;
    if (p.n < 45) return;
    const avg = p.acc / p.n; p.n = 0; p.acc = 0;
    if (avg > 58) { // < ~17 FPS
      if (this.scaleIdx < SCALES.length - 1) { this.scaleIdx++; this.resize(); }
      else { this.frozen = true; this.stop(); this.running = true; console.info('[menu] cena 3D congelada (aparelho lento)'); }
    }
  }
  update(dt) {
    const t = (this.t += dt);
    setFxTime(t);
    // câmera: deriva lenta (laço longo, nunca parada)
    const cam = this.camera;
    cam.position.set(0.55 + Math.sin(t * 0.045) * 0.55, 1.58 + Math.sin(t * 0.11) * 0.05, 3.25 + Math.sin(t * 0.031) * 0.45);
    cam.lookAt(0.45 + Math.sin(t * 0.027 + 1) * 0.35, 1.22 + Math.sin(t * 0.07) * 0.06, -5.5);
    // velas e lareira
    let dip = 1;
    const g = this.ghost;
    if (g) { // "engasgo" da vela ao aparecer e ao sumir
      const a = g.t - 0, b = g.dur - g.t;
      const e = Math.min(a, b); if (e < 0.35) dip = 0.18 + 0.82 * Math.abs(Math.sin(e * 40)) * (e / 0.35);
    }
    const c1 = 0.82 + 0.1 * Math.sin(t * 11.3) * Math.sin(t * 6.1) + 0.06 * Math.sin(t * 23.7 + 1.2);
    this.candle.intensity = 4.5 * c1 * dip;
    this.fire.intensity = 7 * (0.78 + 0.12 * Math.sin(t * 9.1) * Math.sin(t * 5.3) + 0.07 * Math.sin(t * 17.7) + 0.03 * Math.sin(t * 31)) * (0.55 + 0.45 * dip);
    this.rim.intensity = 6 * (g ? 1.25 : 1) * (0.92 + 0.08 * Math.sin(t * 0.7));
    // aparição da criatura
    if (this.cr) {
      if (typeof window.__menuGhost === 'number') { this.nextGhost = Math.min(this.nextGhost, t + window.__menuGhost); window.__menuGhost = undefined; }
      if (!g && t >= this.nextGhost) this.ghost = { t: 0, dur: 2.4 + Math.random() * 1.4, yaw: (Math.random() - 0.5) * 0.5 };
      if (this.ghost) {
        const gh = this.ghost; gh.t += dt;
        const vis = gh.t > 0.12 && gh.t < gh.dur - 0.12;
        this.cr.root.visible = vis;
        try { this.cr.anim.update(Math.max(dt, 0.016), { anim: 'idle', animT: gh.t, speed: 0, headYaw: gh.yaw + Math.sin(gh.t * 0.9) * 0.12, headPitch: -0.12, yaw: 0, duck: 0 }); } catch { }
        if (gh.t >= gh.dur) { this.ghost = null; this.cr.root.visible = false; this.nextGhost = t + 18 + Math.random() * 14; }
      }
    }
    if (this.dust) this.dust.material.uniforms.uTime.value = t;
  }
  dispose() {
    this.stop(); window.removeEventListener('resize', this._onResize);
    try { this.renderer.dispose(); this.renderer.forceContextLoss(); } catch { }
    this.ready = false;
  }
}

// poeira: pontos espalhados na sala, flutuando devagar (tudo no shader, um draw call)
function makeDust(n) {
  const pos = [], sd = [];
  for (let i = 0; i < n; i++) {
    pos.push(ROOM.x0 + 0.3 + Math.random() * (ROOM.x1 - ROOM.x0 - 0.6), 0.2 + Math.random() * 2.9, -4.5 + Math.random() * 7.5);
    sd.push(Math.random());
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(sd, 1));
  g.computeBoundingSphere(); g.boundingSphere.radius += 1;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPx: { value: 400 } },
    vertexShader: /* glsl */`
      uniform float uTime; uniform float uPx; attribute float aSeed; varying float vA;
      void main(){
        vec3 p = position;
        float s = aSeed * 6.2831;
        p.x += sin(uTime * 0.13 + s * 3.0) * 0.25;
        p.y += sin(uTime * 0.09 + s * 5.0) * 0.18 - mod(uTime * 0.02 * (0.5 + aSeed), 0.6);
        p.z += cos(uTime * 0.11 + s * 2.0) * 0.25;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float d = -mv.z;
        vA = (0.35 + 0.65 * fract(aSeed * 17.3)) * smoothstep(0.4, 1.2, d) * (1.0 - smoothstep(6.0, 11.0, d)) * (0.6 + 0.4 * sin(uTime * (0.6 + aSeed) + s));
        gl_PointSize = clamp((0.007 + fract(aSeed * 7.7) * 0.008) * uPx / max(0.3, d), 1.0, 4.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying float vA;
      void main(){ float r = 1.0 - smoothstep(0.1, 0.5, length(gl_PointCoord - 0.5));
        gl_FragColor = vec4(vec3(1.0, 0.82, 0.6) * 0.3 * r * vA, r * vA);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const p = new THREE.Points(g, mat); p.renderOrder = 7; p.frustumCulled = false;
  return p;
}
