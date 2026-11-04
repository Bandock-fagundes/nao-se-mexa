// Caixas de ocupação (AABB) de quadros, janelas e luminárias — a MESMA medida usada para desenhá-los.
// Servem para a varredura de sobreposição (test/overlap.js): nada pode atravessar outro objeto.
import * as THREE from 'three';
import { LEVELS } from '../../../shared/config.js';

// tamanho das janelas (o desenho em mansion.js usa estes números)
export const winSize = (w) => ({ ww: w.small ? 0.6 : 1.0, wh: w.small ? 0.6 : 1.7, wy: w.small ? 1.4 : 1.75 });

// caixa presa à parede: largura 2*hw ao longo da parede, altura ya..yb, profundidade da..db para dentro do cômodo
export function wallBox(x, y, z, rot, hw, ya, yb, da, db, along = 0) {
  const nx = Math.sin(rot), nz = Math.cos(rot); // normal (para dentro do cômodo)
  const tx = Math.cos(rot), tz = -Math.sin(rot); // direção ao longo da parede
  const b = new THREE.Box3();
  for (const s of [-1, 1]) for (const dd of [da, db]) {
    const px = x + tx * (along + s * hw) + nx * dd, pz = z + tz * (along + s * hw) + nz * dd;
    b.expandByPoint(new THREE.Vector3(px, y + ya, pz)); b.expandByPoint(new THREE.Vector3(px, y + yb, pz));
  }
  return b;
}

export function decorBox(dc) {
  const y0 = LEVELS[dc.level].y;
  if (dc.kind === 'painting') return wallBox(dc.x, y0 + dc.y, dc.z, dc.rot, dc.w / 2 + 0.05, -dc.h / 2 - 0.05, dc.h / 2 + 0.05, 0, 0.06);
  return null; // tapetes ficam no chão (por baixo de tudo); cortinas-esconderijo ocupam suas próprias células
}
export function windowBox(w) {
  const y0 = LEVELS[w.level].y, { ww, wh, wy } = winSize(w);
  const out = [wallBox(w.x, y0, w.z, w.rot, ww / 2 + 0.1, wy - wh / 2 - 0.04, wy + wh / 2 + 0.04, 0, 0.12)];
  if (!w.small && !w.curtain && !w.noDrape) for (const s of [-1, 1]) out.push(wallBox(w.x, y0, w.z, w.rot, 0.225, wy - 1.4, wy + 1.0, 0.07, 0.17, s * (ww / 2 + 0.2)));
  return out;
}
export function lampBox(l) {
  if (l.kind === 'wall') return wallBox(l.x, l.y, l.z, l.rot, 0.12, -0.04, 0.2, 0, 0.32);
  if (l.kind === 'emergency') return wallBox(l.x, l.y, l.z, l.rot || 0, 0.11, -0.06, 0.06, 0, 0.1);
  if (l.kind === 'chandelier') return new THREE.Box3(new THREE.Vector3(l.x - 0.47, l.y - 0.02, l.z - 0.47), new THREE.Vector3(l.x + 0.47, l.y + 0.9, l.z + 0.47));
  if (l.kind === 'candle') return new THREE.Box3(new THREE.Vector3(l.x - 0.05, l.y + 0.001, l.z - 0.05), new THREE.Vector3(l.x + 0.05, l.y + 0.17, l.z + 0.05));
  if (l.kind === 'bulb') return new THREE.Box3(new THREE.Vector3(l.x - 0.12, l.y - 0.05, l.z - 0.12), new THREE.Vector3(l.x + 0.12, l.y + 0.5, l.z + 0.12));
  return null; // fogo da lareira: é só luz dentro da lareira
}
