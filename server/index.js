// Servidor único: HTTP (cliente estático de /dist) + WebSocket (/ws) na mesma porta.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RoomManager } from './rooms.js';
import { GEN_VERSION } from '../shared/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '..', 'dist');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

export function createGameServer({ port = 0, host, dist = DIST, tickMs = 50 } = {}) {
  const manager = new RoomManager({ tickMs });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, rooms: manager.rooms.size, genVersion: GEN_VERSION }));
    }
    let file = path.normalize(path.join(dist, decodeURIComponent(url.pathname)));
    if (!file.startsWith(dist)) { res.writeHead(403); return res.end(); }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) file = path.join(dist, 'index.html'); // rotas SPA: /, /testar
      fs.readFile(file, (e2, data) => {
        if (e2) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Cliente não compilado. Rode "npm run build".'); }
        const ext = path.extname(file);
        const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
        if (file.includes(path.sep + 'assets' + path.sep)) headers['Cache-Control'] = 'public, max-age=31536000, immutable';
        else headers['Cache-Control'] = 'no-cache';
        res.writeHead(200, headers); res.end(data);
      });
    });
  });
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
  wss.on('connection', (ws) => {
    const conn = { ws, room: null, pid: null, alive: true };
    ws.on('pong', () => { conn.alive = true; });
    ws.on('message', (data) => {
      let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
      try { manager.handle(conn, msg); } catch (e) { console.error('erro ao tratar mensagem', e); }
    });
    ws.on('close', () => manager.disconnected(conn));
    ws.send(JSON.stringify({ t: 'hello', genVersion: GEN_VERSION }));
  });
  // detecção de conexões mortas
  const hb = setInterval(() => {
    for (const ws of wss.clients) { if (ws._dead) { ws.terminate(); continue; } ws._dead = true; ws.ping(); }
  }, 10000);
  wss.on('connection', (ws) => ws.on('pong', () => { ws._dead = false; }));
  return new Promise((resolve) => {
    // host: '0.0.0.0' em produção (Render); omitido nos testes (aceita localhost em IPv4 e IPv6)
    server.listen(port, host, () => {
      const addr = server.address();
      resolve({
        server, wss, manager, port: addr.port,
        close: () => new Promise((r) => { clearInterval(hb); manager.close(); for (const c of wss.clients) c.terminate(); wss.close(); server.close(() => r()); }),
      });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createGameServer({ port, host: '0.0.0.0' }).then(({ port: p }) => console.log(`NÃO SE MEXA! servidor em http://localhost:${p}  (WebSocket em /ws)`));
}
