// Aplicação: telas, salas, configurações, estatísticas, laço de renderização.
import { Net } from './net.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { Renderer, QUALITY } from './render/renderer.js';
import { buildMaterials } from './render/materials.js';
import { Game } from './game.js';
import { runIntro, shouldShowIntro } from './intro.js';
import { LoadingScreen, nextPaint } from './loading.js';
import { WakeScene } from './wakeup.js';
import { generateMansion, validateMap } from '../../shared/mapgen.js';
import { PHASES, W, D, T, CELL } from '../../shared/config.js';
import { LOOK_COLORS, ACCESSORY_NAMES, sanitizeLook, defaultLook, lookHex } from '../../shared/look.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const params = new URLSearchParams(location.search);
const isTest = location.pathname.startsWith('/testar');

// ---------------- configurações e estatísticas ----------------
// v4: dynRes (resolução dinâmica), fpsTarget (0 = sem limite), maxRes ('1080'|'1440'|'2160'|'native'), sharpness 0..1, showFps (painel F3)
const DEFAULTS = { quality: 'medium', resScale: 1, dynRes: true, fpsTarget: 60, maxRes: 'native', sharpness: 0.5, showFps: false, master: 0.8, sfx: 0.9, ambient: 0.7, music: 0.6, sensitivity: 1, fov: 72, invertY: false };
function load(k, d) { try { return { ...d, ...JSON.parse(localStorage.getItem(k) || '{}') }; } catch { return { ...d }; } }
const app = {
  settings: load('nsm_settings', DEFAULTS),
  stats: load('nsm_stats', { started: 0, wins: 0, deaths: 0, phases: {}, totalSurvival: 0, bestSurvival: 0 }),
  net: new Net(), audio: new AudioEngine(), input: null, renderer: null, M: null, game: null, myId: null, room: null,
  phase: 1, diagOn: true, playing: false,
};
if (params.get('quality') && QUALITY[params.get('quality')]) app.settings.quality = params.get('quality');
// v4: parâmetros de teste/captura (não são salvos): ?res=0.67 (escala fixa) ?dynres=0|1 ?sharp=0..1 ?maxres=1080
const urlOver = {};
if (params.has('res')) { urlOver.resScale = +params.get('res'); urlOver.dynRes = false; }
if (params.has('dynres')) urlOver.dynRes = params.get('dynres') === '1';
if (params.has('sharp')) urlOver.sharpness = +params.get('sharp');
if (params.has('maxres')) urlOver.maxRes = params.get('maxres');
const renderSettings = () => ({ ...app.settings, ...urlOver, preserve: params.has('e2e') && !params.has('dynres') });
app.saveSettings = () => localStorage.setItem('nsm_settings', JSON.stringify(app.settings));
app.saveStats = () => localStorage.setItem('nsm_stats', JSON.stringify(app.stats));
app.audio.vol = { master: app.settings.master, sfx: app.settings.sfx, ambient: app.settings.ambient, music: app.settings.music };
app.music = app.audio.music; // window.__music.setTension(0..1) / .stinger('death'|'win')
const isE2E = (params.has('e2e') || navigator.webdriver) && !params.has('showload'); // ?showload força a tela de carregamento completa (capturas)
app.loading = new LoadingScreen(document.querySelector('#loading'), { lite: isE2E });
app.input = new Input($('#stage'));
window.__app = app;

// ---------------- telas ----------------
// v8: telas do menu com fundo 3D (sala de jantar) atrás; troca de tela com fade (a anterior sai por cima, sem cliques)
const MENU_SCREENS = new Set(['menu', 'mode', 'lobby', 'settings', 'tutorial', 'credits']);
function show(id) {
  const prevEl = app.screen ? $('#' + app.screen) : null;
  $$('.screen').forEach(s => s.classList.remove('on', 'out'));
  if (prevEl && prevEl.id !== id && prevEl.id !== 'loading' && id !== 'loading' && id && !isE2E) {
    prevEl.classList.add('out'); clearTimeout(prevEl._outT); prevEl._outT = setTimeout(() => prevEl.classList.remove('out'), 420);
  }
  if (id) $('#' + id).classList.add('on');
  const prev = app.screen;
  app.screen = id;
  if (id === 'loading') { if (prev !== 'loading') app.loading.open(app.phase); }
  else if (prev === 'loading' && app.loading.active && id) app.loading.close(); // saiu para um menu (erro etc.)
  updateMusic();
  if (id === 'menu') renderStats();
  if (id === 'settings') fillSettings();
  if (id === 'mode' || id === 'lobby') mountLook(id);
  updateMenuBack();
}
// fundo 3D do menu: liga só com uma tela do menu aberta e fora da partida; desligado em e2e/webdriver (salvo ?menu3d=1)
const menu3dOn = params.get('menu3d') === '1' || (!isE2E && params.get('menu3d') !== '0');
function updateMenuBack() {
  const on = MENU_SCREENS.has(app.screen) && !app.game && !app.introRunning;
  $('#menuBack').classList.toggle('off', !(MENU_SCREENS.has(app.screen) && !app.game));
  if (!menu3dOn) return;
  if (on && !app.menuScene && !app.menuSceneLoading) {
    app.menuSceneLoading = true;
    const go = () => import('./menuScene.js').then(({ MenuScene }) => {
      try {
        const ms = new MenuScene($('#menuCanvas')); ms.build();
        ms.onFirstFrame = () => $('#menuBack').classList.add('has3d');
        app.menuScene = window.__menuScene = ms; updateMenuBack();
      } catch (e) { console.warn('fundo 3D do menu indisponível', e); }
    });
    (window.requestIdleCallback || ((f) => setTimeout(f, 200)))(go, { timeout: 900 });
    return;
  }
  const ms = app.menuScene; if (!ms) return;
  if (on && !document.hidden) ms.start(); else ms.stop();
}
document.addEventListener('visibilitychange', () => updateMenuBack());
// trilha conforme a tela
function updateMusic() {
  if (app.introRunning || app.wakeRunning) return app.music.setMode('none');
  if (app.screen === 'loading') return app.music.setMode('loading');
  if (app.game && app.playing && !app.game.ended) return app.music.setMode('game');
  if (app.game) return app.music.setMode('none');
  app.music.setMode(app.screen ? 'menu' : 'none');
}
app.updateMusic = updateMusic;
// sons de interface: clique e passagem do mouse em botões
let hoverT = 0, hoverEl = null;
document.addEventListener('pointerover', (e) => {
  const b = e.target.closest && e.target.closest('button, .btn, select'); if (!b || b === hoverEl || b.disabled) { if (!b) hoverEl = null; return; }
  hoverEl = b; const now = performance.now(); if (now - hoverT < 60 || app.playing && app.input.locked) return; hoverT = now;
  if (app.audio.enabled && !app.audio.blocked) app.audio.play('ui_hover', null);
});
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('button, .btn'); if (!b || b.disabled || b.dataset.go) return; // data-go já toca
  app.audio.init(); app.audio.play('ui', null);
  if (!app.game) updateMusic();
}, true);
function overlay(id, on) { $('#' + id).classList.toggle('hidden', !on); }
function hideOverlays() { for (const id of ['pause', 'death', 'escaped', 'end', 'reconnecting', 'disconnected', 'clickToPlay']) overlay(id, false); }
$$('[data-go]').forEach(b => b.addEventListener('click', () => { app.audio.init(); app.audio.play('ui'); if (b.dataset.mode) app.modeHint = b.dataset.mode; show(b.dataset.go); }));
$('[data-action=home]').addEventListener('click', () => { location.href = '/'; });
function renderStats() {
  const s = app.stats;
  const ph = s.phases || {};
  $('#stats').innerHTML = `Partidas iniciadas: ${s.started || 0} · Vitórias: ${s.wins || 0} · Mortes: ${s.deaths || 0}<br>Fases concluídas — 1: ${ph[1] || 0} · 2: ${ph[2] || 0} · 3: ${ph[3] || 0}<br>Tempo total sobrevivido: ${fmtT(s.totalSurvival || 0)} · Maior sobrevivência: ${fmtT(s.bestSurvival || 0)}`;
}
const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ---------------- seleção de modo ----------------
$('#name').value = localStorage.getItem('nsm_name') || '';
$('#tName').value = localStorage.getItem('nsm_name') || '';
const myName = () => { const n = ($('#name').value || $('#tName').value || 'Jogador').trim().slice(0, 16) || 'Jogador'; localStorage.setItem('nsm_name', n); return n; };
// ---------------- v7: APARÊNCIA (um acessório + cor), salva no navegador e enviada ao entrar na sala ----------------
// Quem nunca escolheu não manda nada: o servidor dá cachecol na cor da vaga (como antes da v7).
app.look = (() => { try { return sanitizeLook(JSON.parse(localStorage.getItem('nsm_look') || 'null')); } catch { return null; } })();
app.lastHat = app.look && app.look.acc !== 'scarf' ? app.look.acc : 'fedora';
const shownLook = () => app.look || (app.room && (app.room.players.find(p => p.id === app.myId) || {}).look) || { acc: 'scarf', col: LOOK_COLORS[0].hex };
const lookMsg = () => app.look ? { look: app.look } : {};
function setLook(l) {
  app.look = sanitizeLook(l); if (!app.look) return;
  if (app.look.acc !== 'scarf') app.lastHat = app.look.acc;
  localStorage.setItem('nsm_look', JSON.stringify(app.look));
  renderLookUI();
  if (app.room && app.net.state === 'open' && app.room.state !== 'playing') app.net.send({ t: 'look', look: app.look });
}
function renderLookUI() {
  const l = shownLook();
  $$('#lookAcc button').forEach(b => b.classList.toggle('on', (b.dataset.acc === 'scarf') === (l.acc === 'scarf')));
  $('#lookHat').classList.toggle('hidden', l.acc === 'scarf');
  $$('#lookHat button').forEach(b => b.classList.toggle('on', b.dataset.hat === l.acc));
  $$('#lookCols button').forEach(b => b.classList.toggle('on', +b.dataset.col === l.col));
  const c = LOOK_COLORS.find(c => c.hex === l.col);
  $('#lookName').textContent = `${ACCESSORY_NAMES[l.acc]} · ${c ? c.name : 'cor da vaga'}${app.look ? '' : ' (padrão — escolha a sua)'}`;
  if (app.lookPrev) app.lookPrev.setLook(l);
}
$('#lookCols').innerHTML = LOOK_COLORS.map(c => `<button data-col="${c.hex}" title="${c.name}" aria-label="${c.name}" style="background:${lookHex(c.hex)}"></button>`).join('');
$$('#lookCols button').forEach(b => b.addEventListener('click', () => setLook({ ...shownLook(), col: +b.dataset.col })));
$$('#lookAcc button').forEach(b => b.addEventListener('click', () => setLook({ ...shownLook(), acc: b.dataset.acc === 'scarf' ? 'scarf' : app.lastHat })));
$$('#lookHat button').forEach(b => b.addEventListener('click', () => setLook({ ...shownLook(), acc: b.dataset.hat })));
function mountLook(id) {
  const slot = $(id === 'lobby' ? '#lookSlotLobby' : '#lookSlotMode');
  if (slot && $('#lookBox').parentElement !== slot) slot.appendChild($('#lookBox'));
  renderLookUI();
  if (!app.lookPrev && !app.lookPrevLoading && (!isE2E || params.has('lookprev'))) {
    app.lookPrevLoading = true;
    import('./lookPreview.js').then(({ LookPreview }) => { try { app.lookPrev = new LookPreview($('#lookCanvas')); app.lookPrev.setLook(shownLook()); app.lookPrev.start(); } catch (e) { console.warn('prévia da aparência indisponível', e); } });
  }
}
renderLookUI();
function segInit(sel, cb) { $$(sel + ' button').forEach(b => b.addEventListener('click', () => { $$(sel + ' button').forEach(x => x.classList.toggle('on', x === b)); cb(+b.dataset.phase); })); }
// v3: sem seletor de fase para jogadores (sempre começa na Fase 1 e avança 1 → 2 → 3). Só a aba TESTAR JOGO escolhe.
segInit('#tPhase', (p) => app.phase = p);
async function ensureNet() { try { await app.net.connect(); return true; } catch { setErr('Não foi possível conectar ao servidor.'); return false; } }
function setErr(msg) { const el = app.screen === 'lobby' ? $('#lobbyErr') : app.screen === 'testar' ? $('#tErr') : $('#modeErr'); if (el) el.textContent = msg; else toast(msg, 'warn'); }
$('#btnSolo').addEventListener('click', async () => { app.audio.init(); if (await ensureNet()) { app.testMode = false; app.phase = 1; app.net.send({ t: 'solo', name: myName(), ...lookMsg() }); show('loading'); } });
$('#btnCreate').addEventListener('click', async () => { app.audio.init(); if (await ensureNet()) { app.testMode = false; app.phase = 1; app.net.send({ t: 'create', name: myName(), ...lookMsg() }); } });
$('#btnJoin').addEventListener('click', async () => { app.audio.init(); const c = $('#joinCode').value.trim().toUpperCase(); if (c.length < 5) return setErr('Digite o código de 5 letras.'); if (await ensureNet()) { app.testMode = false; app.net.send({ t: 'join', code: c, name: myName(), ...lookMsg() }); } });
// ---------------- TESTAR JOGO ----------------
$('#tSolo').addEventListener('click', async () => { app.audio.init(); if (await ensureNet()) { app.testMode = true; app.diagOn = $('#tDiag').checked; app.net.send({ t: 'solo', name: myName(), ...lookMsg(), phase: app.phase, test: true, seed: $('#tSeed').value.trim() || undefined }); show('loading'); } });
$('#tCreate').addEventListener('click', async () => { app.audio.init(); if (await ensureNet()) { app.testMode = true; app.diagOn = $('#tDiag').checked; app.net.send({ t: 'create', name: myName(), ...lookMsg(), phase: app.phase, test: true, seed: $('#tSeed').value.trim() || undefined }); } });
$('#tJoin').addEventListener('click', async () => { app.audio.init(); const c = $('#tCode').value.trim().toUpperCase(); if (await ensureNet()) { app.testMode = true; app.diagOn = $('#tDiag').checked; app.net.send({ t: 'join', code: c, name: myName(), ...lookMsg() }); } });
$('#tPlaySeed').addEventListener('click', async () => { app.audio.init(); if (!$('#tSeed').value.trim()) $('#tSeed').value = Math.random().toString(36).slice(2, 10); if (await ensureNet()) { app.testMode = true; app.diagOn = $('#tDiag').checked; app.net.send({ t: 'solo', name: myName(), ...lookMsg(), phase: app.phase, test: true, seed: $('#tSeed').value.trim() }); show('loading'); } });
$('#tGen').addEventListener('click', () => {
  const seed = $('#tSeed').value.trim() || Math.random().toString(36).slice(2, 10);
  $('#tSeed').value = seed;
  const t0 = performance.now();
  const m = generateMansion(seed, { noCache: true });
  const v = validateMap(m);
  const ms = (performance.now() - t0).toFixed(0);
  $('#tGenOut').textContent = `Semente: ${seed}  (gerador v${m.version}, tentativa ${m.attempt}${m.fallbackFrom ? ', usou configuração de reserva' : ''})\nValidação: ${v.ok ? 'OK — conectividade, chaves, saída, spawns, navegação da criatura, colisões e rotas alternativas' : 'FALHOU: ' + v.errors.join('; ')}\nSalas: ${m.rooms.length} · Portas: ${m.doors.length} · Esconderijos de chave: ${m.containers.length} · Móveis: ${m.props.length} · Objetos derrubáveis: ${m.knockables.length} · Hash: ${m.hash} · ${ms} ms`;
  drawMap($('#tMap'), m, null);
});
export function drawMap(cv, m, diag) {
  const g = cv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
  const col = { [T.FLOOR]: '#3a3430', [T.WALL]: '#9a8a70', [T.DOOR]: '#c86a30', [T.STAIR]: '#5a8ac8', [T.LOW]: '#5a4a3a', [T.TALL]: '#7a5a3a', [T.EXIT]: '#40d040', [T.HOLE]: '#101828', [T.CURTAIN]: '#7a2030', [T.VOID]: '#000' };
  const names = ['Porão', 'Térreo', '2º andar', 'Sótão'];
  const s = Math.min((cv.width / 2 - 10) / W, (cv.height / 2 - 24) / D);
  for (let L = 0; L < 4; L++) {
    const ox = (L % 2) * cv.width / 2 + 5, oy = Math.floor(L / 2) * cv.height / 2 + 18;
    g.fillStyle = '#ccc'; g.font = '12px monospace'; g.fillText(names[L], ox, oy - 5);
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) { const t = m.levels[L].grid[z * W + x]; if (t === T.VOID) continue; g.fillStyle = col[t]; g.fillRect(ox + x * s, oy + (D - 1 - z) * s, s + 0.3, s + 0.3); }
    g.fillStyle = '#ffd040'; for (const c of m.containers) if (c.level === L) g.fillRect(ox + c.access[0] * s, oy + (D - 1 - c.access[1]) * s, s, s);
    if (L === 1) { g.fillStyle = '#40e0ff'; for (const sp of m.spawns) g.fillRect(ox + sp.x / CELL * s - 1, oy + (D - sp.z / CELL) * s - 1, 3, 3); }
    if (m.creatureSpawn && m.creatureSpawn.level === L) { g.fillStyle = '#ff3030'; g.beginPath(); g.arc(ox + m.creatureSpawn.x / CELL * s, oy + (D - m.creatureSpawn.z / CELL) * s, 3, 0, 7); g.fill(); }
  }
}
// ---------------- lobby ----------------
$('#btnCopyCode').addEventListener('click', () => copy(app.room?.code, 'Código copiado!'));
$('#btnShare').addEventListener('click', async () => {
  const url = `${location.origin}/?sala=${app.room?.code}`;
  if (navigator.share) { try { await navigator.share({ title: 'NÃO SE MEXA!', text: 'Entre na minha sala de NÃO SE MEXA!', url }); return; } catch { } }
  copy(url, 'Link de convite copiado: ' + url);
});
function copy(text, msg) {
  if (!text) return;
  const done = () => { $('#shareHint').textContent = msg; };
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done)); else fallbackCopy(text, done);
}
function fallbackCopy(text, done) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch { } ta.remove(); done(); }
$('#btnReady').addEventListener('click', () => { const me = app.room?.players.find(p => p.id === app.myId); app.net.send({ t: 'ready', ready: !(me && me.ready) }); });
$('#btnStart').addEventListener('click', () => app.net.send({ t: 'start' }));
$('#btnLeave').addEventListener('click', () => leaveToMenu());
function renderLobby() {
  const r = app.room; if (!r) return;
  if (!app.look) renderLookUI(); // aparência padrão da vaga (vinda do servidor)
  $('#lobbyCode').textContent = r.code;
  $('#lobbyCount').textContent = `(${r.players.length}/${r.max})`;
  const isHost = r.hostId === app.myId;
  $('#lobbyPlayers').innerHTML = r.players.map(p => `<li><span>${p.look ? `<i class="look-dot" style="background:${lookHex(p.look.col)}"></i>` : ''}${esc(p.name)}${p.id === app.myId ? ' (você)' : ''}${p.isHost ? '<span class="tag">anfitrião</span>' : ''}${p.look ? `<span class="look-acc">${ACCESSORY_NAMES[p.look.acc] || ''}</span>` : ''}</span><span>${p.connected ? '' : '<span class="tag off">desconectado</span>'}${p.isHost ? '<span class="tag ok">pronto</span>' : p.ready ? '<span class="tag ok">pronto</span>' : '<span class="tag wait">aguardando</span>'}</span></li>`).join('');
  { const ph = PHASES[r.phase] || PHASES[1]; $('#lobbyPhaseInfo').textContent = `Próxima partida: ${ph.wake[0].replace(/\.$/, '')}${r.test ? ' (aba de testes)' : ''}`; }
  const notReady = r.players.filter(p => !p.isHost && p.connected && !p.ready);
  $('#btnStart').style.display = isHost ? '' : 'none';
  $('#btnStart').disabled = notReady.length > 0;
  $('#btnReady').style.display = isHost ? 'none' : '';
  const me = r.players.find(p => p.id === app.myId);
  $('#btnReady').textContent = me && me.ready ? 'Cancelar pronto' : 'Estou pronto';
  $('#lobbyHint').textContent = isHost ? (notReady.length ? `Aguardando: ${notReady.map(p => p.name).join(', ')}` : r.players.length === 1 ? 'Você pode iniciar sozinho ou esperar amigos (envie o código).' : 'Todos prontos — inicie quando quiser.') : 'Aguardando o anfitrião iniciar a partida.';
  $('#lobbyConn').textContent = app.net.state === 'open' ? '● conectado' : '● sem conexão'; $('#lobbyConn').className = 'conn ' + (app.net.state === 'open' ? 'ok' : 'bad');
}
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// ---------------- configurações ----------------
function fillSettings() {
  const s = app.settings;
  $('#setQuality').value = s.quality; $('#setRes').value = s.resScale; $('#setMaster').value = s.master; $('#setSfx').value = s.sfx; $('#setAmb').value = s.ambient; $('#setMusic').value = s.music ?? 0.6; $('#setSens').value = s.sensitivity; $('#setFov').value = s.fov; $('#setInvert').checked = !!s.invertY;
  $('#setDyn').checked = !!s.dynRes; $('#setFps').value = String(s.fpsTarget ?? 60); $('#setMaxRes').value = s.maxRes || 'native'; $('#setSharp').value = s.sharpness ?? 0.5; $('#setShowFps').checked = !!s.showFps;
  labels();
}
function labels() { const s = app.settings; $('#vRes').textContent = Math.round(s.resScale * 100) + '%'; $('#vMaster').textContent = Math.round(s.master * 100) + '%'; $('#vSfx').textContent = Math.round(s.sfx * 100) + '%'; $('#vAmb').textContent = Math.round(s.ambient * 100) + '%'; $('#vMusic').textContent = Math.round((s.music ?? 0.6) * 100) + '%'; $('#vSens').textContent = (+s.sensitivity).toFixed(2) + '×'; $('#vFov').textContent = s.fov + '°'; $('#vSharp').textContent = Math.round((s.sharpness ?? 0.5) * 100) + '%'; $('#vRes').textContent = s.dynRes ? 'automática' : Math.round(s.resScale * 100) + '%'; $('#setRes').disabled = !!s.dynRes; }
function applySettings() {
  const s = app.settings;
  const prevQ = s.quality;
  s.quality = $('#setQuality').value; s.resScale = +$('#setRes').value; s.master = +$('#setMaster').value; s.sfx = +$('#setSfx').value; s.ambient = +$('#setAmb').value; s.music = +$('#setMusic').value; s.sensitivity = +$('#setSens').value; s.fov = +$('#setFov').value; s.invertY = $('#setInvert').checked;
  s.dynRes = $('#setDyn').checked; s.fpsTarget = +$('#setFps').value; s.maxRes = $('#setMaxRes').value; s.sharpness = +$('#setSharp').value; s.showFps = $('#setShowFps').checked;
  // escolher Ultra libera a saída até 4K (o preset sozinho não muda a resolução máxima)
  if (s.quality === 'ultra' && prevQ !== 'ultra' && s.maxRes !== 'native') { s.maxRes = '2160'; $('#setMaxRes').value = '2160'; }
  app.saveSettings(); labels(); fpsBox();
  app.audio.setVolumes({ master: s.master, sfx: s.sfx, ambient: s.ambient, music: s.music });
  if (app.renderer) app.renderer.applySettings(renderSettings());
}
for (const id of ['#setDyn', '#setFps', '#setMaxRes', '#setSharp', '#setShowFps', '#setQuality', '#setRes', '#setMaster', '#setSfx', '#setAmb', '#setMusic', '#setSens', '#setFov', '#setInvert']) $(id).addEventListener('input', applySettings);
// v4: painel de FPS / resolução de render (F3 ou Configurações)
function fpsBox() { $('#fpsBox').classList.toggle('hidden', !app.settings.showFps); }
window.addEventListener('keydown', (e) => { if (e.code === 'F3') { e.preventDefault(); app.settings.showFps = !app.settings.showFps; app.saveSettings(); fpsBox(); } });
let fpsAcc = 0;
function renderFps(dt) {
  fpsAcc += dt; if (fpsAcc < 0.25 || !app.settings.showFps || !app.renderer) return; fpsAcc = 0;
  const st = app.renderer.stats();
  $('#fpsBox').textContent = `${st.fps.toFixed(0)} FPS · ${st.ms.toFixed(1)} ms\nRender ${st.rw}×${st.rh} (${Math.round(st.scale * 100)}%) → tela ${st.ow}×${st.oh}\n${st.dyn ? 'Resolução dinâmica' : 'Resolução fixa'} · ${st.calls} draw calls · ${(st.tris / 1000).toFixed(0)} mil triângulos`;
}
fpsBox();
$('#btnTestSound').addEventListener('click', () => { app.audio.init(); app.audio.play('door_rusty', null); setTimeout(() => app.audio.play('cstep', null), 700); });
$('#settingsBack').addEventListener('click', () => { if (app.fromPause) { app.fromPause = false; show(null); overlay('pause', true); } else show('menu'); });
// ---------------- rede ----------------
const net = app.net;
net.on('joined', (m) => {
  app.myId = m.id; app.room = m.room;
  sessionStorage.setItem('nsm_session', JSON.stringify({ code: m.code, token: m.token }));
  if (!m.resumed && !m.room.solo && m.room.state === 'lobby') { show('lobby'); renderLobby(); }
});
net.on('room', (m) => { app.room = m.room; if (app.screen === 'lobby') renderLobby(); if (app.game) app.game.roomInfo = m.room; if (app.screen === 'lobby' && m.room.state === 'playing' && !app.game) { /* aguardando start */ } });
net.on('error', (m) => setErr(m.msg));
net.on('host', (m) => toast(m.id === app.myId ? 'Você agora é o anfitrião da sala.' : `${m.name} agora é o anfitrião.`, 'info'));
net.on('start', (m) => startGame(m));
net.on('s', (m) => app.game && app.game.onSnapshot(m));
net.on('ev', (m) => app.game && app.game.onEvents(m.events));
net.on('corr', (m) => app.game && app.game.onCorrection(m));
net.on('ires', (m) => app.game && app.game.onInteractResult(m));
net.on('end', (m) => app.game && app.game.onEnd(m));
net.on('diag', (m) => { app.lastDiag = m; });
net.on('tolobby', () => { stopGame(); show('lobby'); renderLobby(); });
net.on('reconnecting', () => { if (app.game || app.screen === 'lobby') overlay('reconnecting', true); });
net.on('reconnected', () => { overlay('reconnecting', false); toast('Reconectado!', 'info'); });
net.on('resume_fail', (m) => { overlay('reconnecting', false); sessionStorage.removeItem('nsm_session'); if (app.game || app.screen === 'lobby') { const el = document.getElementById('dcMsg'); if (el) el.textContent = app.serverRestart ? 'O servidor do jogo foi reiniciado (atualização) e a partida foi perdida. Crie uma nova sala.' : 'A conexão caiu e a sala não existe mais no servidor (ele pode ter reiniciado). Crie uma nova sala.'; overlay('disconnected', true); } });
net.on('fatal', () => { overlay('reconnecting', false); overlay('disconnected', true); app.input.unlock(); });
// v2: o servidor avisou que vai reiniciar (atualização/deploy) — explica em vez de "caiu do nada"
net.on('server_restart', (m) => { app.serverRestart = true; const el = document.getElementById('dcMsg'); if (el) el.textContent = m.msg || 'O servidor foi reiniciado.'; });
$('#btnDcMenu').addEventListener('click', () => { location.href = isTest ? '/testar' : '/'; });

// ---------------- partida ----------------
async function startGame(m) {
  hideOverlays();
  const token = app.loadToken = (app.loadToken || 0) + 1;
  if (m.phase) app.phase = m.phase;
  show('loading'); app.loading.setPhase(m.phase || app.phase);
  const L = app.loading;
  try {
    await L.step(0.12, 'Gerando a mansão (semente ' + m.seed + ')…');
    if (!app.renderer) {
      app.renderer = new Renderer($('#stage'), renderSettings());
      await L.step(0.28, 'Preparando o renderizador…');
      app.M = buildMaterials(app.renderer.q.tex);
    }
    L.setMaterials(app.M);
    await L.step(0.5, 'Texturas e materiais prontos. Mobiliando os cômodos…');
    if (token !== app.loadToken) return;
    stopGame(true);
    app.game = new Game(app, m);
    await L.step(0.82, 'Escondendo as chaves…');
    if (!app.game.hashOk) { console.warn('[mapa] hash diferente do servidor', m.gen, m.mapHash, app.game.map.hash); toast(app.game.genVersionOk ? 'Aviso: mapa diferente do servidor. Recarregue a página.' : 'Aviso: versão do jogo diferente da do servidor. Recarregue a página.', 'warn'); }
    if (!m.resumed) { app.stats.started = (app.stats.started || 0) + 1; app.saveStats(); }
    // compila os shaders do jogo com um quadro antes de revelar
    try { app.renderer.render(); } catch { }
    await L.step(0.94, 'Acordando a criatura…');
    await L.finish(isE2E ? 0 : 2500);
    if (token !== app.loadToken || !app.game) return;
    const pre = m.state && m.state.pre;
    if (pre) app.wake.waiting(m.phase || app.phase, !(app.room && app.room.solo)); // tela preta já por baixo do fade
    L.leave();
    show(null);
    $('#diag').classList.toggle('hidden', !(m.test && app.diagOn));
    app.input.enabled = true;
    if (pre) {
      // v3: avisa o servidor que carregou; a cena "acordando" começa quando todos carregarem ('go')
      $('#hud').classList.add('hidden');
      net.send({ t: 'loaded' });
      if (pre.stage === 'intro') app.onWakeGo(app.game, pre.left);
    } else {
      $('#hud').classList.remove('hidden');
      if (!app.input.locked && !params.has('e2e')) overlay('clickToPlay', true);
    }
    app.playing = true; updateMusic();
    if (!app.loop) { app.last = performance.now(); app.loop = true; requestAnimationFrame(frame); }
    if (app.game.p.alive === false) { app.game.deathT = performance.now() - 5000; app.game.deathCam = { yaw: 0, pitch: 0 }; }
  } catch (e) { console.error(e); L.close(); toast('Erro ao iniciar: ' + e.message, 'warn'); show('menu'); }
}
// v3: cena "acordando" (sincronizada pelo servidor: 'go' inicia, 'begin' libera a partida)
app.wake = new WakeScene(app);
app.onWakeGo = (g, dur) => {
  if (!g.wakeCam) g.wakeCam = { t0: performance.now() - Math.max(0, 8 - (dur || 8)) * 1000, dur: 8000 };
  app.wakeRunning = true; updateMusic();
  app.wake.play(g.phase, dur).then(() => { app.wakeRunning = false; updateMusic(); });
};
app.onWakeEnd = (g) => {
  app.wake.finish(); app.wakeRunning = false;
  if (app.game !== g) return;
  $('#hud').classList.remove('hidden');
  if (!app.input.locked && !params.has('e2e') && g.p.alive) overlay('clickToPlay', true);
  updateMusic();
};
function stopGame(keepHud) {
  if (app.wake && app.wake.active) app.wake.finish();
  if (app.game) { app.game.dispose(); app.game = null; }
  app.playing = false;
  app.music.setTension(0, false);
  if (!keepHud) { $('#hud').classList.add('hidden'); $('#diag').classList.add('hidden'); app.input.enabled = false; app.input.unlock(); }
}
function leaveToMenu() {
  net.leave(); sessionStorage.removeItem('nsm_session');
  stopGame(); hideOverlays();
  show(isTest ? 'testar' : 'menu');
}
let diagAcc = 0, musicAcc = 0, lastEnded = false;
// tensão automática da música: estado e distância da criatura (game.js pode chamar window.__music.setTension direto)
const STATE_T = { chase: 1, attack: 1, kill: 1, persegue: 1, perseguindo: 1, investigate: 0.6, investigando: 0.6, search: 0.55, procurando: 0.55, farejando: 0.5, sniff: 0.5, hear: 0.5, alert: 0.7 };
function musicTension(dt) {
  const g = app.game;
  if (g.ended !== lastEnded) { lastEnded = g.ended; updateMusic(); }
  musicAcc += dt; if (musicAcc < 0.2) return; musicAcc = 0;
  try {
    if (!g.p.alive || g.p.escaped || g.ended) return app.music.autoTension(0.15);
    const cs = g.crState || (g.lastSnap && g.lastSnap.creature);
    let k = 0.12;
    if (cs) {
      const d = cs.level === g.p.level ? Math.hypot(cs.x - g.p.x, cs.z - g.p.z) : 40 + Math.abs(cs.level - g.p.level) * 10;
      k = Math.max(k, Math.max(0, 1 - d / 26) * 0.75);
      const st = String(cs.state || '').toLowerCase();
      for (const key in STATE_T) if (st.includes(key)) { k = Math.max(k, STATE_T[key] * (d < 30 ? 1 : 0.6)); break; }
    }
    app.music.autoTension(k);
  } catch { }
}
function frame(now) {
  requestAnimationFrame(frame);
  if (app.renderer && !app.noRender && !app.renderer.shouldRender(now)) return; // v4: limite de FPS (30/60/120)
  const dt = Math.min(0.05, (now - app.last) / 1000); app.last = now;
  if (!app.game) return;
  try { app.game.update(dt); } catch (e) { console.error(e); }
  musicTension(dt);
  renderFps(dt);
  if (!app.noRender) app.renderer.render(); // noRender: usado só pelo teste E2E para poupar CPU entre capturas
  diagAcc += dt;
  if (diagAcc > 0.25 && !$('#diag').classList.contains('hidden')) { diagAcc = 0; renderDiag(); }
}
// clique para jogar / pausa
$('#clickToPlay').addEventListener('click', () => { app.audio.init(); app.input.lock(); overlay('clickToPlay', false); });
$('#stage').addEventListener('click', () => { if (app.game && !app.input.locked && app.game.p.alive && !app.game.ended && $('#pause').classList.contains('hidden')) { app.audio.init(); app.input.lock(); } });
app.input.on('unlock', () => { if (app.game && app.game.p.alive && !app.game.p.escaped && !app.game.ended) { app.game.paused = true; overlay('pause', true); } });
document.addEventListener('pointerlockchange', () => { if (app.input.locked && app.game) { app.game.paused = false; overlay('pause', false); overlay('clickToPlay', false); } });
$('#btnResume').addEventListener('click', () => { overlay('pause', false); if (app.game) app.game.paused = false; app.input.lock(); });
$('#btnPauseSettings').addEventListener('click', () => { overlay('pause', false); app.fromPause = true; show('settings'); });
$('#btnQuit').addEventListener('click', () => leaveToMenu());
app.input.on('key', (code) => {
  const g = app.game; if (!g) return;
  if (code === 'KeyE') g.interact();
  if (code === 'KeyF') g.toggleFlashlight();
  if (code === 'Escape' && !app.input.locked && !g.ended && g.p.alive) { const on = $('#pause').classList.contains('hidden'); overlay('pause', on); g.paused = on; }
  if ((code === 'KeyQ' || code === 'Space') && (!g.p.alive || g.p.escaped)) g.cycleSpectator();
});
app.input.on('mouse', () => { const g = app.game; if (g && (!g.p.alive || g.p.escaped)) g.cycleSpectator(); });
$('#stage').addEventListener('mousedown', () => { const g = app.game; if (g && (!g.p.alive || g.p.escaped) && !app.input.locked) g.cycleSpectator(); });
// morte / fuga / fim
$('#btnSpectate').addEventListener('click', () => { overlay('death', false); if (app.game) app.game.spectate = app.game.spectate || null; });
$('#btnDeathMenu').addEventListener('click', () => leaveToMenu());
$('#btnEscSpectate').addEventListener('click', () => overlay('escaped', false));
// v3: o servidor decide a fase: 'next' (venceu → próxima), 'fresh' (venceu a 3 → recomeça na 1) ou repetir a mesma
$('#btnAgain').addEventListener('click', () => { const g = app.game; const won3 = g && g.phase >= 3 && g.lastResult === 'win'; net.send({ t: 'restart', phase: g ? g.phase : app.phase, fresh: won3 }); });
$('#btnNext').addEventListener('click', () => net.send({ t: 'restart', next: true, phase: Math.min(3, (app.game ? app.game.phase : 1) + 1) }));
$('#btnEndLobby').addEventListener('click', () => net.send({ t: 'lobby' }));
$('#btnEndMenu').addEventListener('click', () => leaveToMenu());

// ---------------- UI usada pelo jogo ----------------
const hudCache = {};
function setText(id, txt) { if (hudCache[id] !== txt) { hudCache[id] = txt; $(id).innerHTML = txt; } }
function toast(text, kind = 'info') {
  const el = document.createElement('div'); el.className = 'toast ' + kind; el.textContent = text;
  $('#toasts').appendChild(el);
  while ($('#toasts').children.length > 4) $('#toasts').firstChild.remove();
  setTimeout(() => el.remove(), 4200);
}
app.ui = {
  toast,
  setPrompt(t) { const el = $('#prompt'); if (hudCache.prompt !== t) { hudCache.prompt = t; el.textContent = t; el.classList.toggle('on', !!t); } },
  updateHud(g) {
    setText('#hPhase', PHASES[g.phase].title);
    const nk = g.myKeys || 0;
    setText('#hKeys', `${nk ? `Você tem ${nk} chave${nk > 1 ? 's' : ''}` : 'Você não tem chaves'}<br><span class="door">Porta de saída: ${g.deposited}/${g.keysNeeded} chaves colocadas</span>`);
    let obj;
    if (g.exitOpen) obj = 'Objetivo: escape pela porta principal do hall!';
    else if (nk > 0) obj = 'Objetivo: leve as chaves até a porta de saída (ela aparece através das paredes).';
    else obj = `Objetivo: ache as ${g.keysNeeded} chaves (gavetas, armários, sobre mesas) e coloque na porta.`;
    if (!g.p.alive) obj = 'Você foi encontrado — observando os sobreviventes.';
    else if (g.p.escaped) obj = 'Você escapou — aguardando os colegas.';
    setText('#hObj', obj);
    const meta = g.playersMeta ? [...g.playersMeta.values()] : [];
    const snapP = g.lastSnap ? g.lastSnap.players : [];
    const rows = (snapP.length ? snapP : meta).map(sp => {
      const mt = g.playersMeta.get(sp.id) || {};
      const alive = sp.alive ?? mt.alive, escd = sp.escaped ?? mt.escaped, conn = sp.conn ?? mt.conn ?? true;
      // v2: ninguém é avisado da morte de um colega — só quem achou o corpo (ou o próprio morto) sabe
      const known = sp.id === app.myId || (g.foundBodies && g.foundBodies.has(sp.id)) || !g.p.alive || g.ended;
      const st = escd ? '<span class="esc">escapou</span>' : (!alive && known) ? '<span class="dead">morto</span>' : !conn ? '<span class="dc">desconectado</span>' : (sp.id === app.myId ? 'vivo' : '…');
      return `<li>${esc(g.name(sp.id))} — ${st}</li>`;
    });
    setText('#hPlayers', rows.join(''));
    const ping = Math.round(app.net.ping);
    setText('#hConn', app.net.state !== 'open' ? 'Sem conexão com o servidor…' : ping > 220 ? `Conexão instável (${ping} ms)` : '');
    $('#stamina div').style.width = (g.p.stamina / 6 * 100).toFixed(0) + '%';
    setText('#hFl', g.p.fl ? '◉ lanterna ligada [F]' : '○ lanterna desligada [F]');
    setText('#hCrouch', g.p.crouch ? 'agachado' : '');
    $('#vignette').classList.toggle('hurt', !g.p.alive);
    $('#crosshair').style.display = g.p.alive && !g.p.escaped ? '' : 'none';
  },
  setSpectator(g, name) { const el = $('#spec'); el.classList.toggle('hidden', !(!g.p.alive || g.p.escaped)); setText('#spec', name ? `ESPECTADOR — observando ${esc(name)} · clique ou Q para alternar` : 'ESPECTADOR — nenhum sobrevivente para observar'); },
  showDeath() { if (!app.game || app.game.ended) return; app.input.unlock(); $('#deathInfo').textContent = 'A criatura te tocou. Você pode observar os sobreviventes até o fim da partida.'; overlay('death', true); },
  showEscaped() { app.input.unlock(); overlay('escaped', true); },
  showEnd(m, g) {
    hideOverlays(); app.input.unlock();
    $('#endTitle').textContent = m.result === 'win' ? 'VOCÊS CONSEGUIRAM ESCAPAR' : 'TODOS FORAM ENCONTRADOS';
    const s = m.stats;
    $('#endInfo').innerHTML = `<p>${PHASES[s.phase].title} · Duração ${fmtT(s.duration)} · Chaves ${s.keys}/${s.keysNeeded} · Semente <code>${esc(s.seed)}</code></p><table><tr><th>Jogador</th><th>Resultado</th><th>Chaves</th><th>Tempo vivo</th></tr>${s.players.map(p => `<tr><td>${esc(p.name)}${p.id === app.myId ? ' (você)' : ''}</td><td>${p.escaped ? 'escapou' : p.left ? 'saiu' : p.alive ? '—' : 'morto'}</td><td>${p.keys}</td><td>${fmtT(p.survived)}</td></tr>`).join('')}</table>`;
    const isHost = app.room && app.room.hostId === app.myId;
    $('#btnAgain').disabled = !isHost; $('#btnNext').disabled = !isHost; $('#btnEndLobby').disabled = !isHost;
    if (g) g.lastResult = m.result;
    $('#btnNext').style.display = s.phase < 3 && m.result === 'win' ? '' : 'none';
    $('#btnNext').textContent = `Próxima fase — Fase ${Math.min(3, s.phase + 1)}`;
    $('#btnEndLobby').style.display = app.room && app.room.solo ? 'none' : '';
    $('#btnAgain').textContent = m.result === 'win' ? (s.phase >= 3 ? 'Jogar de novo desde a Fase 1' : 'Repetir esta fase') : 'Tentar novamente';
    $('#endHint').textContent = isHost ? 'Uma nova partida gera uma nova mansão e novos esconderijos de chave.' : 'Aguardando o anfitrião escolher…';
    overlay('end', true);
  },
};
function ORD(i) { return ['primeira', 'segunda', 'terceira'][i] || 'próxima'; }
// ---------------- diagnóstico ----------------
$('#diagToggle').addEventListener('click', () => { const b = $('#diagBody'); b.classList.toggle('hidden'); });
$('#diagNew').addEventListener('click', () => net.send({ t: 'restart' }));
$('#diagApply').addEventListener('click', () => { const s = $('#diagSeed').value.trim(); if (s) net.send({ t: 'restart', seed: s }); });
$('#diagCopy').addEventListener('click', () => { if (app.game) copy(app.game.seed, ''); toast('Semente copiada: ' + (app.game && app.game.seed), 'info'); });
$('#diagSeed').addEventListener('keydown', (e) => e.stopPropagation());
function renderDiag() {
  const d = app.lastDiag, g = app.game; if (!g) return;
  const c = d && d.creature;
  const lines = [];
  lines.push(`Semente: ${g.seed}  (gerador v${d ? d.genVersion : '?'})${d && d.fallback ? ' [reserva]' : ''}`);
  lines.push(`Conexão: ${app.net.state} · ping ${Math.round(app.net.ping)} ms · sala ${app.room ? app.room.code : '-'}`);
  if (c) {
    lines.push(`Criatura: ${c.label} [${c.state}/${c.anim}] v=${c.speed}`);
    lines.push(`Andar ${c.level} · pos (${c.x}, ${c.z})`);
    lines.push(`Sentidos: visão ${c.senses.visao ? 'SIM' : 'não'} · audição ${c.senses.audicao ? 'SIM' : 'não'} · olfato ${c.senses.olfato ? 'SIM' : 'não'}`);
    lines.push(`Último som percebido: ${c.lastSound ? `${c.lastSound.type} (${c.lastSound.dist} m, t=${c.lastSound.t.toFixed(1)})` : '—'}`);
    lines.push(`Última região investigada: ${c.lastInvestigated ? `${c.lastInvestigated.room} — ${c.lastInvestigated.reason}` : '—'}`);
    lines.push(`Farejamento: ${c.sniff.state}${c.sniff.nextIn !== null ? ` · próximo em ${c.sniff.nextIn}s` : ''} · rastros ativos: ${c.scentCells}`);
    lines.push(`Rastreando jogador: ${c.tracking.length ? 'sim' : 'não'}`);
  }
  if (d) { lines.push(`Chaves: achadas ${d.keys.collected} · na porta ${d.keys.deposited}/${d.keys.needed} · Saída: ${d.exitOpen ? 'ABERTA' : 'trancada'}`); lines.push('Sons recentes: ' + d.recentSounds.map(s => `${s.type}${s.heard ? '*' : ''}`).join(', ')); }
  $('#diagText').textContent = lines.join('\n');
  // minimapa (apenas no diagnóstico)
  const cv = $('#diagMap'), gg = cv.getContext('2d'), L = g.p.level, m = g.map;
  const s = Math.min(cv.width / W, cv.height / D);
  gg.fillStyle = '#000'; gg.fillRect(0, 0, cv.width, cv.height);
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) { const t = m.levels[L].grid[z * W + x]; if (t === T.VOID) continue; gg.fillStyle = t === T.WALL ? '#7a6a50' : t === T.DOOR ? (g.world.doorOpen[m.levels[L].door[z * W + x]] ? '#406020' : '#c86a30') : t === T.STAIR ? '#3a6aa8' : t === T.TALL || t === T.LOW ? '#3a2e24' : '#1e1a18'; gg.fillRect(x * s, (D - 1 - z) * s, s, s); }
  if (d && d.keys.spots) for (const k of d.keys.spots) { if (k.level === L && k.state === 'placed') { gg.fillStyle = '#ffd040'; gg.fillRect(k.ax / CELL * s - 1, (D - k.az / CELL) * s - 1, 3, 3); } }
  gg.fillStyle = '#40e0ff'; gg.beginPath(); gg.arc(g.p.x / CELL * s, (D - g.p.z / CELL) * s, 2.5, 0, 7); gg.fill();
  for (const mt of g.mates.values()) { gg.fillStyle = '#80ff80'; gg.fillRect(mt.rx / CELL * s - 1, (D - mt.rz / CELL) * s - 1, 3, 3); }
  if (c && c.level === L) { gg.fillStyle = '#ff2020'; gg.beginPath(); gg.arc(c.x / CELL * s, (D - c.z / CELL) * s, 3.5, 0, 7); gg.fill(); }
}

// ---------------- início ----------------
// a 1ª interação desbloqueia o som e começa o tema do menu
const firstGesture = () => { app.audio.init(); updateMusic(); $('#menuSound').classList.add('gone'); };
if (isE2E && !params.has('menu3d')) document.body.classList.add('e2e');
window.addEventListener('pointerdown', firstGesture, { once: true }); window.addEventListener('keydown', firstGesture, { once: true });
if (shouldShowIntro(params, isTest)) {
  app.introRunning = true;
  runIntro(app.audio).then(() => { app.introRunning = false; updateMusic(); updateMenuBack(); });
}
show(isTest ? 'testar' : 'menu');
if (params.get('sala')) {
  $('#joinCode').value = params.get('sala').toUpperCase();
  show('mode'); $('#modeErr').textContent = 'Você recebeu um convite. Digite seu nome e clique em Entrar.';
}
// retoma a sessão após recarregar a página
const saved = sessionStorage.getItem('nsm_session');
if (saved && !params.has('e2e')) {
  try { const s = JSON.parse(saved); net.session = { code: s.code, token: s.token }; net.connect().then(() => net.send({ t: 'resume', code: s.code, token: s.token })).catch(() => { }); } catch { }
}
