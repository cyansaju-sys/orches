/** Lectura del historial de Antigravity (agy): ~/.gemini/antigravity-cli/conversation_summaries.db. Solo lectura. */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

export interface AgyRow { conversation_id: string; title: string; preview: string; step_count: number; last_modified_time: string | number; workspace_uris: string }

export const agyDbPath = (): string => join(homedir(), '.gemini', 'antigravity-cli', 'conversation_summaries.db')

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
