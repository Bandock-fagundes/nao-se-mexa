// Jogadores-robô simples para simulações sem interface (headless).
// Eles procuram as chaves (recipientes ainda fechados), abrem a saída e fogem.
//  • 'careless' (descuidado): nunca para, lanterna sempre ligada.
//  • 'careful'  (cuidadoso): ao ver a criatura, congela e apaga a lanterna; se for perseguido,
//    corre para longe até quebrar a linha de visão e então fica parado.
import { Match } from '../server/match.js';
import { PLAYER, CELL } from '../shared/config.js';

export class Bot {
  constructor(m, id, style = 'careful') {
    this.m = m; this.id = id; this.style = style;
    this.path = null; this.pi = 0; this.goal = null; this.mode = 'seek';
    this.freezeUntil = -1; this.fleeUntil = -1; this.lastSeenT = -1e9;
    this.progT = 0; this.progRef = null; this.tried = new Set(); this.blacklist = new Set();
    this.repathT = 0;
  }
  get p() { return this.m.players.get(this.id); }
  seesCreature() {
    const p = this.p, c = this.m.creature;
    if (Math.abs(p.y - c.y) > 2.2) return false;
    const d = Math.hypot(c.x - p.x, c.z - p.z);
    return d < 20 && this.m.world.lineOfSight(p.level, p.x, p.z, c.x, c.z);
  }
  pickGoal() {
    const m = this.m, p = this.p;
    if (m.keysCollected.length >= m.keysNeeded) {
      const e = m.map.exit;
      return { x: e.x, z: e.z + 1.2, level: e.level, kind: 'exit' };
    }
    let best = null, bd = Infinity;
    for (const c of m.map.containers) {
      if (this.tried.has(c.id) || this.blacklist.has(c.id)) continue;
      const d = Math.hypot(c.ax - p.x, c.az - p.z) + Math.abs(c.level - p.level) * 14;
      if (d < bd) { bd = d; best = c; }
    }
    if (!best) { this.tried.clear(); return this.pickGoal(); }
    return { x: best.ax, z: best.az, level: best.level, kind: 'container', id: best.id };
  }
  plan(goal) {
    const p = this.p;
    this.goal = goal;
    this.path = this.m.nav.findPath(p.level, p.x, p.z, goal.level, goal.x, goal.z);
    this.pi = 0;
    if (!this.path) { if (goal.kind === 'container') this.blacklist.add(goal.id); this.goal = null; }
  }
  step(dt) {
    const m = this.m, p = this.p, c = m.creature, t = m.t;
    if (!p.alive || p.escaped) return;
    if (this.stamina === undefined) this.stamina = PLAYER.staminaMax;
    if (this.mode !== 'flee') this.stamina = Math.min(PLAYER.staminaMax, this.stamina + PLAYER.staminaRegen * dt);
    let speed = PLAYER.walk, fl = true, crouch = false;
    const sees = this.seesCreature();
    // cuidadoso: ao OUVIR a criatura por perto (passos dela), agacha e apaga a lanterna
    const cd = Math.hypot(c.x - p.x, c.z - p.z) + Math.abs(c.level - p.level) * 6;
    if (this.style === 'careful' && cd < 14) { crouch = true; fl = false; speed = PLAYER.crouch; }
    if (sees) this.lastSeenT = t;
    const hunted = (c.state === 'chase' || c.state === 'alert' || c.state === 'attack') && c.target === this.id;
    if (this.style === 'careful') {
      if (hunted && this.mode !== 'flee') {
        // foge: corre para uma sala longe da criatura
        this.mode = 'flee'; this.fleeUntil = t + 14;
        const rooms = m.map.rooms.filter(r => r.type !== 'stairs' && r.level === p.level);
        let far = null, fd = -1;
        for (const r of rooms) { const x = (r.x0 + r.x1 + 1) * CELL / 2, z = (r.z0 + r.z1 + 1) * CELL / 2; const d = Math.hypot(x - c.x, z - c.z) - Math.hypot(x - p.x, z - p.z) * 0.5; if (d > fd) { fd = d; far = { x, z }; } }
        if (far) this.plan({ x: far.x, z: far.z, level: p.level, kind: 'flee' });
      }
      if (this.mode === 'flee') {
        // corre enquanto houver fôlego (stamina como no cliente), depois anda rápido
        crouch = false;
        if (this.stamina > 0) { speed = PLAYER.run * 0.95; this.stamina -= dt; } else speed = PLAYER.walk;
        if (t > this.fleeUntil || (!hunted && !sees && cd > 10)) { this.mode = 'freeze'; this.freezeUntil = t + 5; this.goal = null; }
      } else if (sees && !hunted) { this.mode = 'freeze'; this.freezeUntil = Math.max(this.freezeUntil, t + 2.5); }
      if (this.mode === 'freeze') {
        fl = false;
        const dc = Math.hypot(c.x - p.x, c.z - p.z);
        if (dc < 3.6 && c.level === p.level) {
          // a criatura vai esbarrar: esgueira-se agachado para longe dela
          const ax = (p.x - c.x) / (dc || 1), az = (p.z - c.z) / (dc || 1);
          const r = m.world.move(p.level, p.x, p.z, ax * PLAYER.crouch * dt, az * PLAYER.crouch * dt, PLAYER.radius);
          this.input(r.x, r.z, false, false, true); return;
        }
        if (t < this.freezeUntil || (sees && dc < 16)) { this.input(p.x, p.z, fl, false, true); return; }
        this.mode = 'seek';
      }
    }
    if (!this.goal || !this.path) this.plan(this.pickGoal());
    if (!this.goal) { this.input(p.x, p.z, fl, false); return; }
    // segue o caminho
    let tx, tz;
    if (this.path && this.pi < this.path.length) {
      let wp = this.path[this.pi];
      while (Math.hypot(wp.x - p.x, wp.z - p.z) < 0.35 && this.pi < this.path.length - 1) wp = this.path[++this.pi];
      tx = wp.x; tz = wp.z;
      if (this.pi === this.path.length - 1 && Math.hypot(wp.x - p.x, wp.z - p.z) < 0.35) this.pi++;
    } else { tx = this.goal.x; tz = this.goal.z; }
    // abre portas fechadas no caminho
    const quietNeeded = this.style === 'careful' && cd < 14 && this.mode !== 'flee'; // cuidadoso não abre porta com a criatura por perto
    if (quietNeeded && this.path && this.path.slice(this.pi, this.pi + 3).some(q => q.door >= 0 && !m.world.doorOpen[q.door] && Math.hypot(q.x - p.x, q.z - p.z) < 2.5)) { this.input(p.x, p.z, false, false, true); return; }
    if (this.path && t - (this.doorTryT || 0) > 0.5) {
      for (let k = this.pi; k < Math.min(this.path.length, this.pi + 3); k++) {
        const q = this.path[k];
        if (q.door >= 0 && !m.world.doorOpen[q.door] && Math.hypot(q.x - p.x, q.z - p.z) < 2.2) { this.doorTryT = t; m.interact(this.id, { kind: 'door', id: q.door }); break; }
      }
      for (const d of m.map.doors) if (d.level === p.level && !m.world.doorOpen[d.id] && Math.hypot(d.x - p.x, d.z - p.z) < 1.3) { this.doorTryT = t; m.interact(this.id, { kind: 'door', id: d.id }); break; }
    }
    const g = this.goal;
    const dGoal = Math.hypot(g.x - p.x, g.z - p.z);
    const cont = g.kind === 'container' ? m.map.containers[g.id] : null;
    if (cont && p.level === g.level && (dGoal < 2.3 || Math.hypot(cont.x - p.x, cont.z - p.z) < 2.1) && t - (this.lastTryT || 0) > 0.3) {
      this.lastTryT = t;
      const r = m.interact(this.id, { kind: 'container', id: g.id });
      if (r.ok && r.key !== null && r.key !== undefined) m.interact(this.id, { kind: 'key', id: g.id });
      if (r.ok || dGoal < 0.6) { this.tried.add(g.id); this.goal = null; this.input(p.x, p.z, fl, false); return; }
    }
    if (this.unstick && t < this.unstick.until) { tx = p.x + this.unstick.dx; tz = p.z + this.unstick.dz; }
    if (g.kind === 'exit' && p.level === g.level && dGoal < 1.5) {
      if (!m.exitOpen) m.interact(this.id, { kind: 'exit' });
      if (m.exitOpen) { tx = m.map.exit.x; tz = 0.1; }
    }
    if (g.kind === 'flee' && this.pi >= (this.path ? this.path.length : 0)) { if (hunted) this.mode = 'seek'; else { this.mode = 'freeze'; this.freezeUntil = t + 5; } this.goal = null; }
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    let nx = p.x, nz = p.z;
    if (d > 0.01) {
      const s = Math.min(d, speed * dt);
      const r = m.world.move(p.level, p.x, p.z, dx / d * s, dz / d * s, PLAYER.radius);
      nx = r.x; nz = r.z;
      p.yaw = Math.atan2(-dx, -dz);
    }
    this.input(nx, nz, fl, speed > 3, crouch);
    // sem progresso → replaneja / desiste do recipiente
    this.progT += dt;
    if (!this.progRef) this.progRef = { x: p.x, z: p.z };
    if (this.progT > 1.5) {
      if (Math.hypot(p.x - this.progRef.x, p.z - this.progRef.z) < 0.4) {
        this.stuckN = (this.stuckN || 0) + 1;
        if (this.goal && this.goal.kind === 'container' && this.stuckN >= 2) this.tried.add(this.goal.id);
        this.goal = null;
        const a = Math.random() * Math.PI * 2; this.unstick = { until: t + 0.8, dx: Math.cos(a), dz: Math.sin(a) };
      } else this.stuckN = 0;
      this.progT = 0; this.progRef = { x: p.x, z: p.z };
    }
  }
  input(x, z, fl, run, crouch = this.lastCrouch || false) {
    const p = this.p;
    this.lastCrouch = crouch;
    this.m.applyInput(this.id, { x, z, yaw: p.yaw, pitch: 0, fl, crouch, run });
  }
}

// Partida completa simulada. Retorna estatísticas.
export function simulateMatch({ seed, phase = 1, styles = ['careful'], maxTime = 900 }) {
  const players = styles.map((s, i) => ({ id: 'p' + (i + 1), name: 'Bot' + (i + 1) }));
  const m = new Match({ seed, phase, players });
  const bots = styles.map((s, i) => new Bot(m, 'p' + (i + 1), s));
  const dt = 0.05;
  let menaceSum = 0, n = 0, maxStill = 0;
  const states = {};
  let chases = 0, prevState = '';
  while (!m.ended && m.t < maxTime) {
    for (const b of bots) b.step(dt);
    m.tick(dt);
    if (m.creature.state === 'chase' && prevState !== 'chase' && prevState !== 'attack') chases++;
    prevState = m.creature.state;
    menaceSum += m.director.menace; n++;
    states[m.creature.state] = (states[m.creature.state] || 0) + dt;
    if (m.t > 8) maxStill = Math.max(maxStill, m.creature.stillT);
  }
  const ps = [...m.players.values()];
  return {
    seed, phase, styles: styles.join('+'), duration: +m.t.toFixed(1), result: m.result || 'timeout',
    firstEncounter: m.director.firstEncounterT, encounters: m.director.encounters, passBys: m.director.passBys,
    chases, kills: ps.filter(p => !p.alive).length, escaped: ps.filter(p => p.escaped).length, players: ps.length,
    keys: m.keysCollected.length, keysNeeded: m.keysNeeded, avgMenace: +(menaceSum / n).toFixed(2), maxStill: +maxStill.toFixed(1),
    states: Object.fromEntries(Object.entries(states).map(([k, v]) => [k, +v.toFixed(0)])),
  };
}
