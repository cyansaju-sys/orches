/** Lectura del historial de Antigravity (agy): ~/.gemini/antigravity-cli/conversation_summaries.db. Solo lectura. */
import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

export interface AgyRow { conversation_id: string; title: string; preview: string; step_count: number; last_modified_time: string | number; workspace_uris: string }

export const agyDbPath = (): string => join(homedir(), '.gemini', 'antigravity-cli', 'conversation_summaries.db')

/** Borra una conversación: su fila del resumen y sus archivos (conversación, notas y anotaciones). Devuelve false si no se pudo. */
export function deleteAgyConversation(id: string, path = agyDbPath()): boolean {
  if (!/^[\w-]{8,64}$/.test(id) || !existsSync(path)) return false      // el id forma rutas: solo caracteres seguros
  let db: Database.Database | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sqlite = require('better-sqlite3') as typeof Database
    db = new Sqlite(path, { fileMustExist: true, timeout: 5000 })
    db.prepare('delete from conversation_summaries where conversation_id = ?').run(id)
  } catch {
    return false
  } finally {
    db?.close()
  }
  const root = join(path, '..')
  for (const f of ['conversations/' + id + '.db', 'conversations/' + id + '.db-wal', 'conversations/' + id + '.db-shm', 'annotations/' + id + '.pbtxt']) rmSync(join(root, f), { force: true })
  rmSync(join(root, 'brain', id), { recursive: true, force: true })
  return true
}

export function readAgyConversations(path = agyDbPath()): AgyRow[] | null {
  if (!existsSync(path)) return null
  let db: Database.Database | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sqlite = require('better-sqlite3') as typeof Database
    db = new Sqlite(path, { readonly: true, fileMustExist: true, timeout: 2000 })
    return db.prepare('select conversation_id, title, preview, step_count, last_modified_time, workspace_uris from conversation_summaries where killed = 0').all() as AgyRow[]
  } catch {
    return []
  } finally {
    db?.close()
  }
}
