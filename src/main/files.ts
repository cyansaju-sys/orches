import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { DirEntry, FileData } from '../shared/types'

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
