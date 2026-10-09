/** Cómo arrancar cada agente conectado al reparto de tareas (argumentos y variables de entorno). */

export interface McpEntry { type: 'http'; url: string; headers: Record<string, string> }
/** Contexto del proyecto: el texto y el archivo donde vive. */
export interface ProjectContext { text: string; file: string }
export interface Launch { args: string[]; env: Record<string, string>; after?: () => void }

// herramientas del servidor «orches» que Claude Code puede usar sin pedir permiso cada vez
export const ORCHES_TOOLS = ['mcp__orches__list_agents', 'mcp__orches__delegate_task', 'mcp__orches__wait_agent', 'mcp__orches__read_agent_output']
// cómo arrancar cada agente con una tarea inicial (el resto la recibe escrita cuando ya está listo)
export const PROMPT_ARGS: Record<string, (text: string) => string[]> = {
  claude: (t) => [t], opencode: (t) => ['--prompt', t],
  agy: (t) => ['--prompt-interactive', t]            // Antigravity: ejecuta la tarea y sigue en modo interactivo
}

/** OpenCode lee las instrucciones adicionales de la clave `instructions` (rutas de archivos). */
const instructions = (context?: ProjectContext): { instructions?: string[] } => (context ? { instructions: [context.file] } : {})

/**
 * OpenCode 2.x atiende a todos sus clientes desde UN servicio en segundo plano compartido: la configuración que se le pasa
 * a un proceso por variable de entorno se pierde si el servicio ya estaba corriendo, y la que consigue entrar queda para
 * todos los demás OpenCode (incluidos los que abres fuera de Orches). `--standalone` le da a cada panel su propio servidor
 * privado: la configuración (con el id de ese panel) se aplica solo a él y no deja nada atrás.
 * La 1.x no tiene servicio compartido ni ese flag, y declara los servidores directamente bajo `mcp`.
 */
export function opencodeLaunch(entry: McpEntry | null, first: string[], given: string[], major: number, context?: ProjectContext): Launch {
  if (!entry) {         // sin servidor de reparto de tareas: solo el contexto del proyecto
    return { args: [...first, ...given], env: context ? { OPENCODE_CONFIG_CONTENT: JSON.stringify(instructions(context)) } : {} }
  }
  const remote = { type: 'remote', url: entry.url, headers: entry.headers }
  if (major >= 2) {
    const config = { mcp: { servers: { orches: remote } }, permission: { 'orches_*': 'allow' }, ...instructions(context) }   // sin preguntar en cada llamada
    return { args: ['--standalone', ...first, ...given], env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) } }
  }
  return { args: [...first, ...given], env: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ mcp: { orches: remote }, ...instructions(context) }) } }
}

/** La tarea inicial va primero: --mcp-config acepta varios valores y se la comería. */
export function claudeLaunch(entry: McpEntry | null, first: string[], given: string[], context?: ProjectContext): Launch {
  const system = context ? ['--append-system-prompt', context.text] : []
  if (!entry) return { args: [...first, ...given, ...system], env: {} }
  return { args: [...first, ...given, ...system, '--mcp-config', JSON.stringify({ mcpServers: { orches: entry } }), '--allowedTools', ...ORCHES_TOOLS], env: {} }
}

export function buildLaunch(command: string, entry: McpEntry | null, prompt: string | undefined, given: string[], opencodeMajor: number, context?: ProjectContext): Launch {
  const task = prompt?.trim()
  const first = task && PROMPT_ARGS[command] ? PROMPT_ARGS[command](task) : []
  if (command === 'claude') return claudeLaunch(entry, first, given, context)
  if (command === 'opencode') return opencodeLaunch(entry, first, given, opencodeMajor, context)
  return { args: given, env: {} }
}

/** Deja solo letras y números: así el texto se reconoce aunque la pantalla lo parta en líneas o lo rodee de bordes. */
const squash = (t: string): string => t.replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase()

/** ¿Aparece el comienzo de la tarea en la pantalla del agente? (si no, no la recibió) */
export function taskShown(screen: string, task: string): boolean {
  const head = squash(task).slice(0, 30)
  return head.length === 0 || squash(screen).includes(head)
}

/** «opencode v2.0.21» -> 2. Si no se puede leer se asume la versión actual (2). */
export function parseMajor(output: string): number {
  const m = /(\d+)\.\d+/.exec(output)
  return m ? Number(m[1]) : 2
}
