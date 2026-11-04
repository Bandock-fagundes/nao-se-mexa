// Teste E2E com navegador real (puppeteer, Chrome headless com WebGL por software):
// duas páginas — cria sala, entra pelo link ?sala=, prontidão, início, jogo, interação,
// encontro com a criatura, morte, vitória — e capturas de tela para revisão visual.
// Uso: PUPPETEER_CACHE_DIR=$PWD/.puppeteer-cache node e2e/e2e.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameServer } from '../server/index.js';
import { generateMansion } from '../shared/mapgen.js';
import { clearCorridor } from '../test/helpers.js';
import { World } from '../shared/world.js';
import { launch, newPage, sleep } from './launch.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, '..', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
// renderiza só quando vai capturar (WebGL por software é lento; a lógica do jogo segue rodando)
async function shot(pg, file, waitMs = 2500) {
  await pg.evaluate(() => { window.__app.noRender = false; });
  await sleep(waitMs);
  await pg.screenshot({ path: path.join(SHOTS, file) });
  await pg.evaluate(() => { window.__app.noRender = true; });
}
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
function check(name, cond, info = '') { results.push({ name, ok: !!cond, info }); log(cond ? 'PASS' : 'FAIL', name, info); }
const errors = [];

const srv = await createGameServer({ port: 0 });
const base = `http://localhost:${srv.port}`;
const browser = await launch();
let A, B;
try {
  // ---------- menu ----------
  A = await newPage(browser, `${base}/?e2e=1&quality=low`, (...a) => { errors.push('A ' + a.join(' ')); log('A', ...a); });
  await A.waitForSelector('#menu.on');
  await A.screenshot({ path: path.join(SHOTS, 'menu.png') });
  check('menu principal exibido', await A.$eval('.title', e => e.textContent === 'NÃO SE MEXA!'));
  check('selo BETA pequeno sob o título', await A.$eval('.beta', e => e.textContent === 'BETA' && parseFloat(getComputedStyle(e).fontSize) < 20));
  // ---------- cria sala (aba TESTAR JOGO, para permitir comandos de teste) ----------
  await A.goto(`${base}/testar?e2e=1&quality=low`);
  await A.waitForSelector('#testar.on');
  await A.$eval('#tName', e => { e.value = ''; });
  await A.type('#tName', 'Ana');
  await A.click('#tCreate');
  await A.waitForSelector('#lobby.on');
  const code = await A.$eval('#lobbyCode', e => e.textContent);
  check('sala criada com código de 5 letras', /^[A-Z0-9]{5}$/.test(code), code);
  // ---------- segundo jogador entra pelo link de convite ----------
  B = await newPage(browser, `${base}/?sala=${code}&e2e=1&quality=low`, (...a) => { errors.push('B ' + a.join(' ')); log('B', ...a); }, 960, 540);
  await B.waitForSelector('#mode.on');
  check('link ?sala= abre o modo com o código preenchido', (await B.$eval('#joinCode', e => e.value)) === code);
  await B.$eval('#name', e => { e.value = ''; });
  await B.type('#name', 'Beto');
  await B.click('#btnJoin');
  await B.waitForSelector('#lobby.on');
  await A.waitForFunction(() => document.querySelectorAll('#lobbyPlayers li').length === 2, { timeout: 15000 });
  check('anfitrião vê 2 jogadores', true);
  check('sala mostra limite de 3 jogadores', /\/3\)/.test(await A.$eval('#lobbyCount', e => e.textContent)), await A.$eval('#lobbyCount', e => e.textContent));
  check('botão iniciar bloqueado até todos ficarem prontos', await A.$eval('#btnStart', b => b.disabled));
  await B.evaluate(() => { window.__app.diagOn = false; });
  await B.click('#btnReady');
  await A.waitForFunction(() => !document.querySelector('#btnStart').disabled, { timeout: 15000 });
  await A.screenshot({ path: path.join(SHOTS, 'lobby.png') });
  await A.click('#btnStart');
  await A.waitForFunction('window.__game && window.__game.lastSnap', { timeout: 240000, polling: 1000 });
  await B.waitForFunction('window.__game && window.__game.lastSnap', { timeout: 240000, polling: 1000 });
  log('partida iniciada nas duas páginas');
  // conta quedas/reconexões (diagnóstico: CPU muito carregada pode atrasar o navegador)
  for (const pg of [A, B]) await pg.evaluate(() => { window.__rc = 0; window.__app.net.on('reconnecting', () => { window.__rc++; }); });
  await A.evaluate(() => { window.__app.noRender = true; }); await B.evaluate(() => { window.__app.noRender = true; });
  const seedA = await A.evaluate(() => window.__game.seed), seedB = await B.evaluate(() => window.__game.seed);
  check('mesma semente nas duas páginas', seedA === seedB, seedA);
  check('mapa do cliente confere com o servidor (hash)', await A.evaluate(() => window.__game.hashOk) && await B.evaluate(() => window.__game.hashOk));
  const map = generateMansion(seedA);
  const ids = { A: await A.evaluate(() => window.__app.myId), B: await B.evaluate(() => window.__app.myId) };
  const send = (pg, m) => pg.evaluate((m) => window.__app.net.send(m), m);
  // estaciona a criatura longe
  const cs = map.creatureSpawn;
  await send(A, { t: 'debug', cmd: 'creature', x: cs.x, z: cs.z, level: cs.level, state: 'hold' });
  // ---------- corredor: mão + lanterna, colega à frente ----------
  const corr = clearCorridor({ map }, 1, 22) || clearCorridor({ map }, 1, 14);
  const ax = corr.x0, az = corr.z;
  await send(A, { t: 'debug', cmd: 'tp', x: ax, z: az, level: 1 });
  await send(B, { t: 'debug', cmd: 'tp', x: ax + 4.5, z: az - 0.5, level: 1 });
  await A.evaluate(() => window.__game.setLook(-Math.PI / 2, -0.04));
  await B.evaluate(() => window.__game.setLook(-Math.PI / 2 - 0.5, -0.1));
  await sleep(4000);
  const mates = await A.evaluate(() => window.__game.mates.size);
  check('A vê o colega B (sincronização de posição)', mates === 1);
  const posB = await A.evaluate(() => { const m = [...window.__game.mates.values()][0]; return m ? { x: m.rx, z: m.rz } : null; });
  check('posição de B em A confere', posB && Math.abs(posB.x - (ax + 4.5)) < 0.3, JSON.stringify(posB));
  const hq = async (pg, q) => { await pg.evaluate((q) => { window.__app.settings.quality = q; window.__app.renderer.applySettings(window.__app.settings); }, q); await sleep(300); };
  const SHOTQ = process.env.E2E_QUALITY || 'medium';
  await hq(A, SHOTQ);
  await shot(A, 'hallway-hand-flashlight-on.png', 4000);
  // lanterna desligada (tecla F) — traz a página A para frente (o teclado vai para a aba focada)
  await A.bringToFront(); await sleep(300);
  await A.mouse.click(640, 400); await sleep(300); // foco no documento (como o "clique para jogar")
  await A.keyboard.press('KeyF');
  await sleep(5000);
  check('tecla F desliga a lanterna', (await A.evaluate(() => window.__game.p.fl)) === false);
  await shot(A, 'hallway-flashlight-off.png', 4000);
  await A.keyboard.press('KeyF');
  await sleep(1500);
  if (!(await A.evaluate(() => window.__game.p.fl))) await A.evaluate(() => window.__game.toggleFlashlight());
  const ext = await A.evaluate(() => window.__app.net.ping);
  log('ping', ext);
  // sincronização da lanterna do colega
  const bfl = await A.evaluate(() => window.__game.lastSnap.players.find(p => p.id !== window.__app.myId).fl);
  check('estado da lanterna do colega sincronizado', bfl === true);
  await hq(A, 'low');
  // ---------- v2: chaves — gaveta individual mirada com o pontinho + tecla E ----------
  const keys = await A.evaluate(() => new Promise(res => { const net = window.__app.net; const h = (m) => { if (m.keys) { res(m.keys); } }; net.on('dres', h); net.send({ t: 'debug', cmd: 'keys' }); }));
  check('3 chaves na casa', keys.length === 3, JSON.stringify(keys.map(k => ({ c: k.id, part: k.part, s: k.surface }))));
  // prefere uma chave dentro de móvel com várias gavetas (testa a gaveta certa); senão a primeira dentro de móvel
  const inside = keys.filter(k => k.id !== null);
  const k = inside.find(q => map.containers[q.id].parts > 1) || inside[0] || keys[0];
  const aimAt = async (pg, pt) => pg.evaluate((pt) => { const g = window.__game; const cam = window.__app.renderer.camera.position; const dx = pt.x - cam.x, dy = pt.y - cam.y, dz = pt.z - cam.z; g.setLook(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))); }, pt);
  await send(A, { t: 'debug', cmd: 'tp', x: k.ax, z: k.az, level: k.level });
  await sleep(2500);
  if (k.id !== null) {
    const ptc = await A.evaluate((id, part) => { const b = window.__game.view.containers[id].parts[part].box; return { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2, z: (b.min.z + b.max.z) / 2 }; }, k.id, k.part);
    await aimAt(A, ptc);
    await sleep(2000);
    let tgt = await A.evaluate(() => window.__game.target);
    log('alvo de interação:', JSON.stringify(tgt));
    check('mira (pontinho) seleciona a gaveta/porta certa do móvel', tgt && tgt.kind === 'container' && tgt.id === k.id && tgt.part === k.part, JSON.stringify(tgt));
    if (tgt && tgt.kind === 'container' && tgt.id === k.id && tgt.part === k.part) await A.keyboard.press('KeyE');
    else await send(A, { t: 'act', kind: 'container', id: k.id, part: k.part, open: true });
    await A.waitForFunction((id, part) => window.__game.view.containers[id].parts[part].open, { timeout: 30000 }, k.id, k.part);
    const others = await A.evaluate((id, part) => window.__game.view.containers[id].parts.filter((p, i) => i !== part && p.open).length, k.id, k.part);
    check('só aquela gaveta abriu (as outras continuam fechadas)', others === 0, 'abertas além dela: ' + others);
    await sleep(2200);
  }
  const kv = await A.evaluate((kid) => window.__game.keyViews[kid].mesh.visible, k.key);
  check('chave revelada fica visível (brilho branco)', kv);
  // mira na própria chave
  const kp = await A.evaluate((kid) => { const v = new window.__game.keyViews[kid].mesh.position.constructor(); window.__game.keyViews[kid].mesh.getWorldPosition(v); return { x: v.x, y: v.y, z: v.z }; }, k.key);
  await aimAt(A, kp);
  await hq(A, 'medium');
  await shot(A, 'key-revealed.png', 3000);
  let tgt = await A.evaluate(() => window.__game.target && window.__game.target.text);
  check('prompt "[E] Pegar chave" ao mirar na chave', tgt === '[E] Pegar chave', tgt);
  if (tgt === '[E] Pegar chave') await A.keyboard.press('KeyE'); else await send(A, { t: 'act', kind: 'key', key: k.key });
  await A.waitForFunction(() => window.__game.myKeys === 1, { timeout: 30000 });
  await B.waitForFunction(() => window.__game.keys === 1, { timeout: 30000 });
  check('chave coletada em A aparece em B', true);
  await sleep(1200);
  await shot(A, 'hud.png', 3000);
  const hudText = await A.$eval('#hudTL', e => e.innerText);
  check('HUD mostra "Você tem 1 chave" e a porta 0/3', /FASE 1 — A CRIATURA VÊ/.test(hudText) && /Você tem 1 chave/.test(hudText) && /Porta de saída: 0\/3/.test(hudText), hudText.replace(/\n/g, ' | '));
  check('com chave no inventário a saída aparece através das paredes', await A.evaluate(() => window.__game.debugState().exitXray));
  // as outras duas: uma para A (protocolo) e uma para B
  const rest = keys.filter(q => q.key !== k.key);
  const grab = async (pg, q) => { await send(pg, { t: 'debug', cmd: 'tp', x: q.ax, z: q.az, level: q.level }); await sleep(1200); if (q.id !== null) await send(pg, { t: 'act', kind: 'container', id: q.id, part: q.part, open: true }); await sleep(800); await send(pg, { t: 'act', kind: 'key', key: q.key }); };
  await grab(A, rest[0]); await A.waitForFunction(() => window.__game.myKeys === 2, { timeout: 30000 });
  await grab(B, rest[1]); await B.waitForFunction(() => window.__game.myKeys === 1, { timeout: 30000 });
  check('chaves no inventário de cada jogador (A=2, B=1)', true);
  // ---------- sons em níveis + onda na tela ----------
  // ponto livre ao lado de um objeto derrubável (de vidro, de preferência) no térreo
  const wq = new World(map);
  const freeNear = (q) => { for (const [ox, oz] of [[0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8], [0.6, 0.6], [-0.6, 0.6], [0.6, -0.6], [-0.6, -0.6], [1.1, 0], [-1.1, 0], [0, 1.1], [0, -1.1]]) { const x = q.x + ox, z = q.z + oz; if (wq.circleFree(q.level, x, z, 0.3) && wq.noWallBetween(q.level, x, z, q.x, q.z)) return { x, z }; } return null; };
  const cands = map.knockables.filter(q => freeNear(q)).sort((a, b) => (['vase', 'bottles', 'candelabrum'].includes(b.kind) ? 1 : 0) - (['vase', 'bottles', 'candelabrum'].includes(a.kind) ? 1 : 0) || (a.level === 1 ? -1 : 1));
  const kn = cands[0];
  const kpos = freeNear(kn);
  await send(A, { t: 'debug', cmd: 'tp', x: kpos.x, z: kpos.z, level: kn.level });
  await sleep(1500);
  await send(A, { t: 'act', kind: 'knock', id: kn.id });
  await sleep(600);
  const wv = await A.evaluate(() => window.__game.debugState().waves);
  const expect = { vase: 'yellow', bottles: 'yellow', candelabrum: 'yellow', bucket: 'red', box: 'low' }[kn.kind];
  check('objeto caindo gera onda com o nível certo (' + kn.kind + ' → ' + expect + ')', wv.includes(expect), JSON.stringify(wv));
  await hq(A, 'medium');
  await A.evaluate(() => { window.__game.pushWave(window.__game.waves.length ? window.__game.waves[window.__game.waves.length - 1].lvl : 'yellow', true); });
  await shot(A, 'sound-wave.png', 300);
  await hq(A, 'low');
  // correr = passos ouvidos (onda baixa); agachar = silêncio
  await send(A, { t: 'debug', cmd: 'tp', x: ax, z: az, level: 1 });
  await A.evaluate(() => window.__game.setLook(-Math.PI / 2, 0));
  await sleep(2500);
  await A.evaluate(() => { window.__game.waves = []; });
  await A.keyboard.down('ShiftLeft'); await A.keyboard.down('KeyW'); await sleep(2500); await A.keyboard.up('KeyW'); await A.keyboard.up('ShiftLeft');
  const wRun = await A.evaluate(() => window.__game.debugState().waves);
  check('correndo: passos geram onda BAIXA', wRun.includes('low'), JSON.stringify(wRun));
  await send(A, { t: 'debug', cmd: 'tp', x: ax, z: az, level: 1 }); await sleep(2000);
  await A.evaluate(() => { window.__game.waves = []; });
  await A.keyboard.press('KeyC'); await A.keyboard.down('KeyW'); await sleep(2500); await A.keyboard.up('KeyW'); await A.keyboard.press('KeyC');
  const wCr = await A.evaluate(() => window.__game.debugState().waves);
  check('agachado: silêncio total (sem onda)', wCr.length === 0, JSON.stringify(wCr));
  await hq(A, 'low');
  // ---------- encontro com a criatura ----------
  await send(A, { t: 'debug', cmd: 'tp', x: ax, z: az, level: 1 });
  await send(A, { t: 'debug', cmd: 'creature', x: ax + 5.5, z: az, level: 1, yaw: -Math.PI / 2, state: 'freeze' });
  await send(B, { t: 'debug', cmd: 'tp', x: map.spawns[0].x, z: map.spawns[0].z, level: 1 });
  await A.evaluate(() => window.__game.setLook(-Math.PI / 2, 0.12));
  await sleep(3000);
  await hq(A, SHOTQ);
  await shot(A, 'creature-encounter.png', 4000);
  const crv = await A.evaluate(() => window.__game.cr.root.visible);
  check('criatura visível no encontro', crv);
  await hq(A, 'low');
  // ---------- morte de B ----------
  const pB = await A.evaluate(() => window.__game.lastSnap.players.find(p => p.id !== window.__app.myId));
  await send(A, { t: 'debug', cmd: 'creature', x: pB.x + 0.7, z: pB.z, level: pB.level, yaw: -Math.PI / 2, state: 'hold' });
  // B se mexe encostado nela (v2: o toque mata quem se mexe ou foi percebido; parado e despercebido, não)
  for (let i = 0; i < 6; i++) { await B.evaluate(() => { window.__game.p.x += 0.04; }); await sleep(120); }
  // estado no servidor (o servidor de jogo roda neste mesmo processo)
  const srvMatch = () => [...srv.manager.rooms.values()][0].match;
  const dumpSrv = (tag) => { const m = srvMatch(); const b = m.players.get(ids.B), c = m.creature; log(tag, JSON.stringify({ B: { x: b.x, z: b.z, y: b.y, level: b.level, alive: b.alive, conn: b.connected }, C: { x: c.x, z: c.z, y: c.y, level: c.level, state: c.state } })); };
  dumpSrv('antes da morte:');
  await sleep(1500);
  dumpSrv('após 1,5 s:');
  await B.waitForSelector('#death:not(.hidden)', { timeout: 120000 });
  check('tela de morte em B', (await B.$eval('#death h1', e => e.textContent)) === 'VOCÊ FOI ENCONTRADO');
  await shot(B, 'death.png', 2500);
  await A.waitForFunction((id) => window.__game.playersMeta.get(id).alive === false, { timeout: 30000 }, ids.B);
  check('A recebe a morte de B', true);
  await sleep(1500);
  const hp = await A.$eval('#hPlayers', e => e.innerText);
  const toastsA = await A.$eval('#toasts', e => e.innerText);
  check('morte do colega NÃO é anunciada (sem "morto" no HUD nem aviso com o nome)', !/morto/.test(hp) && !/Beto foi/.test(toastsA), hp.replace(/\n/g, ' | '));
  const ghosts = await A.evaluate(() => window.__game.debugState().ghosts);
  check('B morreu com chave → A vê o fantasminha através das paredes', ghosts.includes(ids.B), JSON.stringify(ghosts));
  await B.click('#btnSpectate');
  await sleep(4000);
  const specText = await B.$eval('#spec', e => e.textContent);
  check('B entra no modo espectador observando A', /observando Ana/.test(specText), specText);
  await shot(B, 'spectator.png', 3000);
  // ---------- vitória: A coloca 2 chaves, pega a de B no corpo, coloca a 3ª e sai andando ----------
  await send(A, { t: 'debug', cmd: 'creature', x: cs.x, z: cs.z, level: cs.level, state: 'hold' });
  const e = map.exit;
  await send(A, { t: 'debug', cmd: 'tp', x: e.x, z: e.z + 1.4, level: 1, yaw: 0 });
  await A.evaluate(() => window.__game.setLook(0, 0.05));
  await sleep(2500);
  tgt = await A.evaluate(() => window.__game.target && window.__game.target.text);
  check('prompt da saída: colocar 2 chaves', /Colocar 2 chaves na porta \(0\/3\)/.test(tgt || ''), tgt);
  if (/Colocar/.test(tgt || '')) await A.keyboard.press('KeyE'); else await send(A, { t: 'act', kind: 'exit', id: 0 });
  await A.waitForFunction(() => window.__game.deposited === 2, { timeout: 30000 });
  check('depósito em parcelas: 2/3 e porta ainda trancada', !(await A.evaluate(() => window.__game.exitOpen)));
  const bodyB = await A.evaluate(() => window.__game.lastSnap.players.find(p => p.id !== window.__app.myId));
  await send(A, { t: 'debug', cmd: 'tp', x: bodyB.x + 0.8, z: bodyB.z, level: bodyB.level });
  await sleep(2500);
  await aimAt(A, { x: bodyB.x, y: bodyB.y + 0.4, z: bodyB.z });
  await sleep(1500);
  const hp2 = await A.$eval('#hPlayers', el => el.innerText);
  check('achando o corpo, A fica sabendo da morte', /morto/.test(hp2), hp2.replace(/\n/g, ' | '));
  tgt = await A.evaluate(() => window.__game.target && window.__game.target.text);
  if (/Pegar as chaves/.test(tgt || '')) await A.keyboard.press('KeyE'); else await send(A, { t: 'act', kind: 'body', id: ids.B });
  await A.waitForFunction(() => window.__game.myKeys === 1, { timeout: 30000 });
  check('pegou a chave do corpo de B (fantasminha some)', !(await A.evaluate((id) => window.__game.debugState().ghosts.includes(id), ids.B)), tgt);
  await send(A, { t: 'debug', cmd: 'tp', x: e.x, z: e.z + 1.4, level: 1, yaw: 0 });
  await A.evaluate(() => window.__game.setLook(0, 0.05));
  await sleep(2500);
  tgt = await A.evaluate(() => window.__game.target && window.__game.target.text);
  check('prompt da saída: colocar a última chave', /Colocar 1 chave na porta \(2\/3\)/.test(tgt || ''), tgt);
  if (/Colocar/.test(tgt || '')) await A.keyboard.press('KeyE'); else await send(A, { t: 'act', kind: 'exit', id: 0 });
  await A.waitForFunction(() => window.__game.exitOpen, { timeout: 30000 });
  await B.waitForFunction(() => window.__game.exitOpen, { timeout: 30000 });
  check('saída aberta sincronizada', true);
  await sleep(3000);
  await A.keyboard.down('KeyW');
  await A.waitForFunction(() => window.__game.p.escaped || window.__game.ended, { timeout: 240000, polling: 1000 });
  await A.keyboard.up('KeyW');
  await A.waitForSelector('#end:not(.hidden)', { timeout: 60000 });
  await B.waitForSelector('#end:not(.hidden)', { timeout: 60000 });
  check('tela de vitória em A', (await A.$eval('#endTitle', e => e.textContent)) === 'VOCÊS CONSEGUIRAM ESCAPAR');
  check('tela de vitória em B (morto, mas a equipe venceu)', (await B.$eval('#endTitle', e => e.textContent)) === 'VOCÊS CONSEGUIRAM ESCAPAR');
  await shot(A, 'victory.png', 2500);
  const st = await A.evaluate(() => JSON.parse(localStorage.getItem('nsm_stats')));
  check('estatísticas salvas no localStorage', st.wins >= 1 && st.started >= 1, JSON.stringify(st));
  // ---------- diagnóstico ----------
  const rcA = await A.evaluate(() => window.__rc), rcB = await B.evaluate(() => window.__rc);
  const hostIsA = await A.evaluate(() => window.__app.room && window.__app.room.hostId === window.__app.myId);
  log('reconexões durante a partida: A=' + rcA + ' B=' + rcB + ' · anfitrião é A? ' + hostIsA);
  check('nenhuma queda de conexão durante a partida', rcA === 0 && rcB === 0, `A=${rcA} B=${rcB}`);
  if (hostIsA) await A.click('#btnAgain'); else await B.click('#btnAgain');
  await A.waitForFunction((s) => window.__game && window.__game.seed !== s && window.__game.lastSnap, { timeout: 240000, polling: 1000 }, seedA);
  check('reinício gera nova semente', (await A.evaluate(() => window.__game.seed)) !== seedA);
  await sleep(6000);
  await A.evaluate(() => { window.__app.noRender = true; });
  await shot(A, 'diagnostics-panel.png', 3000);
  const diagText = await A.$eval('#diagText', e => e.textContent);
  check('painel de diagnóstico mostra criatura, sentidos e semente', /Criatura:/.test(diagText) && /Sentidos:/.test(diagText) && /Semente:/.test(diagText), diagText.split('\n').slice(0, 3).join(' | '));
  // limite de 3 jogadores (clientes WebSocket diretos numa sala nova)
  {
    const { default: WS } = await import('ws');
    const open = () => new Promise((res) => { const w = new WS(`ws://localhost:${srv.port}/ws`); const c = { w, msgs: [] }; w.on('message', d => c.msgs.push(JSON.parse(d))); w.on('open', () => res(c)); });
    const wait = async (c, f) => { for (let i = 0; i < 100; i++) { const m = c.msgs.find(f); if (m) return m; await sleep(30); } return null; };
    const cl = []; for (let i = 0; i < 4; i++) cl.push(await open());
    cl[0].w.send(JSON.stringify({ t: 'create', name: 'X0' })); const j = await wait(cl[0], m => m.t === 'joined');
    for (let i = 1; i < 4; i++) cl[i].w.send(JSON.stringify({ t: 'join', code: j.code, name: 'X' + i }));
    const ok2 = await wait(cl[2], m => m.t === 'joined'), err4 = await wait(cl[3], m => m.t === 'error');
    check('sala aceita 3 jogadores e recusa o 4º', !!ok2 && !!err4 && /máximo 3/.test(err4.msg), err4 && err4.msg);
    for (const c of cl) c.w.close();
  }
  // mapa gerado na aba TESTAR JOGO
  const C = await newPage(browser, `${base}/testar?e2e=1`, (...a) => errors.push('C ' + a.join(' ')));
  await C.waitForSelector('#testar.on');
  await C.type('#tSeed', 'casarao-e2e');
  await C.click('#tGen');
  await C.waitForFunction(() => /Validação: OK/.test(document.querySelector('#tGenOut').textContent), { timeout: 30000 });
  check('TESTAR JOGO: gerar e validar mansão', true);
  const el = await C.$('#tMap');
  await el.screenshot({ path: path.join(SHOTS, 'diagnostics-map.png') });
  await C.close();
} catch (err) {
  check('execução sem exceções', false, err.stack.split('\n').slice(0, 3).join(' '));
  try { if (A) await A.screenshot({ path: path.join(SHOTS, 'e2e-fail-A.png') }); if (B) await B.screenshot({ path: path.join(SHOTS, 'e2e-fail-B.png') }); } catch { }
}
const pageErrors = errors.filter(e => /pageerror/.test(e));
check('nenhum erro de página (exceção JS)', pageErrors.length === 0, pageErrors.slice(0, 3).join(' / '));
await browser.close(); await srv.close();
const pass = results.filter(r => r.ok).length, fail = results.length - pass;
fs.writeFileSync(path.join(SHOTS, 'e2e-results.json'), JSON.stringify({ pass, fail, results, seconds: (Date.now() - t0) / 1000 }, null, 2));
log(`E2E: ${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
