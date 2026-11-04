// Texturas procedurais (canvas): cor + mapa de normais (Sobel da altura) + rugosidade.
import * as THREE from 'three';
import { makeRng } from '../../../shared/rng.js';

let rng = makeRng('texturas-v2');
const r = () => rng.next();
const gray = (v) => { v = Math.max(0, Math.min(255, v | 0)); return `rgb(${v},${v},${v})`; };

function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d', { willReadFrequently: true })]; }
function noise(g, w, h, a, col = '0,0,0', density = 0.08) {
  for (let i = 0; i < w * h * density; i++) { g.fillStyle = `rgba(${col},${r() * a})`; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
}
function tex(c, repeat = [1, 1], srgb = true, aniso = 8) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso; t.needsUpdate = true;
  return t;
}
export function normalFromHeight(hc, strength = 2.0) {
  const w = hc.width, h = hc.height;
  const src = hc.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const [c, g] = mk(w, h); const out = g.createImageData(w, h);
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1));
    const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1));
    let nx = -dx * strength, ny = dy * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * w + x) * 4;
    out.data[i] = (nx * 0.5 + 0.5) * 255; out.data[i + 1] = (ny * 0.5 + 0.5) * 255; out.data[i + 2] = (nz * 0.5 + 0.5) * 255; out.data[i + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  return c;
}
// Desenha simultaneamente cor (A), altura (H) e rugosidade (R)
function triple(w, h, draw) {
  const [ca, a] = mk(w, h), [ch, hh] = mk(w, h), [cr, rr] = mk(w, h);
  hh.fillStyle = '#808080'; hh.fillRect(0, 0, w, h);
  draw(a, hh, rr, w, h);
  return { ca, ch, cr };
}
function set(t, repeat, nStrength = 2, aniso = 8) {
  return {
    map: tex(t.ca, repeat, true, aniso),
    normalMap: tex(normalFromHeight(t.ch, nStrength), repeat, false, aniso),
    roughnessMap: tex(t.cr, repeat, false, aniso),
  };
}

export function buildTextures(size = 512) {
  rng = makeRng('texturas-v2');
  const S = size, aniso = size >= 512 ? 8 : 2;
  const T = {};
  // ---------- piso de madeira ----------
  T.woodFloor = set(triple(S, S, (a, h, ro, w, hh) => {
    ro.fillStyle = '#7a7a7a'; ro.fillRect(0, 0, w, hh);
    const pw = w / 8;
    for (let x = 0; x < w; x += pw) {
      for (let y = -r() * 200; y < hh; y += 160 + r() * 140) {
        const b = 55 + r() * 30;
        a.fillStyle = `rgb(${b + 26 | 0},${b * 0.7 | 0},${b * 0.46 | 0})`; a.fillRect(x, y, pw, 300);
        h.fillStyle = `rgb(${130 + r() * 30},${130},${130})`; h.fillRect(x + 1, y + 1, pw - 2, 298);
        for (let k = 0; k < 16; k++) {
          const xx = x + r() * pw;
          a.strokeStyle = `rgba(30,14,4,${0.12 + r() * 0.25})`; a.lineWidth = 0.6 + r();
          a.beginPath(); a.moveTo(xx, y); a.bezierCurveTo(xx + 6, y + 80, xx - 6, y + 160, xx + 3, y + 300); a.stroke();
          h.strokeStyle = `rgba(90,90,90,0.25)`; h.beginPath(); h.moveTo(xx, y); h.bezierCurveTo(xx + 6, y + 80, xx - 6, y + 160, xx + 3, y + 300); h.stroke();
        }
        if (r() < 0.3) { a.fillStyle = 'rgba(20,10,4,0.5)'; a.beginPath(); a.ellipse(x + r() * pw, y + r() * 200, 3 + r() * 4, 6 + r() * 6, 0, 0, 7); a.fill(); }
        a.fillStyle = 'rgba(8,4,2,0.95)'; a.fillRect(x, y, pw, 2);
        h.fillStyle = '#202020'; h.fillRect(x, y, pw, 2);
        ro.fillStyle = gray(90 + r() * 70); ro.fillRect(x + 2, y + 2, pw - 4, 296);
      }
      a.fillStyle = 'rgba(8,4,2,0.95)'; a.fillRect(x, 0, 2, hh); h.fillStyle = '#202020'; h.fillRect(x, 0, 2, hh);
    }
    noise(a, w, hh, 0.22); noise(ro, w, hh, 0.3, '255,255,255', 0.03);
  }), [1, 1], 2.5, aniso);
  // ---------- papel de parede (variações de cor) ----------
  const paper = (bg, fg, emb) => set(triple(S / 2, S / 2, (a, h, ro, w, hh) => {
    a.fillStyle = bg; a.fillRect(0, 0, w, hh); ro.fillStyle = '#d8d8d8'; ro.fillRect(0, 0, w, hh);
    for (let x = 0; x < w; x += 64) for (let y = 0; y < hh; y += 64) {
      for (const [g, col, lw] of [[a, fg, 2], [h, '#b0b0b0', 3]]) {
        g.strokeStyle = col; g.lineWidth = lw;
        g.beginPath(); g.ellipse(x + 32, y + 32, 13, 23, 0, 0, Math.PI * 2); g.stroke();
        g.beginPath(); g.moveTo(x + 32, y + 4); g.bezierCurveTo(x + 20, y + 20, x + 44, y + 44, x + 32, y + 60); g.stroke();
        g.fillStyle = col; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill();
        g.beginPath(); g.arc(x + 32, y + 32, 3, 0, 7); g.fill();
      }
    }
    for (let i = 0; i < 6; i++) { const cx = r() * w, cy = r() * hh; const gr = a.createRadialGradient(cx, cy, 0, cx, cy, 60 + r() * 60); gr.addColorStop(0, 'rgba(20,10,4,0.4)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); a.fillStyle = gr; a.fillRect(0, 0, w, hh); }
    // descascado
    for (let i = 0; i < 3; i++) { a.fillStyle = 'rgba(60,50,40,0.5)'; const x = r() * w, y = r() * hh; a.beginPath(); a.moveTo(x, y); for (let k = 0; k < 6; k++) a.lineTo(x + (r() - 0.5) * 30, y + (r() - 0.5) * 30); a.fill(); }
    noise(a, w, hh, 0.28); noise(h, w, hh, 0.3, '0,0,0', 0.05);
  }), [1, 1], emb, aniso);
  T.wallRed = paper('#3d2424', 'rgba(160,110,70,0.35)', 1.2);
  T.wallGreen = paper('#22302a', 'rgba(150,140,90,0.3)', 1.2);
  T.wallBlue = paper('#262a3a', 'rgba(150,140,120,0.3)', 1.2);
  T.wallGold = paper('#3a3220', 'rgba(170,140,80,0.35)', 1.2);
  T.wallPlain = set(triple(S / 2, S / 2, (a, h, ro, w, hh) => {
    a.fillStyle = '#5a5248'; a.fillRect(0, 0, w, hh); ro.fillStyle = '#e0e0e0'; ro.fillRect(0, 0, w, hh);
    noise(a, w, hh, 0.25); noise(h, w, hh, 0.35, '0,0,0', 0.15);
    for (let i = 0; i < 5; i++) { a.strokeStyle = 'rgba(30,20,10,0.4)'; h.strokeStyle = '#303030'; let x = r() * w, y = r() * hh; a.beginPath(); h.beginPath(); a.moveTo(x, y); h.moveTo(x, y); for (let k = 0; k < 8; k++) { x += (r() - 0.5) * 20; y += r() * 14; a.lineTo(x, y); h.lineTo(x, y); } a.stroke(); h.stroke(); }
    for (let i = 0; i < 5; i++) { const cx = r() * w, cy = r() * hh; const gr = a.createRadialGradient(cx, cy, 0, cx, cy, 70); gr.addColorStop(0, 'rgba(40,30,10,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); a.fillStyle = gr; a.fillRect(0, 0, w, hh); }
  }), [1, 1], 1.5, aniso);
  // ---------- lambri ----------
  T.wainscot = set(triple(S / 2, S / 4, (a, h, ro, w, hh) => {
    a.fillStyle = '#2c1b10'; a.fillRect(0, 0, w, hh); ro.fillStyle = '#909090'; ro.fillRect(0, 0, w, hh);
    for (let x = 6; x < w; x += 64) {
      a.strokeStyle = 'rgba(0,0,0,0.65)'; a.lineWidth = 3; a.strokeRect(x, 12, 52, hh - 24);
      a.strokeStyle = 'rgba(130,85,50,0.3)'; a.strokeRect(x + 3, 15, 46, hh - 30);
      h.fillStyle = '#a8a8a8'; h.fillRect(x + 5, 17, 42, hh - 34); h.strokeStyle = '#404040'; h.lineWidth = 3; h.strokeRect(x, 12, 52, hh - 24);
    }
    for (let k = 0; k < 40; k++) { a.strokeStyle = `rgba(20,10,0,${r() * 0.3})`; a.beginPath(); const y = r() * hh; a.moveTo(0, y); a.lineTo(w, y + (r() - 0.5) * 6); a.stroke(); }
    noise(a, w, hh, 0.3);
  }), [1, 1], 3, aniso);
  // ---------- pedra (porão) ----------
  T.stone = set(triple(S, S, (a, h, ro, w, hh) => {
    a.fillStyle = '#262624'; a.fillRect(0, 0, w, hh); h.fillStyle = '#202020'; h.fillRect(0, 0, w, hh); ro.fillStyle = '#f0f0f0'; ro.fillRect(0, 0, w, hh);
    for (let y = 0; y < hh; y += 64) for (let x = (y / 64) % 2 ? -50 : 0; x < w; x += 100) {
      const b = 42 + r() * 30; a.fillStyle = `rgb(${b},${b},${b - 4})`;
      const rx = x + 3 + r() * 2, ry = y + 3 + r() * 2, rw = 92 + r() * 3, rh = 56 + r() * 3;
      a.beginPath(); a.roundRect(rx, ry, rw, rh, 8); a.fill();
      const hv = 150 + r() * 60; h.fillStyle = `rgb(${hv},${hv},${hv})`; h.beginPath(); h.roundRect(rx + 2, ry + 2, rw - 4, rh - 4, 10); h.fill();
      if (r() < 0.25) { a.fillStyle = 'rgba(40,60,30,0.25)'; a.fillRect(rx, ry + rh * 0.6, rw, rh * 0.4); }
    }
    noise(a, w, hh, 0.4); noise(a, w, hh, 0.08, '255,255,255'); noise(h, w, hh, 0.5, '0,0,0', 0.2);
  }), [1, 1], 3.5, aniso);
  // ---------- azulejo (cozinha/banheiro) ----------
  T.tile = set(triple(S / 2, S / 2, (a, h, ro, w, hh) => {
    const n = 8, s = w / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const dark = (i + j) % 2;
      const b = dark ? 34 + r() * 8 : 150 + r() * 20;
      a.fillStyle = dark ? `rgb(${b},${b + 6},${b + 4})` : `rgb(${b},${b - 6},${b - 18})`; a.fillRect(i * s, j * s, s, s);
      h.fillStyle = '#c0c0c0'; h.fillRect(i * s + 1.5, j * s + 1.5, s - 3, s - 3);
      ro.fillStyle = gray(50 + r() * 50); ro.fillRect(i * s, j * s, s, s);
    }
    a.strokeStyle = 'rgba(40,35,25,0.9)'; a.lineWidth = 2; h.strokeStyle = '#303030'; h.lineWidth = 2;
    for (let i = 0; i <= n; i++) { for (const g of [a, h]) { g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, hh); g.moveTo(0, i * s); g.lineTo(w, i * s); g.stroke(); } }
    for (let i = 0; i < 4; i++) { const cx = r() * w, cy = r() * hh; const gr = a.createRadialGradient(cx, cy, 0, cx, cy, 50); gr.addColorStop(0, 'rgba(50,35,15,0.4)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); a.fillStyle = gr; a.fillRect(0, 0, w, hh); }
    noise(a, w, hh, 0.2);
  }), [1, 1], 2, aniso);
  // ---------- tapete ----------
  const carpet = (bg, line) => set(triple(S / 2, S, (a, h, ro, w, hh) => {
    a.fillStyle = bg; a.fillRect(0, 0, w, hh); ro.fillStyle = '#ffffff'; ro.fillRect(0, 0, w, hh);
    a.strokeStyle = line; a.lineWidth = 6; a.strokeRect(14, 14, w - 28, hh - 28); a.lineWidth = 2; a.strokeRect(28, 28, w - 56, hh - 56);
    for (let y = 80; y < hh - 60; y += 70) { a.beginPath(); a.moveTo(w / 2, y - 25); a.lineTo(w / 2 + 30, y); a.lineTo(w / 2, y + 25); a.lineTo(w / 2 - 30, y); a.closePath(); a.stroke(); a.beginPath(); a.arc(w / 2, y, 6, 0, 7); a.stroke(); }
    for (let y = 40; y < hh; y += 22) for (const x of [44, w - 44]) { a.fillStyle = line; a.fillRect(x - 3, y - 3, 6, 6); }
    noise(a, w, hh, 0.35); noise(h, w, hh, 0.6, '0,0,0', 0.3);
    for (let i = 0; i < 3; i++) { const cx = r() * w, cy = r() * hh; const gr = a.createRadialGradient(cx, cy, 0, cx, cy, 50); gr.addColorStop(0, 'rgba(10,5,2,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); a.fillStyle = gr; a.fillRect(0, 0, w, hh); }
  }), [1, 1], 1.0, aniso);
  T.carpets = [carpet('#4a0f12', '#a07a3a'), carpet('#1a2a3a', '#a08850'), carpet('#2a3018', '#9a7a40')];
  T.carpetFloor = set(triple(S / 2, S / 2, (a, h, ro, w, hh) => {
    a.fillStyle = '#3a1418'; a.fillRect(0, 0, w, hh); ro.fillStyle = '#ffffff'; ro.fillRect(0, 0, w, hh);
    for (let x = 0; x < w; x += 32) for (let y = 0; y < hh; y += 32) { a.fillStyle = 'rgba(120,80,40,0.25)'; a.beginPath(); a.arc(x + 16, y + 16, 4, 0, 7); a.fill(); }
    noise(a, w, hh, 0.35); noise(h, w, hh, 0.7, '0,0,0', 0.4);
  }), [1, 1], 0.8, aniso);
  // ---------- teto (gesso) ----------
  T.ceiling = set(triple(S / 2, S / 2, (a, h, ro, w, hh) => {
    a.fillStyle = '#4c4640'; a.fillRect(0, 0, w, hh); ro.fillStyle = '#ffffff'; ro.fillRect(0, 0, w, hh);
    noise(a, w, hh, 0.4); noise(h, w, hh, 0.4, '0,0,0', 0.2);
    for (let i = 0; i < 4; i++) { a.strokeStyle = 'rgba(20,15,10,0.5)'; h.strokeStyle = '#303030'; let x = r() * w, y = r() * hh; a.beginPath(); h.beginPath(); a.moveTo(x, y); h.moveTo(x, y); for (let k = 0; k < 10; k++) { x += (r() - 0.5) * 25; y += (r() - 0.5) * 25; a.lineTo(x, y); h.lineTo(x, y); } a.stroke(); h.stroke(); }
    for (let i = 0; i < 4; i++) { const cx = r() * w, cy = r() * hh; const gr = a.createRadialGradient(cx, cy, 0, cx, cy, 70); gr.addColorStop(0, 'rgba(60,45,20,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); a.fillStyle = gr; a.fillRect(0, 0, w, hh); }
  }), [1, 1], 1.2, aniso);
  // ---------- madeira de móveis (veios) ----------
  T.furnWood = set(triple(S / 2, S / 2, (a, h, ro, w, hh) => {
    a.fillStyle = '#8a6a50'; a.fillRect(0, 0, w, hh); ro.fillStyle = '#909090'; ro.fillRect(0, 0, w, hh);
    for (let k = 0; k < 90; k++) {
      const y = r() * hh; a.strokeStyle = `rgba(40,20,8,${0.1 + r() * 0.3})`; a.lineWidth = 0.5 + r() * 1.5;
      a.beginPath(); a.moveTo(0, y); for (let x = 0; x <= w; x += 16) a.lineTo(x, y + Math.sin(x * 0.03 + k) * 3); a.stroke();
      h.strokeStyle = 'rgba(80,80,80,0.3)'; h.beginPath(); h.moveTo(0, y); for (let x = 0; x <= w; x += 16) h.lineTo(x, y + Math.sin(x * 0.03 + k) * 3); h.stroke();
    }
    noise(a, w, hh, 0.15); noise(ro, w, hh, 0.3, '255,255,255', 0.05);
  }), [1, 1], 1.2, aniso);
  // ---------- tecido ----------
  T.fabric = set(triple(128, 128, (a, h, ro, w, hh) => {
    a.fillStyle = '#9a9a9a'; a.fillRect(0, 0, w, hh); ro.fillStyle = '#ffffff'; ro.fillRect(0, 0, w, hh);
    for (let y = 0; y < hh; y += 2) { a.fillStyle = `rgba(0,0,0,${0.08 + r() * 0.06})`; a.fillRect(0, y, w, 1); h.fillStyle = 'rgba(60,60,60,0.5)'; h.fillRect(0, y, w, 1); }
    for (let x = 0; x < w; x += 2) { a.fillStyle = `rgba(255,255,255,${0.04 + r() * 0.04})`; a.fillRect(x, 0, 1, hh); h.fillStyle = 'rgba(200,200,200,0.4)'; h.fillRect(x, 0, 1, hh); }
    noise(a, w, hh, 0.2);
  }), [4, 4], 1.5, aniso);
  // ---------- metal ----------
  T.metal = set(triple(128, 128, (a, h, ro, w, hh) => {
    a.fillStyle = '#7a7470'; a.fillRect(0, 0, w, hh); ro.fillStyle = '#707070'; ro.fillRect(0, 0, w, hh);
    for (let i = 0; i < 30; i++) { a.fillStyle = `rgba(110,50,20,${r() * 0.4})`; ro.fillStyle = 'rgba(255,255,255,0.4)'; const x = r() * w, y = r() * hh, s = 3 + r() * 12; a.beginPath(); a.arc(x, y, s, 0, 7); a.fill(); ro.beginPath(); ro.arc(x, y, s, 0, 7); ro.fill(); }
    noise(a, w, hh, 0.3); noise(h, w, hh, 0.3, '0,0,0', 0.1);
  }), [1, 1], 1, aniso);
  // ---------- tábuas do sótão ----------
  T.planks = set(triple(S / 2, S / 2, (a, h, ro, w, hh) => {
    ro.fillStyle = '#c0c0c0'; ro.fillRect(0, 0, w, hh);
    const ph = hh / 6;
    for (let y = 0; y < hh; y += ph) {
      const b = 50 + r() * 25; a.fillStyle = `rgb(${b + 20},${b * 0.7 | 0},${b * 0.45 | 0})`; a.fillRect(0, y, w, ph);
      h.fillStyle = '#a0a0a0'; h.fillRect(0, y + 1, w, ph - 2);
      for (let k = 0; k < 10; k++) { a.strokeStyle = `rgba(20,10,4,${0.15 + r() * 0.25})`; a.beginPath(); const yy = y + r() * ph; a.moveTo(0, yy); a.lineTo(w, yy + (r() - 0.5) * 4); a.stroke(); }
      a.fillStyle = '#0c0703'; a.fillRect(0, y, w, 2); h.fillStyle = '#202020'; h.fillRect(0, y, w, 2);
      for (let x = r() * 40; x < w; x += 70 + r() * 50) { a.fillStyle = '#1a1a1a'; a.fillRect(x, y + ph / 2 - 1, 3, 3); }
    }
    noise(a, w, hh, 0.25);
  }), [1, 1], 2, aniso);
  // ---------- pele da criatura ----------
  T.creatureSkin = set(triple(S, S, (a, h, ro, w, hh) => {
    // pele pálida, quase cinza-marfim, com manchas frias, veias escuras e rugas finas
    a.fillStyle = '#d6d3c8'; a.fillRect(0, 0, w, hh); ro.fillStyle = '#d4d4d4'; ro.fillRect(0, 0, w, hh);
    for (let i = 0; i < 90; i++) { const cx = r() * w, cy = r() * hh; const gr = a.createRadialGradient(cx, cy, 0, cx, cy, 25 + r() * 80); const warm = r() < 0.35; gr.addColorStop(0, warm ? `rgba(${170 + r() * 30},${130 + r() * 20},${125 + r() * 20},0.22)` : `rgba(${120 + r() * 30},${125 + r() * 25},${120 + r() * 20},0.22)`); gr.addColorStop(1, 'rgba(0,0,0,0)'); a.fillStyle = gr; a.fillRect(0, 0, w, hh); }
    // veias ramificadas (azul-arroxeadas, escuras) levemente em relevo
    const vein = (x, y, ang, len, wd, depth) => {
      for (let s = 0; s < len; s++) {
        const nx = x + Math.cos(ang) * 4, ny = y + Math.sin(ang) * 4;
        a.strokeStyle = `rgba(${42 + r() * 18},${36 + r() * 14},${52 + r() * 16},${0.26 + 0.3 * wd / 3})`; a.lineWidth = wd;
        a.beginPath(); a.moveTo(x, y); a.lineTo(nx, ny); a.stroke();
        a.strokeStyle = `rgba(70,55,75,0.1)`; a.lineWidth = wd + 4; a.beginPath(); a.moveTo(x, y); a.lineTo(nx, ny); a.stroke();
        h.strokeStyle = `rgba(215,215,215,0.7)`; h.lineWidth = wd + 1; h.beginPath(); h.moveTo(x, y); h.lineTo(nx, ny); h.stroke();
        x = nx; y = ny; ang += (r() - 0.5) * 0.6;
        if (depth > 0 && r() < 0.07) vein(x, y, ang + (r() < 0.5 ? 0.8 : -0.8), len * 0.5, wd * 0.6, depth - 1);
      }
    };
    for (let i = 0; i < 30; i++) vein(r() * w, r() * hh, r() * 6.28, 30 + r() * 45, 0.8 + r() * 2.2, 2);
    // rugas e dobras
    for (let i = 0; i < 320; i++) { const x = r() * w, y = r() * hh; h.strokeStyle = 'rgba(40,40,40,0.5)'; h.lineWidth = 1; h.beginPath(); h.moveTo(x, y); h.quadraticCurveTo(x + 6, y + (r() - 0.5) * 6, x + 12 + r() * 10, y + (r() - 0.5) * 4); h.stroke(); a.strokeStyle = 'rgba(70,60,60,0.14)'; a.beginPath(); a.moveTo(x, y); a.lineTo(x + 14, y + 2); a.stroke(); }
    // poros
    for (let i = 0; i < w * hh * 0.006; i++) { const x = r() * w, y = r() * hh; h.fillStyle = 'rgba(70,70,70,0.35)'; h.fillRect(x, y, 1, 1); }
    // áreas úmidas um pouco menos foscas (sem virar plástico)
    for (let i = 0; i < 18; i++) { ro.fillStyle = 'rgba(150,150,150,0.3)'; ro.beginPath(); ro.arc(r() * w, r() * hh, 10 + r() * 30, 0, 7); ro.fill(); }
    noise(a, w, hh, 0.18); noise(h, w, hh, 0.25, '0,0,0', 0.06);
    h.filter = 'blur(0.6px)'; h.drawImage(h.canvas, 0, 0); h.filter = 'none';
  }), [2, 2], 3, aniso);
  // ---------- pele humana (mão) ----------
  T.handSkin = set(triple(256, 256, (a, h, ro, w, hh) => {
    a.fillStyle = '#c99478'; a.fillRect(0, 0, w, hh); ro.fillStyle = '#9a9a9a'; ro.fillRect(0, 0, w, hh);
    for (let i = 0; i < 40; i++) { const cx = r() * w, cy = r() * hh; const gr = a.createRadialGradient(cx, cy, 0, cx, cy, 20 + r() * 40); gr.addColorStop(0, `rgba(${170 + r() * 30},${90 + r() * 20},${80},0.25)`); gr.addColorStop(1, 'rgba(0,0,0,0)'); a.fillStyle = gr; a.fillRect(0, 0, w, hh); }
    for (let i = 0; i < 2600; i++) { const x = r() * w, y = r() * hh; h.fillStyle = 'rgba(70,70,70,0.6)'; h.fillRect(x, y, 1, 1); }
    for (let i = 0; i < 80; i++) { const y = r() * hh, x = r() * w; h.strokeStyle = 'rgba(60,60,60,0.5)'; h.beginPath(); h.moveTo(x, y); h.lineTo(x + 10 + r() * 14, y + (r() - 0.5) * 3); h.stroke(); }
    for (let i = 0; i < 12; i++) { a.strokeStyle = 'rgba(90,110,150,0.12)'; a.lineWidth = 1.5; a.beginPath(); let x = r() * w, y = r() * hh; a.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 20; y += 10; a.lineTo(x, y); } a.stroke(); }
    noise(a, w, hh, 0.12);
  }), [1, 1], 1.4, 4);
  // ---------- jaqueta ----------
  T.jacket = set(triple(128, 128, (a, h, ro, w, hh) => {
    a.fillStyle = '#2a3036'; a.fillRect(0, 0, w, hh); ro.fillStyle = '#ffffff'; ro.fillRect(0, 0, w, hh);
    for (let y = 0; y < hh; y += 3) { a.fillStyle = 'rgba(0,0,0,0.18)'; a.fillRect(0, y, w, 1); h.fillStyle = 'rgba(50,50,50,0.6)'; h.fillRect(0, y, w, 1); }
    for (let x = 0; x < w; x += 3) { a.fillStyle = 'rgba(255,255,255,0.04)'; a.fillRect(x, 0, 1, hh); h.fillStyle = 'rgba(200,200,200,0.3)'; h.fillRect(x, 0, 1, hh); }
    noise(a, w, hh, 0.25);
  }), [3, 3], 1.5, 4);
  // ---------- lanterna (serrilhado) ----------
  T.knurl = set(triple(128, 128, (a, h, ro, w, hh) => {
    a.fillStyle = '#1c1c1e'; a.fillRect(0, 0, w, hh); ro.fillStyle = '#606060'; ro.fillRect(0, 0, w, hh);
    for (let i = -hh; i < w; i += 8) { for (const [g, c] of [[h, '#f0f0f0'], [a, 'rgba(90,90,95,0.5)']]) { g.strokeStyle = c; g.lineWidth = 2; g.beginPath(); g.moveTo(i, 0); g.lineTo(i + hh, hh); g.stroke(); g.beginPath(); g.moveTo(i + hh, 0); g.lineTo(i, hh); g.stroke(); } }
  }), [2, 1], 3, 4);
  return T;
}

// Quadros (retratos/paisagens sombrias)
export function paintingTexture(v) {
  const lr = makeRng('quadro' + v);
  const [c, g] = mk(128, 160);
  const gr = g.createLinearGradient(0, 0, 0, 160); gr.addColorStop(0, ['#2a2418', '#1a2228', '#281818', '#20201a'][v % 4]); gr.addColorStop(1, '#0a0806');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 160);
  if (v % 3 === 0) { // retrato
    g.fillStyle = '#4a3a2a'; g.beginPath(); g.ellipse(64, 66, 24, 32, 0, 0, 7); g.fill();
    g.fillRect(24, 100, 80, 60);
    g.fillStyle = '#0a0806'; g.fillRect(52, 60, 8, 4); g.fillRect(68, 60, 8, 4);
    if (v % 2) { g.fillStyle = 'rgba(0,0,0,0.85)'; g.fillRect(44, 54, 40, 14); } // olhos riscados
  } else if (v % 3 === 1) { // paisagem com casa
    g.fillStyle = '#141a14'; g.fillRect(0, 110, 128, 50);
    g.fillStyle = '#20201c'; g.fillRect(40, 60, 50, 50); g.beginPath(); g.moveTo(34, 62); g.lineTo(65, 34); g.lineTo(96, 62); g.fill();
    g.fillStyle = '#c09040'; g.fillRect(58, 76, 6, 8);
    g.fillStyle = '#c8c8b0'; g.beginPath(); g.arc(100, 26, 8, 0, 7); g.fill();
  } else { // natureza-morta / mão
    g.fillStyle = '#3a2a20'; g.beginPath(); g.ellipse(64, 100, 34, 14, 0, 0, 7); g.fill();
    g.fillStyle = '#5a1a14'; for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(48 + i * 10, 92 - (i % 2) * 6, 8, 0, 7); g.fill(); }
  }
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(0,0,0,${lr.next() * 0.5})`; g.fillRect(lr.next() * 128, lr.next() * 160, 1, 1); }
  g.strokeStyle = 'rgba(200,180,140,0.08)'; for (let i = 0; i < 30; i++) { g.beginPath(); const x = lr.next() * 128, y = lr.next() * 160; g.moveTo(x, y); g.lineTo(x + 8, y + 3); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
