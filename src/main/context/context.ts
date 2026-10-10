/** Contexto de un proyecto para los agentes: <config>/tutti/<proyecto>/contexto.md, fuera del repositorio. */
import { app } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { translate, type Lang } from '../../shared/i18n'
import { tm } from '../i18n'

/** La plantilla en el idioma actual; una escrita en el otro idioma también cuenta como «sin tocar». */
const template = (lang?: Lang): string => (lang ? translate(lang, 'm.ctx.template') : tm('m.ctx.template'))
const isTemplate = (text: string): boolean => [template('es'), template('en')].some((t) => t.trim() === text)

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
    writeFileSync(file, template(), 'utf8')
  }
  return file
}

/** Texto del contexto, o null si no existe o sigue siendo la plantilla sin tocar. */
export function readContext(project: string): { file: string; text: string } | null {
  const file = contextFile(project)
  try {
    const text = readFileSync(file, 'utf8').trim()
    return text && !isTemplate(text) ? { file, text } : null
  } catch { return null }
}
