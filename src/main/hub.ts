/** Une el servidor MCP con los agentes abiertos: lista, reparte tareas, abre paneles y lee pantallas. */
import type { BrowserWindow } from 'electron'
import type { OpenPane } from '../shared/types'
import { detectAgents } from './agents'
import { currentModel, tier } from './models'
import { Orchestra, type AgentOutput, type Host } from './orchestra'
import * as pty from './pty'
import { getSetting } from './settings'

const BUSY_SECONDS = 4       // sin salida durante este tiempo = el agente ya no está trabajando
// herramientas del servidor «orches» que Claude Code puede usar sin pedir permiso cada vez
const ORCHES_TOOLS = ['mcp__orches__list_agents', 'mcp__orches__delegate_task', 'mcp__orches__wait_agent', 'mcp__orches__read_agent_output']
// cómo arrancar cada agente con una tarea inicial (el resto la recibe escrita cuando ya está listo)
const PROMPT_ARGS: Record<string, (text: string) => string[]> = { claude: (t) => [t], opencode: (t) => ['--prompt', t] }

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

const host: Host = {
  listAgents(caller) {
    const open = pty.agentSessions()
    const leader = open[0]
    const project = leader?.cwd
    return {
      open_agents: open.map((m) => describe(m, leader?.id)),
      installed_agents: detectAgents().map((a) => {
        const model = project ? currentModel(a.command, project) : null
        return { agent: a.name, command: a.command, last_model: model ?? 'desconocido', tier: tier(model).tier }
      }),
      you_are: caller, lead: leader?.id ?? null
    }
  },

  async delegate(caller, target, task, newInstance) {
    const open = pty.agentSessions()
    const me = open.find((m) => m.id === caller)
    if (!me) return { ok: false, info: 'Solo los agentes abiertos en la app pueden repartir tareas.' }
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
        const request: OpenPane = { id, name: match.name, command: match.command, cwd: me.cwd, prompt: task, parentId: caller }
        win.webContents.send('orchestra:open-pane', request)         // la interfaz crea su panel; la terminal inicia el proceso
        if (!(await pty.waitForSpawn(id, 20_000))) return { ok: false, info: `No se pudo abrir ${match.name}: no arrancó a tiempo.` }
        toast(`${label(me.name)} abrió ${match.name} en un panel con una tarea`)
        return { ok: true, info: { agent_id: id, message: `Abrí ${match.name} en su propio panel con la tarea. Usa wait_agent para esperar su resultado.` } }
      }
    }
    pty.sendPrompt(pane.id, task)
    toast(`${label(me.name)} delegó una tarea a ${label(pane.name)}`)
    return { ok: true, info: { agent_id: pane.id, message: 'Tarea enviada. Usa wait_agent para esperar su resultado.' } }
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
  if (getSetting('orchestration') === false) return
  try { orchestra = await new Orchestra(host).start() } catch { return }       // sin servidor local la app funciona igual
  pty.setLaunchHook((opts): pty.Launch => {
    const server = orchestra!
    const entry = server.configFor(opts.id)
    const prompt = opts.prompt?.trim()
    const given = opts.args ?? []
    const first = prompt && PROMPT_ARGS[opts.command] ? PROMPT_ARGS[opts.command](prompt) : []   // la tarea va primero: --mcp-config acepta varios valores y se la comería
    const after = prompt && !PROMPT_ARGS[opts.command] ? () => deliverLater(opts.id, prompt) : undefined
    if (opts.command === 'claude') {
      return { args: [...first, ...given, '--mcp-config', JSON.stringify({ mcpServers: { orches: entry } }), '--allowedTools', ...ORCHES_TOOLS], env: {}, after }
    }
    if (opts.command === 'opencode') {
      const config = { mcp: { servers: { orches: { type: 'remote', url: entry.url, headers: entry.headers } } } }
      return { args: [...first, ...given], env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) }, after }
    }
    return { args: given, env: {}, after }
  })
}

export const stopHub = (): void => orchestra?.stop()

/** Configuración MCP de un agente (para las pruebas); null si el servidor no arrancó. */
export const orchestraConfig = (id: string): ReturnType<Orchestra['configFor']> | null => orchestra?.configFor(id) ?? null
