/**
 * Iconos de los agentes. Los que tienen logo (SVG de LobeHub en public/icons/agents, ver NOTICE.md) lo usan; cualquier
 * otro agente —incluidos los que añade el usuario— recibe un icono generado con su inicial y un color propio.
 */

export interface AgentColors { from: string; to: string; text: string }

/** Logo de un agente: archivo SVG y si es de un solo color (`mono`: se tiñe con el color del texto en vez de usarse tal cual). */
export interface AgentLogo { file: string; mono: boolean }
const LOGOS: Record<string, AgentLogo> = {
  claude: { file: 'claudecode-color', mono: false },
  opencode: { file: 'opencode', mono: true },
  agy: { file: 'antigravity-color', mono: false },
  codex: { file: 'codex-color', mono: false },
  gemini: { file: 'geminicli-color', mono: false },
  'cursor-agent': { file: 'cursor', mono: true },
  goose: { file: 'goose', mono: true },
  amp: { file: 'amp-color', mono: false },
  kimi: { file: 'kimi-color', mono: false },
  kilo: { file: 'kilocode', mono: true },
  cline: { file: 'cline', mono: true },
  qwen: { file: 'qwen-color', mono: false },
  copilot: { file: 'copilot-color', mono: false },
  vibe: { file: 'mistral-color', mono: false }
}
// otros nombres con los que se conoce al mismo agente (p. ej. al añadirlo a mano)
const ALIASES: Record<string, string> = {
  antigravity: 'agy', 'claude-code': 'claude', claudecode: 'claude', cursor: 'cursor-agent', 'gemini-cli': 'gemini',
  kilocode: 'kilo', 'kilo-code': 'kilo', 'mistral-vibe': 'vibe', 'qwen-code': 'qwen', 'copilot-cli': 'copilot'
}

const idOf = (key: string): string => (key.split(/[\\/]/).pop() ?? key).toLowerCase().trim().replace(/\.(exe|cmd|bat)$/, '')

/** Logo del agente, o null si no lo tiene (entonces se usa el icono generado). */
export function agentLogo(key: string): AgentLogo | null {
  const id = idOf(key)
  return LOGOS[ALIASES[id] ?? id] ?? null
}

const KNOWN: Record<string, AgentColors> = {
  claude: { from: '#e8825f', to: '#c4532f', text: '#ffffff' },
  opencode: { from: '#4b5563', to: '#1f2937', text: '#ffffff' },
  agy: { from: '#5b9bff', to: '#2f5fd8', text: '#ffffff' },
  codex: { from: '#19c39a', to: '#0a8a6a', text: '#ffffff' },
  gemini: { from: '#8f7bff', to: '#4f5de8', text: '#ffffff' },
  'cursor-agent': { from: '#e5e7eb', to: '#9ca3af', text: '#111827' },
  aider: { from: '#4ade80', to: '#15a34a', text: '#06240f' },
  goose: { from: '#fbbf24', to: '#d97706', text: '#2a1700' },
  amp: { from: '#f87171', to: '#dc2626', text: '#ffffff' },
  qwen: { from: '#a78bfa', to: '#6d3fd6', text: '#ffffff' },
  copilot: { from: '#60c8f5', to: '#1d8fd1', text: '#ffffff' },
  droid: { from: '#fb923c', to: '#ea580c', text: '#ffffff' },
  kimi: { from: '#38bdf8', to: '#0b7fc0', text: '#ffffff' },
  crush: { from: '#f472b6', to: '#c2257d', text: '#ffffff' }
}

/** Número estable (0..2^32) a partir de un texto: el mismo nombre da siempre el mismo color. */
export function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

/** Colores del icono. `key` es el ejecutable (o el nombre si no se conoce); se ignoran mayúsculas y la ruta. */
export function agentColors(key: string): AgentColors {
  const id = ALIASES[idOf(key)] ?? idOf(key)
  if (KNOWN[id]) return KNOWN[id]
  const hue = hash(id) % 360
  return { from: `hsl(${hue} 68% 60%)`, to: `hsl(${(hue + 24) % 360} 70% 40%)`, text: '#ffffff' }
}

/** Letra del icono: la primera letra o cifra del nombre. */
export function agentInitial(name: string): string {
  const m = /[\p{L}\p{N}]/u.exec(name)
  return m ? m[0].toUpperCase() : '?'
}
