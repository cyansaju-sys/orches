import { accessSync, constants, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, delimiter, isAbsolute, join } from 'node:path'
import type { AgentCandidate, AgentInfo, McpResult } from '../shared/types'
import { getSetting, setSetting } from './settings'
import { extendedPath, which } from './shellpath'

// nombre visible -> ejecutable. Los que no estén aquí se añaden como «agente propio» (ver addCustomAgent).
export const KNOWN: Array<[string, string]> = [
  ['Claude Code', 'claude'], ['OpenCode', 'opencode'], ['Codex', 'codex'], ['Gemini CLI', 'gemini'],
  ['Aider', 'aider'], ['Cursor Agent', 'cursor-agent'], ['Goose', 'goose'], ['Amp', 'amp'], ['Qwen Code', 'qwen'],
  ['Copilot CLI', 'copilot'], ['Droid', 'droid'], ['Kimi CLI', 'kimi'], ['Crush', 'crush'], ['Kilo Code', 'kilo'],
  ['Cline', 'cline'], ['Plandex', 'plandex'], ['Auggie', 'auggie'], ['Forge', 'forge'], ['Mistral Vibe', 'vibe'],
  ['Warp Agent', 'oz']
]

interface CustomAgent { name: string; command: string; args: string[] }
const CUSTOM_KEY = 'custom_agents'

export const customAgents = (): CustomAgent[] => {
  const raw = getSetting(CUSTOM_KEY)
  return Array.isArray(raw)
    ? raw.filter((a): a is CustomAgent => !!a && typeof a.name === 'string' && typeof a.command === 'string').map((a) => ({ ...a, args: Array.isArray(a.args) ? a.args : [] }))
    : []
}

/** Resuelve un ejecutable por nombre (PATH ampliado) o por ruta absoluta; null si no existe o no se puede ejecutar. */
export function resolveExecutable(command: string): string | null {
  if (!isAbsolute(command)) return which(command)
  try {
    if (!statSync(command).isFile()) return null
    if (process.platform !== 'win32') accessSync(command, constants.X_OK)
    return command
  } catch { return null }
}

/** Divide «mi-agente --modo rapido "con espacios"» en ejecutable y argumentos (admite comillas y \). */
export function splitCommand(line: string): string[] {
  const parts: string[] = []
  let current = ''
  let quote: string | null = null
  let started = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === quote) quote = null
      else if (ch === '\\' && quote === '"' && i + 1 < line.length) current += line[++i]
      else current += ch
    } else if (ch === '"' || ch === "'") { quote = ch; started = true }
    else if (ch === '\\' && i + 1 < line.length && process.platform !== 'win32') { current += line[++i]; started = true }
    else if (/\s/.test(ch)) { if (started || current) { parts.push(current); current = ''; started = false } }
    else { current += ch; started = true }
  }
  if (started || current) parts.push(current)
  return parts
}

/** Agentes instalados: los conocidos que se encuentran en el PATH y los que añadió el usuario. */
export function detectAgents(): AgentInfo[] {
  const found: AgentInfo[] = []
  const seen = new Set<string>()
  for (const [name, command] of KNOWN) {
    const path = which(command)
    if (path) { found.push({ name, command, path }); seen.add(command) }
  }
  for (const a of customAgents()) {
    const path = resolveExecutable(a.command)
    if (!path || seen.has(a.command)) continue
    found.push({ name: a.name, command: a.command, path, args: a.args, custom: true })
    seen.add(a.command)
  }
  return found
}

/** Añade un agente que la app no conocía. `commandLine` es el comando tal como se escribiría en una terminal. */
export function addCustomAgent(name: string, commandLine: string): McpResult {
  const title = name.trim()
  const [command, ...args] = splitCommand(commandLine.trim())
  if (!command) return { ok: false, message: 'Escribe el comando que inicia el agente' }
  if (!title) return { ok: false, message: 'Escribe un nombre para el agente' }
  if (title.length > 40) return { ok: false, message: 'El nombre es demasiado largo (máximo 40 caracteres)' }
  if (!resolveExecutable(command)) return { ok: false, message: `No se encontró «${command}»: revisa el nombre o escribe la ruta completa` }
  if (KNOWN.some(([, c]) => c === command) || customAgents().some((a) => a.command === command)) {
    return { ok: false, message: `«${command}» ya está en la lista de agentes` }
  }
  setSetting(CUSTOM_KEY, [...customAgents(), { name: title, command, args }])
  return { ok: true, message: `Agente «${title}» añadido` }
}

export function removeCustomAgent(command: string): void {
  setSetting(CUSTOM_KEY, customAgents().filter((a) => a.command !== command))
}

/**
 * Ejecutables que el usuario instaló en sus propias carpetas (~/.local/bin, ~/.cargo/bin, nvm...): ahí viven casi todos los
 * agentes de terminal. Se muestran para elegir uno al añadir un agente; no se ejecuta ninguno.
 */
export function candidateExecutables(home: string = homedir(), path: string = extendedPath()): AgentCandidate[] {
  const taken = new Set<string>([...KNOWN.map(([, c]) => c), ...customAgents().map((a) => a.command)])
  const out = new Map<string, AgentCandidate>()
  for (const dir of path.split(delimiter)) {
    if (!dir || !(dir === home || dir.startsWith(home + '/') || dir.startsWith(home + '\\'))) continue
    let names: string[] = []
    try { names = readdirSync(dir) } catch { continue }
    for (const file of names) {
      const full = join(dir, file)
      try {
        if (!statSync(full).isFile()) continue
        if (process.platform !== 'win32') accessSync(full, constants.X_OK)
      } catch { continue }
      const name = process.platform === 'win32' ? basename(file).replace(/\.(exe|cmd|bat)$/i, '') : file
      if (!taken.has(name) && !out.has(name)) out.set(name, { name, path: full })
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Shell del usuario: $SHELL en Linux/macOS, PowerShell o cmd en Windows. */
export function defaultShell(): string {
  if (process.platform === 'win32') return which('pwsh') ?? which('powershell') ?? process.env.COMSPEC ?? 'cmd'
  return process.env.SHELL || which('bash') || 'sh'
}
