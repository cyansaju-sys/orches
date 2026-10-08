/**
 * Servidor MCP local para que los agentes repartan tareas entre sí.
 *
 * Escucha solo en 127.0.0.1, con un token aleatorio por ejecución. Cada agente lo ve como un servidor MCP más
 * («orches») con las herramientas list_agents, delegate_task, wait_agent y read_agent_output. La app (`host`) hace
 * el trabajo real: abrir paneles, escribir en sus terminales y leer su pantalla.
 */
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export const PROTOCOL = '2025-03-26'

const INSTRUCTIONS = `Eres un agente de una app que ejecuta varios agentes de programación en paralelo, cada uno con un modelo distinto. \
Puedes repartir trabajo con estas herramientas:
- list_agents: agentes abiertos y disponibles, con su modelo y nivel (basic, standard, advanced).
- delegate_task: manda una tarea a otro agente; si no está abierto, la app lo abre (en su propio panel) con la tarea. \
Puedes pedir un agente del mismo tipo que tú.
- wait_agent / read_agent_output: espera y lee lo que respondió.
Para repartir llama a delegate_task con "difficulty" (easy, medium o hard) y deja que la app asigne: revisa la lista de agentes, comprueba su \
capacidad y su límite de uso y elige el adecuado. Criterio: tareas fáciles o mecánicas (renombrar, texto, boilerplate, tests simples, búsquedas) a agentes \
de nivel basic o standard; lo difícil (arquitectura, bugs sutiles, cambios que tocan muchas partes) hazlo tú o pásalo a uno \
advanced. Cada tarea debe ser autosuficiente: indica archivos, objetivo y criterio de terminado. Evita que dos agentes editen \
los mismos archivos a la vez. Revisa siempre el resultado antes de darlo por bueno.`

export const TOOLS = [
  {
    name: 'list_agents',
    description: 'Lista los agentes abiertos (con id, modelo, nivel y si están ocupados) y los instalados que se pueden abrir.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'delegate_task',
    description: 'Envía una tarea a otro agente. `agent` es el id de un agente abierto (p. ej. "a2") o el nombre de un agente ' +
      'instalado (p. ej. "opencode" o "claude"): si no hay uno libre, la app abre uno nuevo en su propio panel con la tarea ya ' +
      'cargada. Pasa `difficulty` para que la app revise la lista de agentes, compruebe su capacidad y su límite de uso y asigne el ' +
      'más adecuado (con agent "auto" o sin `agent`); si el agente que pides no tiene capacidad suficiente, te lo rechaza y propone otro.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Id de un agente abierto, nombre de uno instalado o "auto" (con difficulty) para que la app elija.' },
        difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'], description: 'Dificultad de la tarea: easy (mecánica), medium o hard (arquitectura, bugs sutiles).' },
        force: { type: 'boolean', description: 'Mantener el agente pedido aunque no tenga capacidad suficiente.' },
        task: { type: 'string', description: 'Instrucción completa y autosuficiente.' },
        new_instance: { type: 'boolean', description: 'Abrir uno nuevo aunque ya haya uno libre.' }
      },
      required: ['task']
    }
  },
  {
    name: 'wait_agent',
    description: 'Espera a que un agente termine (sin salida durante `quiet_seconds`) y devuelve las últimas líneas de su pantalla.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        timeout_seconds: { type: 'integer', description: 'Máximo a esperar (por defecto 120).' },
        quiet_seconds: { type: 'integer', description: 'Silencio que cuenta como terminado (5).' },
        lines: { type: 'integer', description: 'Cuántas líneas devolver (por defecto 80).' }
      },
      required: ['agent_id']
    }
  },
  {
    name: 'read_agent_output',
    description: 'Lee las últimas líneas de la pantalla de un agente y dice si sigue ocupado.',
    inputSchema: {
      type: 'object',
      properties: { agent_id: { type: 'string' }, lines: { type: 'integer', description: 'Cuántas líneas (por defecto 80).' } },
      required: ['agent_id']
    }
  }
]

export interface AgentOutput { agent_id: string; busy: boolean; idle_seconds: number; text: string; finished?: boolean; note?: string }

/** Lo que la app ofrece al servidor. */
export interface Host {
  listAgents(caller: string): unknown | Promise<unknown>
  delegate(caller: string, target: string, task: string, newInstance: boolean, opts?: { difficulty?: string; force?: boolean }): Promise<{ ok: boolean; info: unknown }>
  output(agentId: string, lines: number): AgentOutput | null
}

interface RpcMessage { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }
const text = (value: unknown, error = false): object => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 1) }],
  isError: error
})
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export class Orchestra {
  readonly token = randomBytes(24).toString('base64url')
  port = 0
  private server: Server | null = null

  constructor(private readonly host: Host) {}

  async start(): Promise<this> {
    this.server = createServer((req, res) => void this.onRequest(req, res))
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(0, '127.0.0.1', resolve)
    })
    this.port = (this.server.address() as AddressInfo).port
    return this
  }

  stop(): void { this.server?.close(); this.server = null }

  /** Entrada de servidor MCP (formato `mcpServers`) para que un agente se conecte como `callerId`. */
  configFor(callerId: string): { type: 'http'; url: string; headers: { Authorization: string } } {
    return { type: 'http', url: `http://127.0.0.1:${this.port}/mcp/${callerId}`, headers: { Authorization: `Bearer ${this.token}` } }
  }

  private send(res: ServerResponse, code: number, payload?: unknown): void {
    const body = payload === undefined ? '' : JSON.stringify(payload)
    res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
    res.end(body)
  }

  private async onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.headers.authorization !== `Bearer ${this.token}`) return this.send(res, 401, { error: 'unauthorized' })
    if (req.method === 'GET') return this.send(res, 405)            // no hay canal de eventos del servidor
    if (req.method === 'DELETE') return this.send(res, 200)
    if (req.method !== 'POST') return this.send(res, 405)
    const caller = (req.url ?? '').split('?')[0].replace(/\/+$/, '').split('/').pop() ?? ''
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      size += (chunk as Buffer).length
      if (size > 1_000_000) return this.send(res, 413, { error: 'too large' })
      chunks.push(chunk as Buffer)
    }
    let data: RpcMessage | RpcMessage[]
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { return this.send(res, 400, { error: 'invalid json' }) }
    const batch = Array.isArray(data) ? data : [data]
    const replies = (await Promise.all(batch.map((m) => this.handle(m, caller)))).filter((r) => r !== null)
    if (!replies.length) return this.send(res, 202)
    this.send(res, 200, Array.isArray(data) ? replies : replies[0])
  }

  /** JSON-RPC: devuelve null para las notificaciones (sin respuesta). */
  async handle(message: RpcMessage, caller: string): Promise<object | null> {
    const { method, params = {}, id } = message
    if (process.env.ORCHES_MCP_LOG) console.log(`MCP ${caller} ${method}${method === 'tools/call' ? ' ' + String(params.name) : ''}`)   // depuración: qué piden los agentes
    if (id === undefined || id === null) return null
    try {
      let result: unknown
      if (method === 'initialize') {
        result = {
          protocolVersion: (params.protocolVersion as string) || PROTOCOL, capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'orches', version: '0.2' }, instructions: INSTRUCTIONS
        }
      } else if (method === 'ping') result = {}
      else if (method === 'tools/list') result = { tools: TOOLS }
      else if (method === 'tools/call') result = await this.call(String(params.name), (params.arguments as Record<string, unknown>) ?? {}, caller)
      else return { jsonrpc: '2.0', id, error: { code: -32601, message: `método desconocido: ${method}` } }
      return { jsonrpc: '2.0', id, result }
    } catch (e) {          // un fallo de una herramienta no debe tumbar el servidor
      return { jsonrpc: '2.0', id, result: text(`Error interno: ${e instanceof Error ? e.message : String(e)}`, true) }
    }
  }

  private async call(name: string, args: Record<string, unknown>, caller: string): Promise<object> {
    if (name === 'list_agents') return text(await this.host.listAgents(caller))
    if (name === 'delegate_task') {
      const task = String(args.task ?? '').trim()
      const difficulty = args.difficulty === undefined ? undefined : String(args.difficulty)
      if (!task || (!args.agent && !difficulty)) return text('Faltan `task` y `agent` (o `difficulty` para que la app elija).', true)
      if (difficulty && !['easy', 'medium', 'hard'].includes(difficulty)) return text('`difficulty` debe ser easy, medium o hard.', true)
      const { ok, info } = await this.host.delegate(caller, String(args.agent ?? 'auto'), task, Boolean(args.new_instance), { difficulty, force: Boolean(args.force) })
      return text(info, !ok)
    }
    if (name === 'read_agent_output') {
      const out = this.host.output(String(args.agent_id ?? ''), Number(args.lines) || 80)
      return out ? text(out) : text('No existe ese agente.', true)
    }
    if (name === 'wait_agent') return this.wait(args)
    return text(`Herramienta desconocida: ${name}`, true)
  }

  private async wait(args: Record<string, unknown>): Promise<object> {
    const id = String(args.agent_id ?? '')
    const timeout = Math.min(Number(args.timeout_seconds) || 120, 600)
    const quiet = Math.max(2, Number(args.quiet_seconds) || 5)
    const deadline = Date.now() + timeout * 1000
    for (;;) {
      const out = this.host.output(id, Number(args.lines) || 80)
      if (!out) return text('No existe ese agente.', true)
      if (out.idle_seconds >= quiet) return text({ ...out, finished: true })
      if (Date.now() >= deadline) return text({ ...out, finished: false, note: 'Se agotó la espera; el agente sigue trabajando.' })
      await sleep(500)
    }
  }
}
