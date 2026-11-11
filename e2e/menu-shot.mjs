// v8: capturas do MENU INICIAL (fundo 3D): desktop 1280×720, celular 390×844 e quadros para um vídeo de ~10 s.
// Uso: node e2e/menu-shot.mjs <pasta> [frames]   (frames = 0 pula o vídeo)
import fs from 'node:fs';
import { createGameServer } from '../server/index.js';
import { launch, sleep, newPage } from './launch.mjs';
const out = process.argv[2] || 'shots/v8'; fs.mkdirSync(out, { recursive: true });
const N = +(process.argv[3] ?? 300);
const srv = await createGameServer({ port: 0 });
let b = await launch();
const url = `http://localhost:${srv.port}/?menu3d=1&intro=0`;
const errs = []; const log = (...a) => { errs.push(a.join(' ')); console.log(...a); };
async function open(w, h, dsf = 1, manual = true) {
  const pg = await b.newPage();
  pg.on('pageerror', e => log('[pageerror]', e.message));
  pg.on('console', m => { if (m.type() === 'error' || m.type() === 'warning' || m.text().startsWith('[menu]')) log('[console]', m.text().slice(0, 300)); });
  await pg.setViewport({ width: w, height: h, deviceScaleFactor: dsf });
  await pg.evaluateOnNewDocument((man) => { window.__menuManual = man; }, manual);
  await pg.goto(url);
  await pg.waitForFunction(() => window.__menuStep, { timeout: 90000 });
  return pg;
}
const step = (pg, n, dt = 1 / 30) => pg.evaluate((n, dt) => { for (let i = 0; i < n; i++) window.__menuStep(dt); }, n, dt);
// desktop (ONLY=phone pula)
let pg;
if (process.env.ONLY !== 'phone') {
pg = await open(1280, 720);
await step(pg, 1); await sleep(3200); // entrada do título/botões + fade do canvas
await pg.evaluate(() => { window.__menuGhost = 0; }); await step(pg, 30); await step(pg, 1);
await pg.screenshot({ path: `${out}/menu-desktop-1280x720.png` });
await pg.hover('[data-go="mode"][data-mode="solo"]'); await sleep(500); await step(pg, 1);
await pg.screenshot({ path: `${out}/menu-desktop-hover.png` });
if (N > 0) {
  fs.mkdirSync(`${out}/frames`, { recursive: true });
  for (const f of fs.readdirSync(`${out}/frames`)) fs.unlinkSync(`${out}/frames/${f}`);
  await pg.mouse.move(1100, 650);
  for (let i = 0; i < N; i++) {
    if (i === 110) await pg.evaluate(() => { window.__menuGhost = 0; });
    if (i === 200) await pg.hover('[data-go="mode"][data-mode="multi"]');
    if (i === 245) await pg.hover('[data-go="tutorial"]');
    await step(pg, 1);
    await pg.screenshot({ path: `${out}/frames/f${String(i).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 92 });
  }
}
await pg.close(); await b.close(); b = await launch();
} // navegador novo (o swiftshader às vezes cai ao abrir a 2ª página)
// celular
pg = await open(390, 844, 2);
await step(pg, 1); await sleep(3200);
await pg.evaluate(() => { window.__menuGhost = 0; }); await step(pg, 30);
await pg.screenshot({ path: `${out}/menu-phone-390x844.png` });
await pg.close();
console.log('errors', errs.filter(e => e.includes('pageerror')).length);
await b.close(); await srv.close();
