// v9b: capturas de checagem (baixa resolução, poucas): teto do poço de escada, telhado do sótão, cômodo escuro sem
// lanterna, facho da lanterna. Uso: DIST=work/v9dist node e2e/v9b-shots.mjs <pasta> (ONLY=stair,roof,dark,beam)
import fs from 'node:fs';
import path from 'node:path';
import { createGameServer } from '../server/index.js';
import { generateMansion } from '../shared/mapgen.js';
import { launch, newPage, sleep } from './launch.mjs';

const OUT = path.resolve(process.argv[2] || '/workspace/work/v9b');
fs.mkdirSync(OUT, { recursive: true });
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const want = (k) => !only || only.includes(k);
const SEED = process.env.SEED || 'jam-v3-7';
const PFX = process.env.PFX || '';
const srv = await createGameServer({ port: 0, dist: path.resolve(process.env.DIST || 'dist') });
const browser = await launch();
const log = (...a) => console.log('[v9b]', ...a);
const CELL = 0.5, LY = [-3.6, 0, 3.8, 7.6];
const send = (pg, m) => pg.evaluate((m) => window.__app.net.send(m), m);
async function shot(pg, file, wait = 1500) {
  await pg.evaluate(() => { window.__app.noRender = false; for (const id of ['hudTL', 'hudTR', 'wave', 'hudB', 'toasts', 'prompt']) { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; } });
  await sleep(wait);
  await pg.screenshot({ path: path.join(OUT, PFX + file) }); log('captura', PFX + file);
  await pg.evaluate(() => { window.__app.noRender = true; });
}
async function stand(pg, x, z, level, tx, ty, tz) {
  await send(pg, { t: 'debug', cmd: 'tp', x, z, level }); await sleep(300);
  await pg.evaluate(({ x, z, level, tx, ty, tz, LY }) => {
    const g = window.__game; g.teleport(x, z, level);
    const eyeY = 1.62 + LY[level];
    g.setLook(Math.atan2(-(tx - x), -(tz - z)), Math.atan2(ty + LY[level] - eyeY, Math.hypot(tx - x, tz - z))); g.scriptCrouch = false;
  }, { x, z, level, tx, ty, tz, LY });
  await sleep(300);
}
try {
  const map = generateMansion(SEED, { size: 1 });
  const pg = await newPage(browser, `${srv.url || 'http://localhost:' + srv.port}/testar?e2e=1&quality=${process.env.Q || 'medium'}`, (...a) => log('page', ...a), 640, 360);
  await pg.waitForSelector('#testar.on');
  await pg.$eval('#tSeed', (e, s) => { e.value = s; }, SEED);
  await pg.evaluate(() => { document.querySelector('#tDiag').checked = false; });
  await pg.click('#tSolo');
  await pg.waitForFunction('window.__game && window.__game.lastSnap', { timeout: 240000, polling: 500 });
  await pg.evaluate(() => { window.__app.noRender = true; });
  const far = map.rooms.find(r => r.level === 0 && r.type !== 'stairs');
  await send(pg, { t: 'debug', cmd: 'creature', x: (far.x0 + 2) * CELL, z: (far.z0 + 2) * CELL, level: 0, state: 'freeze' });
  const fl = (on) => pg.evaluate((on) => { window.__game.p.fl = on; }, on);
  if (want('stair')) { // escada de serviço térreo→2º: pé da rampa olhando o poço; e do 2º andar olhando o vão
    const s = map.stairs.find(s => s.lower === 1 && !s.grand), dir = s.dir;
    const cx = (s.x0 + 1.5) * CELL, slotC = (s.slotX + 3.5) * CELL;
    const botZ = dir === 1 ? Math.min(s.zTop, s.zBot) * CELL : (Math.max(s.zTop, s.zBot) + 1) * CELL;
    const topZ = dir === 1 ? (Math.max(s.zTop, s.zBot) + 1) * CELL : Math.min(s.zTop, s.zBot) * CELL;
    await stand(pg, (s.walk0 + 1.5) * CELL, botZ - dir * 0.4, 1, cx, 6.0, (botZ + topZ) / 2);
    await fl(true); await shot(pg, 'teto-poco-escada.png');
    await stand(pg, slotC, topZ + dir * 0.3, 2, slotC, 3.0, topZ - dir * 4.5);
    await shot(pg, 'teto-vao-2andar.png');
  }
  if (want('roof')) {
    const a = map.rooms.filter(r => r.level === 3 && r.type === 'attic').sort((p, q) => (q.x1 - q.x0) * (q.z1 - q.z0) - (p.x1 - p.x0) * (p.z1 - p.z0))[0];
    const cx = (a.x0 + a.x1 + 1) / 2 * CELL, cz = (a.z0 + a.z1 + 1) / 2 * CELL;
    await stand(pg, cx, a.z0 * CELL + 1.0, 3, cx, 3.6, 12.5);
    await fl(true); await shot(pg, 'telhado-sotao.png');
  }
  if (want('dark') || want('beam')) {
    const r = map.rooms.filter(r => r.level === 1 && ['living', 'dining', 'study', 'library', 'bedroom'].includes(r.type))[0];
    const cx = (r.x0 + r.x1 + 1) / 2 * CELL, cz = (r.z0 + r.z1 + 1) / 2 * CELL;
    const x0 = (r.x0 + 1.5) * CELL, z0 = (r.z0 + 1.5) * CELL;
    await stand(pg, x0, z0, 1, cx + (cx - x0), 1.0, cz + (cz - z0));
    if (want('dark')) { await fl(false); await shot(pg, 'comodo-escuro-sem-lanterna.png', 2000); }
    if (want('beam')) { await fl(true); await shot(pg, 'lanterna-facho.png'); }
  }
} catch (e) { log('ERRO', e.message); }
await browser.close(); srv.close?.(); process.exit(0);
