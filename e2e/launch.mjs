// Utilitários compartilhados dos testes de navegador.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const cache = path.resolve(here, '..', '.puppeteer-cache');
if (!process.env.PUPPETEER_CACHE_DIR && fs.existsSync(cache)) process.env.PUPPETEER_CACHE_DIR = cache;
const { default: puppeteer } = await import('puppeteer');
export async function launch() {
  return puppeteer.launch({ headless: 'shell', protocolTimeout: 600000, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
}
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export async function newPage(browser, url, log = console.log, w = 1280, h = 720) {
  const pg = await browser.newPage();
  pg.on('pageerror', e => log('[pageerror]', e.message));
  pg.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') log('[console]', m.text().slice(0, 300)); });
  await pg.setViewport({ width: w, height: h });
  await pg.goto(url);
  return pg;
}
