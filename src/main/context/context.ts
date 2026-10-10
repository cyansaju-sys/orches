/** Contexto de un proyecto para los agentes: <config>/tutti/<proyecto>/contexto.md, fuera del repositorio. */
import { app } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const TEMPLATE = `# Contexto del proyecto

Lo que escribas aquí lo leen los agentes que abras desde Tutti en este proyecto.

## Qué es

## Cómo se ejecuta y se prueba

## Convenciones
`

/** Carpeta del proyecto dentro de la configuración: nombre legible + huella de la ruta (dos proyectos pueden llamarse igual). */
export function contextDir(project: string): string {
  const name = basename(project).replace(/[^\w.-]+/g, '_') || 'proyecto'
  const hash = createHash('sha1').update(project).digest('hex').slice(0, 8)
  return join(app.getPath('appData'), 'tutti', `${name}-${hash}`)
}

export const contextFile = (project: string): string => join(contextDir(project), 'contexto.md')

/** Ruta del contexto del proyecto; lo crea con una plantilla si todavía no existe. */
export function ensureContext(project: string): string {
  const file = contextFile(project)
  if (!existsSync(file)) {
    mkdirSync(contextDir(project), { recursive: true })
    writeFileSync(file, TEMPLATE, 'utf8')
  }
  return file
}

/** Texto del contexto, o null si no existe o sigue siendo la plantilla sin tocar. */
export function readContext(project: string): { file: string; text: string } | null {
  const file = contextFile(project)
  try {
    const text = readFileSync(file, 'utf8').trim()
    return text && text !== TEMPLATE.trim() ? { file, text } : null
  } catch { return null }
}
