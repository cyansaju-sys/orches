import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute } from 'node:path'
import type { WebContents } from 'electron'
import type { IPty } from 'node-pty'
import * as pty from 'node-pty'
import { Terminal as Headless } from '@xterm/headless'
import type { PtyOptions } from '../../shared/types'
import { extendedPath, which } from '../shellpath'

const SESSION_VARS = [
  'CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_EXECPATH', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_AGENT_SDK_VERSION', 'CLAUDE_PID'
]

export interface Meta { id: string; kind: 'agent' | 'shell'; name: string; command: string; cwd: string; parentId?: string }
interface Session { term: IPty; killed: boolean; meta: Meta; screen: Headless; lastOutput: number }

/** Cómo arrancar un agente con el reparto de tareas conectado; lo registra el módulo del servidor MCP. */
export type { Launch } from './launch'
import type { Launch } from './launch'
type LaunchHook = (opts: PtyOptions) => Launch
let launchHook: LaunchHook | null = null
export const setLaunchHook = (hook: LaunchHook): void => { launchHook = hook }

const sessions = new Map<string, Session>()

/** Libera la pantalla interna; puede llamarse varias veces (un fallo dentro de un evento de node-pty aborta el proceso). */
const disposeScreen = (s: Session): void => { try { s.screen.dispose() } catch { /* ya liberada */ } }
const waiting = new Map<string, Array<() => void>>()

/** Entorno del agente: sin variables de sesión ajenas y con el PATH ampliado. */
function childEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !SESSION_VARS.includes(k) && !k.startsWith('ELECTRON_')) env[k] = v
  env.PATH = extendedPath()
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  return { ...env, ...extra }
}

/** Resuelve el ejecutable; lanza un Error con un mensaje legible si no se puede iniciar. */
function resolve(opts: PtyOptions, args: string[]): { file: string; args: string[] } {
  const exe = isAbsolute(opts.command) && existsSync(opts.command) ? opts.command : which(opts.command)
  if (!exe) throw new Error(`No se encontró «${opts.command}»: instálalo o revisa que esté en el PATH`)
  let dir = false
  try { dir = statSync(opts.cwd).isDirectory() } catch { /* no existe */ }
  if (!dir) throw new Error(`La carpeta «${opts.cwd}» no existe`)
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(exe)) return { file: 'cmd.exe', args: ['/c', exe, ...args] }
  return { file: exe, args }
}

export function spawn(sender: WebContents, opts: PtyOptions): { ok: boolean; error?: string } {
  try {
    const kind = opts.kind ?? 'shell'
    const launch: Launch = kind === 'agent' && launchHook ? launchHook(opts) : { args: opts.args ?? [], env: {} }
    const { file, args } = resolve(opts, launch.args)
    const term = pty.spawn(file, args, { name: 'xterm-256color', cols: opts.cols, rows: opts.rows, cwd: opts.cwd || homedir(), env: childEnv(launch.env) })
    // pantalla «sin cabeza»: permite leer lo que muestra el agente sin pasar por la interfaz
    const screen = new Headless({ cols: opts.cols, rows: opts.rows, scrollback: 3000, allowProposedApi: true })
    const meta: Meta = { id: opts.id, kind, name: opts.name ?? opts.command, command: opts.command, cwd: opts.cwd, parentId: opts.parentId }
    const session: Session = { term, killed: false, meta, screen, lastOutput: 0 }
    sessions.set(opts.id, session)
    term.onData((data) => {
      session.lastOutput = Date.now()
      try { screen.write(data) } catch { /* pantalla ya liberada */ }
      if (!sender.isDestroyed()) sender.send('pty:data', opts.id, data)
    })
    term.onExit(({ exitCode, signal }) => {
      sessions.delete(opts.id)
      disposeScreen(session)
      if (session.killed || sender.isDestroyed()) return                // lo cerró la app: no hay nada que avisar
      sender.send('pty:exit', { id: opts.id, code: signal ? -signal : exitCode })
    })
    waiting.get(opts.id)?.forEach((resolveWait) => resolveWait())
    waiting.delete(opts.id)
    launch.after?.()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export const write = (id: string, data: string): void => { sessions.get(id)?.term.write(data) }
export function resize(id: string, cols: number, rows: number): void {
  const s = sessions.get(id)
  if (!s) return
  try { s.term.resize(Math.max(cols, 2), Math.max(rows, 2)); s.screen.resize(Math.max(cols, 2), Math.max(rows, 2)) } catch { /* el proceso ya terminó */ }
}
export function kill(id: string): void {
  const s = sessions.get(id)
  if (!s) return
  s.killed = true
  try { s.term.kill() } catch { /* ya terminó */ }
  disposeScreen(s)
  sessions.delete(id)
}
export const killAll = (): void => { for (const id of [...sessions.keys()]) kill(id) }

// --- lo que necesita el reparto de tareas -------------------------------------------------------------------------
/** Agentes abiertos, en el orden en que se abrieron (el primero es el líder). */
export const agentSessions = (): Meta[] => [...sessions.values()].filter((s) => s.meta.kind === 'agent').map((s) => s.meta)
export const hasSession = (id: string): boolean => sessions.has(id)

/** Segundos sin salida del proceso: poco = está trabajando. */
export function idleFor(id: string): number {
  const s = sessions.get(id)
  return s && s.lastOutput ? (Date.now() - s.lastOutput) / 1000 : 999
}

/** Últimas `lines` líneas (historial + pantalla), sin espacios sobrantes. */
export function screenText(id: string, lines: number): string {
  const s = sessions.get(id)
  if (!s) return ''
  const buffer = s.screen.buffer.active
  const rows: string[] = []
  for (let i = 0; i < buffer.length; i++) rows.push(buffer.getLine(i)?.translateToString(true) ?? '')
  while (rows.length && !rows[rows.length - 1]) rows.pop()
  return rows.slice(-lines).join('\n')
}

/** Escribe una instrucción en el agente y la envía (como si la pegaras y pulsaras Enter). */
export function sendPrompt(id: string, text: string): void {
  const s = sessions.get(id)
  if (!s) return
  const clean = text.trim()
  if (s.screen.modes.bracketedPasteMode) s.term.write(`\x1b[200~${clean}\x1b[201~`)   // acepta varias líneas
  else s.term.write(clean.split(/\s+/).join(' '))
  setTimeout(() => s.term.write('\r'), 500)
}

/** Espera a que el proceso de un panel recién pedido haya arrancado. */
export function waitForSpawn(id: string, ms: number): Promise<boolean> {
  if (sessions.has(id)) return Promise.resolve(true)
  return new Promise((done) => {
    const timer = setTimeout(() => { waiting.delete(id); done(false) }, ms)
    waiting.set(id, [...(waiting.get(id) ?? []), () => { clearTimeout(timer); done(true) }])
  })
}
