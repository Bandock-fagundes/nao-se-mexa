// v7 — APARÊNCIA dos jogadores (cosméticos): cada boneco usa UM acessório (cachecol, chapéu fedora ou gorro)
// numa cor escolhida. Compartilhado entre cliente e servidor: a paleta, os acessórios e a limpeza do que o
// cliente envia (o servidor nunca confia no formato vindo da rede).

// acessórios: 'scarf' = cachecol de lã; 'fedora' = chapéu de feltro; 'beanie' = gorro de tricô com barra dobrada
export const ACCESSORIES = ['scarf', 'fedora', 'beanie'];
export const ACCESSORY_NAMES = { scarf: 'Cachecol', fedora: 'Chapéu fedora', beanie: 'Gorro de lã' };

// paleta (cores de lã/feltro tingidos, em sRGB)
export const LOOK_COLORS = [
  { id: 'vinho', name: 'Vinho', hex: 0x6a1a26 },
  { id: 'vermelho', name: 'Vermelho', hex: 0xa3261f },
  { id: 'mostarda', name: 'Mostarda', hex: 0xc0901c },
  { id: 'verde-musgo', name: 'Verde-musgo', hex: 0x55652a },
  { id: 'azul-petroleo', name: 'Azul-petróleo', hex: 0x1c5a64 },
  { id: 'azul-marinho', name: 'Azul-marinho', hex: 0x22305e },
  { id: 'roxo', name: 'Roxo', hex: 0x553070 },
  { id: 'creme', name: 'Creme', hex: 0xd8c8a2 },
];
// cores "de vaga" (quem não escolheu nada — clientes antigos): as mesmas cores do cachecol antes da v7
export const SLOT_COLORS = [0x8a2a24, 0x2a5a80, 0x7a6a24, 0x2f6a3a];

export function defaultLook(slot = 0) { return { acc: 'scarf', col: SLOT_COLORS[((slot % SLOT_COLORS.length) + SLOT_COLORS.length) % SLOT_COLORS.length] }; }

// aceita { acc, col } com col número (0xRRGGBB) ou texto ('#rrggbb' / 'rrggbb'); 'hat' = 'fedora'.
// Devolve um objeto limpo ou null se não houver nada aproveitável.
export function sanitizeLook(l) {
  if (!l || typeof l !== 'object') return null;
  let acc = String(l.acc || '').toLowerCase();
  if (acc === 'hat' || acc === 'chapeu') acc = 'fedora';
  if (acc === 'gorro') acc = 'beanie';
  if (acc === 'cachecol') acc = 'scarf';
  if (!ACCESSORIES.includes(acc)) return null;
  let col = l.col;
  if (typeof col === 'string') { const m = /^#?([0-9a-f]{6})$/i.exec(col.trim()); col = m ? parseInt(m[1], 16) : NaN; }
  if (typeof col !== 'number' || !Number.isFinite(col) || col < 0 || col > 0xffffff) return null;
  return { acc, col: Math.round(col) };
}
export const lookHex = (col) => '#' + (col >>> 0).toString(16).padStart(6, '0');
