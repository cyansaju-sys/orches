/** Modelo que usa cada agente y su nivel de capacidad, para repartir tareas según la dificultad. */
import { closeSync, openSync, readdirSync, readSync, statSync, fstatSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type Tier = 'basic' | 'standard' | 'advanced'

// palabras que delatan un modelo pequeño o rápido / uno grande y capaz (se compara en minúsculas)
const BASIC = ['haiku', 'mini', 'flash', 'lite', 'small', 'nano', 'tiny', 'instant', '8b', '7b']
const ADVANCED = ['opus', 'fable', 'ultra', 'max', 'pro', 'large', 'reasoner', 'o1', 'o3', 'o4', 'gpt-5', 'gpt-4.5']
const STANDARD = ['sonnet', 'gpt-4', 'gemini', 'codestral', 'medium', 'plus']

/** Nivel del modelo y si se reconoció (si no, se asume intermedio). */
export function tier(model: string | null | undefined): { tier: Tier; known: boolean } {
  const m = (model ?? '').toLowerCase()
  if (!m) return { tier: 'standard', known: false }
  if (BASIC.some((k) => m.includes(k))) return { tier: 'basic', known: true }
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
