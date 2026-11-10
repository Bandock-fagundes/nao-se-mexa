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
  // mapa dos 4 andares (gerador da aba TESTAR JOGO)
  if (want('map')) {
    await pg.$eval('#tSeed', (e, s) => { e.value = s; }, SEED);
    await pg.click('#tGen'); await sleep(800);
    const el = await pg.$('#tMap'); await el.screenshot({ path: path.join(OUT, 'map-floors.png') }); log('captura map-floors.png');
  }
  await pg.$eval('#tSeed', (e, s) => { e.value = s; }, SEED);
  await pg.evaluate(() => { document.querySelector('#tDiag').checked = false; });
  await pg.click('#tSolo');
  await pg.waitForFunction('window.__game && window.__game.lastSnap', { timeout: 240000, polling: 500 });
  await pg.evaluate(() => { window.__app.noRender = true; });
  // criatura congelada longe (no sótão) para não atrapalhar
  const att = map.rooms.find(r => r.level === 3 && r.type === 'attic');
  await send(pg, { t: 'debug', cmd: 'creature', x: (att.x0 + 2) * CELL, z: (att.z0 + 2) * CELL, level: 3, state: 'freeze' });
  const hashOk = await pg.evaluate(() => window.__game.hashOk);
  log('hash ok:', hashOk, 'tamanho', await pg.evaluate(() => window.__game.map.size));
  // ponto de acesso diante de um móvel (2 células à frente da face)
  const front = (p, dist = 1.6) => {
    const dir = [[0, 1], [1, 0], [0, -1], [-1, 0]][p.facing];
    return { x: p.x + dir[0] * dist, z: p.z + dir[1] * dist };
  };
  const free = (L, x, z) => { const t = map.levels[L].grid[Math.floor(z / CELL) * 84 + Math.floor(x / CELL)]; return t === 1; };
  const pickProp = (kinds, extra = () => true) => map.props.find(p => kinds.includes(p.kind) && p.container !== undefined && p.level >= 1 && p.level <= 2 && extra(p) && free(p.level, front(p).x, front(p).z));
  // ---------- hall e escadaria ----------
  if (want('hall')) {
    const s = map.spawns[0];
    await stand(pg, s.x, s.z + 0.5, 1, s.x, 1.9, s.z + 12);
    await shot(pg, 'hall-escadaria.png', 2500);
  }
  // ---------- guarda-roupa aberto com roupas ----------
  if (want('wardrobe')) {
    const w = pickProp(['wardrobe', 'cabinet']);
    const c = map.containers[w.container], f = front(w, 1.35);
    await stand(pg, f.x, f.z, w.level, w.x, 1.25, w.z);
    await pg.evaluate((cid) => { const v = window.__game.view.containers[cid]; v.parts[0].open = true; }, c.id);
    await shot(pg, 'guarda-roupa-roupas.png', 2600);
    await pg.evaluate((cid) => { const v = window.__game.view.containers[cid]; v.parts[0].open = false; }, c.id);
  }
  // ---------- guarda-roupa da chave: vazio, chave no ganchinho ----------
  if (want('keywardrobe')) {
    const used = await pg.evaluate(() => window.__game.keyViews.filter(Boolean).map(k => k.spot.c));
    const w = pickProp(['wardrobe', 'oldwardrobe', 'cabinet'], (p) => !used.includes(p.container) && p.id !== (pickProp(['wardrobe', 'cabinet']) || {}).id);
    const c = map.containers[w.container], f = front(w, 1.1);
    await pg.evaluate((cid) => { const g = window.__game; g.setupKey({ id: 90, spot: { type: 'part', c: cid, part: 0 }, state: 'placed' }); g.view.containers[cid].parts[0].open = true; }, c.id);
    await stand(pg, f.x, f.z, w.level, w.x, 1.33, w.z);
    await shot(pg, 'guarda-roupa-chave-gancho.png', 2600);
  }
  // ---------- chave sobre a mesa com brilho dourado ----------
  if (want('keyglow')) {
    const sf = map.surfaces.find(s => s.level === 1 && ['side_table', 'console', 'desk', 'reading_table', 'nightstand'].includes(s.kind)) || map.surfaces[0];
    await pg.evaluate((sid) => { window.__game.setupKey({ id: 91, spot: { type: 'surface', s: sid }, state: 'placed' }); }, sf.id);
    const dx = sf.ax - sf.x, dz = sf.az - sf.z, d = Math.hypot(dx, dz) || 1;
    await stand(pg, sf.x + dx / d * 1.3, sf.z + dz / d * 1.3, sf.level, sf.x, sf.y - [-3.6, 0, 3.8, 7.6][sf.level], sf.z);
    await shot(pg, 'chave-brilho-dourado.png', 2200);
    await stand(pg, sf.x + dx / d * 3.6, sf.z + dz / d * 3.6, sf.level, sf.x, sf.y - [-3.6, 0, 3.8, 7.6][sf.level], sf.z);
    await shot(pg, 'chave-brilho-longe.png', 2000);
  }
  // ---------- cômoda: gaveta grande aberta ----------
  if (want('dresser')) {
    const dr = pickProp(['dresser']);
    if (dr) {
      const c = map.containers[dr.container], f = front(dr, 1.3);
      await stand(pg, f.x, f.z, dr.level, dr.x, 0.55, dr.z);
      await pg.evaluate((cid) => { window.__game.view.containers[cid].parts[0].open = true; }, c.id);
      await shot(pg, 'comoda-gaveta-grande.png', 2400);
    } else log('sem cômoda nesta casa');
  }
  // ---------- cômodos ----------
  if (want('rooms')) {
    const views = [['ballroom', 'salao-de-baile.png'], ['library', 'biblioteca.png'], ['dining', 'sala-de-jantar.png'], ['kitchen', 'cozinha-tijolo.png'], ['master', 'suite-principal.png'], ['gallery', 'galeria-2andar.png'], ['chapel', 'capela.png'], ['living', 'sala-de-estar.png']];
    let n = 0;
    for (const [type, file] of views) {
      const r = map.rooms.find(q => q.type === type); if (!r || n >= 6) continue;
      // de um canto livre olhando para o canto oposto
      let best = null;
      for (const [cx, cz, ox, oz] of [[r.x0 + 1, r.z0 + 1, r.x1, r.z1], [r.x1 - 1, r.z1 - 1, r.x0, r.z0], [r.x0 + 1, r.z1 - 1, r.x1, r.z0], [r.x1 - 1, r.z0 + 1, r.x0, r.z1]]) {
        for (let k = 0; k < 4 && !best; k++) { const x = (cx + (ox > cx ? k : -k) + 0.5) * CELL, z = (cz + (oz > cz ? k : -k) + 0.5) * CELL; if (free(r.level, x, z)) best = { x, z, tx: (ox + 0.5) * CELL, tz: (oz + 0.5) * CELL }; }
        if (best) break;
      }
      if (!best) continue;
      await stand(pg, best.x, best.z, r.level, (best.tx + (r.x0 + r.x1) * CELL / 2) / 2, 1.3, (best.tz + (r.z0 + r.z1) * CELL / 2) / 2);
      await shot(pg, file, 2200); n++;
    }
  }
  await pg.close();
  // ---------- cena "acordando" (partida normal, fora da aba de testes) ----------
  if (want('wake')) {
    const pw = await newPage(browser, `${base}/?e2e=1&quality=${process.env.Q || 'medium'}`, (...a) => log('wake', ...a), 1280, 720);
    await pw.waitForSelector('#menu.on');
    await pw.click('[data-go=mode]'); await pw.waitForSelector('#mode.on');
    await pw.screenshot({ path: path.join(OUT, 'tela-modo-sem-fase.png') }); log('captura tela-modo-sem-fase.png');
    await pw.$eval('#name', e => { e.value = 'Ana'; });
    await pw.click('#btnSolo');
    await pw.waitForFunction('window.__game && window.__app.wake && window.__app.wake.playing', { timeout: 240000, polling: 100 });
    const t0 = Date.now();
    for (const [at, file] of [[0.9, 'acordando-1-texto.png'], [3.6, 'acordando-2-palpebras.png'], [5.3, 'acordando-3-abrindo.png']]) {
      const left = at * 1000 - (Date.now() - t0); if (left > 0) await sleep(left);
      await pw.screenshot({ path: path.join(OUT, file) }); log('captura', file);
    }
    // ninguém se mexe durante a cena: a criatura fica parada e o jogador não anda
    const st = await pw.evaluate(() => ({ frozen: window.__game.frozen, cr: window.__game.lastSnap && window.__game.lastSnap.creature }));
    log('durante a cena:', JSON.stringify({ frozen: st.frozen, creature: st.cr && st.cr.state }));
    await pw.waitForFunction('!window.__game.frozen', { timeout: 30000, polling: 200 });
    await sleep(1500);
    await pw.screenshot({ path: path.join(OUT, 'acordando-4-jogo.png') }); log('captura acordando-4-jogo.png');
    await pw.close();
  }
} catch (e) { console.error(e); process.exitCode = 1; }
await browser.close(); await srv.close();
