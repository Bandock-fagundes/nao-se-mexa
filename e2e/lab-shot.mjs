import puppeteer from 'puppeteer';
import { createGameServer } from '../server/index.js';
const srv = await createGameServer({ port: 0 });
const b = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [name, qs] of process.argv.slice(2).map(a => [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)])) {
  const pg = await b.newPage(); pg.on('pageerror', e => console.log('ERR', e.message)); pg.on('console', m => m.type() === 'error' && console.log('C', m.text()));
  await pg.setViewport({ width: 1280, height: 720 });
  await pg.goto(`http://localhost:${srv.port}/lab.html?${decodeURIComponent(qs)}`);
  await pg.waitForFunction('window.__done', { timeout: 120000 }).catch(e => console.log('timeout'));
  await pg.screenshot({ path: `shots/lab-${name}.png` }); await pg.close(); console.log('ok', name);
}
await b.close(); await srv.close();
