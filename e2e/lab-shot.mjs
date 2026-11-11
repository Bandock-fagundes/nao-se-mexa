// Capturas da página de laboratório (modelos isolados). Uso: node e2e/lab-shot.mjs nome="v=wardrobe&open=1" ...
import fs from 'node:fs';
import { createGameServer } from '../server/index.js';
import { launch } from './launch.mjs';
const out = process.env.SHOTS || 'shots';
fs.mkdirSync(out, { recursive: true });
const srv = await createGameServer({ port: 0 });
const b = await launch();
for (const [name, qs] of process.argv.slice(2).map(a => [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)])) {
  const pg = await b.newPage(); pg.on('pageerror', e => console.log('ERR', e.message, (e.stack || '').split('\n').slice(0, 4).join(' | '))); pg.on('console', m => (m.type() === 'error' || m.text().startsWith('grab')) && console.log('C', m.text()));
  await pg.setViewport({ width: 1280, height: 720 });
  await pg.goto(`http://localhost:${srv.port}/lab.html?${decodeURIComponent(qs)}`);
  await pg.waitForFunction('window.__done', { timeout: 120000 }).catch(e => console.log('timeout'));
  await pg.screenshot({ path: `${out}/lab-${name}.png` }); await pg.close(); console.log('ok', name);
}
await b.close(); await srv.close();
