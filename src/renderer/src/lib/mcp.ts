import type { MsgKey } from '@shared/i18n'
import type { McpScope, McpServer, RegistryField, RegistryOption, RegistryServer } from '@shared/types'

export const SCOPE_KEYS: Record<McpScope, MsgKey> = { global: 'mcp.scope.global', project: 'mcp.scope.project', shared: 'mcp.scope.shared' }
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

/** Nombre corto con el que se instala un servidor del registro: «io.github.acme/filesystem-mcp» -> «filesystem-mcp». */
export function shortName(registryName: string): string {
  const last = registryName.split('/').pop() ?? registryName
  const clean = last.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
  return /^[A-Za-z0-9]/.test(clean) ? clean : `mcp-${clean}`.slice(0, 64)
}

/** Quien lo publica: «io.github.acme/filesystem-mcp» -> «io.github.acme». */
export const publisherOf = (registryName: string): string => (registryName.includes('/') ? registryName.slice(0, registryName.lastIndexOf('/')) : '')

/** Un argumento listo para ponerlo en una línea de comando (con comillas si lleva espacios). */
export const quoteArg = (a: string): string => (/[\s"']/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)

/** Lo que se le entrega al diálogo de «Añadir servidor» para instalar una entrada del registro. */
export interface Prefill {
  name: string; kind: 'remote' | 'local'; url: string; headers: string; command: string; args: string; env: string
  fields: RegistryField[]       // lo que el servidor pide (para explicarlo en el diálogo)
}

const lines = (fields: RegistryField[], sep: string): string => fields.filter((f) => f.required || f.default).map((f) => `${f.name}${sep}${f.default}`).join('\n')

export function prefillFrom(server: RegistryServer, option: RegistryOption): Prefill {
  return {
    name: shortName(server.name), kind: option.kind, url: option.url ?? '', headers: lines(option.headers, ': '),
    command: option.command ?? '', args: (option.args ?? []).map(quoteArg).join(' '), env: lines(option.env, '='), fields: [...option.env, ...option.headers]
  }
}
