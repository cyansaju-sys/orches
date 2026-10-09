/** Modelo que usa cada agente y su nivel de capacidad, para repartir tareas según la dificultad. */
import { execFile } from 'node:child_process'
import { closeSync, openSync, readdirSync, readSync, statSync, fstatSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type Tier = 'basic' | 'standard' | 'advanced'

// palabras que delatan un modelo pequeño o rápido / uno grande y capaz (se compara en minúsculas)
const BASIC = ['haiku', 'flash', 'lite', 'small', 'nano', 'tiny', 'instant', '8b', '7b']
const ADVANCED = ['opus', 'fable', 'ultra', 'max', 'pro', 'large', 'reasoner', 'o1', 'o3', 'o4', 'gpt-5', 'gpt-4.5']
const STANDARD = ['sonnet', 'gpt-4', 'gemini', 'codestral', 'medium', 'plus']

/** Nivel del modelo y si se reconoció (si no, se asume intermedio). */
export function tier(model: string | null | undefined): { tier: Tier; known: boolean } {
  const m = (model ?? '').toLowerCase()
  if (!m) return { tier: 'standard', known: false }
  if (BASIC.some((k) => m.includes(k)) || /(^|[^a-z])mini/.test(m))   // «mini» suelto: no es el de «gemini»
    return { tier: 'basic', known: true }
  if (ADVANCED.some((k) => m.includes(k))) return { tier: 'advanced', known: true }
  if (STANDARD.some((k) => m.includes(k))) return { tier: 'standard', known: true }
  return { tier: 'standard', known: false }
}

/** Último modelo usado en el proyecto, leído del final de su sesión más reciente de Claude Code. */
function claudeModel(cwd: string): string | null {
  const folder = join(homedir(), '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'))
  try {
    const files = readdirSync(folder).filter((f) => f.endsWith('.jsonl')).map((f) => join(folder, f))
    const newest = files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
    if (!newest) return null
    const fd = openSync(newest, 'r')
    try {
      const size = fstatSync(fd).size
      const length = Math.min(size, 300_000)
      const buf = Buffer.alloc(length)
      readSync(fd, buf, 0, length, size - length)
      const found = [...buf.toString('utf8').matchAll(/"model":"([^"]+)"/g)].map((m) => m[1])
      return found.reverse().find((m) => !m.startsWith('<')) ?? null
    } finally { closeSync(fd) }
  } catch {
    return null
  }
}

/** Modelo que está usando el agente en esa carpeta, o null si aún no se sabe (OpenCode no se lee todavía). */
export function currentModel(command: string, cwd: string): string | null {
  return command === 'claude' ? claudeModel(cwd) : null
}

// Modelos conocidos de los agentes que no tienen un comando para listarlos (pueden quedar desfasados con el tiempo)
const STATIC_MODELS: Record<string, string[]> = {
  claude: ['fable', 'opus', 'sonnet', 'haiku', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
  codex: ['gpt-5-codex', 'gpt-5', 'gpt-5-mini', 'o3', 'o4-mini'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
}
/** Agentes que aceptan el modelo como argumento al arrancar (el resto hay que cambiarlo a mano dentro de su interfaz). */
export const MODEL_FLAG: Record<string, string> = { claude: '--model', agy: '--model', codex: '--model', gemini: '--model', 'cursor-agent': '--model', auggie: '--model', forge: '--model', aider: '--model' }

const MODELS_TTL = 5 * 60_000
const modelCache = new Map<string, { at: number; list: string[] }>()
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g
const HEADER = new Set(['available', 'models', 'model', 'provider', 'id', 'name', 'fetching', 'loading'])

/** Primera columna de cada línea que parece un id de modelo (sin cabeceras ni adornos de tabla). */
const firstColumn = (out: string): string[] => out.replace(ANSI, '').split('\n').map((l) => l.trim().split(/[\t\s|]+/).find(Boolean) ?? '')
  .filter((t) => /^[A-Za-z0-9][\w.:/@+-]*$/.test(t) && !HEADER.has(t.toLowerCase()))
const lines = (out: string): string[] => out.replace(ANSI, '').split('\n').map((l) => l.trim()).filter((l) => l && !/^[-─═+|]+$/.test(l))

// Agentes que listan sus modelos con un comando propio (todos sin interfaz): argumentos y cómo leer la salida
const LIST_CMD: Record<string, { args: string[]; parse: (out: string) => string[] }> = {
  opencode: { args: ['models'], parse: lines },
  agy: { args: ['models'], parse: firstColumn },            // «id<TAB>Nombre»
  'cursor-agent': { args: ['models'], parse: firstColumn },
  auggie: { args: ['--list-models'], parse: firstColumn },
  crush: { args: ['models'], parse: lines },                // tabla: se devuelve cada fila tal cual
  forge: { args: ['list', 'model'], parse: lines }
}

/** Modelos que ofrece un agente (id y nivel): con su comando si lo tiene, si no una lista fija; vacío si no se conoce. */
export async function availableModels(command: string, exe?: string): Promise<Array<{ id: string; tier: Tier }>> {
  const hit = modelCache.get(command)
  let list: string[]
  if (hit && Date.now() - hit.at < MODELS_TTL) list = hit.list
  else {
    const cmd = LIST_CMD[command]
    if (cmd) {
      list = await new Promise<string[]>((resolve) => {
        execFile(exe ?? command, cmd.args, { timeout: 15_000, maxBuffer: 4_000_000 }, (err, out) => resolve(err ? [] : [...new Set(cmd.parse(out))]))
      })
    } else list = STATIC_MODELS[command] ?? []
    if (list.length || !cmd) modelCache.set(command, { at: Date.now(), list })
  }
  return list.map((id) => ({ id, tier: tier(id).tier }))
}
