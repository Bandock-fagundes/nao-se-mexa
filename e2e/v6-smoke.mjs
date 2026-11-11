// v6: fumaça do jogo de verdade — sobe a partida solo, confere erros de página, faz a criatura agarrar o jogador
// e captura a morte em primeira pessoa (agarrão + queda). Uso: node e2e/v6-smoke.mjs [pasta]
import fs from 'node:fs'; import path from 'node:path';
import { createGameServer } from '../server/index.js';
import { generateMansion } from '../shared/mapgen.js';
import { launch, newPage, sleep } from './launch.mjs';
const OUT = path.resolve(process.argv[2] || 'shots/v6'); fs.mkdirSync(OUT, { recursive: true });
const SEED = 'jam-v3-7';
const srv = await createGameServer({ port: 0 });
const browser = await launch();
const errs = [];
const log = (...a) => { console.log('[v6]', ...a); if (String(a[0]).includes('pageerror')) errs.push(a.join(' ')); };
try {
  const pg = await newPage(browser, `http://localhost:${srv.port}/testar?e2e=1&quality=medium`, (...a) => log('page', ...a), 960, 540);
  await pg.waitForSelector('#testar.on');
  await pg.$eval('#tSeed', (e, s) => { e.value = s; }, SEED);
  await pg.evaluate(() => { const d = document.querySelector('#tDiag'); if (d) d.checked = false; });
  await pg.click('#tSolo');
  await pg.waitForFunction('window.__game && window.__game.lastSnap && !window.__game.frozen', { timeout: 300000, polling: 500 });
  log('partida no ar');
  await sleep(1500);
  await pg.screenshot({ path: path.join(OUT, 'smoke-start.png') });
  // criatura 1,6 m à frente do jogador; o jogador anda para ela → contato → morte com agarrão
  const pos = await pg.evaluate(() => { const g = window.__game, p = g.p; return { x: p.x, z: p.z, level: p.level, yaw: p.yaw }; });
  const fx = -Math.sin(pos.yaw), fz = -Math.cos(pos.yaw);
  await pg.evaluate((m) => window.__app.net.send(m), { t: 'debug', cmd: 'creature', x: pos.x + fx * 1.7, z: pos.z + fz * 1.7, level: pos.level, yaw: Math.atan2(-fx, -fz) });
  await sleep(600);
  await pg.evaluate(() => { const g = window.__game; g.scripted = { f: 1, s: 0 }; });
  await pg.waitForFunction('!window.__game.p.alive', { timeout: 15000, polling: 100 }).catch(() => log('não morreu'));
  await pg.evaluate(() => { window.__game.scripted = { f: 0, s: 0 }; });
  for (const [ms, n] of [[350, 'a'], [600, 'b'], [700, 'c'], [700, 'd']]) { await sleep(ms); await pg.screenshot({ path: path.join(OUT, `smoke-death-${n}.png`) }); }
  const st = await pg.evaluate(() => ({ alive: window.__game.p.alive, grab: !!window.__game.deathGrab, crAnim: window.__game.crState && window.__game.crState.anim }));
  log('estado', JSON.stringify(st));
} catch (e) { log('ERRO', e.message); }
log('erros de página:', errs.length);
await browser.close(); await srv.close();
