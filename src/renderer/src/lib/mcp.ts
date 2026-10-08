import type { McpScope, McpServer } from '@shared/types'

export const SCOPE_LABELS: Record<McpScope, string> = { global: 'Todos los proyectos', project: 'Este proyecto', shared: 'Compartido (.mcp.json)' }
export const AGENT_NAMES: Record<string, string> = { claude: 'Claude Code', opencode: 'OpenCode', gemini: 'Gemini CLI', codex: 'Codex', agy: 'Antigravity' }
/** Agentes que solo guardan sus MCP de forma global (no tienen archivo por proyecto). */
export const GLOBAL_ONLY: string[] = ['codex', 'agy']
const SECRET = /key|token|secret|auth|pass|pwd|credential/i      // valores que se ocultan

/** «Clave: valor» o «CLAVE=valor» por línea -> objeto. */
export function parsePairs(text: string, separators: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const sep = separators.find((s) => line.includes(s))
    if (!sep) continue
    const i = line.indexOf(sep)
    const key = line.slice(0, i).trim()
    if (key) out[key] = line.slice(i + sep.length).trim()
  }
  return out
}

/** Divide una línea de argumentos respetando comillas simples y dobles (como una shell sencilla). */
export function splitArgs(text: string): string[] {
  const out: string[] = []
  let current = ''
  let quote: string | null = null
  let started = false
  for (const ch of text) {
    if (quote) { if (ch === quote) quote = null; else current += ch }
    else if (ch === '"' || ch === "'") { quote = ch; started = true }
    else if (/\s/.test(ch)) { if (started || current) { out.push(current); current = ''; started = false } }
    else current += ch
  }
  if (started || current) out.push(current)
  return out
}

export const isSecret = (key: string): boolean => SECRET.test(key)
export const mask = (key: string, value: string, reveal: boolean): string =>
  reveal || !isSecret(key) ? value : '•'.repeat(Math.min(12, Math.max(4, value.length)))

/** Agentes soportados que todavía no tienen este servidor (mismo nombre y alcance). */
export function agentsMissing(server: McpServer, all: McpServer[], supported: string[]): string[] {
  const scope = server.scope === 'shared' ? 'project' : server.scope
  const have = new Set(all.map((s) => `${s.agent}|${s.name}|${s.scope === 'shared' ? 'project' : s.scope}`))
  return supported.filter((a) => a !== server.agent && !have.has(`${a}|${server.name}|${scope}`))
}

/** Convierte un servidor ya configurado en lo que hace falta para añadirlo a otro agente. */
export function specFromServer(server: McpServer): import('@shared/types').McpSpec {
  const cfg = server.config as Record<string, unknown>
  const env = { ...((cfg.environment as Record<string, string>) ?? {}), ...((cfg.env as Record<string, string>) ?? {}) }
  const headers = { ...((cfg.headers as Record<string, string>) ?? {}) }
  if (server.kind === 'remote') return { name: server.name, kind: 'remote', url: String(cfg.url ?? ''), headers, env }
  const command = cfg.command
  const parts = Array.isArray(command) ? command.map(String) : [String(command ?? ''), ...((cfg.args as unknown[]) ?? []).map(String)]
  return { name: server.name, kind: 'local', command: parts[0], args: parts.slice(1), headers, env }
}
