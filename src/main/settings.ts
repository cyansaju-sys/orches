/** Ajustes del usuario en <config>/tutti/settings.json. */
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const file = (): string => join(app.getPath('appData'), 'tutti', 'settings.json')

/** La app se llamaba Orches: sus ajustes y contextos de proyecto viven en <config>/orches y pasan a <config>/tutti. */
export function migrateLegacyConfig(): void {
  const old = join(app.getPath('appData'), 'orches')
  const now = join(app.getPath('appData'), 'tutti')
  try { if (existsSync(old) && !existsSync(now)) renameSync(old, now) } catch { /* sin permisos: empieza con ajustes nuevos */ }
}

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
