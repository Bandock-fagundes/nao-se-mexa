// Música procedural (Web Audio) — nenhum arquivo externo.
// Modos: 'menu' (tema melancólico: drone + cordas + piano esparso), 'loading' (ambiência),
// 'game' (drone de tensão controlado por setTension 0..1) e 'none'.
// Stingers curtos: 'death', 'lose', 'win'.
// Uso externo: window.__music.setTension(0.7)  ·  window.__music.stinger('death')
const A = (n) => 440 * Math.pow(2, (n - 69) / 12); // nota MIDI -> Hz

// v2 fase 2 (mais sombria): progressão frígia i–bII–iv–i(b6) em Lá menor, melodia uma oitava abaixo,
// com a 2ª menor (Si bemol) e o trítono (Ré#) aparecendo — soa "errado" de propósito
const CHORDS = [
  { pad: [33, 45, 52, 57, 60], mel: [57, 60, 64, 58, 69] },      // Am
  { pad: [34, 46, 53, 58, 62], mel: [58, 62, 65, 57, 70] },      // Bb (bII)
  { pad: [38, 50, 53, 57], mel: [57, 62, 65, 63, 60] },          // Dm (com Ré#)
  { pad: [33, 45, 52, 53, 60], mel: [56, 57, 60, 64, 53] },      // Am(b6)
];

// v8: tema do menu — canção de ninar original (Ré menor, 3/4). [nota MIDI ou 0 = pausa, duração em tempos]
const LULLABY_BEAT = 0.86;
const LULLABY = [
  [[81, 1], [77, 1], [74, 1]], [[82, 2], [81, 1]], [[79, 1], [82, 1], [79, 1]], [[76, 2], [73, 1]],
  [[74, 1], [77, 1], [81, 1]], [[84, 2], [81, 1]], [[82, 1], [79, 1], [77, 1]], [[76, 3]],
  [[81, 1], [82, 1], [81, 1]], [[77, 2], [74, 1]], [[79, 1], [77, 1], [76, 1]], [[77, 2], [74, 1]],
  [[82, 1], [81, 1], [79, 1]], [[77, 1], [76, 1], [73, 1]], [[74, 3]], [[0, 3]],
];
// acorde de cada compasso: [raiz, quinta, terça] (graves)
const LULLABY_CHORDS = [
  [50, 57, 53], [46, 53, 50], [43, 50, 46], [45, 52, 49], [50, 57, 53], [41, 48, 45], [43, 50, 46], [45, 52, 49],
  [50, 57, 53], [46, 53, 50], [43, 50, 46], [50, 57, 53], [43, 50, 46], [45, 52, 49], [50, 57, 53], [50, 57, 53],
];

export class Music {
  constructor(engine) {
    this.e = engine; this.ready = false; this.want = 'none'; this.mode = 'none';
    this.layer = null; this.tension = 0; this.targetTension = 0; this.manualUntil = 0;
  }
  // chamado pelo AudioEngine quando o AudioContext existe
  attach() {
    if (this.ready) return;
    const c = this.c = this.e.ctx;
    this.out = this.e.musBus;
    // reverb por convolução com resposta ao impulso gerada
    this.verb = c.createConvolver(); this.verb.buffer = this.impulse(3.6, 2.6);
    this.verbIn = c.createGain(); this.verbIn.gain.value = 1;
    const verbOut = c.createGain(); verbOut.gain.value = 0.9;
    this.verbIn.connect(this.verb); this.verb.connect(verbOut); verbOut.connect(this.out);
    this.stingBus = c.createGain(); this.stingBus.gain.value = 1; this.stingBus.connect(this.out);
    this.stingWet = c.createGain(); this.stingWet.gain.value = 0.6; this.stingWet.connect(this.verbIn);
    this.ready = true;
    this.timer = setInterval(() => this.tick(), 90);
    this.apply();
  }
  impulse(sec, decay) {
    const c = this.c, n = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch); let lp = 0;
      for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; lp += (w - lp) * (0.35 - 0.25 * i / n); d[i] = lp * Math.pow(1 - i / n, decay) * (i < 200 ? i / 200 : 1); }
    }
    return b;
  }
  get now() { return this.c ? this.c.currentTime : 0; }

  // ---------------- API pública ----------------
  setMode(m) { this.want = m || 'none'; if (this.ready) this.apply(); }
  setTension(v, manual = true) {
    this.targetTension = Math.max(0, Math.min(1, +v || 0));
    if (manual) this.manualUntil = performance.now() + 2500;
  }
  // usado por main.js a cada quadro; ignorado enquanto houver chamada manual recente
  autoTension(v) { if (performance.now() > this.manualUntil) this.setTension(v, false); }
  stinger(kind) {
    if (!this.ready) return;
    const t = this.now + 0.02;
    if (this.lastSting && this.lastSting.k === kind && t - this.lastSting.t < 4) return; // evita repetir (ex.: fuga + fim)
    this.lastSting = { k: kind, t };
    if (kind === 'death' || kind === 'lose') this.deathSting(t, kind === 'lose' ? 0.75 : 1);
    else if (kind === 'win') this.winSting(t);
    // abaixa a camada atual durante o stinger
    if (this.layer) { const g = this.layer.g.gain; g.cancelScheduledValues(t); g.setTargetAtTime(0.15, t, 0.08); g.setTargetAtTime(1, t + 4.5, 1.5); }
  }

  // ---------------- camadas ----------------
  apply() {
    if (this.want === this.mode) return;
    this.mode = this.want;
    if (this.layer) { if (this.layer.kind === 'menu') this.layer.fade = 2.6; this.killLayer(this.layer); }
    this.layer = null;
    if (this.mode === 'none') return;
    const L = this.newLayer();
    L.kind = this.mode;
    this.layer = L;
    if (this.mode === 'menu') this.startMenu(L);
    else if (this.mode === 'loading') this.startLoading(L);
    else if (this.mode === 'game') this.startGame(L);
  }
  newLayer() {
    const c = this.c, t = this.now;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1, t + 2.0); g.connect(this.out);
    const wet = c.createGain(); wet.gain.value = 1; wet.connect(this.verbIn);
    const bus = c.createGain(); bus.connect(g);
    const wetBus = c.createGain(); wetBus.connect(wet); wetBus.connect(g); wetBus.gain.value = 1;
    // wetBus vai ao reverb e ao seco (com g); bus vai só ao seco
    const L = { g, wet, bus, wetBus, nodes: [], next: t + 0.3, beat: 0, chord: 0, nextChord: t + 0.1 };
    // a camada de reverb também precisa desvanecer junto
    wet.gain.setValueAtTime(0.0001, t); wet.gain.exponentialRampToValueAtTime(1, t + 2.0);
    return L;
  }
  killLayer(L) {
    const t = this.now;
    for (const p of [L.g.gain, L.wet.gain]) { p.cancelScheduledValues(t); p.setValueAtTime(Math.max(0.0001, p.value), t); p.exponentialRampToValueAtTime(0.0001, t + (L.fade || 1.6)); }
    L.dead = true;
    setTimeout(() => { for (const n of L.nodes) { try { n.stop(); } catch { } try { n.disconnect(); } catch { } } try { L.g.disconnect(); L.wet.disconnect(); } catch { } }, 5000);
  }
  osc(L, type, f, dest, detune = 0) {
    const o = this.c.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = detune; o.connect(dest); o.start(); L.nodes.push(o); return o;
  }
  noiseLoop(L, buf, dest) { const s = this.c.createBufferSource(); s.buffer = buf; s.loop = true; s.connect(dest); s.start(0, Math.random() * buf.duration); L.nodes.push(s); return s; }
  lfo(L, f, depth, param) { const o = this.c.createOscillator(); o.frequency.value = f; const g = this.c.createGain(); g.gain.value = depth; o.connect(g); g.connect(param); o.start(); L.nodes.push(o); return o; }
  filt(type, f, q = 0.7) { const b = this.c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  gain(v, dest) { const g = this.c.createGain(); g.gain.value = v; if (dest) g.connect(dest); return g; }

  // ---------------- vozes ----------------
  piano(t, f, vel, dest) {
    const c = this.c;
    const parts = [[1, 1, 3.2], [2, 0.42, 1.8], [3, 0.16, 1.0], [4.02, 0.07, 0.6], [5.1, 0.03, 0.35]];
    const out = c.createGain(); out.gain.value = vel; out.connect(dest);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(Math.min(9000, f * 9), t); lp.frequency.exponentialRampToValueAtTime(Math.max(400, f * 2), t + 2.5); lp.connect(out);
    for (const [m, g, dec] of parts) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f * m; o.detune.value = (Math.random() - 0.5) * 4;
      const e = c.createGain(); e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(g, t + 0.005); e.gain.setTargetAtTime(0, t + 0.005, dec / 3.5);
      o.connect(e); e.connect(lp); o.start(t); o.stop(t + dec * 1.6 + 0.3);
    }
    // martelo
    const n = c.createBufferSource(); n.buffer = this.e.white; const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = Math.min(6000, f * 6); bp.Q.value = 1.5;
    const ng = c.createGain(); ng.gain.setValueAtTime(0.06, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    n.connect(bp); bp.connect(ng); ng.connect(out); n.start(t, Math.random()); n.stop(t + 0.06);
  }
  strings(t, f, dur, g, dest, atk = 2.5, cutoff = 900) {
    const c = this.c;
    const env = c.createGain(); env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(g, t + atk); env.gain.setValueAtTime(g, t + dur); env.gain.setTargetAtTime(0, t + dur, atk / 2.5);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(cutoff * 0.6, t); lp.frequency.linearRampToValueAtTime(cutoff, t + atk); lp.Q.value = 0.6;
    lp.connect(env); env.connect(dest);
    const vib = c.createOscillator(); vib.frequency.value = 4.6 + Math.random(); const vg = c.createGain(); vg.gain.value = f * 0.003; vib.connect(vg);
    for (const dt of [-9, 0, 8]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = dt + (Math.random() - 0.5) * 3; vg.connect(o.frequency); o.connect(lp); o.start(t); o.stop(t + dur + atk * 2 + 0.5); }
    vib.start(t); vib.stop(t + dur + atk * 2 + 0.5);
  }
  bell(t, f, g, dest, dec = 2.4) {
    for (const [m, gg, d] of [[1, 1, dec], [2.76, 0.35, dec * 0.5], [5.4, 0.15, dec * 0.3], [0.5, 0.25, dec * 1.2]]) {
      const o = this.c.createOscillator(); o.type = 'sine'; o.frequency.value = f * m;
      const e = this.c.createGain(); e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(g * gg, t + 0.004); e.gain.setTargetAtTime(0, t + 0.004, d / 4);
      o.connect(e); e.connect(dest); o.start(t); o.stop(t + d * 1.5 + 0.2);
    }
  }

  // ---------------- MENU ----------------
  // v8: canção de ninar ORIGINAL para caixinha de música (Ré menor, 3/4, ~70 bpm) sobre cordas graves e drone.
  // Ciclo de 16 compassos (~41 s): 1ª vez na caixinha; 2ª vez o piano canta a melodia uma oitava abaixo e a
  // caixinha só pontua; no fim da 2ª a caixinha "perde a corda" (desacelera e desafina) e recomeça.
  startMenu(L) {
    const lp = this.filt('lowpass', 150, 1.1); const dg = this.gain(0.11, L.bus); lp.connect(dg);
    this.osc(L, 'sawtooth', A(38), lp, -6); this.osc(L, 'sawtooth', A(38), lp, 7); this.osc(L, 'sine', A(45), lp); // Ré1 + Lá1
    this.lfo(L, 0.045, 60, lp.frequency);
    const air = this.filt('bandpass', 380, 0.6); const ag = this.gain(0.022, L.wetBus); air.connect(ag); this.noiseLoop(L, this.e.pink, air);
    this.lfo(L, 0.07, 0.015, ag.gain);
    L.bar = 0; L.cycle = 0; L.nextBar = this.now + 0.6;
  }
  // caixinha de música: lâmina de metal (fundamental + parciais inarmônicas, ataque seco, cauda curta) e um "tic" mecânico
  musicBox(t, f, vel, dest, detuneCents = 0) {
    const c = this.c; const k = Math.pow(2, detuneCents / 1200);
    const out = c.createGain(); out.gain.value = vel; out.connect(dest);
    for (const [m, g, dec] of [[1, 1, 1.9], [2.0, 0.18, 0.9], [4.16, 0.22, 0.45], [6.9, 0.08, 0.22], [9.7, 0.04, 0.12]]) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f * m * k; o.detune.value = (Math.random() - 0.5) * 6;
      const e = c.createGain(); e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(g, t + 0.003); e.gain.setTargetAtTime(0, t + 0.003, dec / 3.2);
      o.connect(e); e.connect(out); o.start(t); o.stop(t + dec * 1.7 + 0.1);
    }
    const n = c.createBufferSource(); n.buffer = this.e.white; const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5200;
    const ng = c.createGain(); ng.gain.setValueAtTime(0.05, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
    n.connect(hp); hp.connect(ng); ng.connect(out); n.start(t, Math.random()); n.stop(t + 0.02);
  }
  // ---------------- CARREGANDO ----------------
  startLoading(L) {
    const lp = this.filt('lowpass', 150, 1); const dg = this.gain(0.2, L.bus); lp.connect(dg);
    this.osc(L, 'sine', A(26), lp); this.osc(L, 'triangle', A(38), lp, 5); this.osc(L, 'sawtooth', A(38), lp, -9);
    const wind = this.filt('bandpass', 300, 0.7); const wg = this.gain(0.06, L.wetBus); wind.connect(wg); this.noiseLoop(L, this.e.pink, wind);
    this.lfo(L, 0.11, 160, wind.frequency); this.lfo(L, 0.07, 0.04, wg.gain);
  }
  // ---------------- PARTIDA (tensão) ----------------
  startGame(L) {
    const c = this.c;
    // base: dois senos batendo (sempre presente, baixo)
    L.base = this.gain(0.0, L.bus); const blp = this.filt('lowpass', 120); blp.connect(L.base);
    this.osc(L, 'sine', 41.2, blp); this.osc(L, 'sine', 43.65, blp); this.osc(L, 'triangle', 61.7, blp, 4);
    // cluster médio que abre com a tensão
    L.mid = this.gain(0.0, L.wetBus); L.midF = this.filt('lowpass', 250, 2); L.midF.connect(L.mid);
    for (const [f, d] of [[110, 0], [116.5, 6], [155.6, -5], [164.8, 3]]) this.osc(L, 'sawtooth', f, L.midF, d);
    // cordas agudas em trêmulo (dissonantes) para tensão alta
    L.hi = this.gain(0.0, L.wetBus); const hbp = this.filt('bandpass', 1300, 1.4); const trem = this.gain(0.5, null); hbp.connect(trem); trem.connect(L.hi);
    this.lfo(L, 7.3, 0.5, trem.gain);
    for (const [f, d] of [[880, 0], [932.3, -4], [1244.5, 5]]) this.osc(L, 'sawtooth', f, hbp, d);
    L.pulseNext = this.now + 1;
    void c;
  }
  applyTension(L, dt) {
    this.tension += (this.targetTension - this.tension) * Math.min(1, dt * 1.4);
    const k = this.tension, t = this.now;
    L.base.gain.setTargetAtTime(0.10 + 0.10 * k, t, 0.3);
    L.mid.gain.setTargetAtTime(0.012 + 0.07 * k * k, t, 0.3);
    L.midF.frequency.setTargetAtTime(180 + 1700 * k * k, t, 0.4);
    L.hi.gain.setTargetAtTime(k > 0.45 ? 0.045 * Math.pow((k - 0.45) / 0.55, 1.5) : 0, t, 0.4);
  }

  // ---------------- agendador ----------------
  tick() {
    const L = this.layer; if (!L || L.dead) return;
    const now = this.now, ahead = now + 0.35;
    const dt = 0.09;
    if (this.mode === 'menu') {
      while (L.nextBar < ahead) {
        const bi = L.bar % 16, cyc = L.cycle % 2, t = L.nextBar;
        // a corda acabando: os 2 últimos compassos do 2º ciclo desaceleram e desafinam
        const wind = cyc === 1 && bi >= 14 ? (bi - 13) / 3 : 0;
        const beat = LULLABY_BEAT * (1 + wind * 0.9), det = -wind * 38;
        const ch = LULLABY_CHORDS[bi];
        // cordas graves: raiz + quinta (+ terça no meio), pedal longo por compasso
        for (const [n, g] of [[ch[0] - 12, 0.026], [ch[0], 0.02], [ch[1], 0.014]]) this.strings(t, A(n), beat * 3 - 0.2, g, L.wetBus, 1.4, 620);
        // piano: baixo no 1º tempo
        this.piano(t, A(ch[0] - 12), 0.11, L.wetBus);
        if (cyc === 1 && bi % 2 === 1) this.piano(t + beat, A(ch[2]), 0.05, L.wetBus);
        let bt = 0;
        for (const [n, d] of LULLABY[bi]) {
          const tt = t + bt * beat + (Math.random() - 0.5) * 0.02;
          if (n) {
            if (cyc === 0) this.musicBox(tt, A(n), 0.075 + Math.random() * 0.015, L.wetBus, det);
            else {
              this.piano(tt, A(n - 12), 0.085 + Math.random() * 0.02, L.wetBus);
              if (bt === 0 && bi % 4 === 0) this.musicBox(tt + beat * 0.5, A(n + 12), 0.035, L.wetBus, det); // eco agudo
              if (wind) this.musicBox(tt, A(n), 0.06, L.wetBus, det);
            }
          }
          bt += d;
        }
        L.bar++; L.nextBar += beat * 3;
        if (bi === 15) { L.cycle++; L.nextBar += cyc === 1 ? 2.6 : 0.4; } // respira antes de recomeçar
      }
    } else if (this.mode === 'loading') {
      while (L.next < ahead) {
        const t = L.next;
        // nota grave distante e um sino abafado
        this.piano(t, A([38, 41, 45, 40][L.beat % 4]), 0.09, L.wetBus);
        if (L.beat % 2 === 1) this.bell(t + 1.5, A(81 + [0, 3, -2][L.beat % 3]), 0.012, L.wetBus, 3);
        L.beat++; L.next += 3.2;
      }
    } else if (this.mode === 'game') {
      this.applyTension(L, dt);
      const k = this.tension;
      if (k > 0.55 && L.pulseNext < ahead) {
        const t = Math.max(L.pulseNext, now + 0.02);
        const o = this.c.createOscillator(); o.frequency.setValueAtTime(62, t); o.frequency.exponentialRampToValueAtTime(34, t + 0.25);
        const g = this.c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.22 * (k - 0.4), t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
        o.connect(g); g.connect(L.bus); o.start(t); o.stop(t + 0.4);
        L.pulseNext = t + (1.15 - 0.55 * k);
      } else if (k <= 0.55) L.pulseNext = Math.max(L.pulseNext, now);
      // notas raras e frias quando calmo
      if (L.next < ahead) { const t = L.next; if (k < 0.4 && Math.random() < 0.5) { const n = [45, 46, 51, 44, 57][Math.floor(Math.random() * 5)]; this.piano(t, A(n), 0.04, L.wetBus); if (Math.random() < 0.4) this.piano(t + 0.9, A(n + 1), 0.025, L.wetBus); } // notas graves e 2ª menor
        else if (k < 0.4 && Math.random() < 0.3) this.bell(t, A(84) * (1 + (Math.random() - 0.5) * 0.02), 0.006, L.wetBus, 4); // caixinha de música desafinada, bem longe
        L.next += 6 + Math.random() * 6; }
    }
  }

  // ---------------- stingers ----------------
  deathSting(t, v) {
    const c = this.c, d = this.stingBus, w = this.stingWet;
    // impacto grave
    const o = c.createOscillator(); o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(26, t + 1.6);
    const og = c.createGain(); og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(0.7 * v, t + 0.01); og.gain.exponentialRampToValueAtTime(0.0001, t + 2.0);
    o.connect(og); og.connect(d); o.start(t); o.stop(t + 2.1);
    // cluster dissonante de cordas com filtro fechando
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(5000, t); lp.frequency.exponentialRampToValueAtTime(300, t + 3);
    const cg = c.createGain(); cg.gain.setValueAtTime(0, t); cg.gain.linearRampToValueAtTime(0.09 * v, t + 0.02); cg.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
    lp.connect(cg); cg.connect(d); cg.connect(w);
    for (const n of [36, 37, 42, 48, 49, 55, 61]) { const s = c.createOscillator(); s.type = 'sawtooth'; s.frequency.setValueAtTime(A(n), t); s.frequency.linearRampToValueAtTime(A(n) * 0.94, t + 3); s.connect(lp); s.start(t); s.stop(t + 3.6); }
    // guincho descendente
    const sc = c.createOscillator(); sc.type = 'sawtooth'; sc.frequency.setValueAtTime(2400, t); sc.frequency.exponentialRampToValueAtTime(500, t + 1.2);
    const sbp = c.createBiquadFilter(); sbp.type = 'bandpass'; sbp.frequency.value = 1800; sbp.Q.value = 3;
    const sg = c.createGain(); sg.gain.setValueAtTime(0, t); sg.gain.linearRampToValueAtTime(0.05 * v, t + 0.03); sg.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
    sc.connect(sbp); sbp.connect(sg); sg.connect(w); sg.connect(d); sc.start(t); sc.stop(t + 1.4);
    // ruído de impacto
    const n = c.createBufferSource(); n.buffer = this.e.brown; const nf = c.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.setValueAtTime(1200, t); nf.frequency.exponentialRampToValueAtTime(90, t + 1.2);
    const ng = c.createGain(); ng.gain.setValueAtTime(0.9 * v, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    n.connect(nf); nf.connect(ng); ng.connect(d); n.start(t); n.stop(t + 1.5);
    // piano grave final
    this.piano(t + 1.8, A(33), 0.25 * v, w); this.piano(t + 1.8, A(45), 0.15 * v, w);
  }
  winSting(t) {
    const d = this.stingBus, w = this.stingWet;
    const notes = [69, 73, 76, 81, 85, 88];
    notes.forEach((n, i) => this.bell(t + i * 0.16, A(n), 0.07, w, 3));
    for (const n of [57, 64, 69, 73, 76]) this.strings(t + 0.2, A(n), 2.6, 0.02, w, 0.9, 1800);
    this.piano(t + 1.1, A(45), 0.2, w); this.piano(t + 1.1, A(57), 0.12, d);
  }
}
