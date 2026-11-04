// Simulações headless de partidas completas (não faz parte do `npm test`).
// Uso: node test/simulate.mjs [nSeeds] [fases ex.: 1,2,3] [modo: normal|frozen]
//   normal → criatura ativa (caça de verdade); frozen → criatura congelada (confere chaves alcançáveis + saída)
import { simulateMatch } from './bots.js';

const nSeeds = +(process.argv[2] || 4);
const phases = (process.argv[3] || '1,2,3').split(',').map(Number);
const frozen = process.argv[4] === 'frozen';
const configs = [['careful'], ['careless'], ['careful', 'careful', 'careful']];
const rows = [];
for (const phase of phases) for (const styles of configs) for (let i = 0; i < nSeeds; i++) {
  const r = simulateMatch({ seed: 'sim-' + i, phase, styles, keySeed: 'k' + i, frozen, maxTime: frozen ? 1200 : 900 });
  rows.push(r);
  console.log(JSON.stringify(r));
}
console.log('\n=== RESUMO ' + (frozen ? '(criatura congelada)' : '') + ' ===');
const groups = {};
for (const r of rows) (groups[`F${r.phase} ${r.styles}`] ||= []).push(r);
for (const [k, g] of Object.entries(groups)) {
  const enc = g.filter(r => r.firstEncounter !== null).map(r => r.firstEncounter);
  const avg = (a) => a.length ? (a.reduce((s, v) => s + v, 0) / a.length).toFixed(0) : '—';
  console.log(`${k.padEnd(30)} partidas=${g.length} 1º encontro=${avg(enc)}s (${enc.length}/${g.length}) · perseguições=${g.reduce((s, r) => s + r.chases, 0)} · mortes=${g.reduce((s, r) => s + r.kills, 0)}/${g.reduce((s, r) => s + r.players, 0)} · vitórias=${g.filter(r => r.result === 'win').length} · chaves na porta (méd)=${avg(g.map(r => r.deposited))} · duração=${avg(g.map(r => r.duration))}s · passagens=${g.reduce((s, r) => s + r.passBys, 0)} · maior intervalo sem chegar perto=${Math.max(...g.map(r => r.maxGap))}s · maior pausa=${Math.max(...g.map(r => r.maxStill))}s · erros=${g.reduce((s, r) => s + (r.error ? 1 : 0), 0)}`);
}
