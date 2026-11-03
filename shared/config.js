// Constantes compartilhadas entre servidor e cliente.
export const GEN_VERSION = 4;
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

export const LEVELS = [
  { id: 0, key: 'basement', name: 'Porão', y: -3.6, h: 3.0 },
  { id: 1, key: 'ground', name: 'Térreo', y: 0, h: 3.4 },
  { id: 2, key: 'upper', name: 'Segundo andar', y: 3.8, h: 3.4 },
  { id: 3, key: 'attic', name: 'Sótão', y: 7.6, h: 2.6 },
];

// Tipos de célula
export const T = { VOID: 0, FLOOR: 1, WALL: 2, DOOR: 3, STAIR: 4, LOW: 5, TALL: 6, EXIT: 7, HOLE: 8, CURTAIN: 9 };

export const PHASES = {
  1: { keys: 1, vision: true, hearing: false, smell: false, title: 'FASE 1 — A CRIATURA VÊ' },
  2: { keys: 2, vision: true, hearing: true, smell: false, title: 'FASE 2 — A CRIATURA ESCUTA' },
  3: { keys: 3, vision: true, hearing: true, smell: true, title: 'FASE 3 — A CRIATURA FAREJA' },
};

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
  speed: { patrol: 1.35, investigate: 1.9, search: 1.5, chase: [0, 4.3, 4.5, 4.7], scent: 1.8 },
  turnRate: { slow: 2.4, fast: 5.5 },
  contactDist: 1.05,     // centro a centro (raio criatura + raio jogador + margem)
  attackRange: 1.75,     // inicia ataque
  attackReach: 1.55,     // alcance do golpe (com linha livre)
};

// Parâmetros de IA (ajustáveis)
export const AI = {
  fovDeg: 100,
  visionRange: [0, 18, 20, 22],   // por fase, metros (faixa 15–25)
  visionTick: 0.15,               // s entre checagens de visão
  moveSpeedThreshold: 0.35,       // m/s de deslocamento do corpo para contar como movimento
  standUpWindow: 0.6,             // levantar-se de agachado conta como movimento por este tempo
  detectionMemory: 3.0,           // s que uma detecção visual permanece válida sem novo movimento
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

// Tabela de eventos sonoros que afetam a IA: alcance máximo base (m) e intensidade (0..1)
export const SOUND_TYPES = {
  step_crouch: { range: 3.5, intensity: 0.2, duration: 0.15 },
  step_walk: { range: 9, intensity: 0.45, duration: 0.2 },
  step_run: { range: 18, intensity: 0.8, duration: 0.2 },
  land: { range: 12, intensity: 0.65, duration: 0.3 },
  door_wood: { range: 9, intensity: 0.5, duration: 1.0 },
  door_heavy: { range: 14, intensity: 0.7, duration: 1.4 },
  door_rusty: { range: 19, intensity: 0.85, duration: 1.6 },
  container_drawer: { range: 6, intensity: 0.35, duration: 0.6 },
  container_wardrobe: { range: 8, intensity: 0.45, duration: 0.9 },
  container_chest: { range: 9, intensity: 0.5, duration: 0.8 },
  container_crate: { range: 7, intensity: 0.4, duration: 0.6 },
  key_pickup: { range: 4, intensity: 0.25, duration: 0.5 },
  knock_box: { range: 7, intensity: 0.35, duration: 0.5 },
  knock_vase: { range: 13, intensity: 0.7, duration: 0.8 },
  knock_bottles: { range: 14, intensity: 0.72, duration: 1.0 },
  knock_candelabrum: { range: 16, intensity: 0.8, duration: 1.2 },
  knock_bucket: { range: 22, intensity: 0.95, duration: 1.6 },
  exit_unlock: { range: 26, intensity: 1.0, duration: 2.5 },
};

export const SURFACE_MUL = { wood: 1.0, stone: 0.9, tile: 1.1, carpet: 0.6 };

export const NET = { snapRate: 15, inputRate: 20, reconnectGrace: 60, hostMigrateDelay: 3 };
export const MAX_PLAYERS = 4;
