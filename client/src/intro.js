// Abertura "EVA ENGINE": animação em tempo real (Three.js + shader) com som sintetizado.
// Duas correntes de energia (azul e dourada) espiralam uma em direção à outra, formam uma estrela,
// a estrela colapsa num buraco negro (disco de acreção + anel de luz), explode numa onda de choque
// e revela o logotipo. Pulável (clique / Esc / Espaço) depois de 1 s.
import * as THREE from 'three';

// linha do tempo (segundos)
const SAND = 3.6; // duração do splash ENGINE (luxo) antes do EVA
const T_STAR = 2.9, T_COLLAPSE = 3.95, T_HOLE = 4.35, T_BOOM = 5.6, T_LOGO = 5.75, T_END = 8.6;

const BG_FRAG = /* glsl */`
precision highp float;
uniform float uTime; uniform vec2 uRes;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 5; i++){ v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= .5; } return v; }
const float T_STAR = ${T_STAR.toFixed(2)}, T_COLLAPSE = ${T_COLLAPSE.toFixed(2)}, T_HOLE = ${T_HOLE.toFixed(2)}, T_BOOM = ${T_BOOM.toFixed(2)};
const vec3 BLUE = vec3(0.16, 0.42, 1.0);
const vec3 GOLD = vec3(1.0, 0.68, 0.22);
void main(){
  float t = uTime;
  vec2 p = (gl_FragCoord.xy - .5 * uRes) / uRes.y * 2.;
  float e = t - T_BOOM;
  // tremor da explosão
  if (e > 0.) p += (vec2(noise(vec2(t * 40., 1.)), noise(vec2(t * 40., 7.))) - .5) * .035 * exp(-e * 4.);
  float r = length(p);
  vec3 col = vec3(0);
  // ---- buraco negro: raio do horizonte ----
  float hole = smoothstep(T_COLLAPSE, T_HOLE, t) * (1. - smoothstep(T_BOOM - .05, T_BOOM + .12, t));
  float rh = .135 * hole;
  // lente gravitacional sobre o fundo
  vec2 pl = p * (1. + (rh * rh * 2.2) / (r * r + .002));
  // ---- nebulosa e estrelas de fundo ----
  float neb = fbm(pl * 1.5 + vec2(t * .03, -t * .02));
  float neb2 = fbm(pl * 2.7 - vec2(t * .04, t * .01) + 4.);
  vec3 nebCol = mix(vec3(.02, .05, .17), vec3(.17, .10, .03), smoothstep(.35, .75, neb2));
  float nebAmt = (.25 + .75 * smoothstep(0., 3., t)) * (1. - .55 * smoothstep(T_BOOM, T_BOOM + 2.5, t));
  col += nebCol * pow(neb, 2.) * 1.1 * nebAmt;
  vec2 g = pl * 70.; vec2 id = floor(g); float h = hash(id);
  vec2 f = fract(g) - .5 - (vec2(hash(id + 3.1), hash(id + 7.7)) - .5) * .6;
  col += vec3(.75, .82, 1.) * step(.988, h) * smoothstep(.13, 0., length(f)) * (.5 + .5 * sin(t * 3. + h * 50.)) * .55 * smoothstep(0., 1.2, t);
  // ---- brilho central das correntes convergindo ----
  float conv = smoothstep(1.4, T_STAR, t) * (1. - smoothstep(T_COLLAPSE, T_HOLE, t));
  col += mix(BLUE, GOLD, smoothstep(-.4, .4, p.x * cos(t * 2.) + p.y * sin(t * 2.))) * exp(-r * 5.) * conv * .55;
  // ---- estrela ----
  float star = smoothstep(T_STAR - .35, T_STAR + .25, t) * (1. - smoothstep(T_COLLAPSE + .05, T_COLLAPSE + .3, t));
  float squeeze = smoothstep(T_COLLAPSE - .45, T_COLLAPSE + .2, t); // colapso: encolhe e fica mais intensa
  if (star > 0.) {
    float sz = (.055 + .008 * sin(t * 23.) + .005 * sin(t * 37.)) * (1. - .8 * squeeze);
    float core = exp(-r / sz);
    float corona = exp(-r * (4.5 + 10. * squeeze));
    float rays = exp(-abs(p.x) * 90.) * exp(-abs(p.y) * (2.2 + 6. * squeeze)) + exp(-abs(p.y) * 90.) * exp(-abs(p.x) * (2.2 + 6. * squeeze));
    vec2 d = mat2(.7071, -.7071, .7071, .7071) * p;
    rays += .35 * (exp(-abs(d.x) * 140.) * exp(-abs(d.y) * 5.) + exp(-abs(d.y) * 140.) * exp(-abs(d.x) * 5.));
    float ang = atan(p.y, p.x);
    vec3 sc = mix(GOLD, BLUE, .5 + .5 * sin(ang * 3. + t * 5.));
    float surf = fbm(vec2(ang * 3., r * 20. - t * 4.));
    col += (vec3(1., .97, .92) * core * 2.2 + sc * corona * (.9 + .6 * surf) + mix(vec3(1.), sc, .5) * rays * .7) * star * (1. + 2.5 * squeeze);
  }
  // ---- raios de luz sugados no colapso ----
  float suck = smoothstep(T_COLLAPSE - .1, T_COLLAPSE + .15, t) * (1. - smoothstep(T_HOLE, T_HOLE + .5, t));
  if (suck > 0.) {
    float a = atan(p.y, p.x);
    float streak = pow(fbm(vec2(a * 9., r * 2. + t * 9.)), 3.) * 2.5;
    col += mix(BLUE, GOLD, step(0., p.x)) * streak * suck * exp(-r * 1.6) * .8;
  }
  // ---- buraco negro ----
  if (hole > 0.) {
    // sombra do horizonte
    col *= smoothstep(rh * .96, rh * 1.04, r);
    // arco de Einstein: imagem lenteada do lado de trás do disco, envolvendo a sombra
    float arcR = rh * 1.55;
    float arc = exp(-pow((r - arcR) / (rh * .2), 2.)) * (.55 + .45 * smoothstep(-.3, 1., p.y / max(r, 1e-3)));
    float aa = atan(p.y, p.x);
    float arcN = fbm(vec2(aa * 2. - t * 2.5, r * 10.));
    col += mix(GOLD, vec3(1., .9, .75), .4) * arc * (.6 + .9 * arcN) * hole * 1.3;
    // anel de fótons
    col += vec3(1., .95, .88) * exp(-abs(r - rh * 1.08) / (rh * .03)) * .9 * hole;
    // disco de acreção inclinado
    vec2 q = vec2(p.x, p.y / .25);
    float rq = length(q);
    float ang = atan(q.y, q.x);
    float outer = .2 + .55 * hole;
    float band = smoothstep(rh * 1.35, rh * 2.1, rq) * (1. - smoothstep(outer * .55, outer, rq));
    float a2 = ang + 1.9 * t / (rq * 2.4 + .25) + rq * 3.;
    float swirl = fbm(vec2(cos(a2), sin(a2)) * 2.6 + vec2(rq * 8., 0.));
    float streaks = .78 + .22 * sin(rq * 70. + swirl * 9. + ang * 2.);
    float dopp = 1. + .7 * (-q.x / max(rq, 1e-3));
    vec3 hot = vec3(1., .96, .88) * 1.7;
    vec3 dc = mix(hot, mix(GOLD, BLUE, smoothstep(.35, .75, swirl)), smoothstep(rh * 1.6, .3, rq));
    float dI = band * (.3 + swirl * 1.2) * streaks * dopp * hole;
    if (p.y > 0.) dI *= smoothstep(rh * .96, rh * 1.1, r); // metade de trás fica atrás do horizonte
    col += dc * dI * 1.25;
  }
  // ---- explosão: clarão + onda de choque cromática ----
  if (e > 0.) {
    col += vec3(.85, .9, 1.) * exp(-e * 5.5) * 1.4;
    col += vec3(1., .95, .9) * exp(-r * 3.) * exp(-e * 2.2) * 2.2;
    float R = 2.6 * (1. - exp(-e * 1.5));
    float w = .015 + .06 * e;
    float fade = exp(-e * 1.05);
    vec3 ring = vec3(exp(-pow((r - R * 1.035) / w, 2.)), exp(-pow((r - R) / w, 2.)), exp(-pow((r - R * .965) / w, 2.)));
    col += ring * mix(BLUE * 1.4, GOLD * 1.6, .5 + .5 * sin(atan(p.y, p.x) + e)) * 2.4 * fade;
    col += ring * .9 * fade;
    // véu luminoso suave atrás do logotipo
    col += mix(BLUE * .45, GOLD * .45, smoothstep(-1., 1., p.x)) * exp(-r * 1.3) * smoothstep(0., .6, e) * (.35 + .1 * sin(t * 1.3));
    col += mix(GOLD, BLUE, .5 + .5 * sin(p.x * 3. + t)) * exp(-abs(p.y + .02) * 18.) * exp(-abs(p.x) * 1.4) * smoothstep(.1, .8, e) * .18;
  }
  // tonemap fílmico + vinheta + entrada do preto + pontilhado
  col = 1. - exp(-col * 1.15);
  col *= 1. - .38 * dot(p * .5, p * .5);
  col *= smoothstep(0., .6, t);
  col += (hash(gl_FragCoord.xy + fract(t)) - .5) / 200.;
  gl_FragColor = vec4(col, 1.);
}`;

const PT_VERT = /* glsl */`
uniform float uTime; uniform float uScale;
attribute vec4 aR; // x: atraso na trilha (0 = cabeça), y: corrente (0 azul, 1 dourada), z,w: aleatórios
varying vec3 vCol; varying float vA;
const float TC = ${T_STAR.toFixed(2)};
const float T_BOOM = ${T_BOOM.toFixed(2)};
const vec3 BLUE = vec3(0.22, 0.5, 1.0);
const vec3 GOLD = vec3(1.0, 0.72, 0.28);
vec2 headPos(float tt, float s){
  float k = clamp(tt / TC, 0., 1.);
  float r = 2.05 * pow(1. - k, 1.3);
  float ang = s * 3.14159 + .55 + 8.2 * k * k + 1.2 * k;
  vec2 v = vec2(cos(ang), sin(ang)) * r;
  v.y *= mix(.62, .27, k);
  return v;
}
void main(){
  float t = uTime;
  float lag = aR.x, s = aR.y;
  vec3 base = mix(BLUE, GOLD, s);
  vec2 pos; float a; float size;
  float tt = t - .1 - lag * 1.35;
  float k = tt / TC;
  bool inDisk = aR.w > .5 && k >= 1. && t > 4.15 && t < T_BOOM;
  if (t >= T_BOOM) {
    // explosão: todas as partículas são lançadas para fora
    float e = t - T_BOOM;
    float ang = aR.z * 6.2832 + aR.w * 3.;
    float v = .08 + 3.0 * pow(aR.x, 1.25) * (.5 + aR.w);
    float d = v * (1. - exp(-2.4 * e)) / 2.4;
    pos = vec2(cos(ang), sin(ang) * .78) * d;
    a = exp(-e * 1.1) * (.35 + .65 * aR.w) * smoothstep(.0, .35, d) * (1. - .6 * smoothstep(.4, 1.2, e) * step(d, .5));
    size = (1.2 + 2.6 * aR.z) * (1. + 1.5 * exp(-e * 3.));
    base = mix(vec3(1., .95, .9), base, smoothstep(0., .5, e));
  } else if (inDisk) {
    // órbita no disco de acreção
    float rd = mix(.2, .72, pow(aR.z, 1.4));
    float ph = aR.x * 6.2832 + t * .42 / pow(rd, 1.5);
    pos = vec2(cos(ph), sin(ph) * .25) * rd;
    a = smoothstep(4.15, 4.7, t) * .75 * (1. + .6 * -cos(ph));
    if (sin(ph) > 0. && length(pos) < .15) a = 0.;
    size = 1.1 + 1.6 * aR.z;
    base = mix(vec3(1., .93, .8), base, smoothstep(.2, .5, rd));
  } else {
    // correntes em espiral
    if (tt < 0.) { a = 0.; pos = vec2(9.); }
    else {
      vec2 hp = headPos(tt, s);
      vec2 hp2 = headPos(tt + .01, s);
      vec2 tg = normalize(hp2 - hp + 1e-5);
      vec2 nm = vec2(-tg.y, tg.x);
      float rr = length(hp);
      float spread = (.012 + .13 * lag) * (.25 + .75 * smoothstep(0., 1.2, rr));
      pos = hp + nm * (aR.z - .5) * spread * 2.
          + vec2(sin(tt * 6.5 + aR.w * 40.), cos(tt * 5.3 + aR.w * 31.)) * .02 * lag;
      a = pow(1. - lag, 1.6) * (1. - smoothstep(.93, 1., k)) * smoothstep(0., .25, tt);
      size = 1.2 + 4.5 * pow(1. - lag, 6.);
      if (lag < .025) { size = 5. + 4. * aR.z; a *= .22; }
      base = mix(base, vec3(1.), pow(1. - lag, 10.) * .7);
    }
  }
  vCol = base; vA = a;
  gl_PointSize = size * uScale;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 0., 1.);
}`;
const PT_FRAG = /* glsl */`
precision highp float;
varying vec3 vCol; varying float vA;
void main(){
  float d = length(gl_PointCoord - .5) * 2.;
  float m = exp(-d * d * 4.5) * (1. - smoothstep(.85, 1., d));
  gl_FragColor = vec4(vCol * m * vA, 1.);
}`;

// ---------------- som sincronizado ----------------
function introSound(audio, t0) {
  const c = audio.ctx, out = c.createGain(); out.gain.value = 0.9; out.connect(audio.sfx);
  const wet = audio.music && audio.music.verbIn ? audio.music.verbIn : out;
  const at = (s) => t0 + s;
  const src = (buf) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; return s; };
  // 1) sopro das correntes: dois ruídos com filtro subindo e panorâmica girando
  for (let i = 0; i < 2; i++) {
    const n = src(audio.pink), bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.6;
    bp.frequency.setValueAtTime(180 + i * 60, at(0.1)); bp.frequency.exponentialRampToValueAtTime(2600 + i * 900, at(T_STAR));
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, at(0)); g.gain.exponentialRampToValueAtTime(0.35, at(T_STAR - 0.2)); g.gain.exponentialRampToValueAtTime(0.0001, at(T_COLLAPSE + 0.2));
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    n.connect(bp); bp.connect(g);
    if (pan) {
      const lfo = c.createOscillator(); lfo.frequency.setValueAtTime(0.4, at(0)); lfo.frequency.exponentialRampToValueAtTime(3.5, at(T_STAR));
      const lg = c.createGain(); lg.gain.value = i ? -0.8 : 0.8; lfo.connect(lg); lg.connect(pan.pan); lfo.start(at(0)); lfo.stop(at(T_COLLAPSE + 0.3));
      g.connect(pan); pan.connect(out); pan.connect(wet);
    } else g.connect(out);
    n.start(at(0)); n.stop(at(T_COLLAPSE + 0.3));
  }
  // tom grave subindo
  const rise = c.createOscillator(); rise.type = 'sawtooth'; rise.frequency.setValueAtTime(38, at(0)); rise.frequency.exponentialRampToValueAtTime(110, at(T_STAR));
  const rlp = c.createBiquadFilter(); rlp.type = 'lowpass'; rlp.frequency.value = 260;
  const rg = c.createGain(); rg.gain.setValueAtTime(0.0001, at(0)); rg.gain.exponentialRampToValueAtTime(0.18, at(T_STAR)); rg.gain.exponentialRampToValueAtTime(0.0001, at(T_COLLAPSE + 0.1));
  rise.connect(rlp); rlp.connect(rg); rg.connect(out); rise.start(at(0)); rise.stop(at(T_COLLAPSE + 0.2));
  // 2) a estrela acende: brilho harmônico
  for (const [f, gg] of [[880, 0.035], [1318.5, 0.025], [1760, 0.015], [440, 0.03]]) {
    const o = c.createOscillator(); o.frequency.value = f; const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at(T_STAR - 0.3)); g.gain.exponentialRampToValueAtTime(gg, at(T_STAR + 0.3)); g.gain.exponentialRampToValueAtTime(0.0001, at(T_COLLAPSE + 0.15));
    o.connect(g); g.connect(wet); g.connect(out); o.start(at(T_STAR - 0.3)); o.stop(at(T_COLLAPSE + 0.3));
  }
  // 3) colapso: sucção descendente
  { const n = src(audio.white), bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2;
    bp.frequency.setValueAtTime(3500, at(T_COLLAPSE - 0.1)); bp.frequency.exponentialRampToValueAtTime(140, at(T_HOLE + 0.4));
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, at(T_COLLAPSE - 0.1)); g.gain.exponentialRampToValueAtTime(0.5, at(T_COLLAPSE + 0.08)); g.gain.exponentialRampToValueAtTime(0.0001, at(T_HOLE + 0.5));
    n.connect(bp); bp.connect(g); g.connect(out); n.start(at(T_COLLAPSE - 0.1)); n.stop(at(T_HOLE + 0.6));
    const o = c.createOscillator(); o.frequency.setValueAtTime(320, at(T_COLLAPSE)); o.frequency.exponentialRampToValueAtTime(30, at(T_HOLE + 0.3));
    const og = c.createGain(); og.gain.setValueAtTime(0.0001, at(T_COLLAPSE)); og.gain.exponentialRampToValueAtTime(0.35, at(T_COLLAPSE + 0.05)); og.gain.exponentialRampToValueAtTime(0.0001, at(T_HOLE + 0.4));
    o.connect(og); og.connect(out); o.start(at(T_COLLAPSE)); o.stop(at(T_HOLE + 0.5)); }
  // ronco do buraco negro + crescendo invertido antes da explosão
  { const n = src(audio.brown), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 140;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, at(T_HOLE - 0.2)); g.gain.exponentialRampToValueAtTime(0.5, at(T_BOOM - 0.05)); g.gain.setValueAtTime(0.0001, at(T_BOOM));
    const lfo = c.createOscillator(); lfo.frequency.value = 7; const lg = c.createGain(); lg.gain.value = 60; lfo.connect(lg); lg.connect(lp.frequency);
    n.connect(lp); lp.connect(g); g.connect(out); n.start(at(T_HOLE - 0.2)); n.stop(at(T_BOOM + 0.1)); lfo.start(at(T_HOLE - 0.2)); lfo.stop(at(T_BOOM + 0.1));
    const o = c.createOscillator(); o.frequency.value = 31; const og = c.createGain(); og.gain.setValueAtTime(0.0001, at(T_HOLE)); og.gain.exponentialRampToValueAtTime(0.4, at(T_BOOM - 0.05)); og.gain.setValueAtTime(0.0001, at(T_BOOM));
    o.connect(og); og.connect(out); o.start(at(T_HOLE)); o.stop(at(T_BOOM + 0.1));
    const sw = src(audio.white), hp = c.createBiquadFilter(); hp.type = 'bandpass'; hp.Q.value = 0.8; hp.frequency.setValueAtTime(400, at(T_BOOM - 0.9)); hp.frequency.exponentialRampToValueAtTime(5000, at(T_BOOM));
    const sg = c.createGain(); sg.gain.setValueAtTime(0.0001, at(T_BOOM - 0.9)); sg.gain.exponentialRampToValueAtTime(0.4, at(T_BOOM - 0.02)); sg.gain.setValueAtTime(0.0001, at(T_BOOM));
    sw.connect(hp); hp.connect(sg); sg.connect(out); sw.start(at(T_BOOM - 0.9)); sw.stop(at(T_BOOM + 0.05)); }
  // 4) BOOM
  { const o = c.createOscillator(); o.frequency.setValueAtTime(78, at(T_BOOM)); o.frequency.exponentialRampToValueAtTime(23, at(T_BOOM + 2.2));
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, at(T_BOOM)); g.gain.linearRampToValueAtTime(1.0, at(T_BOOM + 0.012)); g.gain.exponentialRampToValueAtTime(0.0001, at(T_BOOM + 2.6));
    o.connect(g); g.connect(out); o.start(at(T_BOOM)); o.stop(at(T_BOOM + 2.7));
    const n = src(audio.brown), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(1400, at(T_BOOM)); lp.frequency.exponentialRampToValueAtTime(70, at(T_BOOM + 1.8));
    const ds = c.createWaveShaper(); ds.curve = audio.dist.curve;
    const ng = c.createGain(); ng.gain.setValueAtTime(0.0001, at(T_BOOM)); ng.gain.linearRampToValueAtTime(0.9, at(T_BOOM + 0.01)); ng.gain.exponentialRampToValueAtTime(0.0001, at(T_BOOM + 2.2));
    n.connect(lp); lp.connect(ds); ds.connect(ng); ng.connect(out); ng.connect(wet); n.start(at(T_BOOM)); n.stop(at(T_BOOM + 2.3));
    const cr = src(audio.white), hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
    const cg = c.createGain(); cg.gain.setValueAtTime(0.5, at(T_BOOM)); cg.gain.exponentialRampToValueAtTime(0.0001, at(T_BOOM + 0.5));
    cr.connect(hp); hp.connect(cg); cg.connect(out); cg.connect(wet); cr.start(at(T_BOOM)); cr.stop(at(T_BOOM + 0.6)); }
  // 5) acorde do logotipo (Lá maior com 9ª), suave e brilhante
  for (const [f, gg] of [[220, 0.05], [329.6, 0.04], [493.9, 0.03], [554.4, 0.03], [659.3, 0.02], [987.8, 0.012]]) {
    for (const det of [-6, 6]) {
      const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.detune.value = det;
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, at(T_LOGO)); g.gain.exponentialRampToValueAtTime(gg, at(T_LOGO + 0.6)); g.gain.setTargetAtTime(0.0001, at(T_LOGO + 1.4), 0.9);
      o.connect(g); g.connect(wet); g.connect(out); o.start(at(T_LOGO)); o.stop(at(T_LOGO + 6));
    }
  }
  return out;
}

// som do splash ENGINE (luxo): carrilhão cristalino suave + brilhos sincronizados com os reflexos
function engineSplashSound(audio, t0) {
  const c = audio.ctx, out = c.createGain(); out.gain.value = 0.8; out.connect(audio.sfx);
  const wet = audio.music && audio.music.verbIn ? audio.music.verbIn : out;
  const bell = (t, f, g, dec) => {
    for (const [m, gg, d] of [[1, 1, dec], [2.0, 0.22, dec * 0.6], [3.01, 0.12, dec * 0.4], [4.17, 0.05, dec * 0.25]]) {
      const o = c.createOscillator(); o.frequency.value = f * m;
      const e = c.createGain(); e.gain.setValueAtTime(0.0001, t); e.gain.linearRampToValueAtTime(g * gg, t + 0.012); e.gain.setTargetAtTime(0.0001, t + 0.012, d / 4);
      o.connect(e); e.connect(out); e.connect(wet); o.start(t); o.stop(t + d * 1.4 + 0.2);
    }
  };
  // acorde de entrada (Mi maior com 9ª, aberto e agudo)
  bell(t0 + 0.25, 659.3, 0.05, 3.2); bell(t0 + 0.32, 987.8, 0.035, 3.0); bell(t0 + 0.4, 1318.5, 0.03, 2.8); bell(t0 + 0.5, 1480, 0.018, 2.6);
  // brilho do reflexo passando pelas letras
  const n = c.createBufferSource(); n.buffer = audio.pink; n.loop = true;
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3; bp.frequency.setValueAtTime(3000, t0 + 1.0); bp.frequency.exponentialRampToValueAtTime(9000, t0 + 2.0);
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0 + 1.0); g.gain.exponentialRampToValueAtTime(0.05, t0 + 1.5); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.2);
  n.connect(bp); bp.connect(g); g.connect(out); g.connect(wet); n.start(t0 + 1.0); n.stop(t0 + 2.3);
  // cintilações
  for (const [dt, f] of [[1.3, 2637], [1.62, 3136], [1.92, 3951]]) bell(t0 + dt, f, 0.02, 1.2);
  return out;
}

// ---------------- controlador ----------------
export function runIntro(audio, { force = false } = {}) {
  return new Promise((resolve) => {
    const root = document.createElement('div'); root.id = 'intro';
    root.innerHTML = `<canvas></canvas>
      <div class="eva-logo"><div class="eva-word">EVA ENGINE</div><div class="eva-line"></div><div class="eva-ver">v.a</div></div>
      <div class="sandian">
        <svg class="sd-gem" viewBox="0 0 100 100" aria-hidden="true">
          <defs>
            <linearGradient id="sdg1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#cfd6e0"/><stop offset="1" stop-color="#7c8592"/></linearGradient>
            <linearGradient id="sdg2" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#5d6672"/><stop offset="1" stop-color="#e9edf3"/></linearGradient>
            <linearGradient id="sdg3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f7fb"/><stop offset="1" stop-color="#9aa3b0"/></linearGradient>
            <linearGradient id="sdg4" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#aeb6c2"/><stop offset="1" stop-color="#3e4550"/></linearGradient>
          </defs>
          <!-- gema lapidada em forma de botão "play": triângulo externo, mesa interna e facetas -->
          <polygon points="18,8 92,50 18,92" fill="#2a2f37"/>
          <polygon points="18,8 92,50 64,50 34,30" fill="url(#sdg1)"/>
          <polygon points="18,8 34,30 34,70 18,92" fill="url(#sdg3)"/>
          <polygon points="18,92 34,70 64,50 92,50" fill="url(#sdg4)"/>
          <polygon points="34,30 64,50 34,70" fill="url(#sdg2)"/>
          <path d="M18,8 L34,30 L34,70 L18,92 M34,30 L64,50 L34,70 M64,50 L92,50" fill="none" stroke="rgba(255,255,255,.55)" stroke-width=".6"/>
          <polygon points="18,8 92,50 18,92" fill="none" stroke="rgba(255,255,255,.8)" stroke-width=".8"/>
        </svg>
        <div class="sd-word" data-text="ENGINE">ENGINE</div>
        <div class="sd-sub"><span class="sd-hair"></span><span class="sd-dot"></span><span class="sd-hair"></span></div>
        <i class="sd-spark s1"></i><i class="sd-spark s2"></i><i class="sd-spark s3"></i><i class="sd-spark s4"></i>
      </div>
      <div class="intro-gate hidden"><div class="gate-dot"></div><div class="gate-txt">clique para começar</div></div>
      <div class="intro-skip">clique ou Esc para pular</div>`;
    document.body.appendChild(root);
    const canvas = root.querySelector('canvas'), gate = root.querySelector('.intro-gate');
    let renderer, scene, cam, bgMat, ptMat, raf = 0, t0 = 0, t0Audio = 0, done = false, started = false, soundOut = null, sandOut = null;
    const dbg = window.__introDebug || {};
    function setup() {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!dbg.preserve });
      renderer.setPixelRatio(Math.min(1.25, window.devicePixelRatio || 1));
      scene = new THREE.Scene();
      cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
      bgMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } }, vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0., 1.); }', fragmentShader: BG_FRAG, depthTest: false, depthWrite: false });
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat); quad.frustumCulled = false; quad.renderOrder = 0; scene.add(quad);
      const N = 9000, arr = new Float32Array(N * 4), pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) { arr[i * 4] = Math.pow(Math.random(), 1.35); arr[i * 4 + 1] = i % 2; arr[i * 4 + 2] = Math.random(); arr[i * 4 + 3] = Math.random(); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aR', new THREE.BufferAttribute(arr, 4));
      ptMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uScale: { value: 1 } }, vertexShader: PT_VERT, fragmentShader: PT_FRAG, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false });
      const pts = new THREE.Points(geo, ptMat); pts.frustumCulled = false; pts.renderOrder = 1; scene.add(pts);
      resize(); window.addEventListener('resize', resize);
    }
    function resize() {
      const w = window.innerWidth, h = window.innerHeight; renderer.setSize(w, h, false);
      const a = w / h; cam.left = -a; cam.right = a; cam.top = 1; cam.bottom = -1; cam.updateProjectionMatrix();
      const pr = renderer.getPixelRatio(); bgMat.uniforms.uRes.value.set(w * pr, h * pr); ptMat.uniforms.uScale.value = (h * pr) / 720;
    }
    let slow = 0, lastNow = 0;
    function frame(now) {
      if (done) return;
      raf = requestAnimationFrame(frame);
      let t = (now - t0) / 1000;
      if (audio.ctx && soundOut) t = audio.ctx.currentTime - t0Audio; // segue o relógio do áudio (sincronia)
      t -= SAND; // primeiro o splash ENGINE (luxo) (DOM/CSS), depois a animação EVA
      if (typeof dbg.freeze === 'number') { t = dbg.freeze; root.classList.add('sand-off'); }
      if (t > 0.2) root.classList.add('sand-off');
      // PCs fracos: reduz a resolução se estiver lento
      if (lastNow && now - lastNow > 45 && ++slow === 12) { renderer.setPixelRatio(0.6); resize(); }
      lastNow = now;
      bgMat.uniforms.uTime.value = t; ptMat.uniforms.uTime.value = t;
      if (t > -0.05) renderer.render(scene, cam); // durante o splash ENGINE (luxo) o canvas fica preto (sem custo de GPU)
      root.classList.toggle('logo', t >= T_LOGO);
      root.classList.toggle('can-skip', t + SAND > 1);
      if (t >= T_END && typeof dbg.freeze !== 'number') finish();
    }
    function start() {
      if (started) return; started = true;
      if (typeof dbg.sand === 'number') { // captura: congela o splash ENGINE (luxo) no instante pedido
        root.classList.add('sand'); gate.classList.add('hidden');
        requestAnimationFrame(() => { for (const an of document.getAnimations()) { an.currentTime = dbg.sand * 1000; an.pause(); } });
        return;
      }
      gate.classList.add('hidden');
      t0 = performance.now();
      root.classList.add('sand');
      if (audio.ctx && !audio.blocked) {
        t0Audio = audio.ctx.currentTime + 0.05;
        try { soundOut = introSound(audio, t0Audio + SAND); sandOut = engineSplashSound(audio, t0Audio); } catch (e) { console.warn(e); }
      }
      raf = requestAnimationFrame(frame);
    }
    function finish() {
      if (done) return; done = true;
      cancelAnimationFrame(raf);
      if (audio.ctx) for (const o of [soundOut, sandOut]) if (o) o.gain.setTargetAtTime(0.0001, audio.ctx.currentTime, 0.25);
      sessionStorage.setItem('nsm_intro_seen', '1');
      root.classList.add('out');
      window.removeEventListener('keydown', onKey, true); root.removeEventListener('pointerdown', onPtr);
      resolve();
      setTimeout(() => { window.removeEventListener('resize', resize); try { renderer.dispose(); renderer.forceContextLoss(); } catch { } root.remove(); }, 900);
    }
    async function unlock() { audio.init(); try { if (audio.ctx) await Promise.race([audio.ctx.resume(), new Promise(r => setTimeout(r, 400))]); } catch { } start(); }
    const elapsed = () => started ? (performance.now() - t0) / 1000 : 0;
    function onKey(e) {
      if (!started) { if (!gate.classList.contains('hidden')) { e.preventDefault(); unlock(); } return; }
      if ((e.code === 'Escape' || e.code === 'Space' || e.code === 'Enter') && elapsed() > 1) { e.preventDefault(); e.stopPropagation(); finish(); }
    }
    function onPtr() {
      if (!started) { if (!gate.classList.contains('hidden')) unlock(); return; }
      if (elapsed() > 1) finish();
    }
    window.addEventListener('keydown', onKey, true); root.addEventListener('pointerdown', onPtr);
    window.__intro = { skip: finish, root };
    try { setup(); } catch (e) { console.warn('intro sem WebGL', e); finish(); return; }
    renderer.render(scene, cam); // quadro preto inicial
    // o navegador libera o som?
    audio.init();
    setTimeout(() => {
      if (done) return;
      if (!audio.blocked || force === 'nosound') start();
      else gate.classList.remove('hidden');
    }, 60);
  });
}

// Mostrar a abertura? Só na 1ª carga da sessão, nunca em /testar ou testes automatizados.
export function shouldShowIntro(params, isTest) {
  if (params.get('intro') === '1') return true;
  if (params.get('intro') === '0') return false;
  if (isTest || params.has('e2e') || navigator.webdriver) return false;
  try { if (sessionStorage.getItem('nsm_intro_seen')) return false; } catch { }
  return true;
}
