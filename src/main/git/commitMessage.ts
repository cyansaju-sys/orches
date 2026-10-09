/** Mensaje de commit (Conventional Commits) redactado por un agente en modo no interactivo. */
import { execFile } from 'node:child_process'
import type { AgentInfo, McpResult } from '../../shared/types'
import { detectAgents } from '../agents/agents'
import * as git from './git'
import { extendedPath } from '../shellpath'

const MAX_DIFF = 24_000          // el agente no necesita ver todo: con esto basta para resumir el cambio
const TYPES = 'feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert'
const FIRST_LINE = new RegExp(`^(${TYPES})(\\([^)\\n]+\\))?!?: \\S.*$`)

/** Orden de preferencia y cómo se lanza cada agente para que responda una sola vez y termine. */
const HEADLESS: Array<[string, (prompt: string) => string[]]> = [
  ['claude', (p) => ['-p', p]],
  ['opencode', (p) => ['run', p]],
  ['gemini', (p) => ['-p', p]],
  ['codex', (p) => ['exec', p]],
  ['agy', (p) => ['--print', p]]
]
export const headlessArgs = (command: string, prompt: string): string[] | null => HEADLESS.find(([c]) => c === command)?.[1](prompt) ?? null

export function buildPrompt(diff: string, recent: string): string {
  const cut = diff.length > MAX_DIFF ? `${diff.slice(0, MAX_DIFF)}\n[... diff recortado ...]` : diff
  return `Escribe el mensaje de commit para estos cambios usando Conventional Commits (https://www.conventionalcommits.org).
Formato: <tipo>(<ámbito opcional>): <descripción>. Tipos: ${TYPES.replace(/\|/g, ', ')}.
Reglas: UNA sola línea, de 72 caracteres como máximo, en imperativo y sin punto final; sin cuerpo. Usa el mismo idioma que los commits recientes. \
Responde SOLO con esa línea, sin comillas, sin bloques de código y sin explicaciones. \
No uses herramientas ni leas archivos: todo lo necesario está aquí.

Commits recientes (para el estilo):
${recent.trim() || '(ninguno)'}

Cambios:
${cut}`
}

/** Deja solo el mensaje: quita bloques de código, comillas y charla previa. Null si no hay una primera línea válida. */
export function cleanMessage(raw: string): string | null {
  const text = raw.replace(/\r/g, '').replace(/```[a-z]*\n?/gi, '').trim()
  const lines = text.split('\n').map((l) => l.replace(/^["'`]+|["'`]+$/g, '').trimEnd())
  const start = lines.findIndex((l) => FIRST_LINE.test(l.trim()))
  if (start < 0) return null
  return lines[start].trim().replace(/\.$/, '')                  // solo el título: el mensaje se mantiene corto
}

export const ask = (agent: AgentInfo, args: string[], cwd: string, signal?: AbortSignal): Promise<string | null> =>
  new Promise((done) => {
    execFile(agent.path, args, { cwd, timeout: 90_000, encoding: 'utf8', maxBuffer: 2_000_000, signal, env: { ...process.env, PATH: extendedPath() } },
      (err, stdout) => done(err ? null : stdout)).stdin?.end()
  })

// --- sin IA: reglas sobre los archivos preparados -----------------------------------------------
export interface FileChange { status: string; path: string; added: number; deleted: number }
type Kind = 'docs' | 'test' | 'ci' | 'build' | 'code'

const kindOf = (path: string): Kind => {
  const p = path.toLowerCase()
  if (/^\.github\/|\.gitlab-ci|^\.circleci\//.test(p)) return 'ci'
  if (/(\.|\/|^)(test|spec)s?(\.|\/)|__tests__/.test(p)) return 'test'
  if (/\.(md|mdx|txt|rst)$|^docs?\/|(^|\/)(license|changelog)/.test(p)) return 'docs'
  if (/(^|\/)(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|tsconfig[^/]*\.json|dockerfile|install\.sh)$|\.config\.[cm]?[jt]s$|\.toml$/.test(p)) return 'build'
  return 'code'
}

const stem = (path: string): string => (path.split('/').pop() ?? path).replace(/\.[^.]+$/, '').replace(/\.(test|spec)$/, '')

/** Carpeta común más profunda (sin `src`), o el nombre del archivo si es uno solo. */
function scopeOf(paths: string[]): string {
  if (paths.length === 1) return stem(paths[0])
  const dirs = paths.map((p) => p.split('/').slice(0, -1))
  const common: string[] = []
  for (let i = 0; i < Math.min(...dirs.map((d) => d.length)); i++) {
    if (dirs.every((d) => d[i] === dirs[0][i])) common.push(dirs[0][i]); else break
  }
  const name = common.filter((c) => !['src', 'lib', 'app', 'packages'].includes(c)).pop() ?? ''
  return /^[\w.-]+$/.test(name) ? name : ''
}

const list = (names: string[]): string => (names.length <= 1 ? names[0] ?? '' : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`)

/** Mensaje de Conventional Commits armado solo con reglas: no entiende el porqué del cambio, pero describe qué se toca. */
export function heuristicMessage(files: FileChange[]): string | null {
  if (!files.length) return null
  const kinds = new Set(files.map((f) => kindOf(f.path)))
  const code = files.filter((f) => kindOf(f.path) === 'code')
  const main = code.length ? code : files                    // el tipo lo marca el código; si no hay, todo
  const type = code.length
    ? (code.some((f) => f.status === 'A') ? 'feat' : code.every((f) => f.status === 'D') ? 'chore' : 'refactor')
    : kinds.size === 1 ? [...kinds][0] : files.some((f) => kindOf(f.path) === 'build') ? 'build' : 'chore'
  const scope = scopeOf(main.map((f) => f.path))
  const statuses = new Set(main.map((f) => f.status))
  const verb = statuses.size === 1 ? ({ A: 'añade', D: 'elimina', R: 'renombra', M: 'actualiza' } as Record<string, string>)[[...statuses][0]] ?? 'actualiza' : 'actualiza'
  const names = main.map((f) => (f.path.split('/').pop() ?? f.path))
  const what = names.length <= 3 ? list(names) : `${names.length} archivos`
  return `${type}${scope ? `(${scope})` : ''}: ${verb} ${what}`
}

/** Pide el mensaje al primer agente instalado que lo consiga. */
export async function suggestCommit(root: string, onAgent: (name: string) => void = () => undefined, signal?: AbortSignal): Promise<McpResult & { agent?: string }> {
  const { diff, recent } = await git.changesForMessage(root)
  if (!diff.trim()) return { ok: false, message: 'No hay cambios preparados: prepara los archivos que quieras incluir' }
  const installed = detectAgents()
  const prompt = buildPrompt(diff, recent)
  let tried = 0
  for (const [command] of HEADLESS) {
    const agent = installed.find((a) => a.command === command)
    if (!agent) continue
    tried++
    onAgent(agent.name)
    const out = await ask(agent, headlessArgs(command, prompt)!, root, signal)
    if (signal?.aborted) return { ok: false, message: '' }               // cancelado: sin mensaje de error
    const message = out ? cleanMessage(out) : null
    if (message) return { ok: true, message, agent: agent.name }
  }
  // ningún agente sirvió: se arma con reglas, para que siempre haya un punto de partida
  const fallback = heuristicMessage(await git.stagedSummary(root))
  if (fallback) return { ok: true, message: fallback, agent: 'Reglas automáticas' }
  return { ok: false, message: 'No se pudo generar el mensaje' }
}
