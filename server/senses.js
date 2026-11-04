// Sentidos da criatura: visão, audição, olfato. Nenhuma função aqui devolve a posição exata
// de um jogador que não foi percebido por um sentido ativo.
import { AI, CREATURE, SOUND_TYPES, SURFACE_MUL, LEVELS } from '../shared/config.js';
import { soundReaches } from '../shared/sound.js';

const DEG = Math.PI / 180;
export const angleDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

// O jogador está "se movendo" (corpo) — rotação de câmera não conta.
export function isPlayerMoving(p, t) {
  return (t - p.lastBodyMoveT) < 0.3 || (t - p.standUpT) < AI.standUpWindow || (t - p.jumpT) < 0.6;
}

function lampLit(match, p) {
  for (const l of match.litLamps) {
    if (l.level !== p.level) continue;
    const d = Math.hypot(l.x - p.x, l.z - p.z);
    if (d < l.range * 0.4) return true;
  }
  return false;
}

// Visão: retorna detalhes da percepção visual de um jogador
export function visionCheck(match, c, p, { focused = false } = {}) {
  const res = { visible: false, inFov: false, inRange: false, los: false, moving: false, beamOnCreature: false, dist: Infinity, lit: false };
  if (!p.alive || p.escaped || !p.connected) return res;
  const dy = Math.abs(p.y - c.y);
  if (p.level !== c.level && dy > 2.2) return res;
  const dx = p.x - c.x, dz = p.z - c.z;
  const dist = Math.hypot(dx, dz);
  res.dist = dist;
  const phase = match.phase;
  let range = AI.visionRange[phase];
  const fl = AI.flashlight;
  const lit = p.flashlight || lampLit(match, p);
  res.lit = lit;
  range *= p.flashlight ? fl.rangeMul : (lit ? 1.0 : fl.darkRangeMul);
  if (focused) range *= 1.3;
  let half = AI.fovDeg / 2 + (p.flashlight ? fl.fovBonusDeg / 2 : 0);
  if (focused) half = 70;
  const look = c.yaw + c.headYaw;
  const ang = Math.abs(angleDiff(Math.atan2(dx, dz), look));
  res.inFov = ang <= half * DEG;
  res.inRange = dist <= range;
  const L = c.level;
  res.los = match.world.lineOfSight(L, c.x, c.z, p.x, p.z) && (p.level === L || match.world.lineOfSight(p.level, c.x, c.z, p.x, p.z));
  res.moving = isPlayerMoving(p, match.t);
  res.visible = res.inFov && res.inRange && res.los;
  // feixe da lanterna atingindo a criatura
  if (p.flashlight && dist <= fl.beamRange && res.los) {
    const fx = -Math.sin(p.yaw) * Math.cos(p.pitch), fz = -Math.cos(p.yaw) * Math.cos(p.pitch), fy = Math.sin(p.pitch);
    const tx = c.x - p.x, ty = (c.y + 2.0) - (p.y + 1.5), tz = c.z - p.z;
    const tl = Math.hypot(tx, ty, tz) || 1;
    const cos = (fx * tx + fy * ty + fz * tz) / tl;
    res.beamOnCreature = cos >= Math.cos(fl.beamHalfDeg * DEG);
  }
  return res;
}

// Audição (v2): níveis discretos — VERMELHO (casa inteira), AMARELO (mesmo andar ou o de baixo),
// BAIXO (mesmo cômodo / cômodo vizinho; alguns também logo abaixo). Retorna { heard, loudness, dist, why }.
// A criatura recebe só o fato de ter ouvido + a origem; quem chama aplica um erro de posição.
const LOUD = { red: 1, yellow: 0.7, low: 0.4 };
export function hearingCheck(match, c, ev) {
  const dist = Math.hypot(ev.x - c.x, (ev.y || 0) - c.y, ev.z - c.z);
  const r = soundReaches(match.map, ev, { level: c.level, x: c.x, z: c.z });
  const base = LOUD[ev.lvl] || 0;
  return { heard: r.heard, loudness: r.heard ? Math.max(0.05, base * (1 - Math.min(0.8, dist / 60))) : 0, effRange: r.heard ? Infinity : 0, dist, why: r.why };
}

export function makeSoundEvent(match, type, x, y, z, level, extra = {}) {
  const st = SOUND_TYPES[type];
  let range = st.range, intensity = st.intensity;
  if (type.startsWith('step_') || type === 'land') {
    const surf = match.world.surfaceAt(level, x, z);
    const m = SURFACE_MUL[surf] ?? 1;
    range *= m; intensity *= m;
  }
  return { id: ++match.soundSeq, type, x, y, z, level, range, intensity, duration: st.duration, lvl: st.lvl ?? null, below: !!st.below, t: match.t, ...extra };
}
