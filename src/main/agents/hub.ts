/** Une el servidor MCP con los agentes abiertos: lista, reparte tareas, abre paneles y lee pantallas. */
import type { BrowserWindow } from 'electron'
import type { OpenPane } from '../../shared/types'
import { execFileSync } from 'node:child_process'
import { detectAgents } from './agents'
import { capableFor, exhausted, isDifficulty, capable, pickAgent, type Candidate, type Difficulty } from './assign'
import { readContext } from '../context/context'
import { projectRoot } from '../context/projectRoot'
import { buildLaunch, parseMajor, PROMPT_ARGS } from './launch'
import { currentModel, tier } from './models'
import { Orchestra, type AgentOutput, type Host } from './orchestra'
import * as pty from './pty'
import { getSetting } from '../settings'
import { claudeLimits } from '../usage/usage'

const BUSY_SECONDS = 4       // sin salida durante este tiempo = el agente ya no está trabajando
let orchestra: Orchestra | null = null
let counter = 1
let getWindow: () => BrowserWindow | null = () => null

export const newId = (): string => `a${counter++}`
const toast = (message: string, kind: 'ok' | 'error' | 'info' = 'info'): void => { getWindow()?.webContents.send('orchestra:toast', message, kind) }

const busy = (id: string): boolean => pty.idleFor(id) < BUSY_SECONDS
const label = (name: string): string => name.split(' · ')[0]

function describe(meta: pty.Meta, leaderId: string | undefined): Record<string, unknown> {
  const model = currentModel(meta.command, meta.cwd)
  const level = tier(model)
  return {
    id: meta.id, agent: meta.name, command: meta.command, model: model ?? 'desconocido', tier: level.tier, model_recognized: level.known,
    role: meta.id === leaderId ? 'líder' : meta.parentId ? `sub-agente de ${meta.parentId}` : 'trabajador',
    status: busy(meta.id) ? 'ocupado' : 'libre', project: meta.cwd
  }
}

/** Agentes que no aceptan la tarea como argumento: se les escribe cuando su interfaz ya está lista. */
function deliverLater(id: string, task: string): void {
  const deadline = Date.now() + 40_000
  const timer = setInterval(() => {
    if (!pty.hasSession(id) || Date.now() > deadline) return clearInterval(timer)
    if (pty.screenText(id, 5) && pty.idleFor(id) >= 2) { clearInterval(timer); pty.sendPrompt(id, task) }
  }, 500)
}

/** Porcentaje usado del límite más ajustado de un agente (solo se conoce el de Claude; usa lo último consultado, sin pedir nada). */
async function quotaOf(command: string): Promise<number | undefined> {
  if (command !== 'claude') return undefined
  try {
    const { limits } = await claudeLimits(false)
    return limits.length ? Math.max(...limits.map((l) => l.percent)) : undefined
  } catch { return undefined }
}

/** Todo lo que se podría usar para una tarea: los paneles abiertos (menos quien pide y el líder) y los instalados por abrir. */
async function candidates(caller: string, cwd: string | undefined): Promise<Candidate[]> {
  const open = pty.agentSessions()
  const leader = open[0]
  const quotas = new Map<string, number | undefined>()
  const quota = async (command: string): Promise<number | undefined> => {
    if (!quotas.has(command)) quotas.set(command, await quotaOf(command))
    return quotas.get(command)
  }
  const out: Candidate[] = []
  for (const m of open) {
    if (m.id === caller || m.id === leader?.id) continue
    out.push({ id: m.id, name: m.name, command: m.command, tier: tier(currentModel(m.command, m.cwd)).tier, busy: busy(m.id), quota: await quota(m.command) })
  }
  for (const a of detectAgents()) {
    out.push({ name: a.name, command: a.command, tier: tier(cwd ? currentModel(a.command, cwd) : null).tier, busy: false, quota: await quota(a.command) })
  }
  return out
}

const nameOf = (c: Candidate): string => (c.id ? `${c.name} (${c.id})` : `${c.name} (por abrir)`)

const host: Host = {
  async listAgents(caller) {
    const open = pty.agentSessions()
    const leader = open[0]
    const project = leader?.cwd
    return {
      open_agents: await Promise.all(open.map(async (m) => ({ ...describe(m, leader?.id), quota_used_percent: (await quotaOf(m.command)) ?? 'desconocido' }))),
      installed_agents: await Promise.all(detectAgents().map(async (a) => {
        const model = project ? currentModel(a.command, project) : null
        const level = tier(model).tier
        return { agent: a.name, command: a.command, last_model: model ?? 'desconocido', tier: level, can_handle: capableFor({ tier: level }), quota_used_percent: (await quotaOf(a.command)) ?? 'desconocido' }
      })),
      you_are: caller, lead: leader?.id ?? null
    }
  },

  async delegate(caller, requested, task, newInstance, opts = {}) {
    const open = pty.agentSessions()
    const me = open.find((m) => m.id === caller)
    if (!me) return { ok: false, info: 'Solo los agentes abiertos en la app pueden repartir tareas.' }
    let target = requested
    const difficulty: Difficulty | undefined = isDifficulty(opts.difficulty) ? opts.difficulty : undefined
    let assigned = ''
    if (difficulty) {
      // revisa el listado de agentes y comprueba que el elegido tenga capacidad para la tarea
      const list = await candidates(caller, me.cwd)
      const best = pickAgent(list, difficulty)
      if (!target || target.toLowerCase() === 'auto') {
        if (!best.chosen) return { ok: false, info: `No se pudo asignar: ${best.reason}.` }
        target = best.chosen.id ?? best.chosen.command
        assigned = `Asignado a ${nameOf(best.chosen)}: ${best.reason}.`
      } else if (!opts.force) {
        const wanted = target.toLowerCase()
        const match = list.find((c) => c.id === target) ?? list.find((c) => !c.id && (c.command.toLowerCase() === wanted || c.name.toLowerCase() === wanted))
        if (match && (!capable(match, difficulty) || exhausted(match))) {
          const why = exhausted(match) ? `agotó su límite de uso (${match.quota}%)` : `es de nivel ${match.tier} y la tarea es ${difficulty}`
          const alt = best.chosen && best.chosen !== match ? ` Mejor opción: ${nameOf(best.chosen)} (${best.reason}). Vuelve a llamar con ese agente, con agent "auto", o con force=true para mantener ${nameOf(match)}.` : ' Usa force=true para mantenerlo igualmente.'
          return { ok: false, info: `${nameOf(match)} ${why}.${alt}` }
        }
      }
    }
    if (target === caller) return { ok: false, info: 'No puedes delegarte una tarea a ti mismo.' }
    const leader = open[0]
    let pane = open.find((m) => m.id === target)
    if (!pane) {
      const wanted = target.toLowerCase()
      const match = detectAgents().find((a) => a.command.toLowerCase() === wanted || a.name.toLowerCase() === wanted)
      if (!match) return { ok: false, info: `No conozco el agente '${target}'. Usa list_agents para ver los disponibles.` }
      // uno libre del mismo tipo, que no sea quien pide ni el líder (no se le quita el trabajo al líder)
      if (!newInstance) pane = open.find((m) => m.id !== caller && m.id !== leader?.id && m.command === match.command && !busy(m.id))
      if (!pane) {
        const win = getWindow()
        if (!win) return { ok: false, info: 'No se pudo abrir el agente: la ventana no está disponible.' }
        const id = newId()
        const request: OpenPane = { id, name: match.name, command: match.command, args: match.args ?? [], cwd: me.cwd, prompt: task, parentId: caller }
        win.webContents.send('orchestra:open-pane', request)         // la interfaz crea su panel; la terminal inicia el proceso
        if (!(await pty.waitForSpawn(id, 20_000))) return { ok: false, info: `No se pudo abrir ${match.name}: no arrancó a tiempo.` }
        toast(`${label(me.name)} abrió ${match.name} en un panel con una tarea`)
        return { ok: true, info: { agent_id: id, message: `${assigned} Abrí ${match.name} en su propio panel con la tarea. Usa wait_agent para esperar su resultado.`.trim() } }
      }
    }
    pty.sendPrompt(pane.id, task)
    toast(`${label(me.name)} delegó una tarea a ${label(pane.name)}`)
    return { ok: true, info: { agent_id: pane.id, message: `${assigned} Tarea enviada. Usa wait_agent para esperar su resultado.`.trim() } }
  },

  output(agentId, lines): AgentOutput | null {
    if (!pty.hasSession(agentId)) return null
    const idle = pty.idleFor(agentId)
    return { agent_id: agentId, busy: idle < BUSY_SECONDS, idle_seconds: Math.round(idle * 10) / 10, text: pty.screenText(agentId, Math.max(5, Math.min(lines, 400))) }
  }
}

/** Arranca el servidor de reparto de tareas (se desactiva con `"orchestration": false` en los ajustes). */
export async function startHub(window: () => BrowserWindow | null): Promise<void> {
  getWindow = window
  // el gancho va siempre: sin servidor de reparto de tareas los agentes siguen recibiendo el contexto del proyecto
  pty.setLaunchHook((opts): pty.Launch => {
    const entry = orchestra?.configFor(opts.id) ?? null
    const prompt = opts.prompt?.trim()
    const context = opts.cwd ? readContext(projectRoot(opts.cwd, knownProjects())) ?? undefined : undefined
    const launch = buildLaunch(opts.command, entry, prompt, opts.args ?? [], opts.command === 'opencode' ? opencodeMajor() : 2, context)
    // los agentes que no aceptan la tarea como argumento la reciben escrita cuando su interfaz está lista
    const after = prompt && !PROMPT_ARGS[opts.command] ? () => deliverLater(opts.id, prompt) : undefined
    return { ...launch, after }
  })
  if (getSetting('orchestration') === false) return
  try { orchestra = await new Orchestra(host).start() } catch { /* sin servidor local la app funciona igual */ }
}

/** Proyecto abierto y los del historial: sirven para saber a cuál pertenece la carpeta de un agente. */
function knownProjects(): string[] {
  const recent = getSetting('recent_projects')
  return [getSetting('project'), ...(Array.isArray(recent) ? recent : [])].filter((p): p is string => typeof p === 'string' && !!p)
}

let majorCache: number | null = null
/** Versión principal de OpenCode instalada (cambia cómo se le conecta el MCP). */
function opencodeMajor(): number {
  if (majorCache === null) {
    const exe = detectAgents().find((a) => a.command === 'opencode')?.path
    try { majorCache = exe ? parseMajor(execFileSync(exe, ['--version'], { encoding: 'utf8', timeout: 4000 })) : 2 } catch { majorCache = 2 }
  }
  return majorCache
}

export const stopHub = (): void => orchestra?.stop()

/** Configuración MCP de un agente (para las pruebas); null si el servidor no arrancó. */
export const orchestraConfig = (id: string): ReturnType<Orchestra['configFor']> | null => orchestra?.configFor(id) ?? null
