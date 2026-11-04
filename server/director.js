// "Diretor" da IA (modelo de dois cérebros, inspirado em Alien: Isolation).
//
// O DIRETOR sabe, de forma grosseira, em que região os jogadores estão — mas NUNCA entrega
// a posição exata à criatura. Ele só sugere uma REGIÃO de patrulha com um erro proposital
// (raio de 15 m com ameaça baixa → 4 m com ameaça alta). A CRIATURA continua dependendo apenas
// dos sentidos da fase (visão → +audição → +olfato) para detectar alguém de verdade.
//
// Medidor de ameaça (menace, 0..1):
//   • cresce com o tempo desde a última chave coletada (e, mais devagar, com o tempo de partida);
//   • cai na hora em que uma chave é pega;
//   • cai por um tempo ("respiro") depois de um encontro próximo ou do fim de uma perseguição.
// Não há configuração de dificuldade: a dificuldade nasce da casa/chaves aleatórias + este ritmo.
import { CELL } from '../shared/config.js';

export const DIRECTOR = {
  keyGrace: 12,          // s após pegar chave (ou início) antes da pressão começar a subir
  keyRamp: 150,          // s para a pressão "sem chave" ir de 0 a 1
  matchRamp: 600,        // s para a pressão do tempo total de partida chegar ao máximo
  keyWeight: 0.75,       // peso da pressão sem chave
  matchWeight: 0.25,     // peso da pressão do tempo de partida
  riseTau: 6,            // s (suavização ao subir)
  fallTau: 1.2,          // s (suavização ao cair — alívio rápido)
  reliefTime: 28,        // s de respiro depois de um encontro/perseguição
  reliefFactor: 0.3,     // ameaça máxima durante o respiro (fração da pressão bruta)
  errMax: 15, errMin: 4, // raio de erro da dica de região (m)
  levelPenalty: 10,      // m equivalentes por andar de diferença
  passByMenace: 0.6,     // ameaça mínima para agendar uma "passagem" pela região dos jogadores
  passByCooldown: [40, 70],
};

const clamp01 = (v) => Math.max(0, Math.min(1, v));

export class Director {
  constructor(match) {
    this.m = match;
    this.lastKeyT = 0;
    this.reliefUntil = -1e9;
    this.menace = 0;
    this.override = null;          // somente testes: fixa a ameaça
    this.hint = null;              // última dica de região (com erro)
    this.target = null;            // último destino escolhido pela criatura via diretor
    this.nextPassByT = 75;         // primeira passagem possível
    this.passBys = 0;
    this.encounters = 0;
    this.firstEncounterT = null;
    this.lastEncounterT = -1e9;
  }
  get rng() { return this.m.rng; }
  rawPressure(t = this.m.t) {
    const D = DIRECTOR;
    const keyP = clamp01((t - this.lastKeyT - D.keyGrace) / D.keyRamp);
    const matchP = clamp01(t / D.matchRamp);
    return clamp01(D.keyWeight * keyP + D.matchWeight * matchP);
  }
  update(dt) {
    if (this.override !== null) { this.menace = this.override; return; }
    const t = this.m.t;
    let target = this.rawPressure(t);
    if (t < this.reliefUntil) target = Math.min(target, target * DIRECTOR.reliefFactor);
    const tau = target > this.menace ? DIRECTOR.riseTau : DIRECTOR.fallTau;
    this.menace += (target - this.menace) * Math.min(1, dt / tau);
    this.menace = clamp01(this.menace);
  }
  // ---- eventos do jogo ----
  onKey() { this.lastKeyT = this.m.t; }
  onSighting() { // a criatura percebeu alguém (alerta)
    if (this.firstEncounterT === null) this.firstEncounterT = this.m.t;
  }
  onEncounterEnd(kind = 'encontro') { // perseguição terminou / encontro próximo / morte
    const t = this.m.t;
    this.encounters++;
    this.lastEncounterT = t;
    this.lastEncounterKind = kind;
    this.reliefUntil = t + DIRECTOR.reliefTime;
    this.nextPassByT = Math.max(this.nextPassByT, t + DIRECTOR.reliefTime + 15);
    // respiro também no olfato (fase 3): a próxima farejada espera um pouco
    const c = this.m.creature;
    if (c && Number.isFinite(c.nextSniffT)) c.nextSniffT = Math.max(c.nextSniffT, t + 12);
  }
  get inRelief() { return this.m.t < this.reliefUntil; }
  errRadius(menace = this.menace) { return DIRECTOR.errMax + (DIRECTOR.errMin - DIRECTOR.errMax) * clamp01(menace); }
  // Dica de região: ponto aproximado (com erro) de um jogador vivo + andar provável.
  // NUNCA é a posição exata: deslocamento aleatório uniforme no disco de raio errRadius.
  regionHint() {
    const alive = [...this.m.players.values()].filter(p => p.alive && !p.escaped && p.connected);
    if (!alive.length) { this.hint = null; return null; }
    const p = this.rng.pick(alive);
    const menace = this.menace;
    const err = this.errRadius(menace);
    // andar: quanto maior a ameaça, mais provável que o diretor "acerte" o andar
    let level = p.level;
    if (!this.rng.chance(0.4 + 0.6 * menace)) {
      const opts = [p.level - 1, p.level + 1].filter(l => l >= 0 && l <= 3);
      level = this.rng.pick(opts);
    }
    const a = this.rng.float(0, Math.PI * 2), r = err * Math.sqrt(this.rng.next());
    this.hint = { x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r, level, err: +err.toFixed(1), t: this.m.t };
    return this.hint;
  }
  // distância "de planta" de uma sala até a dica (0 se dentro do retângulo) + penalidade por andar
  roomDist(room, hint) {
    const x0 = room.x0 * CELL, x1 = (room.x1 + 1) * CELL, z0 = room.z0 * CELL, z1 = (room.z1 + 1) * CELL;
    const dx = Math.max(x0 - hint.x, 0, hint.x - x1), dz = Math.max(z0 - hint.z, 0, hint.z - z1);
    return Math.hypot(dx, dz) + Math.abs(room.level - hint.level) * DIRECTOR.levelPenalty;
  }
  wantsPassBy() {
    return this.menace >= DIRECTOR.passByMenace && this.m.t >= this.nextPassByT && !this.inRelief;
  }
  passByDone() {
    this.passBys++;
    const [a, b] = DIRECTOR.passByCooldown;
    this.nextPassByT = this.m.t + this.rng.float(a, b) * (1.35 - 0.5 * this.menace);
  }
  diag() {
    return {
      menace: +this.menace.toFixed(2),
      pressure: +this.rawPressure().toFixed(2),
      relief: this.inRelief ? +(this.reliefUntil - this.m.t).toFixed(1) : 0,
      sinceKey: +(this.m.t - this.lastKeyT).toFixed(1),
      errRadius: +this.errRadius().toFixed(1),
      target: this.target,
      nextPassByIn: +(this.nextPassByT - this.m.t).toFixed(1),
      passBys: this.passBys, encounters: this.encounters,
    };
  }
}
