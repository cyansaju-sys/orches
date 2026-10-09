/** Lectura de la base de OpenCode (SQLite, tabla session_v2). Solo lectura: nunca se modifica. */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

export interface OpenCodeRow {
  id: string; title: string | null; directory: string | null
  time_created: number; time_updated: number
  tokens_input: number | null; tokens_output: number | null; tokens_reasoning: number | null; tokens_cache_write: number | null
}

export const opencodeDbPath = (): string => join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'opencode', 'opencode.db')

export function readOpenCodeSessions(path = opencodeDbPath()): OpenCodeRow[] | null {
  if (!existsSync(path)) return null
  let db: Database.Database | null = null
  try {
    // import dinámico: el módulo nativo solo se carga si hay base de OpenCode
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sqlite = require('better-sqlite3') as typeof Database
    db = new Sqlite(path, { readonly: true, fileMustExist: true, timeout: 2000 })
    return db.prepare(
      'select id, title, directory, time_created, time_updated, tokens_input, tokens_output, tokens_reasoning, tokens_cache_write ' +
      'from session_v2 where time_archived is null'
    ).all() as OpenCodeRow[]
  } catch {
    return []
  } finally {
    db?.close()
  }
}
