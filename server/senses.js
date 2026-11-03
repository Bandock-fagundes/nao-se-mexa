// Sentidos da criatura: visão, audição, olfato. Nenhuma função aqui devolve a posição exata
// de um jogador que não foi percebido por um sentido ativo.
import { AI, CREATURE, SOUND_TYPES, SURFACE_MUL, LEVELS } from '../shared/config.js';

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

// Audição: o evento sonoro é percebido? Retorna { heard, loudness, effRange, dist }
export function hearingCheck(match, c, ev) {
  const w = match.world;
  const dist = Math.hypot(ev.x - c.x, (ev.y || 0) - c.y, ev.z - c.z);
  let att = 1;
  const L = ev.level === c.level ? c.level : ev.level;
  const o = w.soundAttenuation(L, ev.x, ev.z, c.x, c.z);
  att *= Math.pow(AI.wallAtten, o.walls) * Math.pow(AI.doorAtten, o.doors) * Math.pow(AI.tallAtten, Math.min(3, o.talls));
  const lvlDiff = Math.abs(ev.level - c.level);
  att *= Math.pow(AI.levelAtten, lvlDiff);
  const effRange = ev.range * att;
  const heard = dist <= effRange * AI.hearingThreshold;
  return { heard, loudness: heard ? 1 - dist / effRange : 0, effRange, dist, walls: o.walls, doors: o.doors };
}

export function makeSoundEvent(match, type, x, y, z, level, extra = {}) {
  const st = SOUND_TYPES[type];
  let range = st.range, intensity = st.intensity;
  if (type.startsWith('step_') || type === 'land') {
    const surf = match.world.surfaceAt(level, x, z);
    const m = SURFACE_MUL[surf] ?? 1;
    range *= m; intensity *= m;
  }
  return { id: ++match.soundSeq, type, x, y, z, level, range, intensity, duration: st.duration, t: match.t, ...extra };
}
