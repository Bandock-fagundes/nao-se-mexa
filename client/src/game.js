// Sessão de jogo no cliente: mundo 3D, jogador local (predição), colegas e criatura interpolados,
// interações, áudio posicional, HUD, espectador e painel de diagnóstico (modo teste).
import * as THREE from 'three';
import { generateMansion } from '../../shared/mapgen.js';
import { World, cellOf } from '../../shared/world.js';
import { PLAYER, LEVELS, PHASES, CELL, T, W, D } from '../../shared/config.js';
import { buildMansion, LightPool, flicker } from './render/mansion.js';
import { buildCreature } from './render/creature.js';
import { buildHand, HandAnimator } from './render/hand.js';
import { buildTeammate, animateTeammate } from './render/human.js';
import { makeBeamCone } from './render/renderer.js';

const lerpA = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; };
const ORD = ['primeira', 'segunda', 'terceira'];
const NAMES_KNOCK = { vase: 'vaso', bucket: 'balde de metal', bottles: 'garrafas', candelabrum: 'candelabro', box: 'caixinha' };

export class Game {
  constructor(app, msg) {
    this.app = app; this.R = app.renderer; this.net = app.net; this.audio = app.audio; this.ui = app.ui;
    this.myId = app.myId; this.test = !!msg.test;
    this.seed = msg.seed; this.phase = msg.phase; this.keysNeeded = msg.keysNeeded; this.names = msg.names || {};
    this.map = generateMansion(msg.seed);
    this.hashOk = this.map.hash === msg.mapHash;
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
    this.spot = new THREE.SpotLight(0xe8f0ff, 0, 28, 0.42, 0.45, 1.0);
    this.spot.castShadow = this.R.q.shadows; this.spot.shadow.mapSize.set(this.R.q.shadowSize, this.R.q.shadowSize); this.spot.shadow.camera.near = 0.15; this.spot.shadow.bias = -0.0006; this.spot.shadow.normalBias = 0.02;
    this.R.scene.add(this.spot); this.R.scene.add(this.spot.target);
    this.beam = makeBeamCone(7.5, 0.36, 0.06); this.R.scene.add(this.beam);
    this.R.onQualityChange = (q) => { this.spot.castShadow = q.shadows; this.spot.shadow.mapSize.set(q.shadowSize, q.shadowSize); if (this.spot.shadow.map) { this.spot.shadow.map.dispose(); this.spot.shadow.map = null; } };
    // lanternas dos colegas (luzes fixas reaproveitadas)
    this.remoteSpots = [0, 1, 2].map(() => { const s = new THREE.SpotLight(0xe8f0ff, 0, 18, 0.4, 0.5, 1.5); this.R.scene.add(s); this.R.scene.add(s.target); const c = makeBeamCone(6, 0.36, 0.045); c.visible = false; this.R.scene.add(c); return { s, c }; });
    this.mates = new Map(); this.snaps = [];
    // estado
    const you = msg.you || { x: this.map.spawns[0].x, z: this.map.spawns[0].z, level: 1, yaw: Math.PI, alive: true, escaped: false };
    this.p = { x: you.x, z: you.z, level: you.level, y: LEVELS[you.level].y, yaw: you.yaw, pitch: 0, vx: 0, vz: 0, crouchK: 0, jumpY: 0, vy: 0, grounded: true, stamina: PLAYER.staminaMax, exhausted: false, alive: you.alive !== false, escaped: !!you.escaped, fl: true, jumps: 0, lands: 0, stepAcc: 0, bob: 0 };
    this.keys = 0; this.exitOpen = false; this.ended = false; this.paused = false;
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
    this.R.scene.remove(this.view.root, this.cr.root, this.spot, this.spot.target, this.beam);
    for (const r of this.remoteSpots) this.R.scene.remove(r.s, r.s.target, r.c);
    for (const l of this.pool.lights) this.R.scene.remove(l.l);
    for (const m of this.mates.values()) this.R.scene.remove(m.v.root);
    this.R.handScene.remove(this.hand.root);
    this.R.scene.traverse(o => { });
    if (window.__game === this) window.__game = null;
  }
  // ---------------- estado vindo do servidor ----------------
  applyFullState(s) {
    if (!s) return;
    s.doors.forEach((o, i) => { this.world.doorOpen[i] = o; const v = this.view.doors[i]; if (v) { v.open = !!o; v.cur = o ? 1 : 0; } });
    s.containers.forEach((o, i) => { const v = this.view.containers[i]; if (v) { v.open = !!o; v.cur = o ? 1 : 0; } });
    for (const [cid, k] of Object.entries(s.revealed || {})) { this.keyPresent[cid] = k; const v = this.view.containers[cid]; if (v) { v.key.visible = true; v.keyShown = true; } }
    s.knocked.forEach((k, i) => { if (k) { const v = this.view.knockables[i]; v.knocked = true; v.t = 1; } });
    this.keys = s.keysCollected; this.exitOpen = s.exitOpen; this.world.exitOpen = s.exitOpen;
    if (this.exitOpen) { this.view.exit.open = true; }
    this.playersMeta = new Map((s.players || []).map(p => [p.id, p]));
    for (const p of s.players || []) this.names[p.id] = p.name;
  }
  onSnapshot(m) {
    const now = performance.now();
    this.snaps.push({ time: now, d: m });
    if (this.snaps.length > 40) this.snaps.shift();
    for (const sp of m.players) {
      if (sp.id === this.myId) continue;
      if (!this.mates.has(sp.id)) {
        const v = buildTeammate(this.app.M, this.mates.size + 1);
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
        const v = V.containers[e.id]; if (!v) break; v.open = e.open;
        if (e.key !== null && e.key !== undefined && e.open) { this.keyPresent[e.id] = e.key; v.key.visible = true; v.keyShown = true; if (e.by === this.myId) this.toast('Uma chave! Pressione E para pegar.', 'key'); }
        break;
      }
      case 'key': {
        const v = V.containers[e.container]; if (v) { v.key.visible = false; v.keyShown = false; }
        delete this.keyPresent[e.container];
        this.keys = e.count;
        this.toast(`${e.by === this.myId ? 'Você encontrou' : (e.name + ' encontrou')} uma chave (${e.count}/${e.needed})`, 'key');
        if (e.count >= e.needed) setTimeout(() => this.toast('Todas as chaves encontradas! Destranque a saída no hall de entrada.', 'key'), 1200);
        if (e.by === this.myId) { this.handAnim.trigger('interact'); this.app.stats.keys = (this.app.stats.keys || 0) + 1; }
        break;
      }
      case 'knock': { const v = V.knockables[e.id]; if (v) { v.knocked = true; } if (e.by === this.myId && e.how === 'esbarrou') this.toast('Você esbarrou em algo… barulho!', 'warn'); break; }
      case 'exit': this.exitOpen = true; this.world.exitOpen = true; V.exit.open = true; this.toast(`${e.by === this.myId ? 'Você destrancou' : e.name + ' destrancou'} a saída! Fujam!`, 'key'); break;
      case 'death': {
        if (e.id === this.myId) this.onMyDeath(e);
        else { this.toast(`${e.name} foi encontrado pela criatura.`, 'death'); const m = this.mates.get(e.id); if (m) m.dead = true; }
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
        if (name.startsWith('door_')) this.audio.play(name, pos, { close: false });
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
    this.audio.play('stinger', null, { volume: 0.8 });
    this.app.stats.deaths = (this.app.stats.deaths || 0) + 1; this.app.saveStats();
    setTimeout(() => this.app.ui.showDeath(), 1400);
  }
  onEnd(m) {
    this.ended = true;
    const st = this.app.stats;
    const me = m.stats.players.find(x => x.id === this.myId);
    if (m.result === 'win') { st.wins = (st.wins || 0) + 1; st.phases = st.phases || {}; st.phases[this.phase] = (st.phases[this.phase] || 0) + 1; }
    if (me) { st.totalSurvival = (st.totalSurvival || 0) + me.survived; st.bestSurvival = Math.max(st.bestSurvival || 0, me.survived); }
    this.app.saveStats();
    this.app.ui.showEnd(m, this);
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
    if (active && !this.paused) {
      const sens = 0.0022 * (st.sensitivity || 1);
      p.yaw -= m.x * sens; p.pitch -= m.y * sens * (st.invertY ? -1 : 1);
      p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch));
    }
    // ----- movimento -----
    let speed = 0;
    if (active) {
      const mv = (this.paused || this.typing) ? { f: 0, s: 0 } : (this.scripted || inp.move());
      const crouch = !this.paused && (this.scriptCrouch ?? inp.crouch);
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
      if ((inp.down('Space') || this.scriptJump) && p.grounded && !crouch && !this.paused) { p.vy = PLAYER.jumpV; p.grounded = false; p.jumps++; this.scriptJump = false; }
      if (!p.grounded) {
        p.vy -= PLAYER.gravity * dt; p.jumpY += p.vy * dt;
        if (p.jumpY <= 0) { p.jumpY = 0; p.vy = 0; p.grounded = true; p.lands++; this.playStep(true); }
      }
      // passos locais
      p.stepAcc += moved;
      const stride = running ? 0.95 : crouch ? 0.55 : 0.75;
      if (p.stepAcc >= stride && p.grounded) { p.stepAcc = 0; this.playStep(false, running, crouch); }
      p.bob += moved * (running ? 2.4 : 3.2);
      p.speed = speed;
    }
    p.y = this.world.floorY(p.level, p.x, p.z);
    // ----- envio ao servidor (20 Hz) -----
    this.sendAcc += dt;
    if (this.sendAcc >= 0.05 && active) {
      this.sendAcc = 0;
      this.net.send({ t: 'in', x: +p.x.toFixed(3), z: +p.z.toFixed(3), level: p.level, yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3), crouch: p.crouch, run: !!p.running, fl: p.fl, jump: p.jumps, land: p.lands });
    }
    // ----- interpolação -----
    this.interpolate(dt);
    // ----- câmera -----
    const cam = R.camera;
    let camLevel = p.level;
    if (active || (!p.alive && this.deathT && performance.now() - this.deathT < 1500 && !this.spectate)) {
      const eye = PLAYER.eye + (PLAYER.crouchEye - PLAYER.eye) * p.crouchK;
      const bob = active ? Math.sin(p.bob) * 0.035 * Math.min(1, (p.speed || 0) / 2.6) : 0;
      if (!p.alive) {
        const k = Math.min(1, (performance.now() - this.deathT) / 1200);
        cam.position.set(p.x, p.y + eye * (1 - k * 0.8) + 0.05, p.z);
        cam.rotation.set(this.deathCam.pitch * (1 - k) + 0.5 * k, this.deathCam.yaw, k * 1.2, 'YXZ');
        cam.position.x += (Math.random() - 0.5) * 0.06 * (1 - k); cam.position.y += (Math.random() - 0.5) * 0.06 * (1 - k);
      } else {
        cam.position.set(p.x, p.y + eye + bob + p.jumpY, p.z);
        cam.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
      }
    } else {
      // espectador: segue um sobrevivente
      camLevel = this.spectatorCam(dt);
    }
    this.camLevel = camLevel;
    // ----- visibilidade por andar / neblina -----
    for (let L = 0; L < 4; L++) this.view.levels[L].visible = Math.abs(L - camLevel) <= 1;
    const fogD = camLevel === 0 ? 0.075 : camLevel === 3 ? 0.068 : 0.05;
    R.scene.fog.density += (fogD - R.scene.fog.density) * Math.min(1, dt * 2);
    // ----- luzes -----
    this.pool.update(dt, this.t, cam.position, camLevel, this.view.lamps);
    for (const lp of this.view.flickerMeshes) { const f = flicker(lp, this.t); if (lp.bulb) lp.bulb.material.emissiveIntensity = 1.6 * f; if (lp.bulbs) lp.bulbs[0].material.emissiveIntensity = 1.6 * f; }
    for (const fl of this.view.flames) { fl.scale.y = 0.8 + 0.3 * Math.sin(this.t * 11 + fl.id) * Math.sin(this.t * 4.3 + fl.id); fl.rotation.y += dt * 0.6; }
    // ----- lanterna local -----
    const showHand = active;
    this.hand.root.visible = showHand;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const lensPos = cam.position.clone().addScaledVector(right, 0.12).addScaledVector(up, -0.1).addScaledVector(fwd, 0.05);
    const flOn = p.fl && active;
    this.spot.intensity = flOn ? 40 : 0;
    this.spot.position.copy(lensPos);
    this.spot.target.position.copy(cam.position).addScaledVector(fwd, 10).addScaledVector(right, -0.25);
    this.beam.visible = flOn;
    this.beam.position.copy(lensPos); this.beam.lookAt(this.spot.target.position); this.beam.rotateY(Math.PI); this.beam.material.uniforms.uTime.value = this.t;
    // mão: luz que incide sobre ela (lâmpadas próximas + respingo da lanterna)
    let nearest = null, nd = 1e9; for (const s of this.pool.lights) { if (!s.lamp) continue; const d = s.l.position.distanceTo(cam.position); if (d < nd) { nd = d; nearest = s; } }
    R.handSpill.intensity = flOn ? 0.5 : 0; R.handKey.intensity = nearest ? Math.min(1.2, nearest.l.intensity * 0.6 / (1 + nd * nd * 0.15)) : 0.05;
    if (nearest) { R.handKey.color.copy(nearest.l.color); const dir = nearest.l.position.clone().sub(cam.position).applyQuaternion(cam.quaternion.clone().invert()).normalize(); R.handKey.position.copy(dir); }
    R.handHemi.intensity = camLevel === 0 ? 0.35 : 0.5;
    const yawVel = (lerpA(this.lastYaw, p.yaw, 1) - this.lastYaw) / Math.max(dt, 1e-3), pitchVel = (p.pitch - this.lastPitch) / Math.max(dt, 1e-3);
    this.lastYaw = p.yaw; this.lastPitch = p.pitch;
    this.handAnim.update(dt, { speed: p.speed || 0, running: p.running, crouch: p.crouch, on: p.fl, yawVel, pitchVel, dead: !p.alive });
    // ----- animação de portas, recipientes, objetos -----
    this.animateWorld(dt);
    // ----- interação -----
    this.target = active && !this.paused ? this.findTarget() : null;
    this.ui.setPrompt(this.target ? this.target.text : '');
    // ----- áudio -----
    this.audio.setListener(cam.position, fwd, up);
    this.ambientAudio(dt);
    // ----- HUD -----
    this.ui.updateHud(this);
  }
  toggleFlashlight() {
    if (!this.p.alive || this.p.escaped) return;
    this.p.fl = !this.p.fl;
    this.handAnim.trigger('click');
    this.audio.play('flashlight', null, { volume: 0.8 });
  }
  interact() {
    if (!this.target || !this.p.alive) return;
    const tg = this.target;
    this.handAnim.trigger('interact');
    if (tg.kind === 'exit' && !tg.can) { this.toast(tg.text, 'warn'); return; }
    this.net.send({ t: 'act', kind: tg.req, id: tg.id });
  }
  onInteractResult(m) { if (!m.ok && m.msg) this.toast(m.msg, 'warn'); }
  findTarget() {
    const cam = this.R.camera;
    const ray = new THREE.Ray(cam.position.clone(), new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion));
    let best = null, bd = 2.3;
    const hit = new THREE.Vector3();
    for (const it of this.view.interact) {
      if (it.level !== this.p.level) continue;
      const c = it.box.getCenter(hit);
      if (c.distanceTo(cam.position) > 4) continue;
      const h = ray.intersectBox(it.box, hit);
      if (!h) continue;
      const d = h.distanceTo(cam.position);
      if (d < bd) { bd = d; best = it; }
    }
    if (!best) return null;
    const V = this.view;
    if (best.kind === 'container') {
      const c = V.containers[best.id];
      if (c.open && c.keyShown) return { kind: 'key', req: 'key', id: best.id, text: '[E] Pegar chave' };
      return { kind: 'container', req: 'container', id: best.id, text: `[E] ${c.open ? 'Fechar' : 'Abrir'} ${c.label}` };
    }
    if (best.kind === 'door') {
      const d = V.doors[best.id];
      const extra = d.type === 'rusty' ? ' (enferrujada — muito barulho)' : d.type === 'heavy' ? ' (pesada — barulhenta)' : '';
      return { kind: 'door', req: 'door', id: best.id, text: `[E] ${d.open ? 'Fechar' : 'Abrir'} porta${extra}` };
    }
    if (best.kind === 'knock') {
      const k = V.knockables[best.id]; if (k.knocked) return null;
      return { kind: 'knock', req: 'knock', id: best.id, text: `[E] Derrubar ${NAMES_KNOCK[k.kind]} (faz barulho — distrai a criatura)` };
    }
    if (best.kind === 'exit') {
      if (this.exitOpen) return null;
      const can = this.keys >= this.keysNeeded;
      return { kind: 'exit', req: 'exit', id: 0, can, text: can ? '[E] Destrancar a saída' : `Saída trancada — chaves: ${this.keys}/${this.keysNeeded}` };
    }
    return null;
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
    for (const c of V.containers) {
      if (!c) continue;
      const tgt = c.open ? 1 : 0;
      if (Math.abs(c.cur - tgt) < 0.001) continue;
      c.cur += Math.sign(tgt - c.cur) * Math.min(Math.abs(tgt - c.cur), dt * 2.5);
      const e = c.cur * c.cur * (3 - 2 * c.cur);
      if (c.type === 'drawer') c.part.position.z = (c.part.userData.z0 ??= c.part.position.z) + e * c.amount;
      else if (c.type === 'door') { c.part.rotation.y = e * c.amount; if (c.extra) c.extra.rotation.y = -e * c.amount * 0.9; }
      else if (c.type === 'lid') c.part.rotation.x = e * c.amount;
    }
    for (const c of V.containers) if (c && c.key.visible) { c.key.rotation.z += dt * 0.6; }
    for (const k of V.knockables) {
      if (!k || !k.knocked || k.t >= 1) { if (k && k.knocked && k.t >= 1 && !k.done) { k.done = true; k.g.rotation.set(Math.PI / 2, k.rot, 0); k.g.position.y = LEVELS[k.level].y + 0.08; } continue; }
      k.t = Math.min(1, k.t + dt * 2.5);
      k.g.rotation.x = k.t * Math.PI / 2; k.g.position.y = LEVELS[k.level].y + 0.08 * k.t;
      if (k.kind === 'vase' && k.t >= 1) k.g.scale.set(1, 0.5, 1);
    }
    const ex = V.exit;
    if (ex) {
      for (let i = 0; i < ex.locks.length; i++) ex.locks[i].visible = i < (this.keysNeeded - this.keys) && !this.exitOpen;
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
      // abaixa ao passar sob portas
      let duck = 0;
      const L = cb.level, cx = cellOf(c.position.x), cz = cellOf(c.position.z);
      for (let a2 = -2; a2 <= 2 && !duck; a2++) for (let b2 = -2; b2 <= 2; b2++) { const t = this.world.cell(L, cx + a2, cz + b2); if (t === T.DOOR || (t === T.FLOOR && this.map.levels[L].room[(cz + b2) * W + cx + a2] < 0)) { duck = 1; break; } }
      this.crDuck = (this.crDuck || 0) + (duck - (this.crDuck || 0)) * Math.min(1, dt * 4);
      this.crState = cb;
      this.cr.anim.update(dt, { anim: cb.anim, animT: cb.animT, speed: ca.speed + (cb.speed - ca.speed) * k, headYaw: ca.headYaw + (cb.headYaw - ca.headYaw) * k, headPitch: ca.headPitch + (cb.headPitch - ca.headPitch) * k, yaw: c.rotation.y, duck: this.crDuck });
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
      v.root.rotation.y = lerpA(sa.yaw, sp.yaw, k) + Math.PI;
      animateTeammate(v, dt, { speed: m.speed, crouch: sp.crouch, alive: sp.alive, fl: sp.fl, pitch: sp.pitch });
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
        const pos = new THREE.Vector3(x - Math.cos(yaw) * 0.2, y + (sp.crouch ? 0.9 : 1.35), z + Math.sin(yaw) * 0.2).addScaledVector(dir, 0.35);
        rs.s.intensity = on ? 30 : 0; rs.s.position.copy(pos); rs.s.target.position.copy(pos).addScaledVector(dir, 8);
        rs.c.visible = on; rs.c.position.copy(pos); rs.c.lookAt(rs.s.target.position); rs.c.rotateY(Math.PI);
      }
    }
    for (; si < this.remoteSpots.length; si++) { this.remoteSpots[si].s.intensity = 0; this.remoteSpots[si].c.visible = false; }
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
    if (d > 40) return;
    const side = foot === 'L' ? 0.2 : -0.2;
    const pos = new THREE.Vector3(c.position.x + Math.cos(c.rotation.y) * side, c.position.y + 0.05, c.position.z - Math.sin(c.rotation.y) * side);
    this.audio.play('cstep', pos, { volume: 0.9 + run * 0.5, refDistance: 2.5, maxDistance: 50, rolloff: 1.1 });
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
    return { me: { x: this.p.x, z: this.p.z, level: this.p.level, alive: this.p.alive, escaped: this.p.escaped, fl: this.p.fl }, keys: this.keys, keysNeeded: this.keysNeeded, exitOpen: this.exitOpen, creature: c ? { x: c.x, z: c.z, level: c.level, state: c.state } : null, mates: [...this.mates.entries()].map(([id, m]) => ({ id, x: m.rx, z: m.rz })), doorsOpen: Array.from(this.world.doorOpen), ended: this.ended, hashOk: this.hashOk, seed: this.seed, target: this.target ? this.target.text : null };
  }
  setLook(yaw, pitch) { this.p.yaw = yaw; this.p.pitch = pitch; }
  teleport(x, z, level) { this.p.x = x; this.p.z = z; this.p.level = level; }
}
