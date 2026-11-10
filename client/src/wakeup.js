// v3 (jam): cena "ACORDANDO" no começo de cada fase.
// Tela preta → o personagem abre os olhos (pálpebras pretas em cima/embaixo que se abrem entre piscadas,
// visão embaçada e escura clareando aos poucos) enquanto o texto da fase aparece:
//   FASE 1 — ELE VÊ.            Não se mexa quando ele estiver perto.
//   FASE 2 — ELE OUVE.          Faça o mínimo de barulho.
//   FASE 3 — ELE SENTE SEU CHEIRO.  Ele vai te farejar.
// O servidor é quem manda: espera todos carregarem ('go') e segura a partida durante a cena (ninguém se move,
// a criatura fica parada, ninguém morre). Aqui é só a parte visual/sonora, sincronizada pela duração recebida.
import { PHASES, WAKE } from '../../shared/config.js';

const smooth = (t) => t * t * (3 - 2 * t);
// curva por pontos (tempo em s → valor), com suavização entre os pontos
function curve(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    if (t <= t1) { const [t0, v0] = keys[i - 1]; return v0 + (v1 - v0) * smooth((t - t0) / Math.max(1e-6, t1 - t0)); }
  }
  return keys[keys.length - 1][1];
}
// abertura dos olhos (0 = fechados, 1 = abertos), em segundos de uma cena de 8 s
const OPEN = [[0, 0], [1.4, 0], [1.9, 0.2], [2.25, 0.02], [2.8, 0.03], [3.5, 0.46], [3.85, 0.14], [4.3, 0.2], [5.3, 0.8], [5.6, 0.82], [5.78, 0.04], [5.95, 0.06], [6.7, 1]];
const BLUR = [[0, 16], [2.6, 14], [4.0, 8], [5.4, 3.5], [7.0, 0]];
const BRIGHT = [[0, 0.22], [3, 0.35], [5.2, 0.7], [7, 1]];

export class WakeScene {
  constructor(app) {
    this.app = app;
    this.el = document.getElementById('wake');
    this.stage = document.getElementById('stage');
    this.active = false; this.raf = 0;
  }
  q(s) { return this.el.querySelector(s); }
  setText(phase) {
    const [l1, l2] = (PHASES[phase] || PHASES[1]).wake;
    this.q('.wk-l1').textContent = l1; this.q('.wk-l2').textContent = l2;
    for (const s of ['.wk-l1', '.wk-rule', '.wk-l2']) this.q(s).classList.remove('on');
    this.q('.wk-text').classList.remove('out');
  }
  lids(open) {
    // as pálpebras saem um pouco além da borda quando abertas (a sombra suave não fica na tela)
    const k = open * 118;
    this.q('.wk-lid.top').style.transform = `translateY(${-k}%)`;
    this.q('.wk-lid.bottom').style.transform = `translateY(${k}%)`;
  }
  // tela preta enquanto o servidor espera os outros jogadores carregarem
  waiting(phase, multi) {
    cancelAnimationFrame(this.raf);
    this.active = true; this.playing = false;
    this.setText(phase);
    this.el.classList.remove('hidden');
    this.q('.wk-black').style.opacity = '1';
    this.lids(0);
    this.stage.style.filter = 'blur(16px) brightness(0.22)';
    clearTimeout(this.waitT);
    const w = this.q('.wk-wait'); w.classList.remove('on');
    if (multi) this.waitT = setTimeout(() => { if (this.active && !this.playing) w.classList.add('on'); }, 1500);
  }
  // toca a cena; 'dur' = segundos restantes informados pelo servidor (8 s numa cena inteira)
  play(phase, dur = WAKE.seconds) {
    if (!this.active) this.waiting(phase, false);
    this.setText(phase);
    this.playing = true;
    clearTimeout(this.waitT); this.q('.wk-wait').classList.remove('on');
    const total = WAKE.seconds, start = performance.now() - Math.max(0, total - dur) * 1000;
    const audio = this.app.audio, beats = [0.35, 1.25, 2.2, 3.4];
    let beatI = 0, breathed = false;
    return new Promise((resolve) => {
      this.resolve = resolve;
      const step = () => {
        const t = (performance.now() - start) / 1000;
        // som: batimentos lentos e uma respiração funda ao abrir os olhos
        while (beatI < beats.length && t >= beats[beatI]) { try { audio.play('heartbeat', null, { volume: 0.55 - beatI * 0.08 }); } catch { } beatI++; }
        if (!breathed && t > 3.3) { breathed = true; try { audio.play('pant', null, { volume: 0.35 }); } catch { } }
        this.q('.wk-black').style.opacity = String(1 - smooth(Math.min(1, Math.max(0, (t - 1.0) / 0.6))));
        this.lids(curve(OPEN, t));
        this.stage.style.filter = `blur(${curve(BLUR, t).toFixed(2)}px) brightness(${curve(BRIGHT, t).toFixed(3)})`;
        if (t > 0.5) this.q('.wk-l1').classList.add('on');
        if (t > 1.3) this.q('.wk-rule').classList.add('on');
        if (t > 2.6) this.q('.wk-l2').classList.add('on');
        if (t > 6.5) this.q('.wk-text').classList.add('out');
        if (t >= total) { this.finish(); return; }
        this.raf = requestAnimationFrame(step);
      };
      step();
    });
  }
  finish() {
    cancelAnimationFrame(this.raf); clearTimeout(this.waitT);
    this.active = false; this.playing = false;
    this.el.classList.add('hidden');
    this.stage.style.filter = '';
    if (this.resolve) { const r = this.resolve; this.resolve = null; r(); }
  }
}
