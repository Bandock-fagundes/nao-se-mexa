// Criatura: máquina de estados autoritativa no servidor.
// Ela só conhece jogadores pelo que seus sentidos (visão / audição / olfato) da fase permitem.
import { AI, CREATURE, CELL, LEVELS } from '../shared/config.js';
import { visionCheck, hearingCheck, angleDiff } from './senses.js';

export const STATE_LABEL = {
  patrol: 'Patrulhando', wander: 'Caminhando sem destino', look: 'Observando', alert: 'Percebeu algo (confirmando)',
  chase: 'Perseguindo jogador', attack: 'Atacando', kill: 'Matando', hear: 'Reagindo a som',
  investigate: 'Investigando som', inspect: 'Investigando o local', search: 'Procurando pessoa (última posição)',
  sniff: 'Farejando', track: 'Rastreando cheiro', recover: 'Recuperando-se da investigação', return: 'Retornando à exploração',
  door: 'Abrindo porta', idle: 'Despertando', hold: 'Parada (teste)', freeze: 'Congelada (teste)',
};

export class Creature {
  constructor(match) {
    this.m = match;
    const s = match.map.creatureSpawn;
    this.level = s.level; this.x = s.x; this.z = s.z; this.y = match.world.floorY(s.level, s.x, s.z);
    this.yaw = s.yaw; this.headYaw = 0; this.headPitch = 0;
    this.state = 'idle'; this.stateT = 0; this.anim = 'idle'; this.animT = 0;
    this.speed = 0; this.path = null; this.pathIdx = 0; this.goal = null; this.repathT = 0;
    this.stuckT = 0; this.stuckRef = { x: this.x, z: this.z }; this.repathFails = 0;
    this.target = null; this.lastKnown = null; this.lastSeenT = -1e9; this.detectT = new Map();
    this.invest = null; this.lastSound = null; this.lastInvestigated = null;
    this.pendingSounds = [];
    this.nextSniffT = match.phaseCfg.smell ? match.t + match.rng.float(...AI.sniffInterval) : Infinity;
    this.sniffInfo = { state: match.phaseCfg.smell ? 'aguardando' : 'inativo', lastT: null, found: false, strength: 0 };
    this.track = null;
    this.visionAcc = 0; this.durState = 0;
    this.visited = new Map();
    this.resume = null; this.doorId = -1;
    this.trace = []; // amostras de posição para testes (sem teletransporte)
    this.lightSeen = null;
    this.killed = null;
    this.prevSpeed = 0;
  }
  get rng() { return this.m.rng; }
  setState(s, dur = 0) {
    if (this.state !== s) { this.state = s; this.stateT = 0; this.animT = 0; }
    this.durState = dur;
  }
  // -------- sentidos --------
  senseVision() {
    const m = this.m, t = m.t;
    let tracked = [], fresh = [], light = null;
    for (const p of m.players.values()) {
      const focused = this.state === 'chase' && this.target === p.id;
      const v = visionCheck(m, this, p, { focused });
      let detected = v.visible && v.moving;
      if (v.beamOnCreature && v.inFov && v.los && v.moving && v.dist <= AI.flashlight.beamRange) detected = true;
      if (detected) { this.detectT.set(p.id, t); fresh.push({ p, v }); }
      const prior = this.detectT.has(p.id) && (t - this.detectT.get(p.id)) < AI.detectionMemory;
      if ((v.visible || (focused && v.los && v.dist < 3.5)) && prior) tracked.push({ p, v });
      else if (v.beamOnCreature && v.inFov && v.los && !v.moving) light = { p, v };
    }
    this.vis = { tracked: tracked.map(o => o.p.id), fresh: fresh.map(o => o.p.id) };
    if (this.state === 'chase' || this.state === 'attack' || this.state === 'alert') {
      const mine = tracked.find(o => o.p.id === this.target) || tracked.sort((a, b) => a.v.dist - b.v.dist)[0];
      if (mine) {
        this.target = mine.p.id;
        this.lastKnown = { x: mine.p.x, z: mine.p.z, level: mine.p.level, t };
        this.lastSeenT = t;
      }
      return;
    }
    if (this.state === 'kill') return;
    if (fresh.length) {
      const o = fresh.sort((a, b) => a.v.dist - b.v.dist)[0];
      this.enterAlert(o.p, o.v.beamOnCreature);
      return;
    }
    if (light && !['hear', 'investigate'].includes(this.state)) {
      // percebe a luz, mas não o jogador parado: investiga a região aproximada
      this.lightSeen = { t, x: light.p.x, z: light.p.z };
      this.enterHear({ x: light.p.x, y: light.p.y, z: light.p.z, level: light.p.level, type: 'luz da lanterna', t, range: 10 }, { dist: light.v.dist, loudness: 0.6 });
    }
  }
  onSound(ev) { this.pendingSounds.push(ev); }
  processSounds() {
    const m = this.m;
    const evs = this.pendingSounds; this.pendingSounds = [];
    if (!m.phaseCfg.hearing) return; // fase 1: audição desligada
    for (const ev of evs) {
      if (ev.source === 'creature') continue;
      const r = hearingCheck(m, this, ev);
      ev.heardBy = r.heard;
      if (!r.heard) continue;
      this.lastSound = { type: ev.type, x: +ev.x.toFixed(1), z: +ev.z.toFixed(1), level: ev.level, t: ev.t, loudness: +r.loudness.toFixed(2), dist: +r.dist.toFixed(1) };
      if (['attack', 'kill', 'alert'].includes(this.state)) continue;
      if (this.state === 'chase' && (m.t - this.lastSeenT) < 1.0) continue; // alvo visível: ignora
      if (this.invest && ['hear', 'investigate'].includes(this.state)) {
        const age = m.t - this.invest.t;
        if (r.loudness < this.invest.loudness * 0.7 && age < 4) continue;
      }
      this.enterHear(ev, r);
    }
  }
  approxPoint(x, z, level, dist) {
    // posição aproximada da origem (erro proporcional à distância), ajustada à malha navegável
    const err = Math.min(3, 0.12 * dist + 0.4) * Math.sqrt(this.rng.next());
    const a = this.rng.float(0, Math.PI * 2);
    let px = x + Math.cos(a) * err, pz = z + Math.sin(a) * err;
    const n = this.m.nav.nearest(level, px, pz, 8) || this.m.nav.nearest(level, x, z, 10);
    if (n) { px = (n.cx + 0.5) * CELL; pz = (n.cz + 0.5) * CELL; }
    return { x: px, z: pz, level };
  }
  enterHear(ev, r) {
    const quick = ['investigate', 'hear', 'track', 'search', 'chase'].includes(this.state);
    const p = this.approxPoint(ev.x, ev.z, ev.level, r.dist);
    this.invest = { ...p, t: this.m.t, loudness: r.loudness, type: ev.type, srcX: ev.x, srcZ: ev.z };
    this.lookAt = Math.atan2(ev.x - this.x, ev.z - this.z);
    this.path = null;
    this.target = null;
    this.setState('hear', quick ? 0.3 : 0.75);
    this.m.creatureSound(quick ? 'turn' : 'hear');
  }
  enterAlert(p, instant) {
    this.target = p.id;
    this.lastKnown = { x: p.x, z: p.z, level: p.level, t: this.m.t };
    this.lastSeenT = this.m.t;
    this.lookAt = Math.atan2(p.x - this.x, p.z - this.z);
    this.path = null;
    this.setState('alert', instant ? 0.2 : AI.alertTime);
    this.m.creatureSound('alert');
  }
  enterSniff(local = false) {
    this.path = null;
    this.sniffLocal = local;
    this.setState('sniff', local ? 1.3 : AI.sniffDuration);
    this.sniffInfo.state = 'farejando';
    this.m.creatureSound('sniff');
  }
  evaluateScent(radius) {
    const m = this.m, t = m.t;
    const dists = m.nav.pathDistances(this.level, this.x, this.z, radius);
    let best = null, bestScore = 0;
    const visited = this.track ? this.track.visited : null;
    if (visited) for (const e of m.scent.entries(t)) if (e.L === this.level && Math.hypot(e.x - this.x, e.z - this.z) < 1.6) visited.add(e.k);
    for (const e of m.scent.entries(t)) {
      if (e.v < AI.scentThreshold) continue;
      if (visited && visited.has(e.k)) continue; // já verificado: não conta como sinal novo
      // célula de referência (centro) — precisa ser alcançável por caminho, nunca através de parede
      const cx = Math.floor(e.x / CELL), cz = Math.floor(e.z / CELL);
      let d = dists.get(e.L * 84 * 50 + cz * 84 + cx);
      if (d === undefined) d = dists.get(e.L * 84 * 50 + cz * 84 + cx - 1);
      if (d === undefined) d = dists.get(e.L * 84 * 50 + (cz - 1) * 84 + cx);
      if (d === undefined) continue;
      let score = e.v * (1 - d / (radius + 2));
      if (this.track && e.t > this.track.lastCellT + 0.5) score = e.v * (0.6 + 0.4 * Math.min(1, d / 6)) * 1.6; // trilha mais recente adiante
      if (d < 1.2 && this.track) score *= 0.3; // já está aqui
      if (score > bestScore) { bestScore = score; best = { ...e, d }; }
    }
    return best ? { ...best, score: bestScore } : null;
  }
  // -------- atualização --------
  update(dt) {
    const m = this.m, t = m.t;
    this.stateT += dt; this.animT += dt;
    if (this.state === 'freeze') { this.speed = 0; this.pendingSounds = []; return; } // congelada (somente salas de teste)
    if (this.state !== 'idle' || t > AI.graceTime * 0.5) {
      this.visionAcc += dt;
      if (this.visionAcc >= AI.visionTick) { this.visionAcc = 0; if (m.phaseCfg.vision && this.state !== 'idle') this.senseVision(); }
    }
    if (this.state !== 'idle') this.processSounds(); else this.pendingSounds = [];
    if (m.phaseCfg.smell && t >= this.nextSniffT) {
      if (['chase', 'attack', 'alert', 'kill', 'door', 'sniff', 'hear', 'idle'].includes(this.state)) this.nextSniffT = t + 5;
      else { this.nextSniffT = t + this.rng.float(...AI.sniffInterval); this.sniffReturn = this.state; this.enterSniff(false); }
    }
    let desired = 0, turn = CREATURE.turnRate.slow, accel = 2.5;
    let headTarget = 0, pitchTarget = 0;
    const S = this.state;
    switch (S) {
      case 'hold':
        break;
      case 'idle':
        if (t >= AI.graceTime) this.pickPatrol();
        headTarget = Math.sin(t * 0.5) * 0.5;
        break;
      case 'patrol': case 'wander': case 'return': {
        desired = S === 'return' ? CREATURE.speed.search : CREATURE.speed.patrol;
        if (this.arrived()) { this.setState('look', this.rng.float(2, 4)); }
        headTarget = Math.sin(t * 0.7) * 0.35;
        break;
      }
      case 'look':
        headTarget = Math.sin(this.stateT * 1.3) * 1.1;
        if (this.stateT >= this.durState && this.afterLook !== 'search') { if (this.rng.chance(0.45)) this.pickWander(); else this.pickPatrol(); }
        break;
      case 'alert': {
        accel = 12; turn = CREATURE.turnRate.fast;
        if (this.lastKnown) this.lookAt = Math.atan2(this.lastKnown.x - this.x, this.lastKnown.z - this.z);
        this.faceToward(this.lookAt, turn, dt);
        headTarget = clampA(angleDiff(this.lookAt, this.yaw), 1.2);
        if (this.stateT >= this.durState) {
          const tracked = this.vis && this.vis.tracked.includes(this.target);
          if (tracked) { this.setState('chase'); this.chaseStart = t; this.m.creatureSound('roar'); this.path = null; }
          else this.enterSearch();
        }
        break;
      }
      case 'chase': {
        desired = CREATURE.speed.chase[m.phase]; turn = CREATURE.turnRate.fast; accel = 7;
        const tp = m.players.get(this.target);
        const lk = this.lastKnown;
        const lost = t - this.lastSeenT;
        if (!tp || !tp.alive || tp.escaped) { this.target = null; this.enterSearch(); break; }
        if (lk && (!this.goal || Math.hypot(this.goal.x - lk.x, this.goal.z - lk.z) > 0.8 || this.repathT <= 0)) { this.goTo(lk.x, lk.z, lk.level); this.repathT = 0.35; }
        this.repathT -= dt;
        if (lk) headTarget = clampA(angleDiff(Math.atan2(lk.x - this.x, lk.z - this.z), this.yaw), 0.9);
        if (lost < 0.3 && tp.level === this.level) {
          const d = Math.hypot(tp.x - this.x, tp.z - this.z);
          if (d < CREATURE.attackRange && m.world.noWallBetween(this.level, this.x, this.z, tp.x, tp.z)) { this.setState('attack', 0.75); this.struck = false; this.m.creatureSound('attack'); break; }
        }
        if (lost > 0.4 && (this.arrived() || lost > 8)) this.enterSearch();
        break;
      }
      case 'attack': {
        turn = CREATURE.turnRate.fast; accel = 14;
        const tp = m.players.get(this.target);
        if (tp && tp.alive) this.faceToward(Math.atan2(tp.x - this.x, tp.z - this.z), turn, dt);
        desired = this.stateT > 0.2 && this.stateT < 0.45 ? 4.5 : 0.3;
        if (!this.struck && this.stateT >= 0.35) {
          this.struck = true;
          const victims = m.attackStrike(this);
          if (victims.length) { this.setState('kill', 1.9); this.killed = victims[0]; break; }
        }
        if (this.stateT >= this.durState) {
          const tracked = this.vis && this.vis.tracked.includes(this.target);
          if (tracked) this.setState('chase'); else this.enterSearch();
        }
        break;
      }
      case 'kill':
        pitchTarget = -0.5;
        if (this.stateT >= this.durState) { this.target = null; this.setState('recover', this.rng.float(...AI.recoverTime)); }
        break;
      case 'hear': {
        accel = 10; turn = CREATURE.turnRate.fast;
        this.faceToward(this.lookAt, turn * 0.7, dt);
        headTarget = clampA(angleDiff(this.lookAt, this.yaw), 1.2);
        if (this.stateT >= this.durState) { this.setState('investigate'); this.goTo(this.invest.x, this.invest.z, this.invest.level); }
        break;
      }
      case 'investigate': {
        desired = CREATURE.speed.investigate;
        headTarget = Math.sin(t * 1.1) * 0.4;
        if (this.arrived()) {
          this.lastInvestigated = { x: +this.invest.x.toFixed(1), z: +this.invest.z.toFixed(1), level: this.invest.level, t, room: this.roomName(), reason: this.invest.type };
          this.setState('inspect', this.rng.float(3, 5));
          this.inspectProp = this.nearestProp();
        }
        break;
      }
      case 'inspect': {
        headTarget = Math.sin(this.stateT * 1.6) * 1.2; pitchTarget = this.inspectProp ? -0.35 : -0.1;
        if (this.inspectProp && this.stateT < 1.5) this.faceToward(Math.atan2(this.inspectProp.x - this.x, this.inspectProp.z - this.z), 2, dt);
        if (this.stateT >= this.durState) {
          if (this.track && t - this.track.lastSignalT < AI.scentGiveUp) { this.enterSniff(true); break; }
          if (this.track) { this.track = null; this.sniffInfo.state = 'rastro abandonado'; }
          this.invest = null;
          this.setState('recover', this.rng.float(...AI.recoverTime));
        }
        break;
      }
      case 'search': {
        desired = this.searchPhase === 0 ? 2.6 : CREATURE.speed.search;
        headTarget = Math.sin(t * 1.4) * 0.8;
        if (this.arrived()) {
          if (this.searchPhase === 0) this.lastInvestigated = { x: +this.goal.x.toFixed(1), z: +this.goal.z.toFixed(1), level: this.goal.level, t, room: this.roomName(), reason: 'última posição conhecida' };
          this.searchPhase++;
          if (this.searchPhase <= 2 && this.stateT < 14) { this.setState('look', this.rng.float(...AI.searchTime) * 0.6); this.afterLook = 'search'; }
          else { this.setState('return'); this.pickPatrol('return'); }
        }
        break;
      }
      case 'sniff': {
        pitchTarget = -0.55; headTarget = Math.sin(this.stateT * 9) * 0.12;
        if (this.stateT >= this.durState) {
          const best = this.evaluateScent(this.sniffLocal ? 8 : AI.sniffRadius);
          this.sniffInfo.lastT = t;
          if (best) {
            this.sniffInfo.found = true; this.sniffInfo.strength = +best.v.toFixed(2); this.sniffInfo.state = 'rastro encontrado';
            const off = this.approxPoint(best.x, best.z, best.L, 4);
            const visited = this.track ? this.track.visited : new Set(); visited.add(best.k);
            this.track = { x: off.x, z: off.z, L: best.L, lastSignalT: t, lastCellT: best.t, steps: (this.track ? this.track.steps : 0) + 1, visited };
            this.setState('track'); this.goTo(off.x, off.z, best.L);
            this.m.creatureSound('sniff_found');
          } else {
            this.sniffInfo.found = false; this.sniffInfo.strength = 0;
            if (this.track) {
              this.sniffInfo.state = 'sinal fraco — investigando área';
              if (t - this.track.lastSignalT > AI.scentGiveUp) { this.track = null; this.sniffInfo.state = 'rastro abandonado'; this.setState('return'); this.pickPatrol('return'); }
              else { this.setState('inspect', 3); this.inspectProp = null; }
            } else { this.sniffInfo.state = 'nada encontrado'; this.pickPatrol(); }
          }
        }
        break;
      }
      case 'track': {
        desired = CREATURE.speed.scent;
        pitchTarget = -0.3; headTarget = Math.sin(t * 2) * 0.3;
        if (this.arrived()) { this.lastInvestigated = { x: +this.track.x.toFixed(1), z: +this.track.z.toFixed(1), level: this.track.L, t, room: this.roomName(), reason: 'rastro de cheiro' }; this.enterSniff(true); }
        if (this.track && t - this.track.lastSignalT > AI.scentGiveUp + 10) { this.track = null; this.setState('return'); this.pickPatrol('return'); }
        break;
      }
      case 'recover':
        headTarget = Math.sin(this.stateT * 0.8) * 0.3;
        if (this.stateT >= this.durState) this.pickPatrol();
        break;
      case 'door': {
        if (this.stateT >= 0.85) {
          this.m.creatureOpensDoor(this.doorId);
          this.setState(this.resume || 'patrol'); this.resume = null;
        }
        break;
      }
    }
    if (this.state === 'look' && this.afterLook === 'search' && this.stateT >= this.durState) {
      this.afterLook = null; this.state = 'search'; this.stateT = 0;
      const p = this.randomNearby(5);
      if (p) this.goTo(p.x, p.z, this.level); else { this.setState('return'); this.pickPatrol('return'); }
    }
    // cabeça
    this.headYaw += (headTarget - this.headYaw) * Math.min(1, dt * 5);
    this.headPitch += (pitchTarget - this.headPitch) * Math.min(1, dt * 4);
    this.moveAlongPath(dt, desired, turn, accel);
    this.animFromState();
    this.trace.push({ t, x: this.x, z: this.z, level: this.level });
    if (this.trace.length > 400) this.trace.shift();
  }
  animFromState() {
    const S = this.state;
    let a = 'idle';
    if (S === 'chase') a = this.speed > 1 ? 'run' : 'idle';
    else if (S === 'investigate' || S === 'track' || S === 'search') a = this.speed > 0.2 ? 'investigate_walk' : 'look';
    else if (S === 'patrol' || S === 'wander' || S === 'return') a = this.speed > 0.2 ? 'walk' : 'idle';
    else if (S === 'alert') a = this.stateT < 0.35 ? 'stop' : 'turn';
    else if (S === 'hear') a = 'hear';
    else if (S === 'sniff') a = 'sniff';
    else if (S === 'inspect') a = this.inspectProp ? 'inspect' : 'look';
    else if (S === 'look') a = 'look';
    else if (S === 'attack') a = 'attack';
    else if (S === 'kill') a = 'kill';
    else if (S === 'recover') a = 'recover';
    else if (S === 'door') a = 'door';
    if (this.prevSpeed > 2.5 && this.speed < this.prevSpeed - 0.25 && ['alert', 'hear'].includes(S)) a = 'stop';
    this.prevSpeed = this.speed;
    if (a !== this.anim) { this.anim = a; this.animT = 0; }
  }
  // -------- navegação --------
  roomName() { const r = this.m.world.roomAt(this.level, this.x, this.z); return r >= 0 ? this.m.map.rooms[r].name : 'passagem'; }
  nearestProp() {
    let best = null, bd = 2.6;
    for (const p of this.m.map.props) { if (p.level !== this.level) continue; const d = Math.hypot(p.x - this.x, p.z - this.z); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  goTo(x, z, level) {
    this.goal = { x, z, level };
    const path = this.m.nav.findPath(this.level, this.x, this.z, level, x, z);
    if (!path || path.length === 0) { this.path = null; this.repathFails++; return false; }
    this.path = path; this.pathIdx = path.length > 1 ? 1 : 0; this.repathFails = 0;
    this.stuckT = 0; this.stuckRef = { x: this.x, z: this.z };
    return true;
  }
  arrived() {
    if (!this.path) return true;
    return this.pathIdx >= this.path.length;
  }
  pickPatrol(stateName = 'patrol') {
    const m = this.m;
    const rooms = m.map.rooms.filter(r => r.type !== 'stairs' || !r.top);
    let best = null, bestScore = -1;
    for (let k = 0; k < 8; k++) {
      const r = this.rng.pick(rooms);
      const last = this.visited.get(r.id) ?? -1e9;
      const score = Math.min(200, m.t - last) + this.rng.float(0, 40) - (r.level !== this.level ? 25 : 0);
      if (score > bestScore) { bestScore = score; best = r; }
    }
    for (let k = 0; k < 12; k++) {
      const cx = this.rng.int(best.x0, best.x1), cz = this.rng.int(best.z0, best.z1);
      if (m.nav.walkable(best.level, cx, cz)) {
        this.visited.set(best.id, m.t);
        this.setState(stateName);
        if (this.goTo((cx + 0.5) * CELL, (cz + 0.5) * CELL, best.level)) return;
      }
    }
    this.pickWander();
  }
  randomNearby(r) {
    const m = this.m;
    for (let k = 0; k < 15; k++) {
      const a = this.rng.float(0, Math.PI * 2), d = this.rng.float(1.5, r);
      const x = this.x + Math.cos(a) * d, z = this.z + Math.sin(a) * d;
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      if (m.nav.walkable(this.level, cx, cz) && m.world.noWallBetween(this.level, this.x, this.z, x, z)) return { x: (cx + 0.5) * CELL, z: (cz + 0.5) * CELL };
    }
    return null;
  }
  pickWander() {
    const p = this.randomNearby(7);
    this.setState('wander');
    if (!p || !this.goTo(p.x, p.z, this.level)) { this.path = null; this.setState('look', 2); }
  }
  enterSearch() {
    const lk = this.lastKnown;
    this.searchPhase = 0;
    this.setState('search');
    if (!lk) { this.pickPatrol('return'); return; }
    // última posição conhecida com pequena incerteza
    const p = this.approxPoint(lk.x, lk.z, lk.level, 6);
    if (!this.goTo(p.x, p.z, p.level)) this.pickPatrol('return');
  }
  faceToward(yaw, rate, dt) {
    const d = angleDiff(yaw, this.yaw);
    const step = Math.max(-rate * dt, Math.min(rate * dt, d));
    this.yaw += step;
  }
  moveAlongPath(dt, desired, turn, accel) {
    const m = this.m;
    let moveYaw = this.yaw;
    if (this.path && this.pathIdx < this.path.length && desired > 0) {
      let wp = this.path[this.pathIdx];
      let d = Math.hypot(wp.x - this.x, wp.z - this.z);
      while (d < (this.pathIdx === this.path.length - 1 ? 0.35 : 0.55)) {
        this.pathIdx++;
        if (this.pathIdx >= this.path.length) break;
        wp = this.path[this.pathIdx]; d = Math.hypot(wp.x - this.x, wp.z - this.z);
      }
      if (this.pathIdx < this.path.length) {
        // porta fechada adiante?
        for (let k = this.pathIdx; k < Math.min(this.path.length, this.pathIdx + 4); k++) {
          const q = this.path[k];
          if (Math.hypot(q.x - this.x, q.z - this.z) > 1.6) break;
          const doorCells = this.doorCellsBetween(q);
          if (doorCells >= 0 && this.state !== 'door') {
            this.resume = this.state; this.doorId = doorCells; this.setState('door'); this.speed = 0; return;
          }
        }
        const want = Math.atan2(wp.x - this.x, wp.z - this.z);
        this.faceToward(want, turn, dt);
        const diff = Math.abs(angleDiff(want, this.yaw));
        const align = Math.max(0, Math.cos(Math.min(Math.PI / 2, diff)));
        desired *= align * align;
        moveYaw = this.yaw;
      } else desired = 0;
    } else desired = 0;
    // aceleração / parada repentina
    const a = desired < this.speed ? Math.max(accel, 9) : accel;
    this.speed += Math.max(-a * dt, Math.min(a * dt, desired - this.speed));
    if (this.speed < 0.01) { this.speed = 0; return; }
    const dx = Math.sin(moveYaw) * this.speed * dt, dz = Math.cos(moveYaw) * this.speed * dt;
    const r = m.world.move(this.level, this.x, this.z, dx, dz, 0.42, false);
    this.x = r.x; this.z = r.z; this.level = r.level;
    this.y = m.world.floorY(this.level, this.x, this.z);
    // travado?
    this.stuckT += dt;
    if (this.stuckT > 1.5) {
      const moved = Math.hypot(this.x - this.stuckRef.x, this.z - this.stuckRef.z);
      this.stuckT = 0; this.stuckRef = { x: this.x, z: this.z };
      if (moved < 0.3 && this.goal) {
        if (!this.goTo(this.goal.x, this.goal.z, this.goal.level) || this.repathFails > 2) { this.path = null; }
        if (this.unstuckCount === undefined) this.unstuckCount = 0;
        if (++this.unstuckCount > 3) { this.unstuckCount = 0; this.path = null; this.pickWander(); }
      }
    }
  }
  doorCellsBetween(q) {
    const w = this.m.world;
    const cx = Math.floor(q.x / CELL), cz = Math.floor(q.z / CELL);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const L = q.L;
      if (w.cell(L, cx + a, cz + b) === 3 /* DOOR */ && w.isDoorClosedCell(L, cx + a, cz + b)) return w.doorAt(L, cx + a, cz + b);
    }
    return -1;
  }
  senseSummary() {
    const p = this.m.phaseCfg;
    return { visao: p.vision, audicao: p.hearing, olfato: p.smell };
  }
  snapshot() {
    return {
      x: +this.x.toFixed(3), y: +this.y.toFixed(3), z: +this.z.toFixed(3), level: this.level,
      yaw: +this.yaw.toFixed(3), headYaw: +this.headYaw.toFixed(3), headPitch: +this.headPitch.toFixed(3),
      state: this.state, anim: this.anim, animT: +this.animT.toFixed(2), speed: +this.speed.toFixed(2),
    };
  }
}
const clampA = (v, m) => Math.max(-m, Math.min(m, v));
