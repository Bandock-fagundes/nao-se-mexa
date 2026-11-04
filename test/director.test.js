// Diretor da IA (ameaça / regiões) e comportamento ativo da criatura.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, run, clearCorridor, strafe } from './helpers.js';
import { visionCheck } from '../server/senses.js';
import { W, D, CELL, PLAYER, CREATURE } from '../shared/config.js';
import { simulateMatch } from './bots.js';

// solta a criatura (helpers a deixam em "hold") e apaga a lanterna dos jogadores
function release(m) {
  for (const p of m.players.values()) p.flashlight = false;
  m.creature.setState('idle');
  m.creature.pickPatrol();
}
// cantinhos (nichos) onde um jogador cabe mas o corpo da criatura não chega perto o bastante para esbarrar
function nookSpots(m, L) {
  const out = [];
  for (let cz = 1; cz < D - 1; cz++) for (let cx = 1; cx < W - 1; cx++) {
    const x = (cx + 0.5) * CELL, z = (cz + 0.5) * CELL;
    const rid = m.world.roomAt(L, x, z);
    if (rid < 0 || ['stairs', 'corridor'].includes(m.map.rooms[rid].type)) continue;
    if (!m.world.circleFree(L, x, z, PLAYER.radius)) continue;
    let md = 1e9;
    for (let a = -5; a <= 5; a++) for (let b = -5; b <= 5; b++) if (m.nav.walkable(L, cx + a, cz + b)) md = Math.min(md, Math.hypot(a, b) * CELL);
    if (md >= 1.5 && md < 2.5) out.push({ x, z, L, room: rid });
  }
  return out;
}
const distTo = (t, p) => Math.hypot(t.x - p.x, t.z - p.z) + Math.abs(t.level - p.level) * 10;

test('Diretor: a ameaça sobe com o tempo sem chave e cai quando uma chave é coletada', () => {
  const m = makeMatch(1, 'dir-a');
  const d = m.director;
  assert.equal(d.menace, 0);
  run(m, 30); const m30 = d.menace;
  run(m, 60); const m90 = d.menace;
  run(m, 110); const m200 = d.menace;
  assert.ok(m30 < m90 && m90 < m200, `cresce: ${m30.toFixed(2)} < ${m90.toFixed(2)} < ${m200.toFixed(2)}`);
  assert.ok(m200 > 0.6, 'alta depois de ~3 min sem chave: ' + m200.toFixed(2));
  const cid = m.keyContainers[0], c = m.map.containers[cid];
  m.debugPlacePlayer('p1', c.ax, c.az, c.level);
  assert.ok(m.interact('p1', { kind: 'container', id: cid }).ok);
  assert.ok(m.interact('p1', { kind: 'key', id: cid }).ok);
  run(m, 5);
  assert.ok(d.menace < 0.3, 'caiu após a chave: ' + d.menace.toFixed(2));
  assert.ok(d.diag().sinceKey <= 5.1);
  // volta a subir depois
  run(m, 120);
  assert.ok(d.menace > 0.45, 'volta a subir: ' + d.menace.toFixed(2));
});

test('Diretor: respiro — a ameaça cai por um tempo depois de um encontro/perseguição', () => {
  const m = makeMatch(1, 'dir-b');
  run(m, 200);
  const before = m.director.menace;
  m.director.onEncounterEnd('perseguição');
  run(m, 5);
  assert.ok(m.director.menace < before * 0.5, `${before.toFixed(2)} → ${m.director.menace.toFixed(2)}`);
  assert.ok(m.director.inRelief);
  run(m, 40);
  assert.ok(!m.director.inRelief && m.director.menace > before * 0.8, 'respiro termina: ' + m.director.menace.toFixed(2));
});

test('Diretor: a dica de região tem erro proposital (15 m → 4 m) e nunca é a posição exata', () => {
  const m = makeMatch(1, 'dir-c');
  const p = m.players.get('p1');
  for (const [men, maxErr] of [[0, 15], [1, 4]]) {
    m.director.menace = men;
    let exact = 0, maxD = 0;
    for (let i = 0; i < 300; i++) {
      const h = m.director.regionHint();
      const dd = Math.hypot(h.x - p.x, h.z - p.z);
      maxD = Math.max(maxD, dd);
      if (dd < 0.05) exact++;
      assert.ok(dd <= maxErr + 1e-6, `erro ${dd.toFixed(2)} ≤ ${maxErr}`);
    }
    assert.ok(maxD > maxErr * 0.7, 'usa o raio de erro');
    assert.ok(exact < 3, 'quase nunca coincide com a posição exata');
  }
});

test('Diretor: com ameaça maior, os destinos de patrulha ficam mais perto da região dos jogadores (estatístico)', () => {
  let low = [], high = [];
  for (let s = 0; s < 24; s++) {
    const m = makeMatch(1, 'dir-reg-' + s);
    const rooms = m.map.rooms.filter(r => r.type !== 'stairs' && r.type !== 'corridor');
    const r = rooms[(s * 7) % rooms.length];
    const pt = m.creature.roomPoint(r);
    if (!pt) continue;
    m.debugPlacePlayer('p1', pt.x, pt.z, pt.level);
    const p = m.players.get('p1');
    for (const [men, arr] of [[0.05, low], [0.95, high]]) {
      m.director.override = men; m.director.menace = men; m.director.nextPassByT = Infinity;
      m.creature.visited.clear();
      for (let k = 0; k < 6; k++) { m.creature.pickPatrol(); arr.push(distTo(m.director.target, p)); }
    }
  }
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  assert.ok(low.length > 100 && high.length > 100);
  assert.ok(avg(high) < avg(low) * 0.6, `média baixa ameaça ${avg(low).toFixed(1)} m vs alta ${avg(high).toFixed(1)} m`);
  assert.ok(avg(high) < 14, 'alta ameaça: perto da região ' + avg(high).toFixed(1));
});

test('Criatura ativa: em 5 min nunca fica parada mais que alguns segundos, visita várias salas, sem teletransporte nem atravessar paredes', () => {
  for (const [phase, seed] of [[1, 'act-1'], [2, 'act-2']]) {
    const m = makeMatch(phase, seed);
    release(m);
    const c = m.creature;
    let still = 0, maxStill = 0, maxStep = 0, prev = { x: c.x, z: c.z, level: c.level };
    const rooms = new Set();
    const dt = 0.05;
    for (let i = 0; i < 300 / dt; i++) {
      m.tick(dt);
      if (c.speed < 0.15 && c.state !== 'kill') { still += dt; maxStill = Math.max(maxStill, still); } else still = 0;
      const step = Math.hypot(c.x - prev.x, c.z - prev.z);
      maxStep = Math.max(maxStep, step);
      assert.ok(m.world.circleFree(c.level, c.x, c.z, 0.4), `sem atravessar parede (${c.x.toFixed(2)}, ${c.z.toFixed(2)}, andar ${c.level})`);
      if (c.level !== prev.level) {
        const onStair = m.world.stairAt(c.level, Math.floor(c.x / CELL), Math.floor(c.z / CELL)) >= 0 || m.world.stairAt(prev.level, Math.floor(prev.x / CELL), Math.floor(prev.z / CELL)) >= 0;
        assert.ok(onStair && Math.abs(c.level - prev.level) === 1, 'muda de andar só pela escada');
      }
      prev = { x: c.x, z: c.z, level: c.level };
      const r = m.world.roomAt(c.level, c.x, c.z); if (r >= 0) rooms.add(r);
    }
    assert.ok(maxStep <= CREATURE.speed.chase[3] * 1.2 * dt + 0.01, 'passo máximo por tick ' + maxStep.toFixed(3));
    assert.ok(maxStill <= 6.5, `fase ${phase}: maior tempo parada ${maxStill.toFixed(1)} s`);
    assert.ok(rooms.size >= 8, `fase ${phase}: visitou ${rooms.size} salas`);
  }
});

test('Passagem (fase 1): ameaça alta leva a criatura até o cômodo dos jogadores; parado, ninguém é detectado', () => {
  let passes = 0, exposed = 0, close = 0;
  for (const seed of ['pb-1', 'pb-2', 'pb-3', 'pb-4']) {
    const m = makeMatch(1, seed);
    const spots = nookSpots(m, 1);
    assert.ok(spots.length, 'há cantinho no térreo');
    const s = spots[Math.floor(spots.length / 2)];
    m.debugPlacePlayer('p1', s.x, s.z, 1);
    const p = m.players.get('p1');
    m.director.override = 0.95; m.director.menace = 0.95; m.director.nextPassByT = 0;
    release(m);
    const c = m.creature;
    let minD = 1e9, detected = false, seen = false;
    run(m, 90, () => {
      if (['alert', 'chase', 'attack', 'hear', 'investigate'].includes(c.state)) detected = true;
      if (c.level === 1) {
        minD = Math.min(minD, Math.hypot(c.x - p.x, c.z - p.z));
        const v = visionCheck(m, c, p);
        if (v.visible) seen = true;
      }
    });
    if (m.director.passBys > 0) passes++;
    if (seen) exposed++;
    if (minD < 7) close++;
    assert.equal(detected, false, `${seed}: jogador parado não é detectado (estado ${c.state})`);
    assert.ok(p.alive, `${seed}: jogador parado sobrevive`);
  }
  assert.ok(passes >= 4, 'agendou passagens: ' + passes);
  assert.ok(close >= 3, 'passou perto do jogador na maioria dos casos: ' + close);
  assert.ok(exposed >= 1, 'em algum caso o jogador esteve no campo de visão e mesmo assim não foi detectado: ' + exposed);
});

test('A criatura acaba indo ao andar dos jogadores', () => {
  for (const seed of ['fl-1', 'fl-2', 'fl-3']) {
    const m = makeMatch(1, seed);
    const cl = m.map.creatureSpawn.level;
    const L = cl === 0 ? 2 : (cl === 3 ? 1 : (cl === 1 ? 2 : 1));
    const spots = nookSpots(m, L);
    const s = spots.length ? spots[0] : null;
    assert.ok(s, 'há posição no andar ' + L);
    m.debugPlacePlayer('p1', s.x, s.z, L);
    release(m);
    let reachedAt = null;
    run(m, 300, (t) => { if (reachedAt === null && m.creature.level === L) reachedAt = t; });
    assert.ok(reachedAt !== null, `${seed}: visitou o andar ${L} dos jogadores (criatura começou no ${cl})`);
  }
});

test('Simulação headless: partida completa com robôs termina sem erros e tem encontro', () => {
  const r = simulateMatch({ seed: 'sim-t', phase: 1, styles: ['careless'], maxTime: 600 });
  assert.ok(r.duration > 0);
  assert.ok(r.firstEncounter !== null || r.result === 'win', 'houve encontro (ou vitória rápida)');
  assert.ok(r.maxStill <= 6.5, 'maior pausa ' + r.maxStill);
});

test('Perseguição é escapável: correr, quebrar a linha de visão e ficar parado salva na maioria das vezes', () => {
  let ok = 0, n = 0;
  for (const phase of [1, 2]) for (let s = 0; s < 12; s++) {
    const m = makeMatch(phase, 'esc-' + s);
    const c = clearCorridor(m, 1, 30); if (!c) continue;
    for (const p of m.players.values()) p.flashlight = false;
    m.debugPlaceCreature(c.x0, c.z, 1, Math.PI / 2); m.creature.setState('patrol'); m.creature.path = null;
    m.debugPlacePlayer('p1', c.x0 + 11, c.z, 1);
    run(m, 0.8, strafe(m, 'p1'));
    if (!['alert', 'chase'].includes(m.creature.state)) continue;
    const p = m.players.get('p1');
    // esconderijo: ponto de uma sala do térreo, mais longe da criatura que do jogador, fora da visão dela
    let best = null, bd = 1e9;
    for (const r of m.map.rooms.filter(r => r.level === 1 && r.type !== 'corridor' && r.type !== 'stairs')) {
      const pt = m.creature.roomPoint(r); if (!pt) continue;
      const d = Math.hypot(pt.x - p.x, pt.z - p.z), away = Math.hypot(pt.x - m.creature.x, pt.z - m.creature.z) - d;
      if (away > 2 && d < bd && !m.world.lineOfSight(1, m.creature.x, m.creature.z, pt.x, pt.z)) { bd = d; best = pt; }
    }
    if (!best) continue;
    n++;
    const path = m.nav.findPath(1, p.x, p.z, 1, best.x, best.z);
    let pi = 0, stam = PLAYER.staminaMax, hidden = 0, still = false;
    run(m, 40, (t, dt) => {
      if (!p.alive || still) { m.applyInput('p1', { x: p.x, z: p.z, yaw: p.yaw, pitch: 0, fl: false, crouch: true, run: false }); return; }
      const cr = m.creature;
      hidden = m.world.lineOfSight(1, cr.x, cr.z, p.x, p.z) ? 0 : hidden + dt;
      if (hidden > 1.2 && pi >= path.length - 1) { still = true; return; }
      for (const d of m.map.doors) if (d.level === 1 && !m.world.doorOpen[d.id] && Math.hypot(d.x - p.x, d.z - p.z) < 1.4) m.interact('p1', { kind: 'door', id: d.id });
      let wp = path[Math.min(pi, path.length - 1)];
      while (Math.hypot(wp.x - p.x, wp.z - p.z) < 0.35 && pi < path.length - 1) wp = path[++pi];
      if (pi >= path.length - 1 && Math.hypot(wp.x - p.x, wp.z - p.z) < 0.35) { pi = path.length; return; }
      const sp = stam > 0 ? PLAYER.run * 0.97 : PLAYER.walk; stam -= dt;
      const dx = wp.x - p.x, dz = wp.z - p.z, d = Math.hypot(dx, dz) || 1;
      const r = m.world.move(1, p.x, p.z, dx / d * Math.min(d, sp * dt), dz / d * Math.min(d, sp * dt), PLAYER.radius);
      p.yaw = Math.atan2(-dx, -dz);
      m.applyInput('p1', { x: r.x, z: r.z, yaw: p.yaw, pitch: 0, fl: false, crouch: false, run: sp > 3 });
    });
    if (p.alive) ok++;
  }
  assert.ok(n >= 10, 'cenários válidos: ' + n);
  assert.ok(ok / n >= 0.45, `escaparam ${ok}/${n}`);
  assert.ok(ok < n, 'mas não é garantido (ainda há risco)');
});
