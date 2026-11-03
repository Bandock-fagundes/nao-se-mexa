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
  check('botão iniciar bloqueado até todos ficarem prontos', await A.$eval('#btnStart', b => b.disabled));
  await B.evaluate(() => { window.__app.diagOn = false; });
  await B.click('#btnReady');
  await A.waitForFunction(() => !document.querySelector('#btnStart').disabled, { timeout: 15000 });
  await A.screenshot({ path: path.join(SHOTS, 'lobby.png') });
  await A.click('#btnStart');
  await A.waitForFunction('window.__game && window.__game.lastSnap', { timeout: 240000, polling: 1000 });
  await B.waitForFunction('window.__game && window.__game.lastSnap', { timeout: 240000, polling: 1000 });
  log('partida iniciada nas duas páginas');
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
  // lanterna desligada (tecla F)
  await A.keyboard.press('KeyF');
  await sleep(5000);
  check('tecla F desliga a lanterna', (await A.evaluate(() => window.__game.p.fl)) === false);
  await shot(A, 'hallway-flashlight-off.png', 4000);
  await A.keyboard.press('KeyF');
  await sleep(1500);
  const ext = await A.evaluate(() => window.__app.net.ping);
  log('ping', ext);
  // sincronização da lanterna do colega
  const bfl = await A.evaluate(() => window.__game.lastSnap.players.find(p => p.id !== window.__app.myId).fl);
  check('estado da lanterna do colega sincronizado', bfl === true);
  await hq(A, 'low');
  // ---------- interação real com tecla E: porta mais próxima ----------
  const keys = await A.evaluate(() => new Promise(res => { const net = window.__app.net; const h = (m) => { if (m.keys) { res(m.keys); } }; net.on('dres', h); net.send({ t: 'debug', cmd: 'keys' }); }));
  const k = keys[0];
  const kc = map.containers[k.id];
  await send(A, { t: 'debug', cmd: 'tp', x: k.ax, z: k.az, level: k.level });
  await sleep(2500);
  // mira no esconderijo e usa E
  await A.evaluate((c) => { const g = window.__game; const dx = c.x - g.p.x, dz = c.z - g.p.z; g.setLook(Math.atan2(-dx, -dz), -0.45); }, kc);
  await sleep(2500);
  let tgt = await A.evaluate(() => window.__game.target && window.__game.target.text);
  log('alvo de interação:', tgt);
  if (!tgt || !/Abrir|Pegar/.test(tgt)) { for (const p of [-0.75, -0.25, -0.95]) { await A.evaluate((p) => window.__game.setLook(window.__game.p.yaw, p), p); await sleep(2000); tgt = await A.evaluate(() => window.__game.target && window.__game.target.text); if (tgt && /Abrir|Pegar/.test(tgt)) break; } }
  check('prompt de interação aparece ao mirar no esconderijo', !!tgt && /Abrir|Pegar/.test(tgt), tgt);
  if (tgt && /Abrir/.test(tgt)) { await A.keyboard.press('KeyE'); await sleep(2500); }
  else await send(A, { t: 'act', kind: 'container', id: k.id });
  await A.waitForFunction((id) => window.__game.view.containers[id].keyShown, { timeout: 30000 }, k.id);
  await sleep(2500);
  await hq(A, 'medium');
  await shot(A, 'key-revealed.png', 3000);
  tgt = await A.evaluate(() => window.__game.target && window.__game.target.text);
  if (tgt === '[E] Pegar chave') await A.keyboard.press('KeyE'); else await send(A, { t: 'act', kind: 'key', id: k.id });
  await A.waitForFunction(() => window.__game.keys === 1, { timeout: 30000 });
  await B.waitForFunction(() => window.__game.keys === 1, { timeout: 30000 });
  check('chave coletada em A aparece em B', true);
  await sleep(1200);
  await shot(A, 'hud.png', 3000);
  const hudText = await A.$eval('#hudTL', e => e.innerText);
  check('HUD mostra fase, chaves e objetivo', /FASE 1 — A CRIATURA VÊ/.test(hudText) && /Chaves encontradas: 1\/1/.test(hudText) && /Objetivo/.test(hudText), hudText.replace(/\n/g, ' | '));
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
  await B.click('#btnSpectate');
  await sleep(4000);
  const specText = await B.$eval('#spec', e => e.textContent);
  check('B entra no modo espectador observando A', /observando Ana/.test(specText), specText);
  await shot(B, 'spectator.png', 3000);
  // ---------- vitória: A destranca a saída e sai andando (teclado) ----------
  await send(A, { t: 'debug', cmd: 'creature', x: cs.x, z: cs.z, level: cs.level, state: 'hold' });
  const e = map.exit;
  await send(A, { t: 'debug', cmd: 'tp', x: e.x, z: e.z + 1.4, level: 1, yaw: 0 });
  await A.evaluate(() => window.__game.setLook(0, 0.05));
  await sleep(2500);
  tgt = await A.evaluate(() => window.__game.target && window.__game.target.text);
  check('prompt da saída', tgt === '[E] Destrancar a saída', tgt);
  if (tgt === '[E] Destrancar a saída') await A.keyboard.press('KeyE'); else await send(A, { t: 'act', kind: 'exit', id: 0 });
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
  await A.click('#btnAgain');
  await A.waitForFunction((s) => window.__game && window.__game.seed !== s && window.__game.lastSnap, { timeout: 240000, polling: 1000 }, seedA);
  check('reinício gera nova semente', (await A.evaluate(() => window.__game.seed)) !== seedA);
  await sleep(6000);
  await A.evaluate(() => { window.__app.noRender = true; });
  await shot(A, 'diagnostics-panel.png', 3000);
  const diagText = await A.$eval('#diagText', e => e.textContent);
  check('painel de diagnóstico mostra criatura, sentidos e semente', /Criatura:/.test(diagText) && /Sentidos:/.test(diagText) && /Semente:/.test(diagText), diagText.split('\n').slice(0, 3).join(' | '));
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
