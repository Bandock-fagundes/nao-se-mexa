// Cliente WebSocket com reconexão automática (token de sessão) e detecção de servidor fora do ar.
export class Net {
  constructor() {
    this.ws = null; this.handlers = {}; this.session = null; this.state = 'idle';
    this.ping = 0; this.lastPong = 0; this.queue = [];
    this.url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  }
  on(t, fn) { (this.handlers[t] = this.handlers[t] || []).push(fn); }
  emit(t, m) { for (const fn of this.handlers[t] || []) fn(m); }
  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return this.openPromise;
    this.openPromise = new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(this.url); } catch (e) { reject(e); return; }
      this.ws = ws;
      const to = setTimeout(() => { try { ws.close(); } catch { } reject(new Error('timeout')); }, 6000);
      ws.onopen = () => {
        clearTimeout(to);
        this.state = 'open'; this.lastPong = performance.now();
        for (const m of this.queue) ws.send(JSON.stringify(m)); this.queue = [];
        resolve();
      };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'pong') { this.ping = performance.now() - m.c; this.lastPong = performance.now(); }
        if (m.t === 'joined') this.session = { code: m.code, token: m.token, id: m.id };
        this.lastPong = performance.now();
        this.emit(m.t, m); this.emit('*', m);
      };
      ws.onerror = () => { };
      ws.onclose = () => { clearTimeout(to); if (this.ws === ws) this.onClosed(); reject(new Error('closed')); };
    });
    if (!this.pingTimer) this.pingTimer = setInterval(() => this.heartbeat(), 2000);
    return this.openPromise;
  }
  heartbeat() {
    const now = performance.now();
    // se o próprio temporizador atrasou (aba travada/lenta), as mensagens ainda estão na fila: não julga a conexão
    const starved = this.lastBeat && now - this.lastBeat > 4500;
    this.lastBeat = now;
    if (starved) { this.lastPong = now; return; }
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({ t: 'ping', c: now }));
      if (now - this.lastPong > 12000) { try { this.ws.close(); } catch { } }
    }
  }
  send(m) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
    else if (m.t !== 'in') this.queue.push(m);
  }
  onClosed() {
    this.state = 'closed';
    if (this.session && !this.leaving) this.reconnectLoop();
    else this.emit('closed', {});
  }
  async reconnectLoop() {
    if (this.reconnecting) return;
    this.reconnecting = true;
    this.emit('reconnecting', {});
    const start = performance.now();
    while (performance.now() - start < 30000) {
      try {
        await this.connect();
        this.ws.send(JSON.stringify({ t: 'resume', code: this.session.code, token: this.session.token }));
        this.reconnecting = false;
        this.emit('reconnected', {});
        return;
      } catch { await new Promise(r => setTimeout(r, 1500)); }
    }
    this.reconnecting = false;
    this.session = null;
    this.emit('fatal', { msg: 'SERVIDOR DESCONECTADO' });
  }
  leave() {
    this.leaving = true;
    this.send({ t: 'leave' });
    this.session = null;
    setTimeout(() => { this.leaving = false; }, 500);
  }
  // usado pelo teste E2E para simular queda de conexão
  dropForTest() { try { this.ws.close(); } catch { } }
}
