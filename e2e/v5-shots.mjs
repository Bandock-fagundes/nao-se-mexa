// v5: lareira acesa e janela de verdade. Base: v3-shots.mjs.
// v3 (jam): capturas de revisão visual no jogo de verdade (Chrome headless, WebGL por software).
// Guarda-roupa aberto com roupas, guarda-roupa da chave (vazio + ganchinho), chave com brilho dourado,
// cômoda (gaveta grande), cômodos, mapa dos andares e a cena "acordando".
// Uso: node e2e/v3-shots.mjs [pasta-de-saída]   (padrão: shots/)
import fs from 'node:fs';
import path from 'node:path';
import { createGameServer } from '../server/index.js';
import { generateMansion } from '../shared/mapgen.js';
import { launch, newPage, sleep } from './launch.mjs';

const OUT = path.resolve(process.argv[2] || 'shots');
fs.mkdirSync(OUT, { recursive: true });
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const want = (k) => !only || only.includes(k);
const SEED = process.env.SEED || 'jam-v3-7';
const srv = await createGameServer({ port: 0 });
const base = `http://localhost:${srv.port}`;
const browser = await launch();
const log = (...a) => console.log('[v3-shots]', ...a);
const CELL = 0.5;
async function shot(pg, file, wait = 1800) {
  await pg.evaluate(() => { window.__app.noRender = false; });
  if (process.env.PRE_EVAL) await pg.evaluate(process.env.PRE_EVAL); // depuração (ex.: desligar o recorte por frustum)
  await sleep(wait);
  await pg.screenshot({ path: path.join(OUT, file) });
  log('captura', file);
}
const send = (pg, m) => pg.evaluate((m) => window.__app.net.send(m), m);
// posiciona o jogador num ponto e olha para (tx, ty, tz)
async function stand(pg, x, z, level, tx, ty, tz, crouch = false) {
  await send(pg, { t: 'debug', cmd: 'tp', x, z, level });
  await sleep(300);
  await pg.evaluate(({ x, z, level, tx, ty, tz, crouch }) => {
    const g = window.__game; g.teleport(x, z, level);
    const eyeY = (crouch ? 1.0 : 1.62) + [-3.6, 0, 3.8, 7.6][level];
    const yaw = Math.atan2(-(tx - x), -(tz - z)), pitch = Math.atan2(ty + [-3.6, 0, 3.8, 7.6][level] - eyeY, Math.hypot(tx - x, tz - z));
    g.setLook(yaw, pitch); g.scriptCrouch = crouch;
  }, { x, z, level, tx, ty, tz, crouch });
  await sleep(400);
}

try {
  const map = generateMansion(SEED, { size: 1 });
  const pg = await newPage(browser, `${base}/testar?e2e=1&quality=${process.env.Q || 'medium'}${process.env.EXTRA || ''}`, (...a) => log('page', ...a), 1280, 720);
  await pg.waitForSelector('#testar.on');
  await pg.$eval('#tSeed', (e, s) => { e.value = s; }, SEED);
  await pg.evaluate(() => { document.querySelector('#tDiag').checked = false; });
  await pg.click('#tSolo');
  await pg.waitForFunction('window.__game && window.__game.lastSnap', { timeout: 240000, polling: 500 });
  await pg.evaluate(() => { window.__app.noRender = true; });
  const att = map.rooms.find(r => r.level === 3 && r.type === 'attic');
  await send(pg, { t: 'debug', cmd: 'creature', x: (att.x0 + 2) * CELL, z: (att.z0 + 2) * CELL, level: 3, state: 'freeze' });
  const free = (L, x, z) => { const t = map.levels[L].grid[Math.floor(z / CELL) * 84 + Math.floor(x / CELL)]; return t === 1; };
  const fl = (on) => pg.evaluate((on) => { window.__game.p.fl = on; }, on);
  // ---------- lareira ----------
  const fps = map.props.filter(p => p.kind === 'fireplace');
  log('lareiras', fps.length);
  const fp = fps.find(p => { const d = [[0, 1], [1, 0], [0, -1], [-1, 0]][p.facing]; return free(p.level, p.x + d[0] * 2.2, p.z + d[1] * 2.2); }) || fps[0];
  if (fp && want('fire')) {
    const d = [[0, 1], [1, 0], [0, -1], [-1, 0]][fp.facing];
    const DIST = +(process.env.FD || 2.0);
    await stand(pg, fp.x + d[0] * DIST, fp.z + d[1] * DIST, fp.level, fp.x, 0.55, fp.z, true);
    await fl(false); await shot(pg, 'lareira.png', 2500);
    await fl(true); await shot(pg, 'lareira-lanterna.png', 1500);
    await stand(pg, fp.x + d[0] * 1.1, fp.z + d[1] * 1.1, fp.level, fp.x, 0.3, fp.z, true);
    await fl(false); await shot(pg, 'lareira-perto.png', 1500); await fl(true);
  }
  // ---------- janela ----------
  const wins = map.windows.filter(w => w.level === 1 && !w.small && !w.curtain);
  const wn = wins.find(w => free(w.level, w.x + Math.sin(w.rot) * 1.7, w.z + Math.cos(w.rot) * 1.7)) || wins[0];
  if (wn && want('window')) {
    const nx = Math.sin(wn.rot), nz = Math.cos(wn.rot), tx = Math.cos(wn.rot), tz = -Math.sin(wn.rot);
    await stand(pg, wn.x + nx * 1.7, wn.z + nz * 1.7, wn.level, wn.x, 1.6, wn.z);
    await fl(false); await shot(pg, 'janela.png', 2500);
    await fl(true); await shot(pg, 'janela-lanterna.png', 1500);
    await stand(pg, wn.x + nx * 1.3 + tx * 1.0, wn.z + nz * 1.3 + tz * 1.0, wn.level, wn.x, 1.55, wn.z);
    await fl(false); await shot(pg, 'janela-lado.png', 1500);
    await stand(pg, wn.x + nx * 3.4 + tx * 0.8, wn.z + nz * 3.4 + tz * 0.8, wn.level, wn.x + nx * 1.2, 0.0, wn.z + nz * 1.2);
    await shot(pg, 'janela-luar-piso.png', 1500); await fl(true);
  }
  // ---------- sala: lareira em 3/4, a uns 4 m ----------
  if (fp && want('room')) {
    const d = [[0, 1], [1, 0], [0, -1], [-1, 0]][fp.facing], t = [d[1], -d[0]];
    let best = null;
    for (const [k, l] of [[4, 1.8], [4, -1.8], [3.5, 1.5], [3.5, -1.5], [3, 1.2], [3, -1.2], [4.5, 0], [3, 0]]) {
      const x = fp.x + d[0] * k + t[0] * l, z = fp.z + d[1] * k + t[1] * l; const rid = map.levels[fp.level].room[Math.floor(z / CELL) * 84 + Math.floor(x / CELL)];
      if (free(fp.level, x, z) && rid === fp.room) { best = { x, z }; break; }
    }
    log('sala: ponto', JSON.stringify(best), 'lareira', fp.x, fp.z, fp.facing);
    if (best) { await stand(pg, best.x, best.z, fp.level, fp.x, 0.8, fp.z); await fl(false); await shot(pg, 'sala-lareira.png', 2500); await fl(true); await shot(pg, 'sala-lareira-lanterna.png', 1500); }
  }
  const info = await pg.evaluate(() => { const R = window.__game.R.renderer.info; return { calls: R.render.calls, tris: R.render.triangles, geos: R.memory.geometries }; });
  log('render info', JSON.stringify(info));
  await pg.close();
} catch (e) { console.error(e); process.exitCode = 1; }
await browser.close(); await srv.close();
