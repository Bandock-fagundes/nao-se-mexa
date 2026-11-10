// v4: confere o controlador da resolução dinâmica rodando de verdade (WebGL por software = GPU muito lenta).
// Esperado: com FPS alvo 60 a escala desce até o mínimo do preset e PARA lá (sem oscilar); também mede
// o custo por quadro em escala fixa 100% × 50% (só relativo: SwiftShader não é uma GPU real).
import { createGameServer } from '../server/index.js';
import { launch, newPage, sleep } from './launch.mjs';
const srv = await createGameServer({ port: 0 });
const browser = await launch();
const log = (...a) => console.log('[dynres]', ...a);
try {
  const pg = await newPage(browser, `http://localhost:${srv.port}/testar?e2e=1&quality=${process.env.Q || 'medium'}&dynres=1`, (...a) => log('page', ...a), 1280, 720);
  await pg.waitForSelector('#testar.on');
  await pg.evaluate(() => { document.querySelector('#tDiag').checked = false; });
  await pg.click('#tSolo');
  await pg.waitForFunction('window.__game && window.__game.lastSnap', { timeout: 240000, polling: 500 });
  await pg.evaluate(() => { window.__app.noRender = false; window.__app.input.enabled = false; });
  const trace = [];
  for (let i = 0; i < 24; i++) { await sleep(1000); const st = await pg.evaluate(() => window.__app.renderer.stats()); trace.push(+st.scale.toFixed(2)); if (i % 4 === 3) log(`t=${i + 1}s escala=${st.scale.toFixed(2)} render=${st.rw}x${st.rh} fps=${st.fps.toFixed(1)} calls=${st.calls}`); }
  const tail = trace.slice(-10), changes = tail.filter((v, i) => i && v !== tail[i - 1]).length;
  log('escalas:', trace.join(' '), '| mudanças nos últimos 10 s:', changes);
  // simulação do controlador com tempos sintéticos (GPU fictícia de 60 Hz com vsync): até 80% cabe em 16,7 ms;
  // acima disso o quadro passa do orçamento e o vsync derruba para 33,3 ms. Esperado: assenta perto de 0,8 e não oscila.
  const sim = await pg.evaluate(() => {
    const R = window.__app.renderer; window.__app.noRender = true;
    const st = R.settings, keep = { ...st }; st.dynRes = true; st.preserve = false; st.fpsTarget = 60;
    R.dyn = { acc: 0, lastT: 0, upHold: 2, sinceUp: 99, sinceChange: 0, okT: 0, ceil: 1, ceilT: 0, ceilHold: 7.5, refresh: 1000 / 60, dts: [] };
    R.scale = 0.5; R.applyScale(true);
    let t = 1000; const trace = [];
    for (let i = 0; i < 60 * 120; i++) { // 120 s simulados
      const cost = 14 * (R.scale / 0.8) ** 2; const dt = cost <= 16.4 ? 1000 / 60 : 2000 / 60;
      t += dt; R.updateDynamic(t); if (i % 300 === 0) trace.push(R.scale);
    }
    Object.assign(st, keep);
    return trace;
  });
  const late = sim.slice(-12); log('simulação (escala a cada 5 s):', sim.join(' '), '| últimos 60 s: min', Math.min(...late), 'máx', Math.max(...late));
  // custo relativo por quadro em escala fixa
  for (const s of [1, 0.75, 0.5]) {
    const ms = await pg.evaluate(async (s) => {
      const R = window.__app.renderer; window.__app.noRender = true; R.settings.dynRes = false; R.scale = s; R.applyScale(true);
      const g = window.__game; for (let i = 0; i < 2; i++) R.render(); R.renderer.getContext().finish();
      const t0 = performance.now(); for (let i = 0; i < 5; i++) { g.update(0.016); R.render(); } R.renderer.getContext().finish();
      return (performance.now() - t0) / 5;
    }, s);
    log(`escala fixa ${s * 100}%: ${ms.toFixed(1)} ms/quadro (SwiftShader)`);
  }
} catch (e) { console.error(e); process.exitCode = 1; }
await browser.close(); await srv.close();
