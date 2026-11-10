// v4: medição de custo de renderização (renderer.info: draw calls / triângulos por quadro) em 3 pontos fixos.
// WebGL por software (SwiftShader): o tempo por quadro NÃO representa GPU real, serve só para comparar antes/depois.
// Uso: node e2e/perf-probe.mjs [rótulo]   env: Q=medium  EXTRA="&res=1&dynres=0"
import { createGameServer } from '../server/index.js';
import { generateMansion } from '../shared/mapgen.js';
import { launch, newPage, sleep } from './launch.mjs';
const SEED = process.env.SEED || 'jam-v3-7', CELL = 0.5;
const srv = await createGameServer({ port: 0 });
const browser = await launch();
const out = { label: process.argv[2] || 'run', q: process.env.Q || 'medium', points: [] };
try {
  const map = generateMansion(SEED, { size: 1 });
  const pg = await newPage(browser, `http://localhost:${srv.port}/testar?e2e=1&quality=${out.q}${process.env.EXTRA || ''}`, (...a) => console.log('page', ...a), 1280, 720);
  await pg.waitForSelector('#testar.on');
  await pg.$eval('#tSeed', (e, s) => { e.value = s; }, SEED);
  await pg.evaluate(() => { document.querySelector('#tDiag').checked = false; });
  await pg.click('#tSolo');
  await pg.waitForFunction('window.__game && window.__game.lastSnap', { timeout: 240000, polling: 500 });
  await pg.evaluate(() => { window.__app.noRender = true; });
  const att = map.rooms.find(r => r.level === 3 && r.type === 'attic');
  await pg.evaluate((m) => window.__app.net.send(m), { t: 'debug', cmd: 'creature', x: (att.x0 + 2) * CELL, z: (att.z0 + 2) * CELL, level: 3, state: 'freeze' });
  const s = map.spawns[0];
  const pts = [['hall', s.x, s.z + 0.5, 1, s.x, 1.9, s.z + 12]];
  for (const type of ['library', 'dining', 'master']) {
    const r = map.rooms.find(q => q.type === type); if (!r) continue;
    pts.push([type, (r.x0 + 1.5) * CELL, (r.z0 + 1.5) * CELL, r.level, (r.x1 + 0.5) * CELL, 1.3, (r.z1 + 0.5) * CELL]);
  }
  for (const [name, x, z, level, tx, ty, tz] of pts) {
    await pg.evaluate((m) => window.__app.net.send(m), { t: 'debug', cmd: 'tp', x, z, level }); await sleep(300);
    const res = await pg.evaluate(({ x, z, level, tx, ty, tz }) => {
      const g = window.__game, R = window.__app.renderer; g.teleport(x, z, level);
      const off = [-3.6, 0, 3.8, 7.6][level], eyeY = 1.62 + off;
      g.setLook(Math.atan2(-(tx - x), -(tz - z)), Math.atan2(ty + off - eyeY, Math.hypot(tx - x, tz - z)));
      for (let i = 0; i < 3; i++) { g.update(0.016); R.render(); }
      const info = R.renderer.info; info.autoReset = false;
      const N = 6; let calls = 0, tris = 0; const t0 = performance.now();
      for (let i = 0; i < N; i++) { g.update(0.016); info.reset(); R.render(); calls += info.render.calls; tris += info.render.triangles; }
      R.renderer.getContext().finish();
      const ms = (performance.now() - t0) / N; info.autoReset = true;

      return { calls: calls / N, tris: Math.round(tris / N), ms: +ms.toFixed(1), geos: info.memory.geometries, texs: info.memory.textures, progs: info.programs.length, stats: R.stats ? R.stats() : null };
    }, { x, z, level, tx, ty, tz });
    if (process.env.DUMP && name === 'dining') console.log('DUMP', JSON.stringify(await pg.evaluate(() => {
      const R = window.__app.renderer, sc = R.scene; const byKind = {}; let vis = 0, cast = 0, total = 0;
      const lv = window.__game.view.levels; const lvOf = (o) => { for (let a = o; a; a = a.parent) { const i = lv.indexOf(a); if (i >= 0) return i; } return -1; };
      sc.traverseVisible(o => { if (!o.isMesh && !o.isSprite && !o.isPoints && !o.isLine) return; vis++; if (o.castShadow) cast++;
        let dyn = 0, depth = 0; for (let a = o.parent; a; a = a.parent) { depth++; if (a.userData.dynamic) dyn = 1; }
        const k = o.geometry.type + ' d' + depth + (dyn ? ' DYN' : '') + ' ud:' + Object.keys(o.userData).join('|') + ' kids' + o.children.length + (o.geometry.index ? '' : ' noidx') + (o.geometry.attributes.color ? '' : ' nocol');
        byKind[k] = (byKind[k] || 0) + 1; });
      sc.traverse(o => { if (o.isMesh) total++; });
      return { vis, cast, total, top: Object.entries(byKind).sort((a, b) => b[1] - a[1]).slice(0, 25) };
    })));
    out.points.push({ name, ...res }); console.log(name, JSON.stringify(res));
  }
} catch (e) { console.error(e); process.exitCode = 1; }
console.log('RESULT', JSON.stringify(out));
await browser.close(); await srv.close();
