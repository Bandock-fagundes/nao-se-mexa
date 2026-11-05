// Servidor único: HTTP (cliente estático de /dist) + WebSocket (/ws) na mesma porta.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RoomManager } from './rooms.js';
import { GEN_VERSION, SERVER } from '../shared/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '..', 'dist');
// v2: pasta pública da EVA ENGINE, servida em /eva/ (fica no repositório; o build do Render não precisa mudar)
const PUBLIC_EVA = path.resolve(__dirname, '..', 'public-eva');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8' };

// /eva/... → arquivos de public-eva/ (pasta → index.html; arquivo inexistente → 404, sem cair no jogo)
function serveEva(url, res) {
  if (url.pathname === '/eva') { res.writeHead(301, { Location: '/eva/' + url.search }); return res.end(); }
  let rel; try { rel = decodeURIComponent(url.pathname.slice('/eva/'.length)); } catch { res.writeHead(400); return res.end(); }
  let file = path.normalize(path.join(PUBLIC_EVA, rel));
  if (file !== PUBLIC_EVA && !file.startsWith(PUBLIC_EVA + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (e2, data) => {
      if (e2) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Não encontrado.'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  });
}

export function createGameServer({ port = 0, host, dist = DIST, tickMs = 50, heartbeatMs = SERVER.heartbeatMs, keepAliveUrl = null, keepAliveMs = SERVER.keepAliveMs } = {}) {
  const manager = new RoomManager({ tickMs });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, rooms: manager.rooms.size, players: manager.activePlayers, genVersion: GEN_VERSION, uptime: Math.round(process.uptime()) }));
    }
    if (url.pathname === '/eva' || url.pathname.startsWith('/eva/')) return serveEva(url, res);
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
  // detecção de conexões mortas: ping a cada heartbeatMs; quem não respondeu ao ping anterior é encerrado.
  // Qualquer mensagem do cliente também prova que ele está vivo (abas lentas não caem por pong atrasado).
  // v2: tolerante a engasgos — só encerra depois de 3 pings seguidos sem resposta (~30 s), porque um navegador ou
  // servidor sobrecarregado pode atrasar o pong; antes, 1 ping perdido (10 s) já derrubava o jogador.
  const hb = setInterval(() => {
    for (const ws of wss.clients) {
      ws._missed = (ws._missed || 0) + 1;
      if (ws._missed > 3) { ws.terminate(); continue; }
      try { ws.ping(); } catch { }
    }
  }, heartbeatMs);
  wss.on('connection', (ws) => { ws.on('pong', () => { ws._missed = 0; }); ws.on('message', () => { ws._missed = 0; }); });
  // keepalive HTTP leve enquanto houver alguém jogando (Render grátis dorme sem tráfego de entrada).
  // Só roda se keepAliveUrl for passado (produção: RENDER_EXTERNAL_URL/health).
  let ka = null;
  if (keepAliveUrl) ka = setInterval(() => {
    if (manager.activePlayers === 0) return;
    fetch(keepAliveUrl).catch(() => { });
  }, keepAliveMs);
  return new Promise((resolve) => {
    // host: '0.0.0.0' em produção (Render); omitido nos testes (aceita localhost em IPv4 e IPv6)
    server.listen(port, host, () => {
      const addr = server.address();
      resolve({
        server, wss, manager, port: addr.port,
        close: () => new Promise((r) => { clearInterval(hb); if (ka) clearInterval(ka); manager.close(); for (const c of wss.clients) c.terminate(); wss.close(); server.close(() => r()); }),
      });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const ext = process.env.RENDER_EXTERNAL_URL;
  createGameServer({ port, host: '0.0.0.0', keepAliveUrl: ext ? ext.replace(/\/$/, '') + '/health' : null }).then((srv) => {
    console.log(`NÃO SE MEXA! servidor em http://localhost:${srv.port}  (WebSocket em /ws)`);
    // Deploy/reinício (Render manda SIGTERM ao trocar a instância): avisa os jogadores antes de cair,
    // para o cliente mostrar "o servidor foi atualizado" em vez de uma desconexão misteriosa.
    let stopping = false;
    const stop = (sig) => {
      if (stopping) return; stopping = true;
      console.log(`${sig} recebido: avisando ${srv.manager.activePlayers} jogador(es) e encerrando`);
      try { srv.manager.notifyAll({ t: 'server_restart', msg: 'O servidor do jogo foi reiniciado (atualização). A partida em andamento foi perdida.' }); } catch { }
      setTimeout(() => srv.close().then(() => process.exit(0)), 400);
    };
    process.on('SIGTERM', () => stop('SIGTERM'));
    process.on('SIGINT', () => stop('SIGINT'));
  });
  // erro inesperado fora das salas: registra e mantém o servidor de pé (as salas já se protegem sozinhas)
  process.on('uncaughtException', (e) => console.error('uncaughtException:', e && e.stack || e));
  process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e && e.stack || e));
}
