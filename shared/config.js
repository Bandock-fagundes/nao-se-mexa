// Constantes compartilhadas entre servidor e cliente.
export const GEN_VERSION = 6; // v3 (jam): planta nova — hall central com escadaria, alas de cômodos interligados, tamanho por nº de jogadores
export const FALLBACK_SEED = 'casa-fallback-1';

export const CELL = 0.5;      // metros por célula da grade
export const W = 84;          // células no eixo X (42 m)
export const D = 50;          // células no eixo Z (25 m)

// Linhas fixas da planta (em células)
export const ROWS = {
  southA: 1, southB: 26, wallS: 27,
  corrA: 28, corrB: 31, wallN: 32,
  northA: 33, northB: 48,
};
export const STAIR_LEN = 12;  // 6 m de rampa
export const STAIR_W = 3;     // 1,5 m de largura
export const STAIR_SLOT = 7;  // escada (3) + parede de apoio (1) + passagem (3)
export const GRAND_STAIR_W = 6; // v3: escadaria principal do hall (3 m de largura)
// v3: tamanho da mansão por número de jogadores (1 = compacta, 2 = média, 3 = grande) — largura em células
export const MANSION_SIZES = { 1: [58, 62], 2: [68, 72], 3: [78, 82] };

export const LEVELS = [
  { id: 0, key: 'basement', name: 'Porão', y: -3.6, h: 3.0 },
  { id: 1, key: 'ground', name: 'Térreo', y: 0, h: 3.4 },
  { id: 2, key: 'upper', name: 'Segundo andar', y: 3.8, h: 3.4 },
  { id: 3, key: 'attic', name: 'Sótão', y: 7.6, h: 2.6 },
];

// Tipos de célula
export const T = { VOID: 0, FLOOR: 1, WALL: 2, DOOR: 3, STAIR: 4, LOW: 5, TALL: 6, EXIT: 7, HOLE: 8, CURTAIN: 9 };

export const PHASES = {
  // v2: sempre 3 chaves por casa (depositadas na porta por qualquer jogador, em parcelas)
  1: { keys: 3, vision: true, hearing: false, smell: false, title: 'FASE 1 — A CRIATURA VÊ', wake: ['FASE 1 — ELE VÊ.', 'Não se mexa quando ele estiver perto.'] },
  2: { keys: 3, vision: true, hearing: true, smell: false, title: 'FASE 2 — A CRIATURA ESCUTA', wake: ['FASE 2 — ELE OUVE.', 'Faça o mínimo de barulho.'] },
  3: { keys: 3, vision: true, hearing: true, smell: true, title: 'FASE 3 — A CRIATURA FAREJA', wake: ['FASE 3 — ELE SENTE SEU CHEIRO.', 'Ele vai te farejar.'] },
};
export const MAX_PHASE = 3;
// v3: cena "acordando" no início de cada fase. O servidor espera todos carregarem (até waitMax s), manda 'go'
// e congela a partida (criatura parada, ninguém se move nem morre) durante 'seconds'.
export const WAKE = { seconds: 8, waitMax: 25 };

export const PLAYER = {
  radius: 0.24,
  walk: 2.6, run: 5.0, crouch: 1.3,
  eye: 1.62, crouchEye: 1.0,
  staminaMax: 6.0, staminaRegen: 0.8, // segundos de corrida; regen por segundo
  jumpV: 3.6, gravity: 11,
};

export const CREATURE = {
  radius: 0.5,
  height: 3.0,
  eye: 2.7,
  // v2: um pouco acima do normal (sem seletor de dificuldade). rush = corrida até um som distante;
  // backstage = deslocamento quando ninguém a vê e ela está longe de todos (aparece "do nada", sem teleporte)
  speed: { patrol: 1.45, investigate: 1.9, search: 1.6, chase: [0, 4.4, 4.6, 4.8], scent: 1.9, rush: 4.1, backstage: 3.4 },
  turnRate: { slow: 2.4, fast: 5.5 },
  contactDist: 1.05,     // centro a centro (raio criatura + raio jogador + margem)
  attackRange: 1.75,     // inicia ataque
  attackReach: 1.55,     // alcance do golpe (com linha livre)
};

// Parâmetros de IA (ajustáveis)
export const AI = {
  fovDeg: 100,
  visionRange: [0, 19, 21, 23],   // por fase, metros (faixa 15–25)
  stalkRange: 11.5,               // viu se mexer mais longe que isto: vai andando na direção (não dispara)
  visionTick: 0.15,               // s entre checagens de visão
  moveSpeedThreshold: 0.35,       // m/s de deslocamento do corpo para contar como movimento
  standUpWindow: 0.6,             // levantar-se de agachado conta como movimento por este tempo
  detectionMemory: 2.0,           // s que uma detecção visual permanece válida sem novo movimento
  alertTime: 0.55,                // s parada repentina + confirmação antes de perseguir
  flashlight: { rangeMul: 1.3, darkRangeMul: 0.75, fovBonusDeg: 20, beamHalfDeg: 24, beamRange: 15 },
  hearingThreshold: 1.0,          // percebe se distância <= alcance efetivo
  wallAtten: 0.45, doorAtten: 0.6, tallAtten: 0.85, levelAtten: 0.4,
  searchTime: [4, 7],
  recoverTime: [1.5, 3],
  sniffInterval: [20, 30],
  sniffDuration: 2.2,
  sniffRadius: 14,                 // metros de caminho navegável
  scentThreshold: 0.12,
  scentGiveUp: 22,                 // s sem novo sinal → abandona o rastro
  scentHalfLife: 45,
  graceTime: 6,                    // s iniciais em que a criatura só patrulha devagar
};

// Tabela de eventos sonoros. lvl = nível da v2 (o que a criatura ouve e a cor da onda na tela):
//   'red'    → muito alto: ouvido de QUALQUER lugar da casa
//   'yellow' → médio: ouvido no mesmo andar (qualquer lugar) ou no andar logo abaixo
//   'low'    → baixo: ouvido no mesmo cômodo ou num cômodo vizinho (below: também logo abaixo)
//   null     → silencioso para a criatura (o jogador ainda escuta localmente)
// range/intensity ficam só para o áudio dos clientes e para o diagnóstico.
export const SOUND_TYPES = {
  step_crouch: { range: 0, intensity: 0, duration: 0.15, lvl: null },
  step_walk: { range: 0, intensity: 0.3, duration: 0.2, lvl: null },
  creak: { range: 8, intensity: 0.45, duration: 0.8, lvl: 'low', below: true },
  step_run: { range: 14, intensity: 0.7, duration: 0.2, lvl: 'low', below: true },
  land: { range: 12, intensity: 0.65, duration: 0.3, lvl: 'low', below: true },
  door_wood: { range: 9, intensity: 0.5, duration: 1.0, lvl: 'low' },
  door_heavy: { range: 14, intensity: 0.7, duration: 1.4, lvl: 'yellow' },
  door_rusty: { range: 19, intensity: 0.85, duration: 1.6, lvl: 'yellow' },
  container_drawer: { range: 3, intensity: 0.2, duration: 0.6, lvl: null },
  container_wardrobe: { range: 8, intensity: 0.45, duration: 0.9, lvl: 'low' },
  container_chest: { range: 9, intensity: 0.5, duration: 0.8, lvl: 'low' },
  container_crate: { range: 7, intensity: 0.4, duration: 0.6, lvl: 'low' },
  key_pickup: { range: 3, intensity: 0.2, duration: 0.5, lvl: null },
  key_deposit: { range: 8, intensity: 0.45, duration: 0.8, lvl: 'low' },
  body_search: { range: 3, intensity: 0.2, duration: 0.6, lvl: null },
  wobble: { range: 3, intensity: 0.2, duration: 0.5, lvl: null },
  knock_box: { range: 7, intensity: 0.35, duration: 0.5, lvl: 'low' },
  knock_vase: { range: 13, intensity: 0.7, duration: 0.8, lvl: 'yellow' },
  knock_bottles: { range: 14, intensity: 0.72, duration: 1.0, lvl: 'yellow' },
  knock_candelabrum: { range: 16, intensity: 0.8, duration: 1.2, lvl: 'yellow' },
  knock_bucket: { range: 22, intensity: 0.95, duration: 1.6, lvl: 'red' },
  exit_unlock: { range: 26, intensity: 1.0, duration: 2.5, lvl: 'red' },
};
// chance de a madeira ranger a cada passo andando em pé (nunca correndo nem agachado)
export const CREAK = { chance: 0.13, surfaces: ['wood'] };

export const SURFACE_MUL = { wood: 1.0, stone: 0.9, tile: 1.1, carpet: 0.6 };

// v2: mais tolerância a quedas (reconexão por até 2 min; sala vazia aguarda 3 min antes de ser apagada)
export const NET = { snapRate: 15, inputRate: 20, reconnectGrace: 120, hostMigrateDelay: 10, emptyRoomMs: 180000 };
export const MAX_PLAYERS = 3;
// keepalive HTTP enquanto houver sala ativa (minutos) e limite de fila de envio por cliente (bytes)
export const SERVER = { keepAliveMs: 4 * 60 * 1000, maxBuffered: 256 * 1024, heartbeatMs: 10000 };

// v9b: ILUMINAÇÃO (muito mais escura e assustadora). Valores usados pelo gerador (quais cômodos têm luz) e pelo
// cliente (névoa, ambiente, luminárias, lanterna). Ajuste aqui.
export const LIGHTING = {
  exposure: 0.82,                       // exposição do tone mapping (ACES)
  background: 0x010102,
  hemi: { sky: 0x4a5674, ground: 0x1a130c, intensity: 2.2 },   // luz "de lugar nenhum": só dá forma ao que está perto
  ambient: { color: 0x22262f, intensity: 1.0 },
  // névoa escura exponencial (FogExp2): ~30% a 4 m, ~70% a 8 m, quase preto além de ~12 m
  fog: { color: 0x020203, density: [0.14, 0.12, 0.12, 0.13] }, // por andar: porão, térreo, 2º, sótão
  // gerador: fração dos cômodos que mantêm luminária/vela acesa (o resto fica apagado); lareira sempre acesa
  lampRoomKeep: 0.42,
  lampExtraOff: 0.5,                    // num cômodo aceso, cada luminária além da 1ª tem esta chance de estar apagada
  lampIntensity: 0.7,                   // multiplica a intensidade das luminárias que ficam
  lampRange: 0.6,                       // multiplica o alcance (poça de luz parcial no cômodo)
  // cliente: multiplicadores no pool de luzes
  pool: { lamp: 0.36, fire: 0.75, moon: 0.62, rangeK: 0.75 },
  // lanterna: luz principal, mais realista e fraca
  flashlight: {
    color: 0xffd6a0,                    // ~3500 K (quente, levemente amarelada)
    intensity: 130,                     // candela (decaimento físico)
    distance: 26, decay: 2,             // vai longe, mas fraca
    angle: 0.36, penumbra: 0.8,         // penumbra macia; o "hotspot" vem do mapa de luz (cookie) quando há sombra
    nearDim: 1.5,                       // < 1,5 m de uma superfície: reduz ∝ d² (já existia)
    flickerEvery: [25, 70],             // s entre engasgos raros
    flickerDur: [0.08, 0.35],
    beamStrength: 0.032, beamColor: 0xffe2b8,
    remoteIntensity: 85,
  },
};
