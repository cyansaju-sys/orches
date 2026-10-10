/** Une el servidor MCP con los agentes abiertos: lista, reparte tareas, abre paneles y lee pantallas. */
import type { BrowserWindow } from 'electron'
import type { OpenPane, TaskInfo } from '../../shared/types'
import { execFileSync } from 'node:child_process'
import { detectAgents } from './agents'
import { capableFor, exhausted, isDifficulty, capable, pickAgent, type Candidate, type Difficulty } from './assign'
import { readContext } from '../context/context'
import { projectRoot } from '../context/projectRoot'
import { ensureAgyBridge } from './agyBridge'
import { buildLaunch, parseMajor, PROMPT_ARGS, taskShown } from './launch'
import { availableModels, currentModel, MODEL_FLAG, tier } from './models'
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

// --- registro de tareas delegadas (lo que muestra el panel «Tareas») ---
interface TaskRecord extends Omit<TaskInfo, 'status' | 'model'> { model: string | null; command: string; cwd: string; notified?: boolean }
const tasks: TaskRecord[] = []
const STARTING_SECONDS = 8       // un agente recién abierto aún no ha dado salida: se considera trabajando

function recordTask(caller: pty.Meta, agentId: string, agent: string, command: string, task: string, opts: { difficulty?: string; model?: string }): void {
  const now = Date.now()
  for (const t of tasks) if (t.agentId === agentId && t.endedAt === null) t.endedAt = now      // si se reutiliza el agente, la anterior ya acabó
  tasks.push({ id: tasks.length ? tasks[tasks.length - 1].id + 1 : 1, agentId, agent, callerId: caller.id, caller: label(caller.name), task, model: opts.model ?? null, difficulty: opts.difficulty ?? null,
    startedAt: now, endedAt: null, command, cwd: caller.cwd })
  if (tasks.length > 100) tasks.splice(0, tasks.length - 100)
}

function statusOf(t: TaskRecord): TaskInfo['status'] {
  if (!pty.hasSession(t.agentId)) { t.endedAt ??= Date.now(); return 'closed' }
  if (t.endedAt !== null) return 'done'
  const idle = pty.idleFor(t.agentId)
  if (Date.now() - t.startedAt < STARTING_SECONDS * 1000 || idle < BUSY_SECONDS) return 'working'
  t.endedAt = Date.now() - idle * 1000            // terminó cuando dejó de dar salida
  return 'done'
}

/** Tareas delegadas, de la más reciente a la más antigua. */
export function taskList(): TaskInfo[] {
  return [...tasks].reverse().map((t) => {
    const { command, cwd, ...info } = t
    return { ...info, model: t.model ?? currentModel(command, cwd), status: statusOf(t) }
  })
}
/** Quita del panel las tareas ya terminadas o cuyo agente se cerró. */
export function clearTasks(): void {
  for (let i = tasks.length - 1; i >= 0; i--) if (statusOf(tasks[i]) !== 'working') tasks.splice(i, 1)
}

const NOTIFY_PATIENCE_MS = 60_000        // si el líder sigue ocupado tanto tiempo, el aviso se entrega igualmente

/** Avisa al líder (escribiéndole en su terminal) de que un agente terminó su tarea; espera a que el líder esté libre. */
function notifyLeaders(): void {
  for (const t of tasks) {
    if (t.notified) continue
    const status = statusOf(t)
    if (status === 'working') continue
    if (!pty.hasSession(t.callerId)) { t.notified = true; continue }          // el líder ya no está
    if (pty.idleFor(t.callerId) < 3 && Date.now() - (t.endedAt ?? Date.now()) < NOTIFY_PATIENCE_MS) continue
    t.notified = true
    const what = t.task.replace(/\s+/g, ' ').slice(0, 80)
    const result = status === 'closed' ? 'se cerró' : 'terminó'
    pty.sendPrompt(t.callerId, `[Tutti] ${t.agent} (${t.agentId}) ${result} la tarea «${what}». Lee el resultado con read_agent_output(agent_id: "${t.agentId}") y sigue con tu plan.`)
  }
}
let notifier: ReturnType<typeof setInterval> | null = null

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

/**
 * Entrega la tarea y comprueba que llegó. Si el agente no la acepta como argumento (`viaArgs` falso) se le escribe cuando su
 * interfaz está lista; si la tarea no aparece en su pantalla una vez en reposo (la ignoró o arrancó sin ella), se vuelve a enviar.
 */
function deliverTask(id: string, task: string, viaArgs: boolean): void {
  const deadline = Date.now() + 90_000
  let sent = viaArgs ? 0 : -1            // -1: aún no se ha escrito nada
  const timer = setInterval(() => {
    if (!pty.hasSession(id) || Date.now() > deadline) return clearInterval(timer)
    const screen = pty.screenText(id, 300)
    if (!screen || pty.idleFor(id) < (sent <= 0 ? 2 : 4)) return          // interfaz sin lista o todavía trabajando
    if (sent >= 0 && taskShown(screen, task)) return clearInterval(timer)  // llegó
    if (sent >= 3) return clearInterval(timer)                              // reintentos agotados
    pty.sendPrompt(id, task)
    sent = Math.max(sent, 0) + 1
  }, 1000)
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
      open_agents: await Promise.all(open.map(async (m) => ({ ...describe(m, leader?.id), quota_used_percent: (await quotaOf(m.command)) ?? 'desconocido', available_models: await availableModels(m.command, detectAgents().find((a) => a.command === m.command)?.path) }))),
      installed_agents: await Promise.all(detectAgents().map(async (a) => {
        const model = project ? currentModel(a.command, project) : null
        const level = tier(model).tier
        return { agent: a.name, command: a.command, last_model: model ?? 'desconocido', tier: level, can_handle: capableFor({ tier: level }), available_models: await availableModels(a.command, a.path), quota_used_percent: (await quotaOf(a.command)) ?? 'desconocido' }
      })),
      you_are: caller, lead: leader?.id ?? null
    }
  },

  reported(agentId) {
    for (const t of tasks) if (t.agentId === agentId) t.notified = true
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
    // modelo pedido: se comprueba que el agente lo ofrezca y que se pueda fijar al arrancar; uno abierto con otro modelo no sirve
    const model = opts.model
    let modelArgs: string[] = []
    if (model) {
      const openTarget = open.find((m) => m.id === target)
      const command = openTarget?.command ?? detectAgents().find((a) => a.command.toLowerCase() === target.toLowerCase() || a.name.toLowerCase() === target.toLowerCase())?.command
      if (!command) return { ok: false, info: `No conozco el agente '${target}'. Usa list_agents para ver los disponibles.` }
      const flag = MODEL_FLAG[command]
      if (!flag) return { ok: false, info: `${command} no permite elegir el modelo al abrirlo desde aquí. Cámbialo a mano en su panel o pide otro agente (con model: ${Object.keys(MODEL_FLAG).join(', ')}).` }
      const offered = await availableModels(command, detectAgents().find((a) => a.command === command)?.path)
      if (offered.length && !offered.some((m) => m.id === model)) return { ok: false, info: `${command} no ofrece el modelo '${model}'. Disponibles: ${offered.map((m) => m.id).join(', ')}.` }
      modelArgs = [flag, model]
      if (openTarget) {
        if ((currentModel(command, openTarget.cwd) ?? '').includes(model)) modelArgs = []      // ya usa ese modelo
        else { target = command; newInstance = true }
      } else newInstance = true
    }
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
        const request: OpenPane = { id, name: match.name, command: match.command, args: [...(match.args ?? []), ...modelArgs], cwd: me.cwd, prompt: task, parentId: caller }
        win.webContents.send('orchestra:open-pane', request)         // la interfaz crea su panel; la terminal inicia el proceso
        if (!(await pty.waitForSpawn(id, 20_000))) return { ok: false, info: `No se pudo abrir ${match.name}: no arrancó a tiempo.` }
        recordTask(me, id, match.name, match.command, task, { difficulty, model })
        toast(`${label(me.name)} abrió ${match.name} en un panel con una tarea`)
        return { ok: true, info: { agent_id: id, message: `${assigned} Abrí ${match.name}${model ? ` con el modelo ${model}` : ''} en su propio panel con la tarea. Usa wait_agent para esperar su resultado.`.trim() } }
      }
    }
    pty.sendPrompt(pane.id, task)
    recordTask(me, pane.id, pane.name, pane.command, task, { difficulty, model })
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
    if (entry && opts.command === 'agy') ensureAgyBridge()
    const prompt = opts.prompt?.trim()
    const context = opts.cwd ? readContext(projectRoot(opts.cwd, knownProjects())) ?? undefined : undefined
    const launch = buildLaunch(opts.command, entry, prompt, opts.args ?? [], opts.command === 'opencode' ? opencodeMajor() : 2, context)
    // los agentes que no aceptan la tarea como argumento la reciben escrita cuando su interfaz está lista
    const after = prompt ? () => deliverTask(opts.id, prompt, !!PROMPT_ARGS[opts.command]) : undefined
    return { ...launch, after }
  })
  if (getSetting('orchestration') === false) return
  notifier ??= setInterval(notifyLeaders, 2000)
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

export const stopHub = (): void => { orchestra?.stop(); if (notifier) clearInterval(notifier); notifier = null }

/** Configuración MCP de un agente (para las pruebas); null si el servidor no arrancó. */
export const orchestraConfig = (id: string): ReturnType<Orchestra['configFor']> | null => orchestra?.configFor(id) ?? null
