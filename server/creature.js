// Criatura: máquina de estados autoritativa no servidor.
// Ela só conhece jogadores pelo que seus sentidos (visão / audição / olfato) da fase permitem.
import { AI, CREATURE, CELL, LEVELS, W } from '../shared/config.js';
import { visionCheck, hearingCheck, angleDiff } from './senses.js';
import { roomGraph, roomNear } from '../shared/sound.js';

export const STATE_LABEL = {
  patrol: 'Patrulhando', wander: 'Caminhando sem destino', look: 'Observando', alert: 'Percebeu algo (confirmando)',
  chase: 'Perseguindo jogador', attack: 'Atacando', kill: 'Matando', hear: 'Reagindo a som',
  investigate: 'Investigando som', inspect: 'Investigando o local', search: 'Procurando pessoa (última posição)',
  sniff: 'Farejando', track: 'Rastreando cheiro', recover: 'Recuperando-se da investigação', return: 'Retornando à exploração',
  door: 'Abrindo porta', stalk: 'Viu algo se mexer ao longe (aproximando-se)', check: 'Conferindo em volta e cômodos vizinhos', idle: 'Despertando', sweep: 'Vasculhando o cômodo', hold: 'Parada (teste)', freeze: 'Congelada (teste)',
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
    this.target = null; this.lastKnown = null; this.lastSeenT = -1e9; this.detectT = new Map(); this.losLost = new Map();
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
    // --- comportamento dirigido (diretor) ---
    this.sweep = null; this.passBy = null; this.lookNext = null; this.inspectNext = null;
    this.tension = false; this.stillT = 0; this.maxStill = 0;
    this.roomHist = []; this.lastRoom = -1; this.lastDoorPauseT = -1e9;
    this.vx = 0; this.vz = 0; this.yawRate = 0;
    // v2: presença — última vez que esteve perto de alguém; "bastidores" (longe e sem ninguém vendo)
    this.lastNearT = 0; this.unseenFar = false; this.presenceAcc = 1; this.rushing = false; this.stalk = null;
  }
  get dir() { return this.m.director; }
  get menace() { return this.m.director ? this.m.director.menace : 0; }
  // multiplicador leve de velocidade conforme a ameaça (nunca na perseguição: fuga continua possível)
  get mm() { return 1 + 0.15 * this.menace; }
  get rng() { return this.m.rng; }
  setState(s, dur = 0) {
    if (this.state !== s) { this.state = s; this.stateT = 0; this.animT = 0; if (s !== 'look') this.tension = false; }
    this.durState = dur;
  }
  // interrompe planos de patrulha (sentido percebeu algo)
  dropPlans() { this.sweep = null; this.passBy = null; this.lookNext = null; this.inspectNext = null; this.tension = false; this.stalk = null; }
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
      // quebrou a linha de visão por ~1 s: a memória da detecção some — um jogador PARADO
      // não é "readquirido" ao reaparecer; só volta a ser visto se se mexer
      if (!v.los) {
        if (!this.losLost.has(p.id)) this.losLost.set(p.id, t);
        else if (t - this.losLost.get(p.id) >= 1.0) this.detectT.delete(p.id);
      } else this.losLost.delete(p.id);
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
      // v2: viu alguém se mexer MUITO longe (ex.: da entrada ao fim do corredor de cima) → não dispara:
      // vai andando aos poucos naquela direção; só persegue se voltar a ver movimento mais perto
      if (o.v.dist > AI.stalkRange && !o.v.beamOnCreature) { this.enterStalk(o.p); return; }
      this.enterAlert(o.p, o.v.beamOnCreature);
      return;
    }
    if (light && !['hear', 'investigate'].includes(this.state)) {
      // percebe a luz, mas não o jogador parado: investiga a região aproximada
      this.lightSeen = { t, x: light.p.x, z: light.p.z };
      this.enterHear({ x: light.p.x, y: light.p.y, z: light.p.z, level: light.p.level, type: 'luz da lanterna', t, range: 10 }, { dist: light.v.dist, loudness: 0.6 });
    }
  }
  enterStalk(p) {
    const t = this.m.t;
    if (this.state === 'stalk' && this.stalk && t - this.stalk.t < 1.0) return; // atualiza no máx. 1×/s
    if (this.dir) this.dir.onSighting();
    const pt = this.approxPoint(p.x, p.z, p.level, 6);
    if (this.state !== 'stalk') { this.dropPlans(); this.m.creatureSound('turn'); }
    this.stalk = { ...pt, t, who: p.id };
    this.lookAt = Math.atan2(p.x - this.x, p.z - this.z);
    this.setState('stalk');
    if (!this.goTo(pt.x, pt.z, pt.level)) this.pickPatrol();
  }
  // v2: depois de chegar a um ponto suspeito: circula em volta e confere 1–2 cômodos vizinhos do mesmo andar
  startCheckAround(x, z, level) {
    const pts = [];
    for (let k = 0; k < 2; k++) { const p = this.randomAround(x, z, level, 4); if (p) pts.push(p); }
    const rid = roomNear(this.m.map, level, x, z);
    if (rid >= 0) {
      const nb = [...roomGraph(this.m.map)[rid]].map(i => this.m.map.rooms[i]).filter(r => r.level === level && r.type !== 'stairs');
      this.rng.shuffle(nb);
      for (const r of nb.slice(0, this.rng.int(1, 2))) { const p = this.roomPoint(r, { x, z }); if (p) pts.push(p); }
    }
    this.sweep = { room: -1, pts, i: -1, pause: this.rng.float(0.3, 0.8), inspected: true, check: true };
    this.setState('check');
    this.path = null;
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
      this.lastSound = { type: ev.type, lvl: ev.lvl, why: r.why, x: +ev.x.toFixed(1), z: +ev.z.toFixed(1), level: ev.level, t: ev.t, loudness: +r.loudness.toFixed(2), dist: +r.dist.toFixed(1) };
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
    this.rushing = (r.dist + Math.abs(ev.level - this.level) * 6) > 13; // longe → vai correndo
    this.dropPlans();
    this.lookAt = Math.atan2(ev.x - this.x, ev.z - this.z);
    this.path = null;
    this.target = null;
    this.setState('hear', quick ? 0.3 : 0.75);
    this.m.creatureSound(quick ? 'turn' : 'hear');
  }
  // v2 (justiça): se ela está prestes a esbarrar num jogador PARADO que não percebeu, para a centímetros dele,
  // "fareja o ar" por um instante (tensão máxima) e muda de rumo. Se ele se mexer nesse momento, é visto.
  closeCall() {
    const S = this.state;
    if (!['patrol', 'wander', 'return', 'sweep', 'check', 'investigate', 'stalk', 'search', 'track'].includes(S) || this.speed < 0.2) return;
    const m = this.m, t = m.t;
    for (const p of m.players.values()) {
      if (!p.alive || p.escaped || !p.connected || p.level !== this.level) continue;
      if (this.detectT.has(p.id) && t - this.detectT.get(p.id) < AI.detectionMemory) continue; // já percebido: segue a regra normal
      const dx = p.x - this.x, dz = p.z - this.z, d = Math.hypot(dx, dz);
      if (d > 2.0) continue;
      if (Math.abs(angleDiff(Math.atan2(dx, dz), this.yaw)) > 1.2 && d > 1.3) continue;
      if (this.closeCallT && t - this.closeCallT < 3) continue;
      if (!m.world.noWallBetween(this.level, this.x, this.z, p.x, p.z)) continue;
      this.closeCallT = t;
      this.avoidPt = { x: p.x, z: p.z, level: p.level, until: t + 25 };
      const st = S === 'sweep' || S === 'check' ? 'patrol' : S;
      this.dropPlans(); this.path = null; this.speed = Math.min(this.speed, 0.3);
      this.setState('look', this.rng.float(1.8, 2.8)); this.tension = true;
      this.lastInvestigated = { x: +this.x.toFixed(1), z: +this.z.toFixed(1), level: this.level, t, room: this.roomName(), reason: 'quase esbarrou em alguém parado' };
      this.lookNext = () => { this.setState(st === 'investigate' || st === 'stalk' || st === 'search' || st === 'track' ? 'return' : st); this.pickPatrol(this.state === 'return' ? 'return' : 'patrol'); };
      return;
    }
  }
  // caminho passa perto do ponto a evitar (jogador parado com quem quase esbarrou)?
  pathAvoids(path) {
    const a = this.avoidPt; if (!a || this.m.t > a.until || !path) return true;
    for (let i = 0; i < path.length; i++) {
      const q = path[i], r = path[i + 1] || q;
      if (q.L !== a.level) continue;
      // distância do ponto ao segmento q→r
      const vx = r.x - q.x, vz = r.z - q.z, l2 = vx * vx + vz * vz;
      const u = l2 ? Math.max(0, Math.min(1, ((a.x - q.x) * vx + (a.z - q.z) * vz) / l2)) : 0;
      if (Math.hypot(q.x + vx * u - a.x, q.z + vz * u - a.z) < 1.6) return false;
    }
    return true;
  }
  // perto de alguém? alguém a vê? (para o diretor "nunca sumir" e para a velocidade de bastidores)
  updatePresence() {
    const m = this.m; let minD = Infinity, seen = false;
    for (const p of m.players.values()) {
      if (!p.alive || p.escaped || !p.connected) continue;
      const d = Math.hypot(p.x - this.x, p.z - this.z) + Math.abs(p.level - this.level) * 8;
      if (d < minD) minD = d;
      if (!seen && Math.abs(p.y - this.y) < 2.4 && d < 30 && m.world.lineOfSight(this.level, this.x, this.z, p.x, p.z)) seen = true;
    }
    if (minD < 14) this.lastNearT = m.t;
    this.unseenFar = !seen && minD > 18;
    this.minPlayerDist = minD;
  }
  enterAlert(p, instant) {
    this.dropPlans();
    if (this.dir) this.dir.onSighting();
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
    this.presenceAcc += dt;
    if (this.presenceAcc >= 0.3) { this.presenceAcc = 0; this.updatePresence(); }
    if (this.state !== 'idle' || t > AI.graceTime * 0.5) {
      this.visionAcc += dt;
      if (this.visionAcc >= AI.visionTick) { this.visionAcc = 0; if (m.phaseCfg.vision && this.state !== 'idle') this.senseVision(); }
    }
    if (this.state !== 'idle') this.processSounds(); else this.pendingSounds = [];
    this.closeCall();
    if (m.phaseCfg.smell && t >= this.nextSniffT) {
      if (['chase', 'attack', 'alert', 'kill', 'door', 'sniff', 'hear', 'idle'].includes(this.state)) this.nextSniffT = t + 5;
      else { this.nextSniffT = t + this.rng.float(...AI.sniffInterval); this.sniffReturn = this.state; this.enterSniff(false); }
    }
    let desired = 0, turn = CREATURE.turnRate.slow, accel = 2.5;
    let headTarget = 0, pitchTarget = 0;
    this.doorwayPause();
    const S = this.state;
    switch (S) {
      case 'hold':
        break;
      case 'idle':
        if (t >= AI.graceTime) this.pickPatrol();
        headTarget = Math.sin(t * 0.5) * 0.5;
        break;
      case 'patrol': case 'wander': case 'return': {
        desired = (S === 'return' ? CREATURE.speed.search : CREATURE.speed.patrol) * this.mm;
        if (this.passBy) desired = CREATURE.speed.patrol * 0.92; // passa devagar pela região dos jogadores
        // v2: nos "bastidores" (longe de todos e sem ninguém vendo) anda bem mais rápido — some para longe
        // e reaparece perto "do nada", sem teleporte. Perto dos jogadores volta ao passo lento e pesado.
        if (this.unseenFar) desired = Math.max(desired, CREATURE.speed.backstage);
        if (this.arrived()) this.arrivePatrol();
        headTarget = Math.sin(t * 0.7) * 0.35;
        break;
      }
      case 'look':
        headTarget = Math.sin(this.stateT * 1.3) * 1.1;
        if (this.stateT >= this.durState && this.afterLook !== 'search') {
          if (this.lookNext) { const f = this.lookNext; this.lookNext = null; f(); }
          else this.pickPatrol();
        }
        break;
      case 'sweep': case 'check': {
        const sw = this.sweep;
        if (!sw) { this.pickPatrol(); break; }
        desired = (S === 'check' ? CREATURE.speed.investigate * 0.85 : CREATURE.speed.patrol * 0.95) * this.mm;
        headTarget = Math.sin(t * 1.2) * 0.6;
        if (sw.pause > 0) {
          sw.pause -= dt; desired = 0;
          headTarget = Math.sin(this.stateT * 1.6) * 1.15;
          if (sw.pause <= 0) this.sweepNext();
        } else if (this.arrived()) {
          const prop = this.nearestProp();
          if (prop && !sw.inspected && this.rng.chance(0.4)) {
            sw.inspected = true; this.inspectProp = prop; this.inspectNext = 'sweep';
            this.setState('inspect', this.rng.float(1.4, 2.4));
            this.lastInvestigated = { x: +this.x.toFixed(1), z: +this.z.toFixed(1), level: this.level, t, room: this.roomName(), reason: 'vasculhando móveis' };
          } else sw.pause = this.rng.float(0.5, 1.3);
        }
        break;
      }
      case 'alert': {
        accel = 12; turn = CREATURE.turnRate.fast;
        if (this.lastKnown) this.lookAt = Math.atan2(this.lastKnown.x - this.x, this.lastKnown.z - this.z);
        this.faceToward(this.lookAt, turn, dt);
        headTarget = clampA(angleDiff(this.lookAt, this.yaw), 1.2);
        if (this.stateT >= this.durState) {
          const tracked = this.vis && this.vis.tracked.includes(this.target);
          if (tracked) { this.setState('chase'); this.chaseStart = t; this.m.creatureSound('roar'); this.path = null; }
          else { if (this.dir) this.dir.onEncounterEnd('encontro próximo'); this.enterSearch(); }
        }
        break;
      }
      case 'chase': {
        desired = CREATURE.speed.chase[m.phase]; turn = CREATURE.turnRate.fast; accel = 7;
        const tp = m.players.get(this.target);
        const lk = this.lastKnown;
        const lost = t - this.lastSeenT;
        // perdeu a linha de visão: corre menos (incerteza) — quebrar a visão e ficar parado compensa
        if (lost > 0.6) desired *= 0.8;
        if (!tp || !tp.alive || tp.escaped) { this.target = null; if (this.dir) this.dir.onEncounterEnd('perseguição'); this.enterSearch(); break; }
        if (lk && (!this.goal || Math.hypot(this.goal.x - lk.x, this.goal.z - lk.z) > 0.8 || this.repathT <= 0)) { this.goTo(lk.x, lk.z, lk.level); this.repathT = 0.35; }
        this.repathT -= dt;
        if (lk) headTarget = clampA(angleDiff(Math.atan2(lk.x - this.x, lk.z - this.z), this.yaw), 0.9);
        if (lost < 0.3 && tp.level === this.level) {
          const d = Math.hypot(tp.x - this.x, tp.z - this.z);
          if (d < CREATURE.attackRange && m.world.noWallBetween(this.level, this.x, this.z, tp.x, tp.z)) { this.setState('attack', 0.75); this.struck = false; this.m.creatureSound('attack'); break; }
        }
        if (lost > 0.4 && (this.arrived() || lost > 8)) { if (this.dir) this.dir.onEncounterEnd('perseguição'); this.enterSearch(); }
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
          if (victims.length) { this.setState('kill', 1.9); this.killed = victims[0]; if (this.dir) this.dir.onEncounterEnd('morte'); break; }
        }
        if (this.stateT >= this.durState) {
          const tracked = this.vis && this.vis.tracked.includes(this.target);
          if (tracked) this.setState('chase'); else { if (this.dir) this.dir.onEncounterEnd('perseguição'); this.enterSearch(); }
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
        desired = CREATURE.speed.investigate * this.mm;
        // v2: som distante → CORRE até lá; ao se aproximar (< ~9 m em linha reta) desacelera e anda
        { const dd = this.invest ? Math.hypot(this.invest.x - this.x, this.invest.z - this.z) + Math.abs(this.invest.level - this.level) * 6 : 0;
          if (this.rushing && dd < 9) this.rushing = false;
          if (this.rushing) desired = CREATURE.speed.rush; }
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
          if (this.inspectNext === 'sweep' && this.sweep) { this.inspectNext = null; this.inspectProp = null; this.setState('sweep'); this.sweepNext(); break; }
          this.inspectNext = null;
          if (this.track && t - this.track.lastSignalT < AI.scentGiveUp) { this.enterSniff(true); break; }
          if (this.track) { this.track = null; this.sniffInfo.state = 'rastro abandonado'; }
          const iv = this.invest; this.invest = null;
          // v2: investigou um som → circula e confere cômodos vizinhos antes de desistir
          if (iv && iv.type !== 'luz da lanterna') { this.startCheckAround(iv.x, iv.z, iv.level); break; }
          this.setState('recover', this.rng.float(...AI.recoverTime));
        }
        break;
      }
      case 'search': {
        desired = this.searchPhase === 0 ? 2.6 : CREATURE.speed.search * this.mm;
        headTarget = Math.sin(t * 1.4) * 0.8;
        if (this.arrived()) {
          if (this.searchPhase === 0) this.lastInvestigated = { x: +this.goal.x.toFixed(1), z: +this.goal.z.toFixed(1), level: this.goal.level, t, room: this.roomName(), reason: 'última posição conhecida' };
          this.searchPhase++;
          if (this.searchPhase <= 3 && this.stateT < 22) { this.setState('look', this.rng.float(...AI.searchTime) * 0.6); this.afterLook = 'search'; }
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
        desired = CREATURE.speed.scent * this.mm;
        pitchTarget = -0.3; headTarget = Math.sin(t * 2) * 0.3;
        if (this.arrived()) { this.lastInvestigated = { x: +this.track.x.toFixed(1), z: +this.track.z.toFixed(1), level: this.track.L, t, room: this.roomName(), reason: 'rastro de cheiro' }; this.enterSniff(true); }
        if (this.track && t - this.track.lastSignalT > AI.scentGiveUp + 10) { this.track = null; this.setState('return'); this.pickPatrol('return'); }
        break;
      }
      case 'stalk': {
        desired = CREATURE.speed.investigate * 0.9 * this.mm;
        headTarget = clampA(angleDiff(this.lookAt ?? this.yaw, this.yaw), 0.8);
        if (this.arrived()) { const st = this.stalk || { x: this.x, z: this.z, level: this.level }; this.lastInvestigated = { x: +st.x.toFixed(1), z: +st.z.toFixed(1), level: st.level, t, room: this.roomName(), reason: 'vulto visto ao longe' }; this.stalk = null; this.startCheckAround(st.x, st.z, st.level); }
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
      // busca em expansão: 4 m → 7 m → 10 m ao redor da última posição conhecida
      const lk = this.lastKnown || { x: this.x, z: this.z, level: this.level };
      const p = this.randomAround(lk.x, lk.z, lk.level, 1 + 3 * this.searchPhase);
      if (!p || !this.goTo(p.x, p.z, p.level)) { this.setState('return'); this.pickPatrol('return'); }
    }
    // cabeça
    this.headYaw += (headTarget - this.headYaw) * Math.min(1, dt * 5);
    this.headPitch += (pitchTarget - this.headPitch) * Math.min(1, dt * 4);
    const px = this.x, pz = this.z, pyaw = this.yaw;
    this.moveAlongPath(dt, desired, turn, accel);
    if (dt > 0) { this.vx = (this.x - px) / dt; this.vz = (this.z - pz) / dt; this.yawRate = angleDiff(this.yaw, pyaw) / dt; }
    this.watchdog(dt);
    this.animFromState();
    this.trace.push({ t, x: this.x, z: this.z, level: this.level });
    if (this.trace.length > 400) this.trace.shift();
  }
  animFromState() {
    const S = this.state;
    let a = 'idle';
    if (S === 'chase') a = this.speed > 1 ? 'run' : 'idle';
    else if (S === 'investigate' && this.rushing && this.speed > 2.4) a = 'run';
    else if (S === 'investigate' || S === 'track' || S === 'search' || S === 'stalk' || S === 'check') a = this.speed > 0.2 ? 'investigate_walk' : 'look';
    else if ((S === 'patrol' || S === 'return') && this.speed > 2.6) a = 'run';
    else if (S === 'patrol' || S === 'wander' || S === 'return') a = this.speed > 0.2 ? 'walk' : 'idle';
    else if (S === 'sweep') a = this.speed > 0.2 ? 'walk' : 'look';
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
  // ---------- patrulha dirigida ----------
  // Salas candidatas a destino (as rampas de escada não são destino; a navegação as usa sozinha).
  patrolRooms() {
    if (!this._rooms) this._rooms = this.m.map.rooms.filter(r => r.type !== 'stairs');
    return this._rooms;
  }
  // ponto navegável dentro de uma sala; com "near", escolhe a amostra mais próxima desse ponto
  roomPoint(room, near = null, samples = 14) {
    const m = this.m;
    let best = null, bd = Infinity;
    for (let k = 0; k < samples * 2 && (!best || k < samples); k++) {
      const cx = this.rng.int(room.x0, room.x1), cz = this.rng.int(room.z0, room.z1);
      if (!m.nav.walkable(room.level, cx, cz)) continue;
      if (m.map.levels[room.level].room[cz * W + cx] !== room.id) continue;
      const x = (cx + 0.5) * CELL, z = (cz + 0.5) * CELL;
      const d = near ? Math.hypot(x - near.x, z - near.z) : this.rng.next();
      if (d < bd) { bd = d; best = { x, z, level: room.level }; }
      if (!near) break;
    }
    return best;
  }
  // Escolha de destino ponderada pelo diretor:
  //  ameaça baixa → salas longe da região (aproximada) dos jogadores;
  //  ameaça alta → salas/corredores cada vez mais perto dessa região (que tem erro proposital).
  pickPatrol(stateName = 'patrol') {
    const m = this.m, t = m.t, dir = this.dir;
    this.sweep = null; this.lookNext = null; this.inspectNext = null; this.tension = false;
    if (stateName !== 'return') this.passBy = null;
    if (dir && dir.wantsPassBy() && this.planPassBy(stateName)) return;
    this.passBy = null;
    const hint = dir ? dir.regionHint() : null;
    const menace = this.menace;
    const rooms = this.patrolRooms();
    const here = m.world.roomAt(this.level, this.x, this.z);
    const scored = [];
    // retorno ocasional à sala anterior ("volta atrás")
    const prev = this.roomHist.length >= 2 ? this.roomHist[this.roomHist.length - 2] : -1;
    for (const r of rooms) {
      if (r.id === here && this.rng.chance(0.85)) continue;
      const last = this.visited.get(r.id) ?? -1e9;
      const age = t - last;
      let score = this.rng.float(0, 1.3);
      score -= age < 120 ? (1 - age / 120) * 3.2 : 0;           // evita repetir salas recentes
      if (hint) {
        const d = dir.roomDist(r, hint);
        const pref = 26 * (1 - menace);                             // distância preferida até a região
        score -= Math.abs(d - pref) / (5 + 4 * (1 - menace));
        if (r.type === 'corridor') score += 0.25 + 0.7 * menace;   // corredores ligam as regiões
      }
      // recipientes ainda fechados (áreas que os jogadores ainda vão revistar)
      let closed = 0; for (const c of m.map.containers) if (c.room === r.id && !m.containerOpen[c.id]) closed++;
      score += Math.min(1, closed * 0.25);
      // custo de viagem (aproximado)
      score -= (Math.hypot((r.x0 + r.x1) * CELL / 2 - this.x, (r.z0 + r.z1) * CELL / 2 - this.z) + Math.abs(r.level - this.level) * 8) / 70;
      if (r.id === prev && age > 25 && this.rng.chance(0.25)) score += 2.5; // volta atrás
      scored.push({ r, score });
    }
    scored.sort((a, b) => b.score - a.score);
    for (const { r } of scored.slice(0, 4)) {
      const pt = this.roomPoint(r, hint && menace > 0.35 && hint.level === r.level ? hint : null);
      if (!pt) continue;
      this.setState(stateName);
      if (this.goTo(pt.x, pt.z, pt.level) && (this.pathAvoids(this.path) || r === scored[Math.min(3, scored.length - 1)].r)) {
        this.visited.set(r.id, t);
        if (dir) dir.target = { kind: stateName === 'return' ? 'retorno' : 'patrulha', room: r.name, roomId: r.id, level: r.level, x: +pt.x.toFixed(1), z: +pt.z.toFixed(1), err: hint ? hint.err : null };
        return;
      }
    }
    this.pickWander();
  }
  // "Passagem": rota que atravessa a sala/corredor aproximado dos jogadores e segue adiante.
  // Se eles ficarem parados (fase 1), ela passa sem perceber ninguém.
  planPassBy(stateName = 'patrol') {
    const m = this.m, dir = this.dir;
    const hint = dir.regionHint();
    if (!hint) return false;
    const rooms = this.patrolRooms().filter(r => r.level === hint.level);
    if (!rooms.length) return false;
    let A = null, bd = Infinity;
    for (const r of rooms) { const d = dir.roomDist(r, hint) + (r.type === 'corridor' ? 1.5 : 0); if (d < bd) { bd = d; A = r; } }
    const via = A && this.roomPoint(A, hint, 18);
    if (!via) return false;
    // sala "adiante", no mesmo andar, nem muito perto nem muito longe
    const beyond = rooms.filter(r => r.id !== A.id).map(r => ({ r, d: Math.hypot((r.x0 + r.x1) * CELL / 2 - via.x, (r.z0 + r.z1) * CELL / 2 - via.z) }))
      .filter(o => o.d > 6 && o.d < 24);
    const B = beyond.length ? this.rng.pick(beyond).r : this.rng.pick(rooms);
    const then = this.roomPoint(B) || via;
    this.setState(stateName === 'return' ? 'return' : 'patrol');
    if (!this.goTo(via.x, via.z, via.level)) return false;
    this.passBy = { stage: 0, via: { ...via, room: A.name }, then: { ...then, room: B.name } };
    this.visited.set(A.id, m.t);
    dir.target = { kind: 'passagem', room: A.name, roomId: A.id, level: A.level, x: +via.x.toFixed(1), z: +via.z.toFixed(1), err: hint.err };
    dir.passByDone();
    return true;
  }
  arrivePatrol() {
    const m = this.m;
    const rid = m.world.roomAt(this.level, this.x, this.z);
    if (rid >= 0 && this.roomHist[this.roomHist.length - 1] !== rid) { this.roomHist.push(rid); if (this.roomHist.length > 12) this.roomHist.shift(); }
    if (this.passBy && this.passBy.stage === 0) {
      // no meio da região dos jogadores: às vezes para um instante (tensão) e segue adiante
      this.passBy.stage = 1;
      const th = this.passBy.then, st = this.state;
      const go = () => { this.setState(st === 'look' ? 'patrol' : st); if (!this.goTo(th.x, th.z, th.level)) this.pickPatrol(); };
      if (this.rng.chance(0.55)) { this.setState('look', this.rng.float(1.8, 3.6)); this.tension = true; this.lookNext = go; }
      else go();
      return;
    }
    this.passBy = null;
    const room = rid >= 0 ? m.map.rooms[rid] : null;
    if (room && room.type !== 'corridor' && room.type !== 'stairs') this.startSweep(room);
    else { this.setState('look', this.rng.float(0.8, 1.8)); this.lookNext = () => this.pickPatrol(); }
  }
  // Varredura curta do cômodo: 1–3 pontos, pausas para olhar, às vezes inspeciona um móvel.
  startSweep(room) {
    const pts = [];
    const n = this.rng.int(1, 3);
    for (let k = 0; k < n * 3 && pts.length < n; k++) {
      const p = this.roomPoint(room);
      if (p && Math.hypot(p.x - this.x, p.z - this.z) > 1.2) pts.push(p);
    }
    this.sweep = { room: room.id, pts, i: -1, pause: this.rng.float(0.4, 1.0), inspected: false };
    this.setState('sweep');
    this.path = null;
  }
  sweepNext() {
    const sw = this.sweep;
    if (!sw) { this.pickPatrol(); return; }
    sw.pause = 0;
    sw.i++;
    while (sw.i < sw.pts.length) {
      const p = sw.pts[sw.i];
      if (this.goTo(p.x, p.z, p.level)) return;
      sw.i++;
    }
    this.sweep = null;
    this.pickPatrol();
  }
  // Pausa breve logo ao passar de um cômodo para outro (porta/arco): olha ao redor e segue.
  doorwayPause() {
    const m = this.m;
    const rid = m.world.roomAt(this.level, this.x, this.z);
    if (rid < 0) return;
    const prev = this.lastRoom;
    this.lastRoom = rid;
    if (prev < 0 || prev === rid) return;
    if (!['patrol', 'return', 'sweep'].includes(this.state) || this.speed < 0.3) return;
    const room = m.map.rooms[rid];
    if (room.type === 'stairs') return;
    const t = m.t, menace = this.menace;
    if (t - this.lastDoorPauseT < 8 || !this.rng.chance(0.22 + 0.33 * menace)) return;
    this.lastDoorPauseT = t;
    const hint = this.dir && this.dir.hint;
    const near = hint && hint.level === this.level && Math.hypot(hint.x - this.x, hint.z - this.z) < hint.err + 3;
    const tense = near && menace > 0.55;
    const st = this.state, g = this.goal;
    this.setState('look', tense ? this.rng.float(2.5, 4.5) : this.rng.float(0.7, 1.5));
    this.tension = tense;
    this.lookNext = () => { this.setState(st); if (!g || !this.goTo(g.x, g.z, g.level)) { if (st === 'sweep') this.sweepNext(); else this.pickPatrol(); } };
  }
  // Nunca fica parada à toa: mais de ~4 s sem andar (6 s em pausa de tensão) → segue em frente.
  watchdog(dt) {
    const S = this.state;
    const exempt = S === 'hold' || S === 'freeze' || S === 'alert' || S === 'attack' || S === 'kill' || S === 'chase' || (S === 'idle' && this.m.t < AI.graceTime);
    if (exempt || this.speed > 0.15) { this.stillT = 0; return; }
    this.stillT += dt;
    if (this.stillT > this.maxStill) this.maxStill = this.stillT;
    const limit = this.tension ? 6 : 4;
    if (this.stillT < limit) return;
    this.stillT = limit - 0.6; // a próxima pausa encadeada também é curta
    this.unstickCount = (this.unstickCount || 0) + 1;
    if (S === 'inspect' && this.track) { const p = this.randomNearby(4); this.setState('track'); if (!p || !this.goTo(p.x, p.z, this.level)) this.pickPatrol(); return; }
    if (['look', 'recover', 'inspect', 'hear', 'sniff', 'door', 'idle'].includes(S) || ((S === 'sweep' || S === 'check') && this.sweep && this.sweep.pause > 0)) {
      if (S === 'sweep' || S === 'check') { this.sweepNext(); return; }
      if (S === 'idle') { this.pickPatrol(); return; }
      this.stateT = Math.max(this.stateT, this.durState, 1); // encerra a pausa agora (a transição normal acontece)
      return;
    }
    // estado de deslocamento, mas sem sair do lugar (caminho falhou): escolhe outro destino
    this.path = null;
    if (S === 'search' || S === 'investigate' || S === 'track') { this.setState('return'); this.pickPatrol('return'); }
    else this.pickPatrol();
  }
  // ponto navegável alcançável em torno de (x, z) — usado na busca em expansão
  randomAround(x, z, level, r) {
    const m = this.m;
    for (let k = 0; k < 20; k++) {
      const a = this.rng.float(0, Math.PI * 2), d = this.rng.float(r * 0.4, r);
      const cx = Math.floor((x + Math.cos(a) * d) / CELL), cz = Math.floor((z + Math.sin(a) * d) / CELL);
      if (m.nav.walkable(level, cx, cz)) return { x: (cx + 0.5) * CELL, z: (cz + 0.5) * CELL, level };
    }
    return null;
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
      // campos novos (opcionais) para animação: velocidade no plano e taxa de giro (rad/s)
      vx: +this.vx.toFixed(2), vz: +this.vz.toFixed(2), turn: +this.yawRate.toFixed(2),
    };
  }
}
const clampA = (v, m) => Math.max(-m, Math.min(m, v));
