// v9b: cobertura de teto — toda célula aberta tem teto acima (ou é continuação de um poço de escada fechado pelo teto
// do andar de cima); poços de escada (HOLE/STAIR do andar de cima) têm teto; sótão coberto por telhado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateMansion } from '../shared/mapgen.js';
import { ceilingGaps, ceilingPlan, openAbove, atticRoofBox } from '../shared/ceiling.js';
import { T, W, D } from '../shared/config.js';

test('teto: nenhuma célula aberta sem teto em 60 sementes × 3 tamanhos', () => {
  for (let i = 0; i < 60; i++) for (const size of [1, 2, 3]) {
    const m = generateMansion('teto-' + i, { noCache: true, size });
    const gaps = ceilingGaps(m);
    assert.equal(gaps.length, 0, `semente teto-${i}/${size}: ${gaps.length} células sem teto, ex. ${JSON.stringify(gaps[0])}`);
    const plan = ceilingPlan(m);
    for (let L = 1; L < 4; L++) for (let c = 0; c < W * D; c++) {
      const t = m.levels[L].grid[c];
      if (t !== T.HOLE && t !== T.STAIR) continue;
      const x = c % W, z = (c / W) | 0;
      // a célula do poço é fechada aqui ou por cima (e aquela por sua vez tem teto)
      let k = L; while (k < 3 && !plan[k][c] && openAbove(m, k, x, z)) k++;
      assert.ok(plan[k][c], `poço de escada aberto: andar ${L} (${x},${z})`);
    }
    const b = atticRoofBox(m);
    assert.ok(b && b.z1 > b.z0 + 4 && b.x1 > b.x0 + 4, 'sótão com caixa de telhado');
  }
});

test('teto: o render usa o plano compartilhado e constrói o telhado do sótão', () => {
  const src = readFileSync(new URL('../client/src/render/mansion.js', import.meta.url), 'utf8');
  assert.ok(src.includes('ceilingPlan(map)'), 'mansion.js monta os tetos por ceilingPlan');
  assert.ok(src.includes('buildAtticRoof(map'), 'mansion.js constrói o telhado do sótão');
  assert.ok(!/HOLE \|\| t === T\.STAIR\) continue;[\s\S]{0,900}teto \(se não houver/.test(src), 'regra antiga removida');
});
