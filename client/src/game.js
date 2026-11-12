// Sessão de jogo no cliente: mundo 3D, jogador local (predição), colegas e criatura interpolados,
// interações, áudio posicional, HUD, espectador e painel de diagnóstico (modo teste).
import * as THREE from 'three';
import { setFxTime } from './render/fx.js';
import { generateFromParams } from '../../shared/mapgen.js';
import { World, cellOf } from '../../shared/world.js';
import { PLAYER, LEVELS, PHASES, CELL, T, W, D, GEN_VERSION, LIGHTING } from '../../shared/config.js';
import { buildMansion, LightPool, flicker } from './render/mansion.js';
import { updateExterior } from './render/exterior.js';
import { buildCreature } from './render/creature.js';
import { buildHand, HandAnimator } from './render/hand.js';
import { buildTeammate, animateTeammate, teammateFacing } from './render/human.js';
import { makeBeamCone, flashlightCookie } from './render/renderer.js';
import { buildKey } from './render/props.js';
import { storyPainting } from './story.js';
import { LEVEL_INFO } from '../../shared/sound.js';
import { headroomY } from '../../shared/ceiling.js';

// v2: marcadores vistos ATRAVÉS das paredes (sem teste de profundidade): porta de saída e "fantasminha"
function xrayMat(color, opacity = 0.8) { return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false }); }
function ghostTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 80; const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 30, 4, 32, 36, 38); g.addColorStop(0, 'rgba(235,245,255,0.95)'); g.addColorStop(1, 'rgba(160,190,255,0)');
  x.fillStyle = g; x.beginPath(); x.moveTo(8, 72); x.lineTo(8, 32); x.arc(32, 32, 24, Math.PI, 0); x.lineTo(56, 72);
  for (let i = 0; i < 4; i++) x.quadraticCurveTo(50 - i * 12, 62, 44 - i * 12, 72); x.closePath(); x.fill();
  x.fillStyle = 'rgba(20,24,40,0.9)'; x.beginPath(); x.arc(24, 32, 4, 0, 7); x.arc(40, 32, 4, 0, 7); x.fill();
  // chave pequena no "colo" do fantasma
  x.strokeStyle = 'rgba(255,255,255,1)'; x.lineWidth = 2.5; x.beginPath(); x.arc(26, 52, 4, 0, 7); x.moveTo(30, 52); x.lineTo(42, 52); x.moveTo(38, 52); x.lineTo(38, 56); x.stroke();
  return new THREE.CanvasTexture(c);
}

const smoothK = (t) => { const u = Math.max(0, Math.min(1, (t - 0.35) / 0.6)); return u * u * (3 - 2 * u); };
const lerpA = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; };
const ORD = ['primeira', 'segunda', 'terceira'];
const NAMES_KNOCK = { vase: 'vaso', bucket: 'balde de metal', bottles: 'garrafas', candelabrum: 'candelabro', box: 'caixinha' };

export class Game {
  constructor(app, msg) {
    this.app = app; this.R = app.renderer; this.net = app.net; this.audio = app.audio; this.ui = app.ui;
    this.myId = app.myId; this.test = !!msg.test;
    this.seed = msg.seed; this.phase = msg.phase; this.keysNeeded = msg.keysNeeded; this.names = msg.names || {}; this.looks = msg.looks || {};
    // v3: gera EXATAMENTE com os parâmetros que o servidor usou (msg.gen), sem padrões do cliente
    this.gen = msg.gen || (msg.state && msg.state.gen);
    if (!this.gen) throw new Error('o servidor não mandou os parâmetros do mapa (versões diferentes). Recarregue a página.');
    this.genVersionOk = this.gen.version === GEN_VERSION;
    this.map = generateFromParams(this.gen);
    // v3: cena "acordando" — parado até o servidor liberar ('begin')
    this.frozen = !!(msg.state && msg.state.pre); this.wakeCam = null;
    this.hashOk = this.genVersionOk && this.map.hash === msg.mapHash;
    this.world = new World(this.map);
    const M = app.M;
    this.view = buildMansion(this.map, this.world, M);
    this.R.scene.add(this.view.root);
    this.pool = new LightPool(this.R.scene, this.R.q.lights);
    // criatura
    this.cr = buildCreature(M); this.R.scene.add(this.cr.root); this.cr.root.visible = false;
    this.cr.anim.footCb = (foot, run) => this.creatureStep(foot, run);
    this.crState = null; this.crSnaps = [];
    // mão + lanterna
    this.hand = buildHand(M); this.R.handScene.add(this.hand.root); this.handAnim = new HandAnimator(this.hand);
    // preenchimento frontal suave na mão (luz da lanterna rebatida nas paredes) — a madeira não fica chapada de preto
    this.handFront = new THREE.DirectionalLight(0xffe6cc, 0); this.handFront.position.set(-0.35, 0.5, 1); this.R.handScene.add(this.handFront);
    // v9b: lanterna quente (~3500 K), mais fraca, decaimento físico (d²), penumbra macia, cookie com hotspot/poeira
    const FL = LIGHTING.flashlight;
    this.spot = new THREE.SpotLight(FL.color, 0, FL.distance, FL.angle, FL.penumbra, FL.decay);
    this.flCookie = flashlightCookie(); this.spot.map = this.R.q.shadows ? this.flCookie : null;
    this.flFlick = { next: FL.flickerEvery[0] + Math.random() * (FL.flickerEvery[1] - FL.flickerEvery[0]), until: 0, seed: Math.random() * 100 };
    this.spot.castShadow = this.R.q.shadows; this.spot.shadow.mapSize.set(this.R.q.shadowSize, this.R.q.shadowSize); this.spot.shadow.camera.near = 0.15; this.spot.shadow.bias = -0.0006; this.spot.shadow.normalBias = 0.02;
    // v4: a sombra da lanterna só considera 14 m (a luz vai até 28 m, mas lá longe já é fraca e a névoa cobre):
    // menos objetos entram no mapa de sombra a cada quadro. A única luz com sombra é a lanterna (luminárias sem sombra).
    { const sh = this.spot.shadow, up = sh.updateMatrices.bind(sh); sh.updateMatrices = (light) => { const d = light.distance; light.distance = Math.min(d || 14, 14); up(light); light.distance = d; }; }
    this.R.scene.add(this.spot); this.R.scene.add(this.spot.target);
    this.beam = makeBeamCone(7.5, 0.34, FL.beamStrength, FL.beamColor); this.R.scene.add(this.beam);
    this.R.onQualityChange = (q) => { this.spot.castShadow = q.shadows; this.spot.map = q.shadows ? this.flCookie : null; this.spot.shadow.mapSize.set(q.shadowSize, q.shadowSize); if (this.spot.shadow.map) { this.spot.shadow.map.dispose(); this.spot.shadow.map = null; } };
    // lanternas dos colegas (luzes fixas reaproveitadas)
    this.remoteSpots = [0, 1, 2].map(() => { const s = new THREE.SpotLight(FL.color, 0, 18, FL.angle, FL.penumbra, FL.decay); this.R.scene.add(s); this.R.scene.add(s.target); const c = makeBeamCone(6, 0.34, FL.beamStrength * 0.75, FL.beamColor); c.visible = false; this.R.scene.add(c); return { s, c }; });
    this.mates = new Map(); this.snaps = [];
    // espectador: luz de preenchimento suave em volta do colega observado (a figura inteira fica legível)
    this.specFill = new THREE.PointLight(0xc4ccdc, 0, 7, 1.4); this.R.scene.add(this.specFill);
    this.specRim = new THREE.PointLight(0x8090b0, 0, 5, 1.6); this.R.scene.add(this.specRim);
    // estado
    const you = msg.you || { x: this.map.spawns[0].x, z: this.map.spawns[0].z, level: 1, yaw: Math.PI, alive: true, escaped: false };
    this.p = { x: you.x, z: you.z, level: you.level, y: LEVELS[you.level].y, yaw: you.yaw, pitch: 0, vx: 0, vz: 0, crouchK: 0, jumpY: 0, vy: 0, grounded: true, stamina: PLAYER.staminaMax, exhausted: false, alive: you.alive !== false, escaped: !!you.escaped, fl: true, jumps: 0, lands: 0, stepAcc: 0, bob: 0 };
    this.keys = 0; this.myKeys = 0; this.deposited = 0; this.exitOpen = false; this.ended = false; this.paused = false;
    this.keyViews = []; this.foundBodies = new Set(); this.bodyKeys = new Map(); this.waves = []; this.lastAct = null;
    this.buildXray();
    this.sendAcc = 0; this.t = 0; this.ambT = 3; this.breathT = 0; this.heartT = 0; this.pantT = 0;
    this.spectate = null; this.deathT = null; this.deathCam = null;
    this.toasts = [];
    this.keyPresent = {};
    this.startTime = performance.now();
    this.applyFullState(msg.state);
    this.audio.occlusionFn = (pos) => this.occlusion(pos);
    this.lastYaw = this.p.yaw; this.lastPitch = this.p.pitch;
    window.__game = this;
  }
  dispose() {
    this.R.scene.remove(this.view.root, this.cr.root, this.spot, this.spot.target, this.beam, this.specFill, this.specRim);
    const hf = document.getElementById('hFl'); if (hf) hf.style.display = '';
    const vg = document.getElementById('vignette'); if (vg) vg.style.opacity = '';
    for (const r of this.remoteSpots) this.R.scene.remove(r.s, r.s.target, r.c);
    if (this.exitXray) this.R.scene.remove(this.exitXray);
    if (this.ghosts) for (const g of this.ghosts.values()) this.R.scene.remove(g);
    for (const l of this.pool.lights) this.R.scene.remove(l.l);
    for (const m of this.mates.values()) this.R.scene.remove(m.v.root);
    this.R.handScene.remove(this.hand.root, this.handFront);
    this.R.scene.traverse(o => { });
    if (window.__game === this) window.__game = null;
  }
  // ---------------- estado vindo do servidor ----------------
  applyFullState(s) {
    if (!s) return;
    s.doors.forEach((o, i) => { this.world.doorOpen[i] = o; const v = this.view.doors[i]; if (v) { v.open = !!o; v.cur = o ? 1 : 0; } });
    // v2: cada gaveta/porta de móvel tem seu estado
    (s.parts || []).forEach((arr, i) => { const v = this.view.containers[i]; if (!v) return; arr.forEach((o, j) => { const pt = v.parts[j]; if (pt) { pt.open = !!o; pt.cur = o ? 1 : 0; } }); });
    this.deposited = s.deposited || 0;
    for (const k of s.keys || []) this.setupKey(k);
    s.knocked.forEach((k, i) => { if (k) { const v = this.view.knockables[i]; v.knocked = true; v.t = 1; } });
    this.keys = s.keysCollected; this.exitOpen = s.exitOpen; this.world.exitOpen = s.exitOpen;
    if (this.exitOpen) { this.view.exit.open = true; }
    this.playersMeta = new Map((s.players || []).map(p => [p.id, p]));
    for (const p of s.players || []) { this.names[p.id] = p.name; if (p.id === this.myId) this.myKeys = p.keys || 0; else if (!p.alive) this.bodyKeys.set(p.id, p.keys || 0); }
  }
  onSnapshot(m) {
    const now = performance.now();
    this.snaps.push({ time: now, d: m });
    if (this.snaps.length > 40) this.snaps.shift();
    for (const sp of m.players) {
      if (sp.id === this.myId) continue;
      if (!this.mates.has(sp.id)) {
        const v = buildTeammate(this.app.M, this.mates.size + 1, this.looks[sp.id] || null); // v7: aparência escolhida (sem ela: cachecol na cor da vaga)
        this.R.scene.add(v.root);
        this.mates.set(sp.id, { v, last: sp, stepAcc: 0, px: sp.x, pz: sp.z, rx: sp.x, rz: sp.z, speed: 0 });
      }
    }
    this.lastSnap = m;
  }
  onCorrection(m) { this.p.x = m.x; this.p.z = m.z; this.p.level = m.level; this.p.vx = this.p.vz = 0; this.corrections = (this.corrections || 0) + 1; }
  onEvents(list) {
    for (const e of list) this.onEvent(e);
  }
  name(id) { return id === this.myId ? 'Você' : (this.names[id] || 'Jogador'); }
  onEvent(e) {
    const V = this.view;
    switch (e.type) {
      case 'door': { this.world.doorOpen[e.id] = e.open ? 1 : 0; const v = V.doors[e.id]; if (v) v.open = e.open; break; }
      case 'container': {
        const v = V.containers[e.id]; if (!v) break;
        const pt = v.parts[e.part || 0]; if (pt) pt.open = e.open;
        if (e.open && e.keys && e.keys.length && e.by === this.myId) this.toast('Uma chave! Mire nela e pressione E para pegar.', 'key');
        break;
      }
      case 'key': {
        const kv = this.keyViews[e.key]; if (kv) kv.state = 'carried';
        this.keys = e.count;
        if (e.by === this.myId) { this.myKeys = e.carried; this.toast(`Você pegou uma chave — você tem ${e.carried} chave${e.carried > 1 ? 's' : ''}.`, 'key'); this.handAnim.trigger('interact'); this.app.stats.keys = (this.app.stats.keys || 0) + 1; }
        else this.toast(`${e.name} pegou uma chave.`, 'key');
        break;
      }
      case 'deposit': {
        this.deposited = e.total;
        if (e.by === this.myId) this.myKeys = 0;
        this.toast(`${e.by === this.myId ? 'Você colocou' : e.name + ' colocou'} ${e.n} chave${e.n > 1 ? 's' : ''} na porta (${e.total}/${e.needed}).`, 'key');
        break;
      }
      case 'bodykeys': {
        this.bodyKeys.set(e.id, 0);
        if (e.by === this.myId) { this.myKeys = e.carried; this.toast(`Você pegou ${e.n} chave${e.n > 1 ? 's' : ''} com ${this.name(e.id)}.`, 'key'); }
        break;
      }
      case 'knock': {
        const v = V.knockables[e.id]; if (!v) break;
        if (e.state === 'wobble') { v.wobble = 1; break; }
        v.knocked = true;
        if (e.by === this.myId && e.how === 'esbarrou') this.toast('Você esbarrou em algo… barulho!', 'warn');
        break;
      }
      case 'go': this.wakeCam = { t0: performance.now(), dur: (e.intro || 8) * 1000 }; if (this.app.onWakeGo) this.app.onWakeGo(this, e.intro); break;
      case 'begin': this.frozen = false; this.wakeCam = null; if (this.app.onWakeEnd) this.app.onWakeEnd(this); break;
      case 'exit': this.exitOpen = true; this.world.exitOpen = true; V.exit.open = true; this.toast(`${e.by === this.myId ? 'Você destrancou' : e.name + ' destrancou'} a saída! Fujam!`, 'key'); break;
      case 'death': {
        // v2: a morte de um colega NÃO é anunciada — só quem achar o corpo fica sabendo.
        // Exceção: se ele levava chave, o corpo aparece como "fantasminha" através das paredes.
        if (e.id === this.myId) this.onMyDeath(e);
        else { const m = this.mates.get(e.id); if (m) m.dead = true; this.bodyKeys.set(e.id, e.keys || 0); if (e.keys) this.toast('Um brilho estranho apareceu na casa… (alguém deixou chaves)', 'warn'); }
        if (this.playersMeta.get(e.id)) this.playersMeta.get(e.id).alive = false;
        break;
      }
      case 'escaped': {
        if (this.playersMeta.get(e.id)) this.playersMeta.get(e.id).escaped = true;
        if (e.id === this.myId) { this.p.escaped = true; this.app.ui.showEscaped(); this.audio.play('win', null, { volume: 0.6 }); }
        else this.toast(`${e.name} escapou!`, 'key');
        break;
      }
      case 'disconnected': if (e.id !== this.myId) this.toast(`${e.name} perdeu a conexão…`, 'warn'); if (this.playersMeta.get(e.id)) this.playersMeta.get(e.id).conn = false; break;
      case 'reconnected': if (e.id !== this.myId) this.toast(`${e.name} voltou à partida.`, 'info'); if (this.playersMeta.get(e.id)) this.playersMeta.get(e.id).conn = true; break;
      case 'left': this.toast(`${e.name} saiu da partida.`, 'warn'); if (this.playersMeta.get(e.id)) this.playersMeta.get(e.id).left = true; { const m = this.mates.get(e.id); if (m) { this.R.scene.remove(m.v.root); this.mates.delete(e.id); } } break;
      case 'sound': {
        const pos = new THREE.Vector3(e.x, e.y, e.z);
        const name = e.sound;
        // onda na tela: barulhos meus, perto de mim, ou tão altos que a casa inteira ouve
        if (e.lvl) {
          const cam = this.R.camera.position;
          const near = Math.hypot(e.x - cam.x, e.z - cam.z) < 16 && Math.abs(e.level - (this.camLevel ?? this.p.level)) <= 1;
          if (e.by === this.myId || near || e.lvl === 'red') this.pushWave(e.lvl, e.by === this.myId);
        }
        if (name === 'step_run') break; // passos de corrida já tocam localmente / pela interpolação dos colegas
        if (name.startsWith('door_')) this.audio.play(name, pos, { close: false });
        else if (name === 'creak') this.audio.play('creak', pos, { volume: e.by === this.myId ? 0.9 : 1.1 });
        else this.audio.play(name, pos);
        break;
      }
      case 'csound': {
        const pos = new THREE.Vector3(e.x, e.y + 2.6, e.z);
        const map = { alert: 'clicks', hear: 'clicks', turn: 'clicks', roar: 'roar', sniff: 'sniff', sniff_found: 'growl', attack: 'attack', kill: 'kill' };
        if (map[e.kind]) this.audio.play(map[e.kind], pos, { volume: e.kind === 'turn' ? 0.6 : 1, refDistance: 3, maxDistance: 60 });
        break;
      }
    }
  }
  onMyDeath(e) {
    const p = this.p;
    p.alive = false; this.deathT = performance.now();
    this.deathCam = { yaw: p.yaw, pitch: p.pitch };
    // v6: agarrão em primeira pessoa — a vítima vê o rosto da criatura enquanto é erguida, depois cai no chão
    { const crp = this.cr.root.position; const near = this.cr.root.visible && Math.hypot(crp.x - p.x, crp.z - p.z) < 3.4;
      this.deathGrab = near ? { x0: p.x, y0: p.y + PLAYER.eye, z0: p.z } : null; }
    this.audio.play('stinger', null, { volume: 0.8 });
    this.app.stats.deaths = (this.app.stats.deaths || 0) + 1; this.app.saveStats();
    setTimeout(() => this.app.ui.showDeath(), this.deathGrab ? 3000 : 1400);
  }
  onEnd(m) {
    this.ended = true;
    const st = this.app.stats;
    const me = m.stats.players.find(x => x.id === this.myId);
    if (m.result === 'win') { st.wins = (st.wins || 0) + 1; st.phases = st.phases || {}; st.phases[this.phase] = (st.phases[this.phase] || 0) + 1; }
    if (me) { st.totalSurvival = (st.totalSurvival || 0) + me.survived; st.bestSurvival = Math.max(st.bestSurvival || 0, me.survived); }
    this.app.saveStats();
    // v6: deixa a cena da morte (agarrão + queda) terminar antes do placar
    const left = this.deathT ? (this.deathGrab ? 3200 : 1500) - (performance.now() - this.deathT) : 0;
    if (left > 0) setTimeout(() => this.app.ui.showEnd(m, this), left); else this.app.ui.showEnd(m, this);
    this.audio.play(m.result === 'win' ? 'win' : 'stinger', null, { volume: 0.7 });
  }
  // ---------------- oclusão de som ----------------
  occlusion(pos) {
    const cam = this.R.camera.position;
    const myL = this.camLevel ?? this.p.level;
    const srcL = this.levelAtY(pos.y, pos.x, pos.z);
    const o = this.world.soundAttenuation(myL, cam.x, cam.z, pos.x, pos.z);
    const ld = Math.abs(srcL - myL);
    const walls = o.walls + ld;
    const cutoff = walls === 0 ? (o.doors ? 2200 : 18000) : walls === 1 ? 1100 : walls === 2 ? 600 : 350;
    return { cutoff, gain: Math.pow(0.6, Math.min(4, walls)) * Math.pow(0.75, o.doors) };
  }
  levelAtY(y, x, z) { for (let L = 3; L >= 0; L--) if (y >= LEVELS[L].y - 0.3) return L; return 0; }
  // ---------------- laço por quadro ----------------
  update(dt) {
    this.t += dt;
    const p = this.p, R = this.R, inp = this.app.input, st = this.app.settings;
    const active = p.alive && !p.escaped && !this.ended;
    // ----- olhar (mouse) -----
    const m = inp.takeMouse();
    const wk = this.wakeK();
    if (active && !this.paused && (!this.frozen || wk > 0.8)) {
      const sens = 0.0022 * (st.sensitivity || 1);
      p.yaw -= m.x * sens; p.pitch -= m.y * sens * (st.invertY ? -1 : 1);
      p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch));
    }
    // ----- movimento -----
    let speed = 0;
    if (active) {
      const hold = this.paused || this.typing || this.frozen;
      const mv = hold ? { f: 0, s: 0 } : (this.scripted || inp.move());
      const crouch = !hold && (this.scriptCrouch ?? inp.crouch);
      const wantRun = !this.paused && (this.scriptRun ?? inp.run) && !crouch && mv.f > 0 && !p.exhausted;
      let target = crouch ? PLAYER.crouch : wantRun ? PLAYER.run : PLAYER.walk;
      if (mv.f < 0 && !crouch) target = Math.min(target, PLAYER.walk * 0.85);
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
      let dx = fx * mv.f + rx * mv.s, dz = fz * mv.f + rz * mv.s;
      const len = Math.hypot(dx, dz);
      if (len > 0) { dx /= len; dz /= len; }
      const k = Math.min(1, dt * (len > 0 ? 10 : 14));
      p.vx += (dx * target - p.vx) * k; p.vz += (dz * target - p.vz) * k;
      if (Math.hypot(p.vx, p.vz) < 0.02) { p.vx = 0; p.vz = 0; }
      const res = this.world.move(p.level, p.x, p.z, p.vx * dt, p.vz * dt, PLAYER.radius);
      const moved = Math.hypot(res.x - p.x, res.z - p.z);
      speed = moved / Math.max(dt, 1e-4);
      p.x = res.x; p.z = res.z; p.level = res.level;
      // fôlego
      const running = wantRun && speed > 3.4;
      p.running = running;
      if (running) { p.stamina -= dt; if (p.stamina <= 0) { p.stamina = 0; p.exhausted = true; this.toast('Sem fôlego!', 'warn'); } }
      else { p.stamina = Math.min(PLAYER.staminaMax, p.stamina + dt * PLAYER.staminaRegen); if (p.exhausted && p.stamina > 2) p.exhausted = false; }
      p.crouch = crouch;
      p.crouchK += ((crouch ? 1 : 0) - p.crouchK) * Math.min(1, dt * 9);
      // pulo
      if ((inp.down('Space') || this.scriptJump) && p.grounded && !crouch && !hold) { p.vy = PLAYER.jumpV; p.grounded = false; p.jumps++; this.scriptJump = false; }
      if (!p.grounded) {
        p.vy -= PLAYER.gravity * dt; p.jumpY += p.vy * dt;
        if (p.jumpY <= 0) { p.jumpY = 0; p.vy = 0; p.grounded = true; p.lands++; this.playStep(true); }
      }
      // passos locais
      p.stepAcc += moved;
      const stride = running ? 0.95 : crouch ? 0.55 : 0.75;
      p.stride = stride;
      if (p.stepAcc >= stride && p.grounded) { p.stepAcc = 0; p.stepN = (p.stepN || 0) + 1; this.playStep(false, running, crouch); }
      p.bob += moved * (running ? 2.4 : 3.2);
      p.speed = speed;
    }
    p.y = this.world.floorY(p.level, p.x, p.z);
    // ----- envio ao servidor (20 Hz) -----
    this.sendAcc += dt;
    if (this.sendAcc >= 0.05 && active && !this.frozen) {
      this.sendAcc = 0;
      this.net.send({ t: 'in', x: +p.x.toFixed(3), z: +p.z.toFixed(3), level: p.level, yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3), crouch: p.crouch, run: !!p.running, fl: p.fl, jump: p.jumps, land: p.lands });
    }
    // ----- interpolação -----
    this.interpolate(dt);
    // ----- câmera -----
    const cam = R.camera;
    let camLevel = p.level;
    if (active || (!p.alive && this.deathT && performance.now() - this.deathT < (this.deathGrab ? 3100 : 1500) && !this.spectate)) {
      const eye = PLAYER.eye + (PLAYER.crouchEye - PLAYER.eye) * p.crouchK;
      // balanço da câmera sincronizado com as pisadas (mais baixo no instante do passo)
      const stepPh = (p.stepN || 0) + (p.stepAcc || 0) / (p.stride || 0.75);
      this.bobW = (this.bobW || 0) + ((active && (p.speed || 0) > 0.2 ? Math.min(1, (p.speed || 0) / 2.6) : 0) - (this.bobW || 0)) * Math.min(1, dt * 6);
      const bob = -(0.5 + 0.5 * Math.cos(stepPh * Math.PI * 2)) * (p.running ? 0.045 : 0.03) * this.bobW;
      if (!p.alive && this.deathGrab) this.grabDeathCam(cam, (performance.now() - this.deathT) / 1000);
      else if (!p.alive) {
        const k = Math.min(1, (performance.now() - this.deathT) / 1200);
        cam.position.set(p.x, p.y + eye * (1 - k * 0.8) + 0.05, p.z);
        cam.rotation.set(this.deathCam.pitch * (1 - k) + 0.5 * k, this.deathCam.yaw, k * 1.2, 'YXZ');
        cam.position.x += (Math.random() - 0.5) * 0.06 * (1 - k); cam.position.y += (Math.random() - 0.5) * 0.06 * (1 - k);
      } else {
        // v3: acordando — começa caído/encolhido, olhando um pouco para cima, e vai se levantando
        const wl = this.wakeCam ? 1 - smoothK(wk) : (this.frozen ? 1 : 0);
        cam.position.set(p.x, p.y + eye + bob + p.jumpY - wl * 1.05, p.z);
        cam.rotation.set(p.pitch + wl * 0.42, p.yaw + wl * 0.25, wl * 0.32, 'YXZ');
      }
    } else {
      // espectador: segue um sobrevivente
      camLevel = this.spectatorCam(dt);
    }
    this.camLevel = camLevel;
    this.updateSpecFill(dt);
    // ----- visibilidade por andar / neblina -----
    for (let L = 0; L < 4; L++) this.view.levels[L].visible = Math.abs(L - camLevel) <= 1;
    const fogD = LIGHTING.fog.density[camLevel] ?? LIGHTING.fog.density[1]; // v9b: névoa escura densa (config)
    R.scene.fog.density += (fogD - R.scene.fog.density) * Math.min(1, dt * 2);
    // ----- luzes -----
    this.pool.update(dt, this.t, cam.position, camLevel, this.view.lamps);
    for (const lp of this.view.flickerMeshes) { const f = flicker(lp, this.t); if (lp.bulb) lp.bulb.material.emissiveIntensity = 1.6 * f; if (lp.bulbs) lp.bulbs[0].material.emissiveIntensity = 1.6 * f; }
    setFxTime(this.t); // v5: fogo, brasas, faíscas e céu das janelas
    updateExterior(this.view.exterior, cam, this.t); // v6: céu segue a câmera; postes piscando
    for (const fl of this.view.flames) { fl.scale.y = 0.8 + 0.3 * Math.sin(this.t * 11 + fl.id) * Math.sin(this.t * 4.3 + fl.id); fl.rotation.y += dt * 0.6; }
    // ----- lanterna local -----
    const showHand = active && (!this.frozen || wk > 0.85);
    this.hand.root.visible = showHand;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const lensPos = cam.position.clone().addScaledVector(right, 0.12).addScaledVector(up, -0.1).addScaledVector(fwd, 0.05);
    const flOn = p.fl && active;
    // lanterna perto de superfície (bilhete, quadro, parede, mesa a menos de ~1,5 m): reduz a intensidade
    // na proporção do quadrado da distância, para a luz não "estourar" em branco quando se chega perto para ler
    if (flOn) {
      const d = this.flashNearDist(cam.position, fwd, camLevel);
      const nd = LIGHTING.flashlight.nearDim, target = Math.max(0.1, Math.min(1, (d / nd) * (d / nd)));
      this.flK = (this.flK ?? 1) + (target - (this.flK ?? 1)) * Math.min(1, dt * 10);
    }
    this.spot.intensity = flOn ? LIGHTING.flashlight.intensity * (this.spot.map ? 1 : 0.8) * (this.flK ?? 1) * this.flashFlicker(dt) : 0;
    this.spot.position.copy(lensPos);
    this.spot.target.position.copy(cam.position).addScaledVector(fwd, 10).addScaledVector(right, -0.25);
    this.beam.visible = flOn;
    this.beam.position.copy(lensPos); this.beam.lookAt(this.spot.target.position); this.beam.rotateY(Math.PI); this.beam.material.uniforms.uTime.value = this.t;
    // mão: luz que incide sobre ela (lâmpadas próximas + respingo da lanterna)
    let nearest = null, nd = 1e9; for (const s of this.pool.lights) { if (!s.lamp) continue; const d = s.l.position.distanceTo(cam.position); if (d < nd) { nd = d; nearest = s; } }
    R.handSpill.intensity = flOn ? 0.9 : 0; R.handKey.intensity = nearest ? Math.min(1.3, 0.12 + nearest.l.intensity * 0.6 / (1 + nd * nd * 0.15)) : 0.12;
    if (nearest) { R.handKey.color.copy(nearest.l.color); const dir = nearest.l.position.clone().sub(cam.position).applyQuaternion(cam.quaternion.clone().invert()).normalize(); R.handKey.position.copy(dir); }
    R.handHemi.intensity = (camLevel === 0 ? 0.5 : 0.7) * (flOn ? 1 : 0.6);
    this.handFront.intensity = flOn ? 0.85 : 0.18;
    const yawVel = (lerpA(this.lastYaw, p.yaw, 1) - this.lastYaw) / Math.max(dt, 1e-3), pitchVel = (p.pitch - this.lastPitch) / Math.max(dt, 1e-3);
    this.lastYaw = p.yaw; this.lastPitch = p.pitch;
    this.handAnim.update(dt, { speed: active ? (p.speed || 0) : 0, running: p.running, crouch: p.crouch, on: p.fl, yawVel, pitchVel, dead: !p.alive, stepPhase: (p.stepN || 0) + (p.stepAcc || 0) / (p.stride || 0.75) });
    // ----- animação de portas, recipientes, objetos -----
    this.animateWorld(dt);
    this.updateXray(dt); this.updateReader();
    this.drawWave();
    // ----- interação -----
    this.target = active && !this.paused && !this.frozen ? this.findTarget() : null;
    this.ui.setPrompt(this.target ? this.target.text : '');
    // ----- áudio -----
    this.audio.setListener(cam.position, fwd, up);
    this.ambientAudio(dt);
    // ----- HUD -----
    this.ui.updateHud(this);
    // espectador: sem rótulo da lanterna e sem o vermelho da morte depois que a tela de morte foi fechada
    const spectating = !p.alive || p.escaped;
    const hf = document.getElementById('hFl'); if (hf) hf.style.display = spectating ? 'none' : '';
    const vg = document.getElementById('vignette');
    if (vg) {
      const deathOpen = !document.getElementById('death')?.classList.contains('hidden');
      const recent = this.deathT && performance.now() - this.deathT < 1600;
      if (!p.alive && !deathOpen && !recent) vg.classList.remove('hurt');
      vg.style.opacity = !p.alive && !deathOpen && !recent ? '0.6' : '';
    }
  }
  // v6: câmera da morte com agarrão (a cabeça da criatura é lida do esqueleto animado)
  grabDeathCam(cam, t) {
    const G = this.deathGrab, b = this.cr.bones.find(o => o.name === 'head');
    this.cr.root.updateMatrixWorld(true);
    const head = new THREE.Vector3(0, 0.0, 0.18); b.localToWorld(head);
    const crp = this.cr.root.position, fw = new THREE.Vector3(Math.sin(this.cr.root.rotation.y), 0, Math.cos(this.cr.root.rotation.y));
    const sh = (a) => (Math.sin(t * 37 + a) * 0.6 + Math.sin(t * 23 + a * 2) * 0.4);
    let pos;
    if (t < 1.45) {
      // erguido até o rosto dela: 0,55 m à frente da cabeça, um pouco abaixo, tremendo
      const u = Math.min(1, t / 0.45), e = u * u * (3 - 2 * u);
      const hold = head.clone().addScaledVector(fw, 0.6); hold.y -= 0.36;   // um pouco abaixo: ela inclina a cabeça e encara de cima
      pos = new THREE.Vector3(G.x0, G.y0, G.z0).lerp(hold, e);
      const amp = 0.025 + 0.03 * Math.min(1, t);
      pos.x += sh(1) * amp; pos.y += sh(2) * amp; pos.z += sh(3) * amp;
      G.relPos = pos.clone();
      const face = head.clone().addScaledVector(fw, 0.18); face.y -= 0.1;
      cam.position.copy(pos); cam.up.set(0, 1, 0); cam.lookAt(face); cam.rotateZ(sh(4) * 0.06);
    } else {
      // solto: cai até o chão, rola de lado e fica olhando para cima, para ela
      const u = Math.min(1, (t - 1.45) / 0.55), fall = u * u;
      const floorY = this.p.y + 0.22;
      const start = G.relPos || head;
      pos = start.clone().addScaledVector(fw, 0.5 * u); pos.y = start.y + (floorY - start.y) * fall;
      if (u >= 1) { const b2 = Math.max(0, 1 - (t - 2.0) * 6); pos.y += Math.abs(Math.sin((t - 2.0) * 18)) * 0.05 * b2; }
      cam.position.copy(pos); cam.up.set(0, 1, 0); cam.lookAt(head); cam.rotateZ(1.15 * Math.min(1, u * 1.2));
    }
    this.hand.root.visible = false;
  }
  // progresso da cena de acordar (0 → 1); 1 quando não há cena
  wakeK() { if (!this.wakeCam) return this.frozen ? 0 : 1; return Math.max(0, Math.min(1, (performance.now() - this.wakeCam.t0) / this.wakeCam.dur)); }
  toggleFlashlight() {
    if (!this.p.alive || this.p.escaped) return;
    this.p.fl = !this.p.fl;
    this.handAnim.trigger('click');
    this.audio.play('flashlight', null, { volume: 0.8 });
  }
  interact() {
    if (this.reading) { this.closeReader(); return; }
    if (!this.target || !this.p.alive) return;
    const tg = this.target;
    // v2 fase 2: ler bilhetes/livros e olhar quadros é só do lado do cliente (não faz barulho)
    if (tg.kind === 'read' || tg.kind === 'painting') { this.openReader(tg); return; }
    this.handAnim.trigger('interact');
    if (tg.kind === 'exit' && !tg.can) { this.toast(tg.text, 'warn'); return; }
    // anti-repique: o mesmo alvo não é acionado de novo em menos de 0,45 s
    const sig = tg.req + ':' + tg.id + ':' + (tg.part ?? '') + ':' + (tg.key ?? '');
    const now = performance.now();
    if (this.lastAct && this.lastAct.sig === sig && now - this.lastAct.t < 450) return;
    this.lastAct = { sig, t: now };
    const msg = { t: 'act', kind: tg.req, id: tg.id };
    if (tg.kind === 'door') { msg.open = !this.view.doors[tg.id].open; this.view.doors[tg.id].open = msg.open; } // envia o estado DESEJADO e já começa a animar
    if (tg.kind === 'container') { msg.part = tg.part; const pt = this.view.containers[tg.id].parts[tg.part]; msg.open = !pt.open; pt.open = msg.open; }
    if (tg.kind === 'key') msg.key = tg.key;
    this.net.send(msg);
  }
  onInteractResult(m) {
    if (!m.ok && m.msg) this.toast(m.msg, 'warn');
    // pedido recusado: desfaz a animação adiantada
    if (!m.ok && m.req === 'door' && this.view.doors[m.id]) this.view.doors[m.id].open = !!this.world.doorOpen[m.id];
    if (m.req === 'container' && this.view.containers[m.id] && m.part !== undefined && typeof m.open === 'boolean') this.view.containers[m.id].parts[m.part].open = m.open;
  }
  findTarget() {
    const cam = this.R.camera;
    const ray = new THREE.Ray(cam.position.clone(), new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion));
    let best = null, bd = 2.3;
    const hit = new THREE.Vector3();
    const consider = (it, maxD = 2.3) => {
      const h = ray.intersectBox(it.box, hit);
      if (!h) return;
      const d = h.distanceTo(cam.position);
      // gavetas do MESMO móvel: olhando de cima para a gaveta de baixo, o raio entra antes na caixa da gaveta de cima;
      // entre partes do mesmo móvel vale a que tem o centro mais perto da linha da mira (o pontinho)
      if (it.kind === 'container' && best && best.kind === 'container' && best.id === it.id && d < maxD && Math.abs(d - bd) < 0.45) {
        if (ray.distanceToPoint(it.box.getCenter(new THREE.Vector3())) < ray.distanceToPoint(best.box.getCenter(new THREE.Vector3()))) { bd = Math.min(bd, d); best = it; }
        return;
      }
      // chave aberta à vista tem prioridade sobre o móvel onde está (pendurada no fundo do guarda-roupa: até 0,6 m atrás da porta)
      if (d < Math.min(bd, maxD) || (it.kind === 'key' && d < maxD && best && best.kind === 'container' && d < bd + 0.6)) { bd = d; best = it; }
    };
    for (const it of this.view.interact) {
      if (it.level !== this.p.level) continue;
      const c = it.box.getCenter(hit);
      if (c.distanceTo(cam.position) > 4) continue;
      consider(it);
    }
    // chaves visíveis (prioridade sobre a gaveta onde estão) e corpos de colegas com chaves
    for (const kv of this.keyViews) {
      if (!kv || !kv.mesh.visible || kv.level !== this.p.level) continue;
      kv.mesh.getWorldPosition(hit);
      const box = new THREE.Box3().setFromCenterAndSize(hit.clone(), new THREE.Vector3(0.32, 0.25, 0.32));
      consider({ kind: 'key', key: kv.id, box }, 2.6);
    }
    for (const [id, n] of this.bodyKeys) {
      if (!n) continue; const m = this.mates.get(id); if (!m || !m.v.root.visible) continue;
      const pos = m.v.root.position;
      if (Math.abs(pos.y - this.p.y) > 1.5) continue;
      const box = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(pos.x, pos.y + 0.4, pos.z), new THREE.Vector3(1.2, 1.0, 1.2));
      consider({ kind: 'body', id, box }, 2.4);
    }
    if (!best) return null;
    const V = this.view;
    if (best.kind === 'read') { const nt = this.view.notes[best.id].note; return { kind: 'read', id: best.id, text: `[E] Ler — ${nt.title}` }; }
    if (best.kind === 'painting') return { kind: 'painting', id: best.id, text: `[E] Olhar o quadro — "${this.view.paintings[best.id].title}"` };
    if (best.kind === 'key') return { kind: 'key', req: 'key', id: null, key: best.key, text: '[E] Pegar chave' };
    if (best.kind === 'body') return { kind: 'body', req: 'body', id: best.id, text: `[E] Pegar as chaves de ${this.name(best.id)}` };
    if (best.kind === 'container') {
      const c = V.containers[best.id]; const pt = c.parts[best.part || 0];
      return { kind: 'container', req: 'container', id: best.id, part: best.part || 0, text: `[E] ${pt.open ? 'Fechar' : 'Abrir'} ${pt.label}` };
    }
    if (best.kind === 'door') {
      const d = V.doors[best.id];
      const extra = d.type === 'rusty' ? ' (enferrujada — barulho médio)' : d.type === 'heavy' ? ' (pesada — barulho médio)' : '';
      return { kind: 'door', req: 'door', id: best.id, text: `[E] ${d.open ? 'Fechar' : 'Abrir'} porta${extra}` };
    }
    if (best.kind === 'knock') {
      const k = V.knockables[best.id]; if (k.knocked) return null;
      return { kind: 'knock', req: 'knock', id: best.id, text: `[E] Derrubar ${NAMES_KNOCK[k.kind]} (faz barulho — distrai a criatura)` };
    }
    if (best.kind === 'exit') {
      if (this.exitOpen) return null;
      const can = this.myKeys > 0;
      return { kind: 'exit', req: 'exit', id: 0, can, text: can ? `[E] Colocar ${this.myKeys} chave${this.myKeys > 1 ? 's' : ''} na porta (${this.deposited}/${this.keysNeeded})` : `Porta trancada — ${this.deposited}/${this.keysNeeded} chaves colocadas. Você não tem chaves.` };
    }
    return null;
  }
  // ---------------- v2 fase 2: leitor de bilhetes / quadros ----------------
  // Abrir não pausa o jogo: ler parado no meio da casa é exatamente o tipo de risco que o jogo quer.
  openReader(tg) {
    const el = document.getElementById('reader'); if (!el) return;
    el.className = '';
    if (tg.kind === 'read') {
      const nt = this.view.notes[tg.id].note;
      el.classList.add('t-' + nt.type);
      el.querySelector('.rd-title').textContent = nt.title;
      el.querySelector('.rd-text').textContent = nt.text;
      el.querySelector('.rd-img').style.display = 'none';
      this.audio.play('paper', null, { volume: 0.5 });
    } else {
      const pt = this.view.paintings[tg.id];
      el.classList.add('t-painting');
      el.querySelector('.rd-title').textContent = pt.title;
      el.querySelector('.rd-text').textContent = '';
      const img = el.querySelector('.rd-img'); img.style.display = 'block';
      const tx = storyPainting(pt.v); img.src = tx.image.toDataURL();
    }
    this.reading = { x: this.p.x, z: this.p.z, kind: tg.kind, id: tg.id };
    const pr = document.getElementById('prompt'); if (pr) pr.style.visibility = 'hidden'; // o aviso [E] não aparece por trás do papel
    this.app.stats.notes = (this.app.stats.notes || 0) + (tg.kind === 'read' ? 1 : 0);
  }
  closeReader() { const el = document.getElementById('reader'); if (el) el.className = 'hidden'; this.reading = null; const pr = document.getElementById('prompt'); if (pr) pr.style.visibility = ''; }
  updateReader() { // fecha sozinho se você se afastar ou morrer
    if (this.reading && (!this.p.alive || Math.hypot(this.p.x - this.reading.x, this.p.z - this.reading.z) > 1.2)) this.closeReader();
  }
  // ---------------- v2: chaves, marcadores através das paredes, onda de som ----------------
  setupKey(k) {
    let kv = this.keyViews[k.id];
    if (!kv) {
      const mesh = buildKey(this.app.M);
      const o = k.spot;
      if (o.type === 'part') {
        const pt = this.view.containers[o.c] && this.view.containers[o.c].parts[o.part];
        const cv = this.view.containers[o.c];
        if (pt && pt.anchor) {
          // v3: guarda-roupas/armários — chave pendurada num ganchinho no meio, armário vazio (sem roupas)
          if (pt.hang) { mesh.rotation.set(0, 0, -Math.PI / 2); mesh.position.set(0, 0, 0); if (cv.hook) cv.hook.visible = true; if (cv.clothes) { cv.clothes.removeFromParent(); cv.clothes = null; } }
          else mesh.rotation.set(-Math.PI / 2, 0, 0.6);
          pt.anchor.add(mesh);
        }
        if (cv) cv.hasKey = true;
        kv = { id: k.id, mesh, spot: o, level: this.map.containers[o.c].level, part: pt };
      } else {
        const sf = this.map.surfaces[o.s];
        mesh.rotation.set(-Math.PI / 2, 0, (sf.id * 1.7) % 6.28);
        // v2 fase 2: a chave se APOIA no que estiver no tampo (livro, prato, papel) em vez de atravessar —
        // raios de cima para baixo na argola, no meio e na ponta da chave; fica na maior altura encontrada
        let top = sf.y;
        const lvl = this.view.levels[sf.level]; lvl.updateMatrixWorld(true);
        const rc = new THREE.Raycaster(); rc.camera = this.app.renderer.camera; const ang = (sf.id * 1.7) % 6.28; // halos (Sprite) exigem câmera no raio
        for (const u of [-0.01, 0.02, 0.05]) {
          const px = sf.x + Math.cos(ang) * u, pz = sf.z - Math.sin(ang) * u;
          rc.set(new THREE.Vector3(px, sf.y + 0.6, pz), new THREE.Vector3(0, -1, 0)); rc.far = 0.7;
          const hit = rc.intersectObjects(lvl.children, true).find(h => h.object.isMesh && !h.object.isSprite);
          if (hit && hit.point.y < sf.y + 0.12) top = Math.max(top, hit.point.y); // só itens baixos (livro, prato, papel)
        }
        mesh.position.set(sf.x, top + 0.004, sf.z);
        lvl.add(mesh);
        kv = { id: k.id, mesh, spot: o, level: sf.level, part: null };
      }
      this.keyViews[k.id] = kv;
    }
    kv.state = k.state;
  }
  buildXray() {
    // porta de saída vista através das paredes quando você carrega uma chave
    const e = this.map.exit, half = e.cells.length * CELL / 2, dh = Math.min(LEVELS[1].h - 0.45, 2.75);
    const g = new THREE.Group(); g.renderOrder = 999;
    const mat = xrayMat(0xfff2d0, 0.85);
    const bar = (w, h, x, y) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(x, y, 0); m.renderOrder = 999; g.add(m); };
    bar(half * 2 + 0.2, 0.06, 0, dh); bar(half * 2 + 0.2, 0.06, 0, 0.03); bar(0.06, dh, -half - 0.07, dh / 2); bar(0.06, dh, half + 0.07, dh / 2);
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, dh), xrayMat(0xffd890, 0.12)); fill.position.set(0, dh / 2, 0); fill.renderOrder = 998; g.add(fill);
    g.position.set(e.x, LEVELS[1].y, CELL * 0.9);
    g.visible = false; this.R.scene.add(g); this.exitXray = g; this.exitXrayMat = mat; this.exitXrayFill = fill.material;
    // fantasminhas (corpos com chaves)
    this.ghostTex = ghostTexture(); this.ghosts = new Map();
  }
  ghostFor(id) {
    if (!this.ghosts.has(id)) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.ghostTex, transparent: true, depthTest: false, depthWrite: false, opacity: 0.85 }));
      sp.scale.set(0.6, 0.75, 1); sp.renderOrder = 1000; this.R.scene.add(sp); this.ghosts.set(id, sp);
    }
    return this.ghosts.get(id);
  }
  updateXray(dt) {
    const t = this.t;
    const showExit = this.myKeys > 0 && !this.exitOpen && this.p.alive && !this.p.escaped;
    this.exitXray.visible = showExit;
    if (showExit) { const k = 0.55 + 0.3 * Math.sin(t * 2.4); this.exitXrayMat.opacity = k; this.exitXrayFill.opacity = 0.08 + 0.06 * Math.sin(t * 2.4); }
    // fantasminha: corpo de colega morto que ainda tem chaves (o próprio morto não vê o seu)
    const snapP = this.lastSnap ? this.lastSnap.players : [];
    for (const sp of snapP) {
      if (sp.id === this.myId) continue;
      const n = sp.alive ? 0 : (sp.k ?? this.bodyKeys.get(sp.id) ?? 0);
      if (!sp.alive) this.bodyKeys.set(sp.id, n);
      const show = n > 0 && !sp.alive && !this.ended;
      if (!show && !this.ghosts.has(sp.id)) continue;
      const gh = this.ghostFor(sp.id);
      gh.visible = show;
      if (show) { gh.position.set(sp.x, sp.y + 1.1 + Math.sin(t * 1.8 + sp.x) * 0.12, sp.z); gh.material.opacity = 0.6 + 0.25 * Math.sin(t * 3.1); }
    }
    // achar o corpo de um colega (sem chaves, a morte não é anunciada): perto e com linha de visão
    if (this.p.alive) for (const sp of snapP) {
      if (sp.id === this.myId || sp.alive || this.foundBodies.has(sp.id)) continue;
      const d = Math.hypot(sp.x - this.p.x, sp.z - this.p.z);
      if (d < 7 && sp.level === this.p.level && this.world.lineOfSight(this.p.level, this.p.x, this.p.z, sp.x, sp.z)) {
        this.foundBodies.add(sp.id); this.toast(`Você encontrou o corpo de ${this.name(sp.id)}…`, 'death'); this.audio.play('stinger', null, { volume: 0.45 });
      }
    }
    // v3: brilho DOURADO pulsante, só quando a chave está no campo de visão da câmera (e perto o bastante)
    const cam = this.R.camera; cam.updateMatrixWorld();
    this._pm = (this._pm || new THREE.Matrix4()).multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const fr = (this._fr || (this._fr = new THREE.Frustum())).setFromProjectionMatrix(this._pm);
    const wp = this._kp || (this._kp = new THREE.Vector3());
    for (const kv of this.keyViews) {
      if (!kv) continue;
      const vis = kv.state === 'placed' && (!kv.part || (kv.part.open && kv.part.cur > 0.35));
      kv.mesh.visible = vis;
      const halo = kv.mesh.userData.halo; if (!halo) continue;
      let on = false;
      if (vis) { kv.mesh.getWorldPosition(wp); const d = wp.distanceTo(cam.position); on = d < 14 && fr.containsPoint(wp); if (on) { const pulse = 0.5 + 0.5 * Math.sin(t * 3.0 + kv.id * 1.7); halo.material.opacity = 0.4 + 0.5 * pulse; const sc = Math.min(0.34, 0.08 + d * 0.03) * (0.9 + 0.2 * pulse); halo.scale.set(sc, sc, 1); halo.material.rotation = t * 0.35 + kv.id; } }
      halo.visible = on;
    }
    if (this.app.M.keyGold) { this.app.M.keyGold.emissive.setHex(0xffa628); this.app.M.keyGold.emissiveIntensity = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 3.0)); }
  }
  pushWave(lvl, mine) {
    this.waves.push({ lvl, t0: this.t, mine });
    if (this.waves.length > 8) this.waves.shift();
  }
  // Onda estilo rádio, sombria: amplitude cai com o tempo; a cor é a do som mais alto ainda ativo
  drawWave() {
    const cv = this.waveCv || (this.waveCv = document.getElementById('wave'));
    if (!cv) return;
    const g = cv.getContext('2d'), W2 = cv.width, H2 = cv.height, t = this.t;
    g.clearRect(0, 0, W2, H2);
    this.waves = this.waves.filter(w => t - w.t0 < 1.8);
    let top = null, amp = 0;
    for (const w of this.waves) {
      const r = LEVEL_INFO[w.lvl].rank, a = (1 - (t - w.t0) / 1.8) * (r / 3);
      if (!top || r > LEVEL_INFO[top.lvl].rank) top = w;
      amp = Math.max(amp, a);
    }
    const color = top ? LEVEL_INFO[top.lvl].color : 'rgba(150,160,170,0.35)';
    g.lineWidth = 2; g.strokeStyle = color; g.shadowColor = color; g.shadowBlur = top ? 12 : 0;
    g.beginPath();
    for (let x = 0; x <= W2; x += 2) {
      const u = x / W2, env = Math.sin(u * Math.PI);
      const n = Math.sin(u * 38 + t * 22) * 0.6 + Math.sin(u * 91 - t * 31) * 0.3 + Math.sin(u * 7 + t * 5) * 0.4;
      const y = H2 / 2 + n * env * (2 + amp * (H2 * 0.45));
      if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke(); g.shadowBlur = 0;
    if (top && amp > 0.05) { g.fillStyle = color; g.font = 'bold 10px monospace'; g.textAlign = 'center'; g.fillText(LEVEL_INFO[top.lvl].name, W2 / 2, 11); }
  }
  animateWorld(dt) {
    const V = this.view;
    for (const d of V.doors) {
      if (!d) continue;
      const tgt = d.open ? 1 : 0;
      if (Math.abs(d.cur - tgt) < 0.001) continue;
      d.cur += Math.sign(tgt - d.cur) * Math.min(Math.abs(tgt - d.cur), dt * 1.6);
      const e = d.cur * d.cur * (3 - 2 * d.cur);
      for (const lf of d.leaves) lf.pv.rotation.y = lf.side * -1 * d.swing * e * 1.65 * -1;
    }
    for (const cv of V.containers) {
      if (!cv) continue;
      // v3: roupas só são desenhadas com a porta aberta (menos chamadas de desenho com tudo fechado)
      if (cv.clothes) { const op = cv.parts[0].cur > 0.01 || cv.parts[0].open; if (cv.clothes.visible !== op) cv.clothes.visible = op; }
      for (const c of cv.parts) {
        const tgt = c.open ? 1 : 0;
        if (Math.abs(c.cur - tgt) < 0.001) continue;
        c.cur += Math.sign(tgt - c.cur) * Math.min(Math.abs(tgt - c.cur), dt * 2.5);
        const e = c.cur * c.cur * (3 - 2 * c.cur);
        if (c.type === 'drawer') c.part.position.z = (c.part.userData.z0 ??= c.part.position.z) + e * c.amount;
        else if (c.type === 'door') { c.part.rotation.y = e * c.amount; if (c.extra) c.extra.rotation.y = -e * c.amount * 0.9; }
        else if (c.type === 'lid') c.part.rotation.x = e * c.amount;
      }
    }
    for (const k of V.knockables) {
      // balanço (esbarrão leve): oscila e para
      if (k && !k.knocked && k.wobble > 0) { k.wobble = Math.max(0, k.wobble - dt * 0.8); k.g.rotation.x = Math.sin(this.t * 18) * 0.14 * k.wobble; k.g.rotation.z = Math.cos(this.t * 15) * 0.1 * k.wobble; }
      if (!k || !k.knocked || k.t >= 1) { if (k && k.knocked && k.t >= 1 && !k.done) { k.done = true; k.g.rotation.set(Math.PI / 2, k.rot, 0); k.g.position.y = LEVELS[k.level].y + 0.08; } continue; }
      k.t = Math.min(1, k.t + dt * 2.5);
      k.g.rotation.x = k.t * Math.PI / 2; k.g.position.y = LEVELS[k.level].y + 0.08 * k.t;
      if (k.kind === 'vase' && k.t >= 1) k.g.scale.set(1, 0.5, 1);
    }
    const ex = V.exit;
    if (ex) {
      for (let i = 0; i < ex.locks.length; i++) ex.locks[i].visible = i < (this.keysNeeded - this.deposited) && !this.exitOpen;
      ex.chain.visible = !this.exitOpen;
      const tgt = ex.open ? 1 : 0;
      ex.cur += Math.sign(tgt - ex.cur) * Math.min(Math.abs(tgt - ex.cur), dt * 0.6);
      for (const lf of ex.leaves) lf.pv.rotation.y = lf.side * ex.cur * 1.5;
    }
  }
  // ---------------- colegas e criatura ----------------
  sampleSnaps(renderT) {
    const s = this.snaps;
    if (!s.length) return null;
    let a = s[0], b = s[s.length - 1];
    for (let i = 0; i < s.length - 1; i++) if (s[i].time <= renderT && s[i + 1].time >= renderT) { a = s[i]; b = s[i + 1]; break; }
    const k = b.time === a.time ? 1 : Math.max(0, Math.min(1, (renderT - a.time) / (b.time - a.time)));
    return { a: a.d, b: b.d, k };
  }
  interpolate(dt) {
    const sm = this.sampleSnaps(performance.now() - 110);
    if (!sm) return;
    const { a, b, k } = sm;
    // criatura
    const ca = a.creature, cb = b.creature;
    if (cb) {
      const c = this.cr.root;
      c.visible = Math.abs(cb.level - (this.camLevel ?? this.p.level)) <= 1;
      c.position.set(ca.x + (cb.x - ca.x) * k, ca.y + (cb.y - ca.y) * k, ca.z + (cb.z - ca.z) * k);
      c.rotation.y = lerpA(ca.yaw, cb.yaw, k);
      // v9b: altura livre (vergas de porta/arco, teto, telhado do sótão) em volta e ~1,4 m à frente → a criatura,
      // sempre ereta, só se abaixa o necessário para passar (o animador mede o alto da cabeça e compara)
      const L = cb.level, sp2 = Math.hypot(cb.x - ca.x, cb.z - ca.z), fdx = sp2 > 1e-4 ? (cb.x - ca.x) / sp2 : -Math.sin(c.rotation.y) * 0, fdz = sp2 > 1e-4 ? (cb.z - ca.z) / sp2 : 0;
      const hdx = sp2 > 1e-4 ? fdx : Math.sin(c.rotation.y), hdz = sp2 > 1e-4 ? fdz : Math.cos(c.rotation.y);
      this.crHeadroom = headroomY(this.map, L, c.position.x, c.position.z, hdx, hdz) - c.position.y;
      // v6: o corpo da criatura (cabeça, mãos, ombros) se projeta ~0,9 m à frente da raiz e 0,55 m para os lados;
      // o servidor só colide o centro (raio 0,42). Recuo visual suave para nunca enfiar a cabeça/mãos numa parede,
      // janela ou porta fechada.
      { const push = this.creatureWallPush(L, c.position.x, c.position.z, c.rotation.y);
        this.crPush = this.crPush || { x: 0, z: 0 };
        this.crPush.x += (push.x - this.crPush.x) * Math.min(1, dt * 10); this.crPush.z += (push.z - this.crPush.z) * Math.min(1, dt * 10);
        c.position.x += this.crPush.x; c.position.z += this.crPush.z; }
      this.crState = cb;
      const li = (f) => (typeof ca[f] === 'number' && typeof cb[f] === 'number') ? ca[f] + (cb[f] - ca[f]) * k : undefined;
      this.cr.anim.update(dt, { anim: cb.anim, animT: cb.animT, speed: ca.speed + (cb.speed - ca.speed) * k, headYaw: ca.headYaw + (cb.headYaw - ca.headYaw) * k, headPitch: ca.headPitch + (cb.headPitch - ca.headPitch) * k, yaw: c.rotation.y, headroom: this.crHeadroom, vx: li('vx'), vz: li('vz'), turn: li('turn'), free: this.crFree ?? 1.6 });
    }
    // colegas
    let si = 0;
    for (const sp of b.players) {
      if (sp.id === this.myId) {
        if (!sp.alive && this.p.alive && !this.deathT) { /* evento de morte chega separado */ }
        continue;
      }
      const m = this.mates.get(sp.id); if (!m) continue;
      const sa = a.players.find(q => q.id === sp.id) || sp;
      const x = sa.x + (sp.x - sa.x) * k, y = sa.y + (sp.y - sa.y) * k, z = sa.z + (sp.z - sa.z) * k;
      const moved = Math.hypot(x - m.rx, z - m.rz);
      m.speed += ((moved / Math.max(dt, 1e-3)) - m.speed) * Math.min(1, dt * 8);
      m.rx = x; m.rz = z;
      const v = m.v;
      v.root.visible = !sp.escaped && Math.abs(sp.level - (this.camLevel ?? this.p.level)) <= 1 && !(this.spectate === sp.id && this.specFirst);
      v.root.position.set(x, y, z);
      // v6: o corpo vira para onde anda (sem andar de lado); a cabeça e a lanterna seguem o olhar
      const lookYaw = lerpA(sa.yaw, sp.yaw, k);
      m.vx = (m.vx || 0) + (((x - (m.lx ?? x)) / Math.max(dt, 1e-3)) - (m.vx || 0)) * Math.min(1, dt * 8);
      m.vz = (m.vz || 0) + (((z - (m.lz ?? z)) / Math.max(dt, 1e-3)) - (m.vz || 0)) * Math.min(1, dt * 8);
      m.lx = x; m.lz = z;
      const face = sp.alive ? teammateFacing(v, lookYaw, m.vx, m.vz, dt) : { yaw: v.bodyYaw ?? lookYaw, headYaw: 0 };
      v.root.rotation.y = face.yaw + Math.PI;
      // v6: morte com agarrão — se a criatura está perto e matando, o corpo vai até as mãos dela; depois cai (física)
      let grab = null, from = null;
      if (!sp.alive) {
        const crp = this.cr.root.position, near = this.cr.root.visible && Math.hypot(crp.x - x, crp.z - z) < 3.4 && this.crState && this.crState.anim === 'kill';
        if (m.grabbed === undefined) m.grabbed = !!near;
        if (m.grabbed && near) grab = this.cr.anim.grabPoint();
        from = crp.clone();
      } else m.grabbed = undefined;
      const lv = sp.level, ly = LEVELS[lv] ? LEVELS[lv].y : 0;
      // v9: medo — criatura visível no mesmo andar, a menos de ~10 m: o boneco parado se encolhe e treme
      let fear = 0;
      if (sp.alive && this.cr.root.visible && this.crState && this.crState.level === sp.level) { const crp = this.cr.root.position; fear = Math.max(0, Math.min(1, (10 - Math.hypot(crp.x - x, crp.z - z)) / 6)); }
      animateTeammate(v, dt, { fear, speed: m.speed, crouch: sp.crouch, alive: sp.alive, fl: sp.fl, pitch: sp.pitch, headYaw: face.headYaw, grab, from, reach: sp.reach || null,
        ground: (gx, gz) => this.world.floorY(lv, gx, gz),
        solid: (gx, gy, gz) => { const c = this.world.cell(lv, cellOf(gx), cellOf(gz)); if (c === T.LOW) return gy - ly < 0.75; return c !== T.FLOOR && c !== T.STAIR && c !== T.CURTAIN && c !== T.HOLE && !(c === T.DOOR && this.world.doorOpen[this.world.doorAt(lv, cellOf(gx), cellOf(gz))]); } });
      // passos remotos
      m.stepAcc += moved;
      const stride = m.speed > 3.3 ? 0.95 : sp.crouch ? 0.55 : 0.75;
      if (m.stepAcc > stride && sp.alive) { m.stepAcc = 0; const surf = this.world.surfaceAt(sp.level, x, z); this.audio.play('step_' + surf, new THREE.Vector3(x, y + 0.05, z), { volume: sp.crouch ? 0.35 : m.speed > 3.3 ? 1.1 : 0.7 }); }
      // lanterna do colega
      const rs = this.remoteSpots[si++];
      if (rs) {
        const on = sp.fl && sp.alive && !sp.escaped && v.root.visible;
        const yaw = lerpA(sa.yaw, sp.yaw, k), pitch = sp.pitch;
        const dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
        const pos = new THREE.Vector3(x + Math.cos(yaw) * 0.2, y + (sp.crouch ? 0.95 : 1.33), z - Math.sin(yaw) * 0.2).addScaledVector(dir, 0.5);
        rs.s.intensity = on ? LIGHTING.flashlight.remoteIntensity : 0; rs.s.position.copy(pos); rs.s.target.position.copy(pos).addScaledVector(dir, 8);
        rs.c.visible = on; rs.c.position.copy(pos); rs.c.lookAt(rs.s.target.position); rs.c.rotateY(Math.PI);
      }
    }
    for (; si < this.remoteSpots.length; si++) { this.remoteSpots[si].s.intensity = 0; this.remoteSpots[si].c.visible = false; }
  }
  // v6: deslocamento (x,z) que tira as partes salientes da criatura de dentro de paredes/portas fechadas
  creatureWallPush(L, x, z, yaw, reach = 0.95) {
    const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const solid = (px, pz) => { const cx = cellOf(px), cz = cellOf(pz), t = this.world.cell(L, cx, cz); return t === T.WALL || t === T.VOID || t === T.TALL || ((t === T.DOOR || t === T.EXIT) && this.world.isDoorClosedCell(L, cx, cz)); };
    let back = 0, side = 0;
    for (let d = reach; d >= 0.45; d -= 0.1) for (const o of [0, -0.3, 0.3]) if (solid(x + fx * d + rx * o, z + fz * d + rz * o)) back = Math.max(back, reach + 0.03 - d);
    for (const sg of [-1, 1]) for (let d = 0.6; d >= 0.42; d -= 0.06) if (solid(x + rx * sg * d + fx * 0.25, z + rz * sg * d + fz * 0.25)) { side -= sg * (0.62 - d); break; }
    back = Math.min(back, 0.5);
    // v9: espaço livre à frente (até 1,6 m) — correndo, os braços que alcançam à frente se recolhem perto de paredes
    let free = 1.6;
    for (let d = 0.5; d <= 1.6; d += 0.1) { if (solid(x + fx * d, z + fz * d) || solid(x + fx * d + rx * 0.35, z + fz * d + rz * 0.35) || solid(x + fx * d - rx * 0.35, z + fz * d - rz * 0.35)) { free = d; break; } }
    this.crFree = free; side = Math.max(-0.2, Math.min(0.2, side));
    return { x: -fx * back + rx * side, z: -fz * back + rz * side };
  }
  // distância (m) até a primeira superfície à frente da câmera — marcha barata pela grade (paredes, móveis
  // altos/baixos, piso e teto); 9 = nada perto
  // v9b: ruído quase imperceptível + engasgo raro (a cada 25–70 s, 0,08–0,35 s de piscadas)
  flashFlicker(dt) {
    const F = this.flFlick, FL = LIGHTING.flashlight; if (!F) return 1;
    const t = this.t || 0;
    let k = 1 + 0.015 * Math.sin(t * 7.3 + F.seed) * Math.sin(t * 2.1 + F.seed * 2);
    if (t >= F.next && t > F.until) { F.until = t + FL.flickerDur[0] + Math.random() * (FL.flickerDur[1] - FL.flickerDur[0]); F.next = F.until + FL.flickerEvery[0] + Math.random() * (FL.flickerEvery[1] - FL.flickerEvery[0]); }
    if (t < F.until) { const n = Math.sin(t * 61 + F.seed) * Math.sin(t * 23 + F.seed * 3); k *= n > 0.2 ? 0.25 : n > -0.3 ? 0.7 : 1; }
    void dt; return k;
  }
  flashNearDist(pos, fwd, L) {
    const lv = LEVELS[L]; if (!lv) return 9;
    for (let s = 0.12; s <= 1.6; s += 0.08) {
      const x = pos.x + fwd.x * s, y = pos.y + fwd.y * s - lv.y, z = pos.z + fwd.z * s;
      if (y <= 0.02 || y >= lv.h - 0.02) return s;
      const t = this.world.cell(L, cellOf(x), cellOf(z));
      if (t === T.LOW ? y < 1.1 : this.world.blocksSight(L, cellOf(x), cellOf(z))) return s;
    }
    return 9;
  }

  spectatorCam(dt) {
    const cam = this.R.camera;
    const alive = this.lastSnap ? this.lastSnap.players.filter(q => q.alive && !q.escaped && q.id !== this.myId) : [];
    if (!alive.find(q => q.id === this.spectate)) this.spectate = alive[0] ? alive[0].id : null;
    const tp = alive.find(q => q.id === this.spectate);
    this.ui.setSpectator(this, tp ? this.name(tp.id) : null);
    if (!tp) {
      // ninguém vivo: câmera parada observando
      cam.position.set(this.p.x, this.p.y + 2.2, this.p.z); cam.rotation.set(-0.5, this.p.yaw, 0, 'YXZ');
      return this.p.level;
    }
    const m = this.mates.get(tp.id);
    const x = m ? m.rx : tp.x, z = m ? m.rz : tp.z, y = tp.y;
    const back = 2.2, yaw = tp.yaw;
    let tx = x + Math.sin(yaw) * back, tz = z + Math.cos(yaw) * back;
    // evita atravessar paredes
    for (let s = 1; s >= 0.2; s -= 0.1) { const xx = x + Math.sin(yaw) * back * s, zz = z + Math.cos(yaw) * back * s; if (this.world.lineOfSight(tp.level, x, z, xx, zz) && this.world.circleFree(tp.level, xx, zz, 0.2)) { tx = xx; tz = zz; break; } tx = x; tz = z; }
    const ty = y + 1.9;
    cam.position.x += (tx - cam.position.x) * Math.min(1, dt * 6); cam.position.y += (ty - cam.position.y) * Math.min(1, dt * 6); cam.position.z += (tz - cam.position.z) * Math.min(1, dt * 6);
    cam.rotation.set(-0.25 + tp.pitch * 0.5, yaw, 0, 'YXZ');
    return tp.level;
  }
  updateSpecFill(dt) {
    const p = this.p;
    const tgt = (!p.alive || p.escaped) && this.spectate ? this.mates.get(this.spectate) : null;
    const want = tgt && tgt.v.root.visible ? 1 : 0;
    this.specK = (this.specK || 0) + (want - (this.specK || 0)) * Math.min(1, dt * 3);
    this.specFill.intensity = 5.5 * this.specK; this.specRim.intensity = 2.5 * this.specK;
    if (tgt) {
      const cam = this.R.camera.position, m = tgt.v.root.position;
      // entre a câmera e o colega, um pouco acima (preenchimento) + contraluz atrás dele
      this.specFill.position.set(m.x + (cam.x - m.x) * 0.45, m.y + 2.0, m.z + (cam.z - m.z) * 0.45);
      this.specRim.position.set(m.x - (cam.x - m.x) * 0.35, m.y + 1.6, m.z - (cam.z - m.z) * 0.35);
    }
  }
  cycleSpectator() {
    const alive = this.lastSnap ? this.lastSnap.players.filter(q => q.alive && !q.escaped && q.id !== this.myId) : [];
    if (!alive.length) return;
    const i = alive.findIndex(q => q.id === this.spectate);
    this.spectate = alive[(i + 1) % alive.length].id;
  }
  // ---------------- áudio ----------------
  playStep(land, running, crouch) {
    const p = this.p;
    const surf = this.world.surfaceAt(p.level, p.x, p.z);
    if (land) { this.audio.play('land', null, { volume: 0.5 }); return; }
    this.audio.play('step_' + surf, null, { volume: crouch ? 0.18 : running ? 0.55 : 0.32 });
  }
  creatureStep(foot, run) {
    const c = this.cr.root;
    if (!c.visible && this.crState && Math.abs(this.crState.level - this.p.level) > 1) return;
    const d = c.position.distanceTo(this.R.camera.position);
    if (d > 55) return;
    const side = foot === 'L' ? 0.2 : -0.2;
    const pos = new THREE.Vector3(c.position.x + Math.cos(c.rotation.y) * side, c.position.y + 0.05, c.position.z - Math.sin(c.rotation.y) * side);
    // v2: passos pesados na madeira, audíveis de longe (direcionais, com oclusão por paredes)
    const wood = this.world.surfaceAt(this.crState ? this.crState.level : 1, c.position.x, c.position.z) === 'wood';
    this.audio.play('cstep', pos, { volume: (1.1 + run * 0.5) * (wood ? 1.25 : 1), refDistance: 3.2, maxDistance: 60, rolloff: 0.95 });
    this.shake = Math.max(this.shake || 0, Math.max(0, 1 - d / 10) * 0.6);
  }
  ambientAudio(dt) {
    const a = this.audio; if (!a.enabled) return;
    a.startAmbience();
    const L = this.camLevel ?? this.p.level;
    if (a.windGain) a.windGain.gain.value = L === 3 ? 0.2 : L === 0 ? 0.04 : 0.11;
    if (a.humGain) a.humGain.gain.value = L === 0 ? 0.45 : 0.22;
    this.ambT -= dt;
    const cam = this.R.camera.position;
    if (this.ambT <= 0) {
      this.ambT = 4 + Math.random() * 10;
      if (Math.random() < 0.3) return; // silêncio intencional
      const ang = Math.random() * Math.PI * 2, dd = 4 + Math.random() * 10;
      const pos = new THREE.Vector3(cam.x + Math.cos(ang) * dd, cam.y + (Math.random() < 0.3 ? 2 : 0), cam.z + Math.sin(ang) * dd);
      const pool = L === 0 ? ['drip', 'drip', 'pipe', 'thump', 'creak'] : L === 3 ? ['rustle', 'creak', 'creak', 'wind_gust', 'thump'] : ['creak', 'creak', 'thump', 'pipe', 'wind_gust', 'door_wood'];
      const k = pool[Math.floor(Math.random() * pool.length)];
      a.play(k, k === 'wind_gust' ? null : pos, { volume: k === 'door_wood' ? 0.25 : 0.7, bus: 'amb' });
    }
    // criatura: respiração, rosnado
    const cs = this.crState;
    if (cs && this.cr.root.visible) {
      const head = this.cr.root.position.clone(); head.y += 2.7;
      const d = head.distanceTo(cam);
      this.breathT -= dt;
      if (this.breathT <= 0 && d < 26) {
        const chasing = cs.state === 'chase';
        this.breathT = chasing ? 1.4 : 2.4 + Math.random() * 1.2;
        a.play(chasing && Math.random() < 0.5 ? 'growl' : 'breath', head, { volume: chasing ? 1.2 : 0.8, refDistance: 2, maxDistance: 35, dur: chasing ? 1.1 : 1.8 });
      }
      // batimento cardíaco: criatura próxima e visível para o jogador
      const vis = d < 10 && this.p.alive && this.world.lineOfSight(this.p.level, this.p.x, this.p.z, this.cr.root.position.x, this.cr.root.position.z) && cs.level === this.p.level;
      this.heartT -= dt;
      if (vis && this.heartT <= 0) { this.heartT = 0.45 + d * 0.06; a.play('heartbeat', null, { volume: 0.5 + (1 - d / 10) * 0.6 }); }
    }
    // ofegante
    if (this.p.alive && this.p.stamina < 2.2) { this.pantT -= dt; if (this.pantT <= 0) { this.pantT = 0.8; a.play('pant', null, { volume: 0.6 }); } }
  }
  toast(text, kind = 'info') { this.ui.toast(text, kind); }
  // ---------------- ganchos de teste (E2E) ----------------
  debugState() {
    const c = this.crState;
    return { me: { x: this.p.x, z: this.p.z, level: this.p.level, alive: this.p.alive, escaped: this.p.escaped, fl: this.p.fl }, keys: this.keys, myKeys: this.myKeys, deposited: this.deposited, waves: this.waves.map(w => w.lvl), exitXray: !!(this.exitXray && this.exitXray.visible), ghosts: this.ghosts ? [...this.ghosts.entries()].filter(([, g]) => g.visible).map(([id]) => id) : [], keyVis: this.keyViews.map(k => k && k.mesh.visible), keysNeeded: this.keysNeeded, exitOpen: this.exitOpen, creature: c ? { x: c.x, z: c.z, level: c.level, state: c.state } : null, mates: [...this.mates.entries()].map(([id, m]) => ({ id, x: m.rx, z: m.rz })), doorsOpen: Array.from(this.world.doorOpen), ended: this.ended, hashOk: this.hashOk, seed: this.seed, target: this.target ? this.target.text : null };
  }
  setLook(yaw, pitch) { this.p.yaw = yaw; this.p.pitch = pitch; }
  teleport(x, z, level) { this.p.x = x; this.p.z = z; this.p.level = level; }
}
