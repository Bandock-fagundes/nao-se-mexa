// Áudio procedural (Web Audio): tudo sintetizado em código, posicional (HRTF) com oclusão por paredes.
import { Music } from './music.js';
export class AudioEngine {
  constructor() { this.ctx = null; this.enabled = false; this.vol = { master: 0.8, sfx: 0.9, ambient: 0.7, music: 0.6 }; this.occlusionFn = null; this.loops = []; this.music = new Music(this); window.__music = this.music; }
  // true quando o navegador ainda bloqueia o som (sem gesto do usuário)
  get blocked() { return !this.ctx || this.ctx.state !== 'running'; }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain(); this.master.connect(c.destination);
    this.comp = c.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.ratio.value = 4; this.comp.connect(this.master);
    this.sfx = c.createGain(); this.sfx.connect(this.comp);
    this.amb = c.createGain(); this.amb.connect(this.comp);
    this.musBus = c.createGain(); this.musBus.connect(this.master); // música fora do compressor (sem 'bombear')
    this.applyVolumes();
    // buffers de ruído
    const mkNoise = (sec, kind) => {
      const b = c.createBuffer(1, c.sampleRate * sec, c.sampleRate); const d = b.getChannelData(0);
      let last = 0, b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
        else if (kind === 'pink') { b0 = 0.997 * b0 + w * 0.029; b1 = 0.985 * b1 + w * 0.032; b2 = 0.95 * b2 + w * 0.048; d[i] = (b0 + b1 + b2 + w * 0.02) * 1.6; }
        else d[i] = w;
      }
      return b;
    };
    this.white = mkNoise(2, 'white'); this.pink = mkNoise(3, 'pink'); this.brown = mkNoise(4, 'brown');
    this.dist = c.createWaveShaper(); const curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 3); } this.dist.curve = curve;
    this.enabled = true;
    this.music.attach();
  }
  applyVolumes() { if (!this.ctx) return; this.master.gain.value = this.vol.master; this.sfx.gain.value = this.vol.sfx; this.amb.gain.value = this.vol.ambient * 0.8; this.musBus.gain.value = (this.vol.music ?? 0.6) * 0.9; }
  setVolumes(v) { Object.assign(this.vol, v); this.applyVolumes(); }
  get now() { return this.ctx ? this.ctx.currentTime : 0; }
  setListener(pos, fwd, up) {
    if (!this.ctx) return;
    const L = this.ctx.listener, t = this.now;
    if (L.positionX) { L.positionX.setTargetAtTime(pos.x, t, 0.02); L.positionY.setTargetAtTime(pos.y, t, 0.02); L.positionZ.setTargetAtTime(pos.z, t, 0.02); L.forwardX.setTargetAtTime(fwd.x, t, 0.02); L.forwardY.setTargetAtTime(fwd.y, t, 0.02); L.forwardZ.setTargetAtTime(fwd.z, t, 0.02); L.upX.value = up.x; L.upY.value = up.y; L.upZ.value = up.z; }
    else { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z); }
  }
  // cadeia de saída posicional: panner HRTF + passa-baixa de oclusão
  out(pos, { bus = 'sfx', refDistance = 1.5, maxDistance = 45, rolloff = 1.3, occlusion = true } = {}) {
    const c = this.ctx;
    const g = c.createGain();
    if (!pos) { g.connect(bus === 'amb' ? this.amb : this.sfx); return { input: g, gain: g }; }
    const p = c.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = refDistance; p.maxDistance = maxDistance; p.rolloffFactor = rolloff;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 20000; lp.Q.value = 0.5;
    let occGain = 1;
    if (occlusion && this.occlusionFn) { const o = this.occlusionFn(pos); lp.frequency.value = o.cutoff; occGain = o.gain; }
    g.gain.value = occGain;
    g.connect(lp); lp.connect(p); p.connect(bus === 'amb' ? this.amb : this.sfx);
    return { input: g, panner: p, lp, gain: g };
  }
  env(param, t, a, peak, d, end = 0.0001) { param.cancelScheduledValues(t); param.setValueAtTime(0.0001, t); param.exponentialRampToValueAtTime(peak, t + a); param.exponentialRampToValueAtTime(end, t + a + d); }
  noise(buf, t, dur, dest, { type = 'bandpass', f = 1000, q = 1, gain = 1, a = 0.005, rate = 1, f2 = null, offset = 0 } = {}) {
    const c = this.ctx; const s = c.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur); fl.Q.value = q;
    const g = c.createGain(); this.env(g.gain, t, a, gain, dur);
    s.connect(fl); fl.connect(g); g.connect(dest); s.start(t, Math.max(0, offset || Math.random() * Math.max(0, buf.duration - dur - 0.1))); s.stop(t + a + dur + 0.05);
    return { s, fl, g };
  }
  tone(t, dur, dest, { f = 100, type = 'sine', gain = 0.5, a = 0.005, f2 = null, detune = 0 } = {}) {
    const c = this.ctx; const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur); o.detune.value = detune;
    const g = c.createGain(); this.env(g.gain, t, a, gain, dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + a + dur + 0.05);
    return o;
  }
  // ---------------- efeitos ----------------
  play(kind, pos, opts = {}) {
    if (!this.enabled) return;
    const c = this.ctx, t = this.now + (opts.delay || 0);
    const o = this.out(pos, opts);
    const d = o.input;
    const v = opts.volume ?? 1;
    const r = Math.random;
    switch (kind) {
      case 'step_wood': case 'step_carpet': case 'step_stone': case 'step_tile': {
        const surf = kind.slice(5);
        const base = surf === 'carpet' ? 0.35 : surf === 'stone' ? 0.8 : surf === 'tile' ? 0.85 : 0.7;
        const f = surf === 'carpet' ? 350 : surf === 'stone' ? 1800 : surf === 'tile' ? 2600 : 700;
        this.noise(this.white, t, 0.08 + r() * 0.04, d, { f: f * (0.85 + r() * 0.3), q: 1.2, gain: 0.5 * base * v });
        this.tone(t, 0.09, d, { f: surf === 'carpet' ? 70 : 95 + r() * 20, gain: 0.35 * base * v, f2: 50 });
        if (surf === 'wood' && r() < 0.18) this.creak(t + 0.03, d, 0.15 * v);
        if (surf === 'tile' || surf === 'stone') this.noise(this.white, t + 0.01, 0.03, d, { type: 'highpass', f: 4000, gain: 0.15 * v });
        break;
      }
      case 'land': this.noise(this.brown, t, 0.25, d, { type: 'lowpass', f: 400, gain: 0.9 * v }); this.tone(t, 0.18, d, { f: 70, f2: 40, gain: 0.6 * v }); this.creak(t + 0.05, d, 0.2 * v); break;
      case 'cstep': { // passo pesado da criatura
        this.tone(t, 0.35, d, { f: 52 + r() * 8, f2: 28, gain: 1.1 * v });
        this.noise(this.brown, t, 0.4, d, { type: 'lowpass', f: 260, gain: 1.2 * v });
        this.noise(this.white, t, 0.06, d, { f: 900, q: 2, gain: 0.25 * v });
        if (r() < 0.35) this.creak(t + 0.08, d, 0.35 * v);
        break;
      }
      case 'breath': { // respiração pesada da criatura (inspira/expira)
        const dur = opts.dur || 1.6;
        this.noise(this.pink, t, dur * 0.45, d, { f: 500, f2: 900, q: 0.7, gain: 0.5 * v, a: 0.4 });
        this.noise(this.pink, t + dur * 0.5, dur * 0.5, d, { f: 700, f2: 300, q: 0.7, gain: 0.6 * v, a: 0.1 });
        const o2 = this.tone(t + dur * 0.5, dur * 0.45, d, { f: 62, type: 'sawtooth', gain: 0.12 * v, a: 0.1 });
        void o2;
        break;
      }
      case 'growl': {
        const g = c.createGain(); g.connect(d);
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; lp.connect(g);
        for (const f of [48, 73, 97]) { const os = c.createOscillator(); os.type = 'sawtooth'; os.frequency.setValueAtTime(f, t); os.frequency.linearRampToValueAtTime(f * 0.85, t + 1.2); const lfo = c.createOscillator(); lfo.frequency.value = 9; const lg = c.createGain(); lg.gain.value = f * 0.04; lfo.connect(lg); lg.connect(os.frequency); os.connect(lp); os.start(t); os.stop(t + 1.3); lfo.start(t); lfo.stop(t + 1.3); }
        this.env(g.gain, t, 0.15, 0.35 * v, 1.1);
        this.noise(this.pink, t, 1.0, d, { f: 400, q: 1, gain: 0.3 * v, a: 0.1 });
        break;
      }
      case 'roar': {
        const g = c.createGain(); const ds = c.createWaveShaper(); ds.curve = this.dist.curve; g.connect(d);
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(2500, t); lp.frequency.exponentialRampToValueAtTime(500, t + 2); ds.connect(lp); lp.connect(g);
        for (const f of [110, 165, 233, 311]) { const os = c.createOscillator(); os.type = 'sawtooth'; os.frequency.setValueAtTime(f * 1.3, t); os.frequency.exponentialRampToValueAtTime(f * 0.7, t + 2.0); const lfo = c.createOscillator(); lfo.frequency.value = 14 + r() * 6; const lg = c.createGain(); lg.gain.value = f * 0.08; lfo.connect(lg); lg.connect(os.frequency); const og = c.createGain(); og.gain.value = 0.25; os.connect(og); og.connect(ds); os.start(t); os.stop(t + 2.2); lfo.start(t); lfo.stop(t + 2.2); }
        this.env(g.gain, t, 0.08, 0.7 * v, 2.0);
        this.noise(this.white, t, 1.8, d, { f: 1500, f2: 400, q: 0.8, gain: 0.5 * v, a: 0.05 });
        break;
      }
      case 'clicks': { // estalos da boca vertical (reação a som)
        for (let i = 0; i < 6; i++) this.noise(this.white, t + i * (0.05 + r() * 0.04), 0.02, d, { f: 1800 + r() * 900, q: 6, gain: 0.7 * v });
        this.tone(t, 0.4, d, { f: 140, f2: 90, type: 'square', gain: 0.06 * v });
        break;
      }
      case 'sniff': {
        for (let i = 0; i < 4; i++) this.noise(this.white, t + i * 0.22, 0.13, d, { f: 1600 + r() * 600, q: 1.5, gain: 0.55 * v, a: 0.03 });
        this.noise(this.pink, t + 1.0, 0.8, d, { f: 600, f2: 300, gain: 0.4 * v, a: 0.1 });
        break;
      }
      case 'attack': this.play('roar', pos, { ...opts, volume: v * 1.2 }); this.noise(this.white, t, 0.25, d, { f: 900, f2: 200, gain: 0.8 * v }); break;
      case 'kill': {
        this.noise(this.brown, t, 0.5, d, { type: 'lowpass', f: 500, gain: 1.4 * v });
        for (let i = 0; i < 5; i++) this.noise(this.white, t + 0.1 + i * 0.06, 0.05, d, { f: 1200 + r() * 1500, q: 3, gain: 0.8 * v });
        this.tone(t, 0.6, d, { f: 60, f2: 30, gain: 0.9 * v });
        break;
      }
      case 'door_wood': case 'door_heavy': case 'door_rusty': {
        const k = kind === 'door_rusty' ? 1.6 : kind === 'door_heavy' ? 1.2 : 0.8;
        this.creak(t, d, 0.6 * v * k, kind === 'door_rusty' ? 1.2 : 0.7, kind === 'door_heavy' ? 0.7 : 1);
        if (opts.close) { this.noise(this.brown, t + 0.5, 0.25, d, { type: 'lowpass', f: 300, gain: 1.0 * v }); this.tone(t + 0.5, 0.2, d, { f: 80, f2: 45, gain: 0.6 * v }); }
        this.noise(this.white, t, 0.04, d, { f: 3000, q: 4, gain: 0.3 * v });
        break;
      }
      case 'container_drawer': this.noise(this.pink, t, 0.35, d, { f: 900, f2: 600, q: 0.8, gain: 0.5 * v, a: 0.03 }); this.noise(this.white, t + 0.33, 0.04, d, { f: 1500, q: 3, gain: 0.4 * v }); break;
      case 'container_wardrobe': this.creak(t, d, 0.45 * v, 0.6, 1.3); break;
      case 'container_chest': this.creak(t, d, 0.35 * v, 0.5, 0.8); this.noise(this.brown, t + 0.45, 0.2, d, { type: 'lowpass', f: 350, gain: 0.7 * v }); break;
      case 'container_crate': this.noise(this.white, t, 0.12, d, { f: 1200, q: 2, gain: 0.35 * v }); this.noise(this.brown, t + 0.2, 0.2, d, { type: 'lowpass', f: 400, gain: 0.6 * v }); break;
      case 'key_pickup': for (let i = 0; i < 5; i++) { this.tone(t + i * 0.035, 0.35, d, { f: 2400 + r() * 1800, gain: 0.12 * v, type: 'sine' }); this.tone(t + i * 0.035, 0.25, d, { f: 5200 + r() * 1500, gain: 0.05 * v }); } break;
      case 'key_deposit': for (let i = 0; i < 2; i++) { this.noise(this.white, t + i * 0.18, 0.05, d, { f: 2200, q: 3, gain: 0.5 * v }); this.tone(t + i * 0.18, 0.25, d, { f: 900 + i * 300, f2: 500, gain: 0.2 * v }); } this.tone(t + 0.4, 0.3, d, { f: 140, f2: 80, gain: 0.4 * v }); break;
      case 'wobble': for (let i = 0; i < 4; i++) this.noise(this.white, t + i * 0.09, 0.03, d, { f: 1800 + r() * 900, q: 3, gain: (0.22 - i * 0.04) * v }); break;
      case 'body_search': this.noise(this.pink, t, 0.5, d, { f: 1400, q: 0.7, gain: 0.25 * v, a: 0.05 }); break;
      case 'knock_vase': this.noise(this.white, t, 0.4, d, { type: 'highpass', f: 2500, gain: 0.9 * v }); for (let i = 0; i < 8; i++) this.tone(t + r() * 0.3, 0.12, d, { f: 3000 + r() * 4000, gain: 0.15 * v }); this.noise(this.brown, t, 0.15, d, { type: 'lowpass', f: 300, gain: 0.5 * v }); break;
      case 'knock_bottles': for (let i = 0; i < 6; i++) { const tt = t + i * (0.06 + r() * 0.1); this.tone(tt, 0.3, d, { f: 1200 + r() * 1400, gain: 0.25 * v }); this.noise(this.white, tt, 0.03, d, { f: 3000, gain: 0.3 * v }); } break;
      case 'knock_candelabrum': case 'knock_bucket': {
        const base = kind === 'knock_bucket' ? 310 : 520;
        for (let i = 0; i < 4; i++) { const tt = t + i * (0.12 + r() * 0.15); for (const m of [1, 2.76, 5.4, 8.9]) this.tone(tt, 0.9 - i * 0.15, d, { f: base * m * (1 + r() * 0.02), gain: (0.25 / m) * v * (1 - i * 0.2) }); this.noise(this.white, tt, 0.03, d, { f: 2500, gain: 0.4 * v }); }
        break;
      }
      case 'knock_box': this.noise(this.brown, t, 0.2, d, { type: 'lowpass', f: 500, gain: 0.7 * v }); this.tone(t, 0.12, d, { f: 120, f2: 70, gain: 0.3 * v }); break;
      case 'exit_unlock': for (let i = 0; i < 3; i++) { this.noise(this.white, t + i * 0.25, 0.05, d, { f: 2000, q: 3, gain: 0.6 * v }); this.tone(t + i * 0.25, 0.15, d, { f: 180, f2: 90, gain: 0.5 * v }); } this.creak(t + 0.9, d, 0.9 * v, 1.8, 0.6); this.noise(this.pink, t + 1.0, 2, d, { f: 400, gain: 0.5 * v, a: 0.5 }); break;
      case 'flashlight': this.noise(this.white, t, 0.012, d, { f: 3500, q: 2, gain: 0.5 * v, a: 0.001 }); this.tone(t, 0.02, d, { f: 1400, type: 'square', gain: 0.06 * v, a: 0.001 }); break;
      case 'creak': this.creak(t, d, 0.3 * v, 0.8 + r() * 0.8, 0.6 + r() * 0.8); break;
      case 'thump': this.noise(this.brown, t, 0.4, d, { type: 'lowpass', f: 200, gain: 0.8 * v }); this.tone(t, 0.3, d, { f: 50, f2: 32, gain: 0.5 * v }); break;
      case 'pipe': { const f0 = 220 + r() * 300; for (let i = 0; i < 3; i++) for (const m of [1, 2.4, 4.1]) this.tone(t + i * 0.18, 0.6, d, { f: f0 * m, gain: 0.07 / m * v }); break; }
      case 'drip': this.tone(t, 0.08, d, { f: 1800 + r() * 900, f2: 900, gain: 0.12 * v }); break;
      case 'rustle': this.noise(this.pink, t, 0.6 + r() * 0.5, d, { f: 2500, q: 0.6, gain: 0.25 * v, a: 0.1 }); break;
      case 'wind_gust': this.noise(this.pink, t, 3, d, { f: 250, f2: 600, q: 0.6, gain: 0.35 * v, a: 1.0 }); break;
      case 'heartbeat': this.tone(t, 0.12, d, { f: 55, f2: 40, gain: 0.5 * v }); this.tone(t + 0.22, 0.14, d, { f: 50, f2: 38, gain: 0.4 * v }); break;
      case 'pant': this.noise(this.pink, t, 0.25, d, { f: 1200, q: 0.8, gain: 0.18 * v, a: 0.05 }); this.noise(this.pink, t + 0.35, 0.3, d, { f: 800, q: 0.8, gain: 0.15 * v, a: 0.05 }); break;
      case 'ui': // clique: toque seco de madeira + nota grave curta
        this.noise(this.white, t, 0.025, d, { f: 2600, q: 2.5, gain: 0.18 * v, a: 0.001 });
        this.tone(t, 0.12, d, { f: 330, f2: 220, gain: 0.09 * v, a: 0.002 });
        this.tone(t, 0.06, d, { f: 990, gain: 0.025 * v, a: 0.001 });
        break;
      case 'ui_hover': this.noise(this.white, t, 0.018, d, { f: 3800, q: 4, gain: 0.05 * v, a: 0.001 }); this.tone(t, 0.04, d, { f: 1480, gain: 0.012 * v, a: 0.001 }); break;
      case 'stinger': {
        if (this.music && this.music.ready) { this.music.stinger(opts.volume && opts.volume < 0.75 ? 'lose' : 'death'); break; } const g = this.ctx.createGain(); g.connect(d); for (const f of [61, 65.4, 92.5, 138.6]) this.tone(t, 2.5, g, { f, type: 'sawtooth', gain: 0.08 * v, a: 0.02 }); this.noise(this.white, t, 1.5, d, { f: 3000, f2: 300, gain: 0.3 * v }); break; }
      case 'win': if (this.music && this.music.ready) { this.music.stinger('win'); break; } for (let i = 0; i < 4; i++) this.tone(t + i * 0.25, 1.5, d, { f: [261, 329, 392, 523][i], gain: 0.12 * v, type: 'triangle', a: 0.05 }); break;
    }
  }
  creak(t, dest, gain, dur = 0.8, pitch = 1) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sawtooth';
    const base = 90 * pitch;
    o.frequency.setValueAtTime(base, t);
    for (let k = 1; k <= 8; k++) o.frequency.linearRampToValueAtTime(base * (0.8 + Math.random() * 0.8), t + dur * k / 8);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(900 * pitch, t); bp.frequency.linearRampToValueAtTime(1400 * pitch, t + dur); bp.Q.value = 8;
    const am = c.createGain(); am.gain.value = 0;
    const g = c.createGain(); this.env(g.gain, t, 0.05, gain, dur);
    // fricção: pulsos irregulares
    const lfo = c.createOscillator(); lfo.type = 'square'; lfo.frequency.setValueAtTime(18 + Math.random() * 20, t); lfo.frequency.linearRampToValueAtTime(30 + Math.random() * 30, t + dur);
    const lg = c.createGain(); lg.gain.value = 0.5; lfo.connect(lg); lg.connect(am.gain); am.gain.value = 0.5;
    o.connect(bp); bp.connect(am); am.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.1); lfo.start(t); lfo.stop(t + dur + 0.1);
  }
  // ---------------- laços contínuos ----------------
  startAmbience() {
    if (!this.enabled || this.ambStarted) return;
    this.ambStarted = true;
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this.pink; s.loop = true;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 280; f.Q.value = 0.5;
    const g = c.createGain(); g.gain.value = 0.12;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07; const lg = c.createGain(); lg.gain.value = 0.08; lfo.connect(lg); lg.connect(g.gain);
    const lfo2 = c.createOscillator(); lfo2.frequency.value = 0.11; const lg2 = c.createGain(); lg2.gain.value = 150; lfo2.connect(lg2); lg2.connect(f.frequency);
    s.connect(f); f.connect(g); g.connect(this.amb); s.start(); lfo.start(); lfo2.start();
    this.windGain = g;
    // zumbido grave da casa
    const hum = c.createBufferSource(); hum.buffer = this.brown; hum.loop = true; const hf = c.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 90; const hg = c.createGain(); hg.gain.value = 0.25; hum.connect(hf); hf.connect(hg); hg.connect(this.amb); hum.start();
    this.humGain = hg;
  }
  stopAll() { /* os laços continuam até o fim da página */ }
}
