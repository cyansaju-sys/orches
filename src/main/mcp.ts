/**
 * Servidores MCP de cada agente: leerlos, añadirlos y quitarlos.
 *
 * Se añaden con el propio comando de cada agente (`claude mcp ...`, `opencode mcp ...`) para respetar su formato;
 * la lectura es directa de sus archivos de configuración.
 */
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { McpAgent, McpResult, McpScope, McpServer, McpSpec } from '../shared/types'
import { extendedPath } from './shellpath'

export const SUPPORTED: Record<McpAgent, string> = { claude: 'Claude Code', opencode: 'OpenCode', gemini: 'Gemini CLI', codex: 'Codex' }
export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

type Entry = Record<string, unknown>

function readJson(path: string): Record<string, unknown> {
  try { return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown> } catch { return {} }
}
const isObject = (v: unknown): v is Entry => typeof v === 'object' && v !== null && !Array.isArray(v)

/** ('remote' | 'local', URL o comando) de una entrada de configuración. */
export function describe(entry: Entry): { kind: 'remote' | 'local'; target: string } {
  let command: string | undefined
  if (Array.isArray(entry.command)) command = entry.command.map(String).join(' ')
  else if (entry.command) command = [String(entry.command), ...((entry.args as unknown[]) ?? []).map(String)].join(' ')
  if (entry.url || entry.httpUrl || ['http', 'sse', 'remote'].includes(String(entry.type))) return { kind: 'remote', target: String(entry.url ?? entry.httpUrl ?? '') }
  return { kind: 'local', target: command ?? '' }
}

export const geminiGlobalConfig = (): string => join(homedir(), '.gemini', 'settings.json')
export const codexConfig = (): string => join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml')

/** Servidores de `[mcp_servers.<nombre>]` en el config.toml de Codex (solo lo que hace falta: command, args, url, env). */
export function codexEntries(file: string): Array<[string, Entry]> {
  let text = ''
  try { text = readFileSync(file, 'utf8') } catch { return [] }
  const out = new Map<string, Entry>()
  let current: Entry | null = null
  const value = (raw: string): unknown => {
    const v = raw.trim()
    if (v.startsWith('[')) return [...v.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2])
    const q = /^"((?:[^"\\]|\\.)*)"|^'([^']*)'/.exec(v)
    return q ? (q[1] ?? q[2]) : v
  }
  for (const line of text.split(/\r?\n/)) {
    const head = /^\s*\[\s*mcp_servers\.("([^"]+)"|[^.\]\s]+)(\.[A-Za-z_]+)?\s*\]\s*$/.exec(line)
    if (head) {
      const name = head[2] ?? head[1]
      if (!out.has(name)) out.set(name, {})
      current = head[3] ? ((out.get(name)!.env ??= {}) as Entry) : out.get(name)!
      continue
    }
    if (/^\s*\[/.test(line)) { current = null; continue }
    const kv = /^\s*([A-Za-z0-9_-]+)\s*=\s*(.+?)\s*$/.exec(line)
    if (kv && current) current[kv[1]] = value(kv[2])
  }
  return [...out.entries()]
}

export const opencodeGlobalConfig = (): string => join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'opencode', 'opencode.json')

/**
 * Servidores de un opencode.json. La 2.x los guarda en `mcp.servers.<nombre>` y la 1.x directamente en `mcp.<nombre>`
 * (la 2.x lee las dos formas): se aceptan ambas.
 */
export function opencodeEntries(file: string): Array<[string, Entry, 'servers' | 'flat']> {
  const mcp = readJson(file).mcp
  if (!isObject(mcp)) return []
  const out: Array<[string, Entry, 'servers' | 'flat']> = []
  for (const [name, value] of Object.entries(mcp)) {
    if (name === 'servers' && isObject(value)) {
      for (const [n, e] of Object.entries(value)) out.push([n, isObject(e) ? e : {}, 'servers'])
    } else if (isObject(value) && (value.type || value.url || value.command)) out.push([name, value, 'flat'])
  }
  return out
}

/** ¿Son la misma carpeta? Sigue los enlaces simbólicos: Claude guarda la ruta real y el proyecto puede abrirse por un enlace. */
export function samePath(a: string, b: string): boolean {
  const real = (p: string): string => {
    try { return realpathSync.native(p) } catch { return resolve(p) }
  }
  const [x, y] = [real(a), real(b)]
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y
}

export function listServers(project: string | null): McpServer[] {
  const servers: McpServer[] = []
  const add = (name: string, agent: McpAgent, scope: McpScope, entry: Entry, source: string): void => {
    servers.push({ name, agent, scope, ...describe(entry), config: entry, source })
  }

  const claudeFile = join(homedir(), '.claude.json')
  const claude = readJson(claudeFile)
  const scopes: Array<[McpScope, Entry, string]> = [['global', isObject(claude.mcpServers) ? claude.mcpServers : {}, claudeFile]]
  if (project) {
    const projects = isObject(claude.projects) ? claude.projects : {}
    for (const [key, data] of Object.entries(projects)) {
      if (samePath(key, project) && isObject(data) && isObject(data.mcpServers)) scopes.push(['project', data.mcpServers, claudeFile])
    }
    const shared = join(project, '.mcp.json')
    const sharedServers = readJson(shared).mcpServers
    scopes.push(['shared', isObject(sharedServers) ? sharedServers : {}, shared])
  }
  for (const [scope, entries, source] of scopes) for (const [name, entry] of Object.entries(entries)) add(name, 'claude', scope, isObject(entry) ? entry : {}, source)

  const files: Array<[McpScope, string]> = [['global', opencodeGlobalConfig()]]
  if (project) files.push(['project', join(project, 'opencode.json')])
  for (const [scope, file] of files) for (const [name, entry] of opencodeEntries(file)) add(name, 'opencode', scope, entry, file)

  for (const [name, entry] of Object.entries(isObject(readJson(geminiGlobalConfig()).mcpServers) ? (readJson(geminiGlobalConfig()).mcpServers as Entry) : {})) add(name, 'gemini', 'global', isObject(entry) ? entry : {}, geminiGlobalConfig())
  if (project) {
    const file = join(project, '.gemini', 'settings.json')
    const found = readJson(file).mcpServers
    for (const [name, entry] of Object.entries(isObject(found) ? found : {})) add(name, 'gemini', 'project', isObject(entry) ? entry : {}, file)
  }
  for (const [name, entry] of codexEntries(codexConfig())) add(name, 'codex', 'global', entry, codexConfig())
  return servers
}

/** Mensaje de error si `spec` no es válido; null si está bien. */
export function validate(spec: McpSpec): string | null {
  if (!NAME_RE.test(spec.name ?? '')) return 'El nombre solo puede tener letras, números, - y _'
  if (spec.kind === 'remote') return /^https?:\/\/\S+$/.test(spec.url ?? '') ? null : 'La URL debe empezar por http:// o https://'
  return (spec.command ?? '').trim() ? null : 'Escribe el comando que arranca el servidor'
}

/** Comando (argv) que añade el servidor con la CLI del agente. */
export function buildAddArgv(agent: McpAgent, spec: McpSpec, scope: McpScope): string[] {
  const remote = spec.kind === 'remote'
  const headers = Object.entries(spec.headers ?? {})
  const env = Object.entries(spec.env ?? {})
  const args = spec.args ?? []
  if (agent === 'claude') {
    const cliScope = scope === 'global' ? 'user' : 'local'
    const argv = ['claude', 'mcp', 'add', spec.name]               // el nombre va antes: -H y -e aceptan varios valores
    if (remote) {
      argv.push(spec.url!, '--transport', 'http', '-s', cliScope)
      for (const [k, v] of headers) argv.push('-H', `${k}: ${v}`)
    } else {
      argv.push('-s', cliScope)
      for (const [k, v] of env) argv.push('-e', `${k}=${v}`)
      argv.push('--', spec.command!, ...args)
    }
    return argv
  }
  if (agent === 'gemini') {
    const argv = ['gemini', 'mcp', 'add', '-s', scope === 'global' ? 'user' : 'project']
    if (remote) {
      argv.push('-t', 'http')
      for (const [k, v] of headers) argv.push('-H', `${k}: ${v}`)
      argv.push(spec.name, spec.url!)
    } else {
      for (const [k, v] of env) argv.push('-e', `${k}=${v}`)
      argv.push(spec.name, spec.command!, ...args)
    }
    return argv
  }
  if (agent === 'codex') {
    const argv = ['codex', 'mcp', 'add', spec.name]
    if (remote) return [...argv, '--url', spec.url!]
    for (const [k, v] of env) argv.push('--env', `${k}=${v}`)
    return [...argv, '--', spec.command!, ...args]
  }
  const argv = ['opencode', 'mcp', 'add']
  if (scope === 'global') argv.push('--global')
  if (remote) {
    argv.push('--url', spec.url!)
    for (const [k, v] of headers) argv.push('--header', `${k}=${v}`)
    argv.push(spec.name)
  } else {
    for (const [k, v] of env) argv.push('--env', `${k}=${v}`)
    argv.push(spec.name, '--', spec.command!, ...args)
  }
  return argv
}

function run(argv: string[], cwd: string | null): Promise<McpResult> {
  return new Promise((done) => {
    execFile(argv[0], argv.slice(1), { cwd: cwd ?? undefined, timeout: 60_000, encoding: 'utf8', windowsHide: true, env: { ...process.env, PATH: extendedPath() } },
      (err, stdout, stderr) => {
        const text = ((err ? stderr || stdout : stdout) || '').trim()
        done({ ok: !err, message: text || (err ? String(err.message) : 'Hecho') })
      }).stdin?.end()
  })
}

export async function addServer(agent: McpAgent, spec: McpSpec, scope: McpScope, project: string | null): Promise<McpResult> {
  const error = validate(spec)
  if (error) return { ok: false, message: error }
  if (!(agent in SUPPORTED)) return { ok: false, message: `No sé añadir MCP a ${agent}` }
  if (agent === 'codex' && scope !== 'global') return { ok: false, message: 'Codex solo guarda sus MCP de forma global' }
  if (agent === 'codex' && spec.kind === 'remote' && Object.keys(spec.headers ?? {}).length) return { ok: false, message: 'Codex no permite cabeceras al añadir un MCP remoto desde su CLI' }
  if (scope !== 'global' && !project) return { ok: false, message: 'Abre un proyecto para añadirlo solo a él' }
  return run(buildAddArgv(agent, spec, scope), project)
}

/** Quita `name` de un opencode.json, esté donde esté (mcp.servers o mcp). Devuelve false si no estaba. */
export function removeFromOpencodeFile(file: string, name: string): boolean {
  const data = readJson(file)
  const mcp = data.mcp
  if (!isObject(mcp)) return false
  let removed = false
  if (isObject(mcp.servers) && name in mcp.servers) { delete mcp.servers[name]; removed = true }
  if (name !== 'servers' && name in mcp) { delete mcp[name]; removed = true }
  if (removed) writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8')
  return removed
}

export async function removeServer(server: McpServer, project: string | null): Promise<McpResult> {
  if (server.agent === 'claude') {
    const cliScope = { global: 'user', project: 'local', shared: 'project' }[server.scope]
    return run(['claude', 'mcp', 'remove', server.name, '-s', cliScope], project)
  }
  if (server.agent === 'gemini') return run(['gemini', 'mcp', 'remove', '-s', server.scope === 'global' ? 'user' : 'project', server.name], project)
  if (server.agent === 'codex') return run(['codex', 'mcp', 'remove', server.name], project)
  // OpenCode no trae `mcp remove`: se edita su archivo
  const file = server.scope === 'global' ? opencodeGlobalConfig() : join(project ?? '', 'opencode.json')
  try {
    if (!existsSync(file)) return { ok: false, message: `No existe ${file}` }
    return removeFromOpencodeFile(file, server.name) ? { ok: true, message: 'Quitado' } : { ok: false, message: 'No estaba en el archivo' }
  } catch (e) {
    return { ok: false, message: `No se pudo editar ${file}: ${e instanceof Error ? e.message : String(e)}` }
  }
}
