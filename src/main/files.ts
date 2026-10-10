import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import type { DirEntry, FileData, McpResult } from '../shared/types'
import { tm } from './i18n'

const MAX_BYTES = 1_000_000
const MAX_EDIT_BYTES = 500_000
const IMAGES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.svg': 'image/svg+xml'
}
const HIDDEN = new Set(['.git'])

/** Contenido de una carpeta: primero las carpetas, luego los archivos, por nombre. */
export async function listDir(dir: string): Promise<DirEntry[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    const out: DirEntry[] = []
    for (const e of entries) {
      if (HIDDEN.has(e.name)) continue
      let isDir = e.isDirectory()
      if (e.isSymbolicLink()) isDir = await stat(join(dir, e.name)).then((s) => s.isDirectory(), () => false)
      out.push({ name: e.name, path: join(dir, e.name), isDir })
    }
    return out.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  } catch {
    return []
  }
}

export async function readFileData(path: string): Promise<FileData> {
  const info = await stat(path)
  const base = { crlf: false, truncated: false, readOnly: false, mtimeMs: info.mtimeMs }
  const mime = IMAGES[extname(path).toLowerCase()]
  if (mime) {
    const buf = await readFile(path)
    return { ...base, kind: 'image', text: '', readOnly: true, dataUrl: `data:${mime};base64,${buf.toString('base64')}` }
  }
  const buf = await readFile(path)
  const head = buf.subarray(0, 8000)
  if (head.includes(0)) return { ...base, kind: 'binary', text: '', readOnly: true }
  const truncated = buf.length > MAX_BYTES
  const slice = truncated ? buf.subarray(0, MAX_BYTES) : buf
  let text: string
  let utf8 = true
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(slice) } catch { utf8 = false; text = new TextDecoder('latin1').decode(slice) }
  const crlf = text.includes('\r\n')
  if (crlf) text = text.replace(/\r\n/g, '\n')                 // internamente siempre \n
  return { ...base, kind: 'text', text, crlf, truncated, readOnly: truncated || !utf8 || buf.length > MAX_EDIT_BYTES }
}

/** Guarda conservando los fines de línea originales; devuelve la fecha de modificación nueva. */
export async function writeFileData(path: string, text: string, crlf: boolean): Promise<number> {
  await writeFile(path, crlf ? text.replace(/\n/g, '\r\n') : text, 'utf8')       // en el mismo archivo: conserva permisos
  return (await stat(path)).mtimeMs
}

export async function mtime(path: string): Promise<number> {
  try { return (await stat(path)).mtimeMs } catch { return 0 }
}

const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)
/** Un nombre simple: sin separadores ni «..» (así nunca se sale de la carpeta). */
export const validName = (name: string): boolean => !!name.trim() && name === name.trim() && !/[\\/\0]/.test(name) && name !== '.' && name !== '..'

/** Crea un archivo vacío o una carpeta dentro de `dir`. No pisa nada que ya exista. */
export async function createEntry(dir: string, name: string, isDir: boolean): Promise<McpResult> {
  if (!validName(name)) return { ok: false, message: tm('m.fs.badName') }
  const target = join(dir, name)
  if (await exists(target)) return { ok: false, message: tm('m.fs.exists', { name }) }
  try {
    if (isDir) await mkdir(target)
    else await writeFile(target, '', { flag: 'wx' })
    return { ok: true, message: target }
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) } }
}

/** Cambia el nombre de un archivo o carpeta (dentro de la misma carpeta). Devuelve la ruta nueva en `message`. */
export async function renameEntry(path: string, name: string): Promise<McpResult> {
  if (!validName(name)) return { ok: false, message: tm('m.fs.badName') }
  const target = join(dirname(path), name)
  if (target === path) return { ok: true, message: path }
  if (await exists(target)) return { ok: false, message: tm('m.fs.exists', { name }) }
  try { await rename(path, target); return { ok: true, message: target } } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) } }
}
