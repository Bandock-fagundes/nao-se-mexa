// A HISTÓRIA DA CASA (v2 fase 2) — tudo original, desenhado em canvas (sem imagens prontas).
// Família Albuquerque, 1961–1974: o Dr. Otávio trouxe "ela" de uma gruta; a filha Lia descobriu que ela só vê
// quem se mexe; Helena, a mãe, escreve o diário; o pai trancou a porta com três trancas e escondeu as três chaves.
// Os quadros, os desenhos de criança nas janelas e as páginas/livros legíveis contam isso aos poucos.
import * as THREE from 'three';
import { makeRng } from '../../shared/rng.js';

// ---------------------------------------------------------------------------------------------
// Textos legíveis (bilhetes, páginas de diário, livros abertos, recorte de jornal)
// type: 'diary' (papel pautado), 'child' (letra de criança, giz), 'book' (livro aberto), 'news' (jornal)
// ---------------------------------------------------------------------------------------------
export const NOTES = [
  { type: 'diary', title: 'Diário de Helena — 3 de março de 1961', text: 'Mudamos hoje. A casa é grande demais para nós quatro, mas o Otávio diz que precisa do porão para o trabalho dele.\n\nA Lia já escolheu o quarto. O Tomé chorou a noite inteira — acho que estranhou o barulho da madeira. Esta casa range como se respirasse.' },
  { type: 'child', title: 'Bilhete da Lia', text: 'MAMÃE\nTEM UMA MOÇA ALTA NO PORÃO.\nELA NÃO TEM OLHO.\nEU BRINQUEI DE ESTÁTUA\nE ELA NÃO ME ACHOU.\n\nLIA (7 ANOS)' },
  { type: 'diary', title: 'Caderno do Dr. Otávio — espécime nº 1', text: 'Trazida da gruta do Rio Escuro em caixote lacrado. Altura aproximada: três metros quando ereta. Sem olhos aparentes.\n\nNão reage à lanterna. Não reage à voz. Reage a MOVIMENTO — só a movimento. Fiquei parado a um palmo dela por quase um minuto. Ela respirou no meu rosto e foi embora.' },
  { type: 'diary', title: 'Caderno do Dr. Otávio — semana 6', text: 'Ela aprendeu a ouvir.\n\nOs degraus da escada, a porta da cozinha, o balde que a Helena derrubou na lavanderia. Quanto mais alto o barulho, de mais longe ela vem — e vem CORRENDO.\n\nTirei os sapatos da casa toda. Andar agachado não faz som nenhum.' },
  { type: 'diary', title: 'Diário de Helena — 9 de agosto', text: 'O Otávio pôs três trancas na porta da frente. Três fechaduras, três chaves.\n\nEle diz que é para ela não sair.\nEu acho que é para nós não sairmos.' },
  { type: 'book', title: 'Tratado de Zoologia das Cavernas, vol. II', text: '…as espécies cegas compensam a ausência de visão com um olfato extraordinário, capaz de seguir um rastro por horas…\n\n(sublinhado a lápis, na margem, com a letra do Dr. Otávio:)\n"ELA SENTE O NOSSO CHEIRO. NÃO FIQUE PARADO NO MESMO LUGAR POR MUITO TEMPO."' },
  { type: 'child', title: 'Desenho da Lia (verso)', text: 'EU DESENHEI ELA\nNA JANELA PRA ELA\nVER QUE EU SEI\nONDE ELA TÁ.\n\nO PAPAI DISSE PRA\nNÃO CORRER NA ESCADA.' },
  { type: 'diary', title: 'Caderno do Dr. Otávio — última página', text: 'Escondi as três chaves em lugares diferentes da casa: gavetas, armários, onde ela não pense em procurar.\n\nSe alguém achar este caderno:\nnão corra. Não bata portas. Não derrube nada.\nSe ela vier na sua direção —\n\nNÃO SE MEXA.' },
  { type: 'news', title: 'O Correio do Vale — 14 de julho de 1974', text: 'FAMÍLIA ALBUQUERQUE DESAPARECE\n\nA casa da família, no alto da Estrada Velha, foi encontrada trancada por dentro. Nenhum dos três cadeados da porta principal estava aberto, e as chaves não foram localizadas.\n\nVizinhos relatam ter ouvido, por semanas, "passos pesados na madeira" durante a madrugada.' },
  { type: 'diary', title: 'Diário de Helena — sem data', text: 'Ela está no corredor. Consigo ouvir a respiração dela atrás da porta, devagar, molhada.\n\nO Tomé dormiu, graças a Deus. Se eu ficar parada ela passa. Ela sempre passa.\n\nSe eu ficar parada…' },
  { type: 'book', title: 'Contos para Dormir — A Brincadeira de Estátua', text: 'Quando a música parar, todo mundo vira estátua! Quem se mexer, sai da brincadeira…\n\n(na margem, em giz de cera vermelho:)\n"QUEM SE MEXER ELA PEGA"' },
  { type: 'child', title: 'Bilhete da Lia', text: 'O TOMÉ NÃO PODE\nCHORAR DE NOITE.\nQUANDO ELE CHORA\nELA SOBE A ESCADA.\n\nEU CANTO BEM\nBAIXINHO PRA ELE.' },
];

// ---------------------------------------------------------------------------------------------
// Utilidades de pintura
// ---------------------------------------------------------------------------------------------
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
// pincelada: várias linhas finas tremidas na mesma direção (aspecto de tinta a óleo)
function brush(g, rng, x, y, w, h, col, n = 40, ang = 0.2) {
  g.save(); g.fillStyle = col; g.beginPath(); g.rect(x, y, w, h); g.clip();
  for (let i = 0; i < n; i++) { g.globalAlpha = 0.08 + rng.next() * 0.12; const px = x + rng.next() * w, py = y + rng.next() * h, l = 6 + rng.next() * 18; g.save(); g.translate(px, py); g.rotate(ang + (rng.next() - 0.5) * 0.6); g.fillRect(-l / 2, -1, l, 2 + rng.next() * 2); g.restore(); }
  g.restore();
}
function blob(g, x, y, rx, ry, col, rot = 0) { g.fillStyle = col; g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); g.fill(); }
// envelhecimento: verniz amarelado, vinheta escura, rachaduras (craquelê) e poeira
function age(g, rng, w, h) {
  const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.75);
  vg.addColorStop(0, 'rgba(60,40,10,0.05)'); vg.addColorStop(1, 'rgba(0,0,0,0.75)'); g.fillStyle = vg; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(120,90,30,0.12)'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 0.6;
  for (let i = 0; i < 70; i++) { let x = rng.next() * w, y = rng.next() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (rng.next() - 0.5) * 22; y += (rng.next() - 0.5) * 22; g.lineTo(x, y); } g.stroke(); }
  for (let i = 0; i < 1600; i++) { g.fillStyle = `rgba(${rng.next() < 0.5 ? '0,0,0' : '220,200,160'},${rng.next() * 0.18})`; g.fillRect(rng.next() * w, rng.next() * h, 1, 1); }
}
// figura pintada simples: cabeça, tronco, roupa
function person(g, x, y, s, skin, cloth, opts = {}) {
  blob(g, x, y + 70 * s, 24 * s, 46 * s, cloth);                        // corpo
  g.fillStyle = cloth; g.fillRect(x - 26 * s, y + 60 * s, 52 * s, 60 * s);
  blob(g, x, y, 15 * s, 19 * s, skin);                                   // rosto
  g.fillStyle = opts.hair || '#2a1a10'; g.beginPath(); g.ellipse(x, y - 9 * s, 16 * s, 12 * s, 0, Math.PI, Math.PI * 2); g.fill();
  if (opts.ribbon) blob(g, x + 12 * s, y - 16 * s, 7 * s, 4 * s, '#a0141a', 0.4);
  if (opts.long) { g.fillStyle = opts.hair; g.fillRect(x - 16 * s, y - 8 * s, 6 * s, 30 * s); g.fillRect(x + 10 * s, y - 8 * s, 6 * s, 30 * s); }
  g.fillStyle = 'rgba(20,10,5,0.75)'; g.fillRect(x - 7 * s, y - 2 * s, 4 * s, 2.5 * s); g.fillRect(x + 3 * s, y - 2 * s, 4 * s, 2.5 * s); // olhos
  if (opts.scratch) { g.strokeStyle = 'rgba(15,8,4,0.9)'; g.lineWidth = 2.2 * s; for (let i = 0; i < 7; i++) { g.beginPath(); g.moveTo(x - 14 * s + i * 2 * s, y - 9 * s); g.lineTo(x - 4 * s + i * 3 * s, y + 5 * s); g.stroke(); } }
}
// a criatura em silhueta pálida (muito sutil: só aparece se o jogador olhar com atenção)
function paleThing(g, x, y, s, alpha = 0.5) {
  g.save(); g.globalAlpha = alpha; g.fillStyle = '#c8c2b0';
  g.beginPath(); g.ellipse(x, y, 7 * s, 11 * s, 0.25, 0, 7); g.fill();               // cabeça alongada
  g.fillRect(x - 5 * s, y + 8 * s, 10 * s, 46 * s);                                    // tronco magro
  g.lineWidth = 2.4 * s; g.strokeStyle = '#c8c2b0';
  g.beginPath(); g.moveTo(x - 4 * s, y + 12 * s); g.quadraticCurveTo(x - 18 * s, y + 40 * s, x - 14 * s, y + 78 * s); g.stroke(); // braços enormes
  g.beginPath(); g.moveTo(x + 4 * s, y + 12 * s); g.quadraticCurveTo(x + 18 * s, y + 40 * s, x + 15 * s, y + 80 * s); g.stroke();
  g.beginPath(); g.moveTo(x - 3 * s, y + 52 * s); g.lineTo(x - 6 * s, y + 92 * s); g.moveTo(x + 3 * s, y + 52 * s); g.lineTo(x + 7 * s, y + 92 * s); g.stroke();
  g.restore();
}

// ---------------------------------------------------------------------------------------------
// QUADROS (8 cenas) — cada um conta um pedaço da história
// ---------------------------------------------------------------------------------------------
export const PAINTING_TITLES = ['A família Albuquerque, 1961', 'A casa da Estrada Velha', 'Lia', 'Dr. Otávio na gruta do Rio Escuro', 'O lago à noite', 'Helena', 'Três chaves', 'O corredor'];
const cache = new Map();
export function storyPainting(v) {
  v = ((v % 8) + 8) % 8;
  if (cache.has(v)) return cache.get(v);
  const rng = makeRng('quadro-historia-' + v);
  const W = 256, H = 320, [c, g] = canvas(W, H);
  const bg = (a, b) => { const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr; g.fillRect(0, 0, W, H); brush(g, rng, 0, 0, W, H, a, 260); };
  if (v === 0) { // retrato de família: pai (rosto arranhado), mãe, Lia e o bebê no colo
    bg('#3a2c1c', '#120c08');
    person(g, 78, 110, 1.15, '#c8a080', '#1c1a22', { hair: '#1a120c', scratch: true });
    person(g, 170, 120, 1.05, '#d8b090', '#4a1a1c', { hair: '#3a2010', long: true });
    blob(g, 170, 205, 18, 12, '#e8e0d0'); blob(g, 176, 198, 8, 8, '#e0b898');     // bebê no colo
    person(g, 124, 190, 0.7, '#e0b898', '#5a5a3a', { hair: '#4a2a10', ribbon: true });
  } else if (v === 1) { // a casa à luz do dia, família pequena no jardim
    bg('#6a7a8a', '#2a3020');
    g.fillStyle = '#3a4a2a'; g.fillRect(0, 230, W, 90); brush(g, rng, 0, 230, W, 90, '#5a6a3a', 200, 0);
    g.fillStyle = '#4a3a30'; g.fillRect(40, 120, 176, 115); g.beginPath(); g.moveTo(30, 124); g.lineTo(128, 60); g.lineTo(226, 124); g.fill();
    g.fillStyle = '#2a2018'; for (const x of [60, 100, 140, 180]) { g.fillRect(x, 140, 18, 26); g.fillRect(x, 185, 18, 26); }
    g.fillStyle = '#1a120c'; g.fillRect(116, 196, 24, 40);
    for (const [x, s] of [[70, 0.25], [86, 0.22], [196, 0.15]]) person(g, x, 236, s, '#d0a080', '#2a2a30');
    blob(g, 210, 50, 18, 18, 'rgba(240,220,160,0.7)');
  } else if (v === 2) { // Lia com a fita vermelha
    bg('#2a3428', '#0c100a');
    person(g, 128, 120, 2.0, '#e0b898', '#5a5a3a', { hair: '#4a2a10', ribbon: true, long: true });
    g.fillStyle = '#d8d0c0'; g.fillRect(150, 250, 34, 26); g.strokeStyle = '#3a1a10'; g.lineWidth = 2; g.strokeRect(150, 250, 34, 26); // desenho na mão
  } else if (v === 3) { // Otávio na gruta, lanterna, caixote
    bg('#1a1814', '#050403');
    g.fillStyle = '#0a0908'; g.beginPath(); g.ellipse(150, 170, 90, 120, 0, 0, 7); g.fill();
    const lg = g.createRadialGradient(80, 160, 4, 80, 160, 120); lg.addColorStop(0, 'rgba(255,220,150,0.5)'); lg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = lg; g.fillRect(0, 0, W, H);
    person(g, 70, 150, 0.9, '#c8a080', '#3a3428', { hair: '#1a120c' });
    g.fillStyle = '#5a4630'; g.fillRect(130, 220, 80, 56); g.strokeStyle = '#2a1a10'; g.lineWidth = 3; g.strokeRect(130, 220, 80, 56); g.beginPath(); g.moveTo(130, 220); g.lineTo(210, 276); g.stroke();
    paleThing(g, 170, 110, 0.9, 0.18);
  } else if (v === 4) { // lago à noite com a figura pálida entre as árvores
    bg('#1a2234', '#06080c');
    blob(g, 190, 60, 16, 16, 'rgba(220,226,240,0.85)');
    g.fillStyle = '#0a0e0a'; g.fillRect(0, 200, W, 120);
    g.fillStyle = 'rgba(140,150,180,0.25)'; g.fillRect(30, 230, 200, 30); blob(g, 190, 245, 10, 4, 'rgba(220,226,240,0.4)');
    for (let i = 0; i < 9; i++) { const x = i * 30 + rng.next() * 10; g.fillStyle = '#05070a'; g.beginPath(); g.moveTo(x, 210); g.lineTo(x + 14, 90 + rng.next() * 50); g.lineTo(x + 28, 210); g.fill(); }
    paleThing(g, 118, 130, 0.8, 0.35);
  } else if (v === 5) { // Helena, olhos riscados
    bg('#3a1c1c', '#100606');
    person(g, 128, 115, 2.0, '#d8b090', '#4a1a1c', { hair: '#3a2010', long: true, scratch: true });
  } else if (v === 6) { // natureza-morta com três chaves e uma vela
    bg('#2c2418', '#0a0806');
    g.fillStyle = '#3a2618'; g.fillRect(0, 210, W, 110); brush(g, rng, 0, 210, W, 110, '#5a3a20', 150, 0);
    g.fillStyle = '#e8dcc0'; g.fillRect(190, 120, 16, 92); blob(g, 198, 112, 5, 11, 'rgba(255,200,90,0.95)');
    const lg = g.createRadialGradient(198, 115, 2, 198, 115, 140); lg.addColorStop(0, 'rgba(255,200,120,0.35)'); lg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = lg; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 3; i++) { // as três chaves
      const x = 50 + i * 42, y = 245 + (i % 2) * 14; g.strokeStyle = '#c89a40'; g.fillStyle = '#c89a40'; g.lineWidth = 4;
      g.beginPath(); g.arc(x, y, 9, 0, 7); g.stroke(); g.fillRect(x + 8, y - 2, 30, 4); g.fillRect(x + 30, y, 4, 9); g.fillRect(x + 24, y, 4, 7);
    }
  } else { // o corredor com a porta entreaberta e uma mão longa saindo
    bg('#2a2018', '#080604');
    g.fillStyle = '#1a140e'; g.beginPath(); g.moveTo(60, 40); g.lineTo(196, 40); g.lineTo(150, 230); g.lineTo(106, 230); g.fill();
    g.fillStyle = '#0a0806'; g.fillRect(150, 100, 30, 110);
    g.fillStyle = '#3a2a1c'; g.fillRect(142, 100, 10, 110);
    g.strokeStyle = 'rgba(200,194,176,0.6)'; g.lineWidth = 2; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(152, 140 + i * 5); g.quadraticCurveTo(140, 150 + i * 6, 128 - i * 2, 168 + i * 8); g.stroke(); }
    g.fillStyle = '#4a3a24'; g.fillRect(0, 230, W, 90);
  }
  age(g, rng, W, H);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  cache.set(v, t); return t;
}

// ---------------------------------------------------------------------------------------------
// JANELAS: céu noturno + desenhos de criança (giz de cera) colados no vidro com fita
// ---------------------------------------------------------------------------------------------
function crayon(g, rng, pts, col, wd = 3) {
  // traço de giz de cera: várias passadas tremidas e falhadas
  g.strokeStyle = col; g.lineCap = 'round'; g.lineJoin = 'round';
  for (let p = 0; p < 3; p++) {
    g.globalAlpha = 0.45 + rng.next() * 0.35; g.lineWidth = wd * (0.6 + rng.next() * 0.6);
    g.beginPath(); pts.forEach(([x, y], i) => { const jx = x + (rng.next() - 0.5) * 2.2, jy = y + (rng.next() - 0.5) * 2.2; if (i) g.lineTo(jx, jy); else g.moveTo(jx, jy); }); g.stroke();
  }
  g.globalAlpha = 1;
}
const circlePts = (x, y, r, n = 18) => Array.from({ length: n + 1 }, (_, i) => [x + Math.cos(i / n * 6.283) * r, y + Math.sin(i / n * 6.283) * r]);
function stick(g, rng, x, y, s, col, opts = {}) {
  crayon(g, rng, circlePts(x, y, 7 * s), col, 2.5);
  crayon(g, rng, [[x, y + 7 * s], [x, y + 30 * s]], col); crayon(g, rng, [[x - 12 * s, y + 16 * s], [x + 12 * s, y + 16 * s]], col);
  crayon(g, rng, [[x - 9 * s, y + 46 * s], [x, y + 30 * s], [x + 9 * s, y + 46 * s]], col);
  if (opts.dress) crayon(g, rng, [[x - 10 * s, y + 36 * s], [x, y + 12 * s], [x + 10 * s, y + 36 * s], [x - 10 * s, y + 36 * s]], col);
}
function letters(g, rng, text, x, y, size, col) {
  g.save(); g.font = `bold ${size}px "Comic Sans MS", "Chalkboard SE", cursive, sans-serif`; g.fillStyle = col;
  let cx = x; for (const ch of text) { g.save(); g.translate(cx, y + (rng.next() - 0.5) * 5); g.rotate((rng.next() - 0.5) * 0.35); g.globalAlpha = 0.75 + rng.next() * 0.25; g.fillText(ch, 0, 0); g.restore(); cx += size * (ch === ' ' ? 0.45 : 0.68); }
  g.restore();
}
function paperSheet(g, rng, x, y, w, h, rot, draw) {
  g.save(); g.translate(x + w / 2, y + h / 2); g.rotate(rot);
  g.fillStyle = '#e4dcc4'; g.fillRect(-w / 2, -h / 2, w, h);
  for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(120,100,60,${rng.next() * 0.12})`; g.fillRect(-w / 2 + rng.next() * w, -h / 2 + rng.next() * h, 2, 2); }
  g.translate(-w / 2, -h / 2); draw(w, h); g.translate(w / 2, h / 2);
  g.fillStyle = 'rgba(230,220,170,0.55)'; g.fillRect(-12, -h / 2 - 6, 24, 12); g.fillRect(-w / 2 + 4, h / 2 - 8, 20, 10); // fita adesiva
  g.restore();
}
const winCache = new Map();
export function windowTexture(variant, small = false) {
  const key = variant + (small ? 's' : 'b'); if (winCache.has(key)) return winCache.get(key);
  const rng = makeRng('janela-' + key);
  const W = 256, H = small ? 256 : 436, [c, g] = canvas(W, H);
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#1a2a4a'); gr.addColorStop(0.7, '#0c1424'); gr.addColorStop(1, '#05070c'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(220,230,255,0.9)'; g.beginPath(); g.arc(190, 60, 16, 0, 7); g.fill();
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(220,230,255,${rng.next() * 0.6})`; g.fillRect(rng.next() * W, rng.next() * H * 0.5, 1.5, 1.5); }
  g.strokeStyle = '#020305'; g.lineWidth = 5; // galhos secos
  for (let i = 0; i < 5; i++) { g.beginPath(); let x = 20 + i * 52, y = H; g.moveTo(x, y); for (let k = 0; k < 7; k++) { x += Math.sin(i * 7 + k) * 18; y -= H / 11; g.lineTo(x, y); } g.stroke(); }
  g.fillStyle = '#020305'; g.fillRect(0, H * 0.82, W, H * 0.18);
  // sujeira e condensação no vidro
  for (let i = 0; i < 18; i++) { const x = rng.next() * W, y = rng.next() * H, r = 10 + rng.next() * 40; const sg = g.createRadialGradient(x, y, 0, x, y, r); sg.addColorStop(0, 'rgba(160,170,180,0.10)'); sg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = sg; g.fillRect(0, 0, W, H); }
  const v = variant % 5;
  if (!small && v !== 4) {
    const y0 = H * (0.42 + rng.next() * 0.1);
    if (v === 0) paperSheet(g, rng, 30, y0, 150, 120, -0.06, (w, h) => { // família + casa + sol com cara
      crayon(g, rng, [[20, 70], [20, 40], [50, 18], [80, 40], [80, 70], [20, 70]], '#8a3a1a', 3);
      crayon(g, rng, circlePts(125, 22, 12), '#d8a020', 3); for (let a = 0; a < 6.28; a += 0.8) crayon(g, rng, [[125 + Math.cos(a) * 15, 22 + Math.sin(a) * 15], [125 + Math.cos(a) * 22, 22 + Math.sin(a) * 22]], '#d8a020', 2);
      stick(g, rng, 95, 58, 0.9, '#1a3a8a'); stick(g, rng, 115, 62, 0.8, '#a01a3a', { dress: true }); stick(g, rng, 132, 74, 0.55, '#a01a3a', { dress: true });
      letters(g, rng, 'MINHA FAMÍLIA', 10, h - 10, 13, '#3a2a1a');
    });
    else if (v === 1) paperSheet(g, rng, 60, y0 - 20, 140, 170, 0.05, (w, h) => { // ELA: figura alta, braços enormes, sem olhos
      crayon(g, rng, circlePts(70, 30, 12, 14).map(([x, y]) => [x, y * 1.15 - 4]), '#202020', 3);
      crayon(g, rng, [[70, 44], [70, 105]], '#202020', 4);
      crayon(g, rng, [[70, 52], [40, 80], [30, 130]], '#202020', 3); crayon(g, rng, [[70, 52], [100, 80], [112, 132]], '#202020', 3);
      crayon(g, rng, [[70, 105], [58, 150]], '#202020', 3); crayon(g, rng, [[70, 105], [84, 150]], '#202020', 3);
      crayon(g, rng, [[62, 36], [78, 36]], '#a01010', 2.5); // boca vermelha
      stick(g, rng, 120, 120, 0.45, '#a01a3a', { dress: true });
      letters(g, rng, 'ELA', 14, 26, 22, '#a01010');
    });
    else if (v === 2) paperSheet(g, rng, 24, y0, 200, 90, -0.03, (w, h) => { // NÃO SE MEXA
      letters(g, rng, 'NÃO SE', 16, 38, 26, '#a01010'); letters(g, rng, 'MEXA!!', 40, 74, 28, '#a01010');
      crayon(g, rng, circlePts(172, 40, 16), '#202020', 3); crayon(g, rng, [[158, 26], [186, 54]], '#202020', 3); crayon(g, rng, [[186, 26], [158, 54]], '#202020', 3);
    });
    else paperSheet(g, rng, 40, y0, 170, 130, 0.07, (w, h) => { // menina escondida debaixo da cama, porta com mão
      crayon(g, rng, [[10, 80], [110, 80], [110, 95], [10, 95], [10, 80]], '#3a6a2a', 3); crayon(g, rng, [[14, 95], [14, 110]], '#3a2a1a', 3); crayon(g, rng, [[106, 95], [106, 110]], '#3a2a1a', 3);
      crayon(g, rng, circlePts(40, 104, 5), '#a01a3a', 2.5); crayon(g, rng, [[46, 104], [70, 106]], '#a01a3a', 2.5);
      crayon(g, rng, [[130, 20], [160, 20], [160, 112], [130, 112], [130, 20]], '#5a3a1a', 3);
      for (let i = 0; i < 4; i++) crayon(g, rng, [[130, 55 + i * 4], [116, 60 + i * 6]], '#202020', 2);
      letters(g, rng, 'SHHH', 20, 32, 20, '#1a3a8a');
    });
  }
  if (small) { // sótão: só marcas de mãozinhas no vidro empoeirado
    for (let i = 0; i < 2; i++) { const x = 70 + i * 90, y = 130 + i * 20; g.fillStyle = 'rgba(200,210,220,0.18)'; blob(g, x, y, 16, 20, 'rgba(200,210,220,0.18)'); for (let f = 0; f < 5; f++) blob(g, x - 16 + f * 8, y - 26 - (f === 2 ? 6 : 0), 3.5, 9, 'rgba(200,210,220,0.18)'); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  winCache.set(key, t); return t;
}

// ---------------------------------------------------------------------------------------------
// Textura da página (para o modelo 3D do bilhete/livro sobre os móveis)
// ---------------------------------------------------------------------------------------------
export function noteTexture(note) {
  const rng = makeRng('pagina-' + note.title);
  const W = 128, H = 160, [c, g] = canvas(W, H);
  g.fillStyle = note.type === 'news' ? '#cfc8b4' : note.type === 'child' ? '#e8e0c8' : '#d8ccaa'; g.fillRect(0, 0, W, H);
  if (note.type === 'diary') { g.strokeStyle = 'rgba(80,90,140,0.35)'; for (let y = 22; y < H; y += 9) { g.beginPath(); g.moveTo(6, y); g.lineTo(W - 6, y); g.stroke(); } }
  g.fillStyle = note.type === 'child' ? 'rgba(160,20,20,0.85)' : 'rgba(30,25,40,0.7)';
  for (let y = 20; y < H - 8; y += note.type === 'child' ? 16 : 9) for (let x = 10; x < W - 14; x += 4 + rng.next() * 8) if (rng.next() < 0.8) g.fillRect(x, y - 3, 2 + rng.next() * 6, note.type === 'child' ? 5 : 1.5);
  for (let i = 0; i < 4; i++) { const x = rng.next() * W, y = rng.next() * H, r = 8 + rng.next() * 18; const sg = g.createRadialGradient(x, y, 0, x, y, r); sg.addColorStop(0, 'rgba(90,60,20,0.25)'); sg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = sg; g.fillRect(0, 0, W, H); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
