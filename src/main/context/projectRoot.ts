/** A qué proyecto pertenece una carpeta de trabajo (un agente puede abrirse dentro de una subcarpeta). */
import { execFileSync } from 'node:child_process'
import { relative, isAbsolute, resolve } from 'node:path'

const inside = (dir: string, root: string): boolean => {
  const rel = relative(resolve(root), resolve(dir))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** El proyecto conocido que contiene la carpeta (el más profundo), o la raíz del repositorio git, o la carpeta misma. */
export function projectRoot(cwd: string, known: string[]): string {
  const hit = known.filter((p) => inside(cwd, p)).sort((a, b) => b.length - a.length)[0]
  if (hit) return hit
  try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || cwd } catch { return cwd }
}
