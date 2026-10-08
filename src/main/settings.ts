/** Ajustes del usuario en <config>/orches/settings.json (la misma ruta que usaba la versión anterior). */
import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const file = (): string => join(app.getPath('appData'), 'orches', 'settings.json')

export function loadSettings(): Record<string, unknown> {
  try { return JSON.parse(readFileSync(file(), 'utf8')) } catch { return {} }
}

export function getSetting(key: string): unknown { return loadSettings()[key] }

export function setSetting(key: string, value: unknown): void {
  const data = loadSettings()
  data[key] = value
  try {
    mkdirSync(dirname(file()), { recursive: true })
    writeFileSync(file(), JSON.stringify(data, null, 2), 'utf8')
  } catch { /* sin permisos: se ignora */ }
}
