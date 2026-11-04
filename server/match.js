// Partida autoritativa: jogadores, chaves, portas, saída, criatura, mortes, vitória/derrota.
import { generateMansion } from '../shared/mapgen.js';
import { World, cellOf } from '../shared/world.js';
import { Nav } from '../shared/nav.js';
import { PHASES, PLAYER, CREATURE, AI, CELL, LEVELS, T, NET } from '../shared/config.js';
import { makeRng } from '../shared/rng.js';
import { Creature, STATE_LABEL } from './creature.js';
import { ScentGrid } from './scent.js';
import { Director } from './director.js';
import { makeSoundEvent, isPlayerMoving, angleDiff } from './senses.js';

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const ROOM_SCENT = { kitchen: 0.7, bathroom: 0.7, cellar: 1.2, boiler: 0.8, laundry: 0.7, attic: 1.1 };

export class Match {
  constructor({ seed, phase = 1, players = [], test = false, keySeed }) {
    this.seed = String(seed); this.phase = phase; this.phaseCfg = PHASES[phase]; this.test = test;
    this.map = generateMansion(this.seed);
    this.world = new World(this.map);
    this.nav = new Nav(this.world);
    this.rng = makeRng('match|' + this.seed + '|' + phase + '|' + (keySeed ?? ''));
    this.t = 0; this.soundSeq = 0; this.sounds = []; this.events = [];
    this.players = new Map();
    this.containerOpen = new Uint8Array(this.map.containers.length);
    this.keyIn = new Map();
    this.keysCollected = [];
    this.keysNeeded = this.phaseCfg.keys;
    this.knocked = new Uint8Array(this.map.knockables.length);
    this.exitOpen = false; this.ended = false; this.result = null;
    this.scent = new ScentGrid(); this.scentAcc = 0; this.pruneAcc = 0;
    this.litLamps = this.map.lamps.filter(l => l.state !== 'off');
    this.distributeKeys();
    players.forEach((p, i) => this.addPlayer(p.id, p.name, i));
    this.director = new Director(this); // ritmo/pressão (não dá posição exata à criatura)
    this.creature = new Creature(this);
    this.startT = 0;
  }
  distributeKeys() {
    const m = this.map, rng = this.rng;
    const hall = m.exit.room;
    const s0 = m.spawns[0];
    const cands = m.containers.filter(c => c.room !== hall && !(c.level === 1 && Math.hypot(c.x - s0.x, c.z - s0.z) < 7));
    rng.shuffle(cands);
    const chosen = [];
    const usedRooms = new Set(), usedLevels = new Set();
    for (let pass = 0; pass < 3 && chosen.length < this.keysNeeded; pass++) {
      for (const c of cands) {
        if (chosen.length >= this.keysNeeded) break;
        if (chosen.includes(c)) continue;
        if (usedRooms.has(c.room)) continue;
        if (pass === 0 && usedLevels.has(c.level)) continue;
        if (pass === 0 && c.level === 3 && rng.chance(0.6)) continue; // sótão possível, não obrigatório
        chosen.push(c); usedRooms.add(c.room); usedLevels.add(c.level);
      }
    }
    chosen.forEach((c, i) => this.keyIn.set(c.id, i));
    this.keyContainers = chosen.map(c => c.id);
  }
  addPlayer(id, name, idx) {
    const s = this.map.spawns[idx % this.map.spawns.length];
    const p = {
      id, name, x: s.x, z: s.z, level: s.level, y: LEVELS[s.level].y, yaw: s.yaw, pitch: 0,
      crouch: false, run: false, flashlight: true, alive: true, escaped: false, connected: true, left: false,
      lastBodyMoveT: -10, standUpT: -10, jumpT: -10, lastAcceptT: this.t, stepAcc: 0, hist: [{ t: this.t, x: s.x, z: s.z }],
      jumpCount: 0, landCount: 0, lastLandT: -10, deathT: null, escapeT: null, dcT: null, keys: 0, spawnT: this.t,
    };
    this.players.set(id, p);
    return p;
  }
  emit(ev) { this.events.push(ev); }
  emitSound(type, x, y, z, level, extra = {}) {
    const ev = makeSoundEvent(this, type, x, y, z, level, extra);
    this.sounds.push(ev);
    if (this.sounds.length > 60) this.sounds.shift();
    if (this.creature) this.creature.onSound(ev);
    if (!type.startsWith('step_')) this.emit({ type: 'sound', sound: type, x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2), level, by: extra.by });
    return ev;
  }
  creatureSound(kind) { const c = this.creature; if (c) this.emit({ type: 'csound', kind, x: +c.x.toFixed(2), y: +c.y.toFixed(2), z: +c.z.toFixed(2) }); }

  // ---------- entrada de movimento (validada) ----------
  applyInput(id, inp) {
    const p = this.players.get(id);
    if (!p || !p.alive || p.escaped || !p.connected || this.ended) return { ignored: true };
    if (!fin(inp.x) || !fin(inp.z)) return { ignored: true };
    const t = this.t;
    if (fin(inp.yaw)) p.yaw = inp.yaw;
    if (fin(inp.pitch)) p.pitch = Math.max(-1.5, Math.min(1.5, inp.pitch));
    if (typeof inp.fl === 'boolean') p.flashlight = inp.fl;
    const crouch = !!inp.crouch;
    if (p.crouch && !crouch) p.standUpT = t;
    p.crouch = crouch; p.run = !!inp.run;
    const dist = Math.hypot(inp.x - p.x, inp.z - p.z);
    const budget = PLAYER.run * 1.35 * Math.max(0.05, t - p.lastAcceptT) + 0.4;
    let correction = null;
    if (dist > 0.0005) {
      if (dist > budget) correction = 'velocidade';
      else {
        const seg = this.world.segmentFree(p.level, p.x, p.z, inp.x, inp.z, PLAYER.radius);
        if (!seg.ok) correction = 'colisão';
        else {
          p.x = inp.x; p.z = inp.z; p.level = seg.level;
          p.y = this.world.floorY(p.level, p.x, p.z);
          p.lastAcceptT = t;
        }
      }
    } else p.lastAcceptT = t;
    if (correction) return { correction: { x: p.x, z: p.z, level: p.level, reason: correction } };
    // histórico para velocidade real do corpo (rotação da câmera não entra aqui)
    p.hist.push({ t, x: p.x, z: p.z });
    while (p.hist.length > 2 && t - p.hist[0].t > 0.5) p.hist.shift();
    const h0 = p.hist[0];
    const wdt = Math.max(0.1, t - h0.t);
    const speed = Math.hypot(p.x - h0.x, p.z - h0.z) / wdt;
    p.speed = speed;
    if (speed > AI.moveSpeedThreshold || dist > 0.06) p.lastBodyMoveT = t;
    // passos → eventos sonoros
    p.stepAcc += dist;
    const kind = speed > 3.3 ? 'run' : (crouch && speed < 1.9 ? 'crouch' : 'walk');
    const stride = kind === 'run' ? 0.95 : kind === 'crouch' ? 0.55 : 0.75;
    if (p.stepAcc >= stride) {
      p.stepAcc = 0;
      this.emitSound('step_' + kind, p.x, p.y, p.z, p.level, { by: p.id, source: 'player' });
    }
    // pulo / aterrissagem
    if (fin(inp.jump) && inp.jump > p.jumpCount) { p.jumpCount = inp.jump; p.jumpT = t; }
    if (fin(inp.land) && inp.land > p.landCount) {
      p.landCount = inp.land;
      if (t - p.lastLandT > 0.4) { p.lastLandT = t; this.emitSound('land', p.x, p.y, p.z, p.level, { by: p.id, source: 'player' }); }
    }
    // objetos derrubados ao passar
    if (speed > 0.8 && !(crouch && speed < 1.9)) {
      for (const k of this.map.knockables) {
        if (this.knocked[k.id] || k.level !== p.level) continue;
        if (Math.hypot(k.x - p.x, k.z - p.z) < 0.42) this.knock(k, p, 'esbarrou');
      }
    }
    return { ok: true };
  }
  knock(k, p, how) {
    this.knocked[k.id] = 1;
    this.emit({ type: 'knock', id: k.id, by: p ? p.id : null, how });
    this.emitSound('knock_' + k.kind, k.x, LEVELS[k.level].y + 0.3, k.z, k.level, { by: p ? p.id : null, source: 'object' });
  }
  // ---------- interações (validadas) ----------
  interact(id, req) {
    const p = this.players.get(id);
    if (!p || !p.alive || p.escaped || !p.connected || this.ended) return { ok: false, msg: 'Você não pode interagir agora.' };
    const kind = req && req.kind, tid = req && req.id;
    const w = this.world;
    const near = (x, z, level, maxD) => level === p.level && Math.hypot(x - p.x, z - p.z) <= maxD && w.noWallBetween(p.level, p.x, p.z, x, z);
    if (kind === 'container' || kind === 'key') {
      const c = this.map.containers[tid];
      if (!c) return { ok: false, msg: 'Inválido.' };
      if (!(near(c.ax, c.az, c.level, 1.9) || near(c.x, c.z, c.level, 2.0))) return { ok: false, msg: 'Muito longe.' };
      if (kind === 'container') {
        const open = this.containerOpen[c.id] ? 0 : 1;
        this.containerOpen[c.id] = open;
        const key = open && this.keyIn.has(c.id) ? this.keyIn.get(c.id) : null;
        this.emit({ type: 'container', id: c.id, open: !!open, key, by: p.id });
        this.emitSound('container_' + (c.kind === 'shelf' || c.kind === 'cabinet' ? 'wardrobe' : c.kind === 'drawer' ? 'drawer' : c.kind), c.x, p.y + 0.8, c.z, c.level, { by: p.id, source: 'player' });
        return { ok: true, open: !!open, key };
      }
      if (!this.containerOpen[c.id]) return { ok: false, msg: 'Abra primeiro.' };
      if (!this.keyIn.has(c.id)) return { ok: false, msg: 'Não há chave aqui.' };
      const keyId = this.keyIn.get(c.id);
      this.keyIn.delete(c.id);
      this.keysCollected.push({ key: keyId, by: p.id, t: this.t });
      p.keys++;
      this.director.onKey();
      this.emit({ type: 'key', container: c.id, key: keyId, by: p.id, name: p.name, count: this.keysCollected.length, needed: this.keysNeeded });
      this.emitSound('key_pickup', c.x, p.y + 0.8, c.z, c.level, { by: p.id, source: 'player' });
      return { ok: true, key: keyId };
    }
    if (kind === 'door') {
      const d = this.map.doors[tid];
      if (!d) return { ok: false, msg: 'Inválido.' };
      // ponto na face da porta voltada para o jogador (a própria folha não bloqueia a checagem)
      const xs = d.cells.map(c => c[0]), zs = d.cells.map(c => c[1]);
      const minX = Math.min(...xs) * CELL, maxX = (Math.max(...xs) + 1) * CELL, minZ = Math.min(...zs) * CELL, maxZ = (Math.max(...zs) + 1) * CELL;
      const fx = d.axis === 'z' ? Math.max(minX + 0.05, Math.min(maxX - 0.05, p.x)) : (p.x < d.x ? minX - 0.05 : maxX + 0.05);
      const fz = d.axis === 'z' ? (p.z < d.z ? minZ - 0.05 : maxZ + 0.05) : Math.max(minZ + 0.05, Math.min(maxZ - 0.05, p.z));
      if (!near(fx, fz, d.level, 2.2)) return { ok: false, msg: 'Muito longe.' };
      const open = this.world.doorOpen[d.id] ? 0 : 1;
      if (!open) {
        // não fecha sobre alguém
        const blocked = [...this.players.values()].some(q => q.alive && !q.escaped && q.level === d.level && d.cells.some(([cx, cz]) => Math.abs((cx + 0.5) * CELL - q.x) < 0.25 + PLAYER.radius && Math.abs((cz + 0.5) * CELL - q.z) < 0.25 + PLAYER.radius))
          || (this.creature.level === d.level && d.cells.some(([cx, cz]) => Math.hypot((cx + 0.5) * CELL - this.creature.x, (cz + 0.5) * CELL - this.creature.z) < 0.9));
        if (blocked) return { ok: false, msg: 'Há algo no caminho da porta.' };
      }
      this.world.doorOpen[d.id] = open;
      this.emit({ type: 'door', id: d.id, open: !!open, by: p.id });
      this.emitSound('door_' + d.type, d.x, p.y + 1.2, d.z, d.level, { by: p.id, source: 'player', door: d.id, open: !!open });
      return { ok: true, open: !!open };
    }
    if (kind === 'knock') {
      const k = this.map.knockables[tid];
      if (!k || this.knocked[k.id] || !near(k.x, k.z, k.level, 2.0)) return { ok: false, msg: 'Muito longe.' };
      this.knock(k, p, 'derrubou');
      return { ok: true };
    }
    if (kind === 'exit') {
      const e = this.map.exit;
      if (!near(e.x, e.z + 0.5, e.level, 3.0)) return { ok: false, msg: 'Muito longe.' };
      if (this.exitOpen) return { ok: true, msg: 'A saída está aberta! Saia!' };
      if (this.keysCollected.length < this.keysNeeded) return { ok: false, msg: `A saída está trancada. Chaves: ${this.keysCollected.length}/${this.keysNeeded}` };
      this.exitOpen = true; this.world.exitOpen = true;
      this.emit({ type: 'exit', open: true, by: p.id, name: p.name });
      this.emitSound('exit_unlock', e.x, 1.2, e.z, 1, { by: p.id, source: 'player' });
      return { ok: true };
    }
    return { ok: false, msg: 'Interação desconhecida.' };
  }
  // ---------- criatura → mundo ----------
  creatureOpensDoor(id) {
    if (id < 0 || this.world.doorOpen[id]) return;
    const d = this.map.doors[id];
    this.world.doorOpen[id] = 1;
    this.emit({ type: 'door', id, open: true, by: 'creature' });
    this.emitSound('door_' + d.type, d.x, LEVELS[d.level].y + 1.2, d.z, d.level, { by: 'creature', source: 'creature' });
  }
  attackStrike(c) {
    const out = [];
    for (const p of this.players.values()) {
      if (!p.alive || p.escaped || !p.connected) continue;
      if (Math.abs(p.y - c.y) > 1.6) continue;
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d > CREATURE.attackReach) continue;
      const ang = Math.abs(angleDiff(Math.atan2(p.x - c.x, p.z - c.z), c.yaw));
      if (ang > 75 * Math.PI / 180 && d > CREATURE.contactDist) continue;
      if (!this.world.noWallBetween(c.level, c.x, c.z, p.x, p.z)) continue;
      this.killPlayer(p, 'ataque');
      out.push(p.id);
    }
    return out;
  }
  killPlayer(p, cause) {
    if (!p.alive) return;
    p.alive = false; p.deathT = this.t;
    this.emit({ type: 'death', id: p.id, name: p.name, cause, x: +p.x.toFixed(2), z: +p.z.toFixed(2), level: p.level });
    this.creatureSound('kill');
  }
  // ---------- passo de simulação ----------
  tick(dt) {
    if (this.ended) return;
    this.t += dt;
    const t = this.t;
    // rastros de cheiro (depositados ao longo do trajeto, a cada 0,25 s)
    this.scentAcc += dt;
    if (this.scentAcc >= 0.25) {
      this.scentAcc = 0;
      for (const p of this.players.values()) {
        if (!p.alive || p.escaped || !p.connected) { p.scentPos = null; continue; }
        const moving = isPlayerMoving(p, t);
        const prev = p.scentPos;
        p.scentPos = { x: p.x, z: p.z, level: p.level };
        if (!moving && t - p.lastBodyMoveT > 2) continue; // parado não espalha rastro novo (o antigo permanece)
        const r = this.world.roomAt(p.level, p.x, p.z);
        const rf = r >= 0 ? (ROOM_SCENT[this.map.rooms[r].type] ?? 1) : 1;
        const sp = p.speed || 0;
        const amt = (moving ? (sp > 3.3 ? 0.42 : (p.crouch ? 0.2 : 0.3)) : 0.05) * rf * (p.level === 0 ? 1.2 : 1);
        if (prev && prev.level === p.level) {
          const d = Math.hypot(p.x - prev.x, p.z - prev.z);
          const n = Math.max(1, Math.min(8, Math.ceil(d / 0.5)));
          for (let k = 1; k <= n; k++) this.scent.deposit(p.level, prev.x + (p.x - prev.x) * k / n, prev.z + (p.z - prev.z) * k / n, amt / Math.max(1, n * 0.5), t);
        } else this.scent.deposit(p.level, p.x, p.z, amt, t);
      }
    }
    this.pruneAcc += dt;
    if (this.pruneAcc > 2) { this.pruneAcc = 0; this.scent.prune(t); }
    this.director.update(dt);
    this.creature.update(dt);
    const c = this.creature;
    // morte por contato (servidor confirma distância + ausência de parede)
    for (const p of this.players.values()) {
      if (!p.alive || p.escaped || !p.connected) continue;
      if (Math.abs(p.y - c.y) > 1.6) continue;
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d < CREATURE.contactDist && this.world.noWallBetween(c.level, c.x, c.z, p.x, p.z)) {
        this.killPlayer(p, 'contato');
        if (c.state === 'chase' || c.state === 'attack') { c.setState('kill', 1.9); c.killed = p.id; }
        this.director.onEncounterEnd('morte');
      }
    }
    // fuga
    if (this.exitOpen) {
      const e = this.map.exit;
      for (const p of this.players.values()) {
        if (!p.alive || p.escaped || p.level !== 1) continue;
        if (p.z < 0.45 && Math.abs(p.x - e.x) < 1.0) {
          p.escaped = true; p.escapeT = t;
          this.emit({ type: 'escaped', id: p.id, name: p.name });
        }
      }
    }
    // desconexões longas
    for (const p of this.players.values()) {
      if (!p.connected && !p.left && p.dcT !== null && t - p.dcT > NET.reconnectGrace) { p.left = true; this.emit({ type: 'left', id: p.id, name: p.name }); }
    }
    while (this.sounds.length && t - this.sounds[0].t > 8) this.sounds.shift();
    this.checkEnd();
  }
  checkEnd() {
    const present = [...this.players.values()].filter(p => !p.left);
    const contenders = present.filter(p => p.alive && !p.escaped);
    if (contenders.length === 0) {
      this.ended = true;
      const escaped = present.filter(p => p.escaped);
      this.result = escaped.length > 0 ? 'win' : 'lose';
      this.emit({ type: 'end', result: this.result, stats: this.stats() });
    }
  }
  stats() {
    return {
      seed: this.seed, phase: this.phase, duration: +this.t.toFixed(1),
      keys: this.keysCollected.length, keysNeeded: this.keysNeeded,
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, alive: p.alive, escaped: p.escaped, keys: p.keys, left: p.left, survived: +((p.deathT ?? p.escapeT ?? this.t) - p.spawnT).toFixed(1) })),
    };
  }
  setConnected(id, on) {
    const p = this.players.get(id); if (!p) return;
    p.connected = on; p.dcT = on ? null : this.t;
    if (on) { p.lastAcceptT = this.t; p.hist = [{ t: this.t, x: p.x, z: p.z }]; }
    this.emit({ type: on ? 'reconnected' : 'disconnected', id, name: p.name });
  }
  removePlayer(id) {
    const p = this.players.get(id); if (!p) return;
    p.left = true; p.connected = false;
    this.emit({ type: 'left', id, name: p.name });
  }
  // ---------- estado para rede ----------
  snapshot() {
    return {
      time: +this.t.toFixed(3),
      players: [...this.players.values()].filter(p => !p.left).map(p => ({
        id: p.id, x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3), level: p.level, yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3),
        crouch: p.crouch, run: p.run, fl: p.flashlight, alive: p.alive, escaped: p.escaped, conn: p.connected, moving: isPlayerMoving(p, this.t),
      })),
      creature: this.creature.snapshot(),
    };
  }
  fullState() {
    const revealed = {};
    for (let i = 0; i < this.containerOpen.length; i++) if (this.containerOpen[i] && this.keyIn.has(i)) revealed[i] = this.keyIn.get(i);
    return {
      seed: this.seed, phase: this.phase, keysNeeded: this.keysNeeded, mapHash: this.map.hash,
      doors: Array.from(this.world.doorOpen), containers: Array.from(this.containerOpen), revealed,
      keysCollected: this.keysCollected.length, knocked: Array.from(this.knocked), exitOpen: this.exitOpen,
      ended: this.ended, result: this.result, t: this.t,
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, alive: p.alive, escaped: p.escaped, left: p.left, conn: p.connected })),
    };
  }
  diag() {
    const c = this.creature;
    return {
      time: +this.t.toFixed(1), seed: this.seed, genVersion: this.map.version, mapHash: this.map.hash, fallback: this.map.fallbackFrom || null,
      creature: {
        state: c.state, label: (STATE_LABEL[c.state] || c.state) + ` · ameaça ${Math.round(this.director.menace * 100)}%` + (this.director.target ? ` → ${this.director.target.kind}: ${this.director.target.room} (andar ${this.director.target.level})` : ''), anim: c.anim, x: +c.x.toFixed(1), z: +c.z.toFixed(1), level: c.level,
        speed: +c.speed.toFixed(2), senses: c.senseSummary(), target: c.target, lastSound: c.lastSound, lastInvestigated: c.lastInvestigated,
        sniff: { ...c.sniffInfo, nextIn: Number.isFinite(c.nextSniffT) ? +(c.nextSniffT - this.t).toFixed(1) : null }, scentCells: this.scent.size,
        tracking: c.vis ? c.vis.tracked : [],
        menace: +this.director.menace.toFixed(2),
        director: this.director.diag(),
        passBy: c.passBy ? { stage: c.passBy.stage, via: c.passBy.via.room, then: c.passBy.then.room } : null,
        maxStill: +c.maxStill.toFixed(1),
      },
      director: this.director.diag(),
      keys: { collected: this.keysCollected.length, needed: this.keysNeeded, containers: this.keyContainers },
      exitOpen: this.exitOpen,
      recentSounds: this.sounds.slice(-6).map(s => ({ type: s.type, level: s.level, range: +s.range.toFixed(1), heard: !!s.heardBy, t: +s.t.toFixed(1) })),
    };
  }
  // ---------- utilidades de teste/diagnóstico ----------
  debugCommand(pid, msg) {
    const p = this.players.get(pid);
    if (msg.cmd === 'tp' && p && fin(msg.x) && fin(msg.z) && [0, 1, 2, 3].includes(msg.level)) {
      if (!this.world.circleFree(msg.level, msg.x, msg.z, PLAYER.radius)) return { ok: false, msg: 'posição bloqueada' };
      this.debugPlacePlayer(pid, msg.x, msg.z, msg.level, fin(msg.yaw) ? msg.yaw : p.yaw);
      return { ok: true, correction: { x: p.x, z: p.z, level: p.level, reason: 'teleporte (teste)' } };
    }
    if (msg.cmd === 'creature' && fin(msg.x) && fin(msg.z)) {
      this.debugPlaceCreature(msg.x, msg.z, msg.level ?? 1, msg.yaw ?? 0, msg.state === 'freeze' ? 'freeze' : 'hold');
      return { ok: true };
    }
    if (msg.cmd === 'release') { this.creature.pickPatrol(); return { ok: true }; }
    if (msg.cmd === 'keys') return { ok: true, keys: this.keyContainers.map(id => { const c = this.map.containers[id]; return { id, level: c.level, ax: c.ax, az: c.az, x: c.x, z: c.z }; }) };
    return { ok: false };
  }
  debugPlaceCreature(x, z, level, yaw = 0, state = 'hold') {
    const c = this.creature;
    c.x = x; c.z = z; c.level = level; c.y = this.world.floorY(level, x, z); c.yaw = yaw; c.headYaw = 0;
    c.path = null; c.speed = 0; c.target = null; c.trace = [];
    c.setState(state, 999);
  }
  debugPlacePlayer(id, x, z, level, yaw = 0) {
    const p = this.players.get(id);
    p.x = x; p.z = z; p.level = level; p.y = this.world.floorY(level, x, z); p.yaw = yaw;
    p.hist = [{ t: this.t, x, z }]; p.lastAcceptT = this.t; p.lastBodyMoveT = -10; p.standUpT = -10; p.jumpT = -10;
  }
}
