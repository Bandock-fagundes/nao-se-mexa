// Salas multiplayer: código de convite, lobby, prontidão, início, reconexão, migração de anfitrião.
import crypto from 'node:crypto';
import { Match } from './match.js';
import { randomSeed } from '../shared/rng.js';
import { MAX_PLAYERS, NET, PHASES, SERVER, MAX_PHASE } from '../shared/config.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };
const cleanName = (n) => String(n || 'Jogador').replace(/[<>&"']/g, '').trim().slice(0, 16) || 'Jogador';

export class RoomManager {
  constructor({ tickMs = 50 } = {}) {
    this.rooms = new Map();
    this.tickMs = tickMs;
    this.timer = setInterval(() => this.tick(), tickMs);
    this.last = Date.now();
  }
  close() { clearInterval(this.timer); }
  newCode() {
    for (;;) {
      let c = ''; for (let i = 0; i < 5; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
      if (!this.rooms.has(c)) return c;
    }
  }
  // ---------- mensagens ----------
  handle(conn, msg) {
    if (!msg || typeof msg.t !== 'string') return;
    const room = conn.room, pid = conn.pid;
    switch (msg.t) {
      case 'ping': return send(conn.ws, { t: 'pong', c: msg.c, s: Date.now() });
      case 'create': return this.create(conn, msg, false);
      case 'solo': return this.create(conn, msg, true);
      case 'join': return this.join(conn, msg);
      case 'resume': return this.resume(conn, msg);
    }
    if (!room) return send(conn.ws, { t: 'error', msg: 'Você não está em uma sala.' });
    const pl = room.players.get(pid);
    if (!pl) return;
    switch (msg.t) {
      case 'ready': pl.ready = !!msg.ready; this.broadcastRoom(room); break;
      // v3: escolher a fase é só para a aba TESTAR JOGO; no jogo normal a fase avança sozinha (1 → 2 → 3)
      case 'phase': if (room.test && room.hostId === pid && room.state !== 'playing' && PHASES[msg.phase]) { room.phase = msg.phase; this.broadcastRoom(room); } break;
      case 'loaded': if (room.match && room.state === 'playing') room.match.markLoaded(pid); break;
      case 'seed': if (room.test && room.hostId === pid) { room.nextSeed = String(msg.seed || '').slice(0, 40) || null; this.broadcastRoom(room); } break;
      case 'start': this.start(room, pid, msg); break;
      case 'restart': if (room.hostId === pid && (room.state === 'ended' || room.test)) {
        if (room.test) { if (msg.phase && PHASES[msg.phase]) room.phase = msg.phase; }
        else this.advancePhase(room, msg);
        room.nextSeed = (msg.seed && room.test) ? String(msg.seed).slice(0, 40) : null; this.startMatch(room);
      } break;
      case 'debug': {
        // somente salas da aba TESTAR JOGO (diagnóstico)
        if (!room.test || !room.match || room.state !== 'playing') return;
        const r = room.match.debugCommand(pid, msg);
        if (r && r.correction) send(conn.ws, { t: 'corr', ...r.correction });
        send(conn.ws, { t: 'dres', ...r });
        break;
      }
      case 'lobby': if (room.hostId === pid && room.state === 'ended') { if (!room.test && room.match && room.match.result === 'win') room.phase = Math.min(MAX_PHASE, room.match.phase + 1); room.state = 'lobby'; room.match = null; for (const p of room.players.values()) p.ready = false; this.broadcastRoom(room); this.broadcast(room, { t: 'tolobby' }); } break;
      case 'leave': this.leave(conn); break;
      case 'in': {
        if (room.state !== 'playing' || !room.match) return;
        const r = room.match.applyInput(pid, msg);
        if (r.correction) send(conn.ws, { t: 'corr', ...r.correction });
        break;
      }
      case 'act': {
        if (room.state !== 'playing' || !room.match) return;
        const r = room.match.interact(pid, msg);
        send(conn.ws, { t: 'ires', req: msg.kind, id: msg.id, ...r });
        break;
      }
    }
  }
  // v3: progressão de fases. Vitória → próxima fase (até a 3); 'fresh' (depois da fase 3) → recomeça na 1;
  // derrota ou 'retry' → repete a mesma fase. O cliente não escolhe a fase.
  advancePhase(room, msg) {
    const last = room.match;
    if (msg.fresh) room.phase = 1;
    else if (msg.next && last && last.result === 'win') room.phase = Math.min(MAX_PHASE, last.phase + 1);
    else if (last) room.phase = last.phase;
  }
  roomInfo(room) {
    return {
      code: room.code, hostId: room.hostId, phase: room.phase, state: room.state, test: room.test, solo: room.solo, nextSeed: room.test ? room.nextSeed : undefined,
      players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, ready: p.ready, connected: p.connected, isHost: p.id === room.hostId })),
      max: MAX_PLAYERS,
    };
  }
  // droppable = mensagem descartável (snapshot 20 Hz): se a fila de envio de um cliente lento passar do limite,
  // pula este snapshot para ele em vez de acumular memória (o próximo traz o estado completo de novo)
  broadcast(room, msg, droppable = false) {
    const s = JSON.stringify(msg);
    for (const p of room.players.values()) {
      const ws = p.conn && p.conn.ws;
      if (!ws || ws.readyState !== 1) continue;
      if (droppable && ws.bufferedAmount > SERVER.maxBuffered) { p.dropped = (p.dropped || 0) + 1; continue; }
      try { ws.send(s); } catch (e) { console.error('falha ao enviar', e.message); }
    }
  }
  broadcastRoom(room) { this.broadcast(room, { t: 'room', room: this.roomInfo(room) }); }
  addPlayer(room, conn, name) {
    const id = 'p' + crypto.randomBytes(4).toString('hex');
    const token = crypto.randomBytes(16).toString('hex');
    const p = { id, name: cleanName(name), token, ready: false, connected: true, conn, dcAt: null };
    room.players.set(id, p);
    conn.room = room; conn.pid = id;
    send(conn.ws, { t: 'joined', code: room.code, id, token, room: this.roomInfo(room) });
    return p;
  }
  create(conn, msg, solo) {
    if (conn.room) this.leave(conn);
    const code = this.newCode();
    const room = { code, players: new Map(), hostId: null, phase: (msg.test && PHASES[msg.phase]) ? msg.phase : 1, state: 'lobby', test: !!msg.test, solo, match: null, created: Date.now(), nextSeed: msg.seed && msg.test ? String(msg.seed).slice(0, 40) : null, diagAcc: 0, emptySince: null };
    this.rooms.set(code, room);
    const p = this.addPlayer(room, conn, msg.name);
    room.hostId = p.id;
    this.broadcastRoom(room);
    if (solo) this.startMatch(room);
  }
  join(conn, msg) {
    const code = String(msg.code || '').toUpperCase().trim();
    const room = this.rooms.get(code);
    if (!room) return send(conn.ws, { t: 'error', msg: 'Sala não encontrada. Confira o código.' });
    if (room.solo) return send(conn.ws, { t: 'error', msg: 'Esta é uma partida solo.' });
    if (room.state === 'playing') return send(conn.ws, { t: 'error', msg: 'A partida já começou nesta sala.' });
    const active = [...room.players.values()].filter(p => p.connected || p.dcAt);
    if (active.length >= MAX_PLAYERS) return send(conn.ws, { t: 'error', msg: 'Sala cheia (máximo ' + MAX_PLAYERS + ').' });
    if (conn.room) this.leave(conn);
    this.addPlayer(room, conn, msg.name);
    this.broadcastRoom(room);
  }
  resume(conn, msg) {
    const room = this.rooms.get(String(msg.code || '').toUpperCase());
    const p = room && [...room.players.values()].find(q => q.token === msg.token);
    if (!room || !p) return send(conn.ws, { t: 'resume_fail', msg: 'Não foi possível voltar à sala (expirou).' });
    if (p.conn && p.conn !== conn) { try { p.conn.ws.close(); } catch { } p.conn.room = null; }
    p.conn = conn; p.connected = true; p.dcAt = null;
    conn.room = room; conn.pid = p.id;
    send(conn.ws, { t: 'joined', code: room.code, id: p.id, token: p.token, room: this.roomInfo(room), resumed: true });
    if (room.match && (room.state === 'playing' || room.state === 'ended')) {
      room.match.setConnected(p.id, true);
      const mp = room.match.players.get(p.id);
      send(conn.ws, { t: 'start', resumed: true, gen: { ...room.match.gen }, seed: room.match.seed, size: room.match.size, genVersion: room.match.gen.version, mapHash: room.match.map.hash, phase: room.match.phase, keysNeeded: room.match.keysNeeded, you: mp ? { x: mp.x, z: mp.z, level: mp.level, yaw: mp.yaw, alive: mp.alive, escaped: mp.escaped } : null, state: room.match.fullState(), test: room.test, names: this.names(room) });
      if (room.state === 'ended') send(conn.ws, { t: 'end', result: room.match.result, stats: room.match.stats() });
    }
    this.broadcastRoom(room);
  }
  names(room) { return Object.fromEntries([...room.players.values()].map(p => [p.id, p.name])); }
  start(room, pid) {
    if (room.hostId !== pid) return send(room.players.get(pid).conn.ws, { t: 'error', msg: 'Apenas o anfitrião pode iniciar.' });
    if (room.state === 'playing') return;
    const notReady = [...room.players.values()].filter(p => p.id !== room.hostId && p.connected && !p.ready);
    if (notReady.length) return send(room.players.get(pid).conn.ws, { t: 'error', msg: 'Aguardando jogadores ficarem prontos: ' + notReady.map(p => p.name).join(', ') });
    this.startMatch(room);
  }
  startMatch(room) {
    const seed = room.nextSeed || randomSeed();
    if (!room.test) room.nextSeed = null;
    // remove quem saiu de vez
    for (const [id, p] of room.players) if (!p.connected && !p.dcAt) room.players.delete(id);
    const players = [...room.players.values()].filter(p => p.connected).map(p => ({ id: p.id, name: p.name }));
    // keySeed aleatório: as chaves mudam de lugar a cada partida/reinício, mesmo com a mesma semente de casa
    // v3: casa compacta/média/grande conforme o número de jogadores; cena "acordando" fora da aba de testes
    const size = Math.max(1, Math.min(3, players.length));
    room.match = new Match({ seed, phase: room.phase, players, test: room.test, keySeed: randomSeed(), size, wake: !room.test });
    room.state = 'playing';
    room.lastTick = Date.now();
    for (const p of room.players.values()) {
      const mp = room.match.players.get(p.id);
      if (!mp) continue;
      send(p.conn && p.conn.ws, { t: 'start', gen: { ...room.match.gen }, seed: room.match.seed, size: room.match.size, genVersion: room.match.gen.version, mapHash: room.match.map.hash, phase: room.phase, keysNeeded: room.match.keysNeeded, you: { x: mp.x, z: mp.z, level: mp.level, yaw: mp.yaw, alive: true, escaped: false }, state: room.match.fullState(), test: room.test, names: this.names(room) });
    }
    this.broadcastRoom(room);
  }
  leave(conn) {
    const room = conn.room; if (!room) return;
    const p = room.players.get(conn.pid);
    conn.room = null; conn.pid = null;
    if (!p) return;
    room.players.delete(p.id);
    if (room.match) room.match.removePlayer(p.id);
    if (room.hostId === p.id) this.migrateHost(room);
    if (room.players.size === 0) { this.rooms.delete(room.code); return; }
    this.broadcastRoom(room);
  }
  migrateHost(room) {
    const next = [...room.players.values()].find(p => p.connected);
    if (next) { room.hostId = next.id; this.broadcast(room, { t: 'host', id: next.id, name: next.name }); }
  }
  disconnected(conn) {
    const room = conn.room; if (!room) return;
    const p = room.players.get(conn.pid);
    if (!p || p.conn !== conn) return;
    p.connected = false; p.dcAt = Date.now();
    if (room.match && room.state === 'playing') room.match.setConnected(p.id, false);
    this.broadcastRoom(room);
  }
  // ---------- laço de simulação ----------
  tick() {
    const now = Date.now();
    for (const room of [...this.rooms.values()]) try { this.tickRoom(room, now); } catch (e) { console.error(`[sala ${room.code}] erro no laço:`, e && e.stack || e); }
  }
  // avisa todos os jogadores conectados (ex.: o servidor vai reiniciar por atualização/deploy)
  notifyAll(msg) { for (const room of this.rooms.values()) this.broadcast(room, msg); }
  get activePlayers() { let n = 0; for (const r of this.rooms.values()) for (const p of r.players.values()) if (p.connected) n++; return n; }
  tickRoom(room, now) {
    {
      // tempo de graça de reconexão / migração de anfitrião
      for (const p of [...room.players.values()]) {
        if (p.connected || !p.dcAt) continue;
        const dt = (now - p.dcAt) / 1000;
        if (room.hostId === p.id && dt > NET.hostMigrateDelay) {
          const next = [...room.players.values()].find(q => q.connected);
          if (next) { room.hostId = next.id; this.broadcast(room, { t: 'host', id: next.id, name: next.name }); this.broadcastRoom(room); }
        }
        const grace = room.state === 'playing' ? NET.reconnectGrace : 20;
        if (dt > grace) { room.players.delete(p.id); if (room.match) room.match.removePlayer(p.id); this.broadcastRoom(room); }
      }
      const anyConnected = [...room.players.values()].some(p => p.connected);
      if (!anyConnected) {
        room.emptySince = room.emptySince || now;
        if (now - room.emptySince > (room.state === 'playing' ? NET.emptyRoomMs : 60000) || room.players.size === 0) { this.rooms.delete(room.code); return; }
      } else room.emptySince = null;
      if (room.state !== 'playing' || !room.match) return;
      const dt = Math.min(0.1, (now - (room.lastTick || now)) / 1000) || this.tickMs / 1000;
      room.lastTick = now;
      const m = room.match;
      // v2: um erro na simulação de UMA sala nunca derruba o processo (antes: exceção no setInterval → servidor
      // caía → todos desconectados). A sala registra o erro e continua no próximo tick.
      try {
        m.tick(dt);
      } catch (e) {
        room.errors = (room.errors || 0) + 1;
        console.error(`[sala ${room.code}] erro na simulação (${room.errors}):`, e && e.stack || e);
        m.events = m.events || [];
      }
      if (m.events.length) { this.broadcast(room, { t: 'ev', events: m.events }); m.events = []; }
      try { this.broadcast(room, { ...m.snapshot(), t: 's' }, true); } catch (e) { console.error(`[sala ${room.code}] erro no snapshot:`, e && e.stack || e); }
      if (room.test) {
        room.diagAcc += dt;
        if (room.diagAcc > 0.4) { room.diagAcc = 0; try { this.broadcast(room, { ...m.diag(), t: 'diag' }, true); } catch (e) { console.error('diag', e.message); } }
      }
      if (m.ended) {
        room.state = 'ended';
        this.broadcast(room, { t: 'end', result: m.result, stats: m.stats() });
        this.broadcastRoom(room);
      }
    }
  }
}
