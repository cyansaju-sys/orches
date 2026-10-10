/** Búsqueda de texto en el proyecto (la del panel «Buscar»): respeta .gitignore cuando hay git y salta binarios y archivos enormes. */
import { execFile } from 'node:child_process'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import type { ReplaceResult, SearchFile, SearchOptions, SearchResult } from '../shared/types'

const MAX_FILES = 500
const MAX_MATCHES = 5000
const MAX_FILE_BYTES = 1_000_000
const MAX_LINE = 300
const SKIP_DIRS = new Set(['.git', 'node_modules', 'out', 'dist', 'build', 'release', '.next', '.cache', 'coverage', '__pycache__', '.venv', 'target'])

/** «*.ts, src/**» -> expresiones regulares sobre rutas con «/». Sin «/» en el patrón, vale el nombre en cualquier carpeta. */
export function globsToRegex(list: string): RegExp[] {
  return list.split(',').map((g) => g.trim()).filter(Boolean).map((g) => {
    const dir = g.endsWith('/')
    let p = g.replace(/^\.\//, '').replace(/\/$/, '')
    const anchored = p.includes('/')
    p = p.replace(/^\//, '')
    const body = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '(?:.*/)?')
    return new RegExp(`^${anchored ? '' : '(?:.*/)?'}${body}${dir || !/[*?]/.test(p) ? '(?:/.*)?' : ''}$`)
  })
}

/** La expresión que busca `opts.query`, o un texto de error si la expresión regular no es válida. */
export function buildMatcher(opts: Pick<SearchOptions, 'query' | 'caseSensitive' | 'wholeWord' | 'regex'>): RegExp | string {
  let src = opts.regex ? opts.query : opts.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (opts.wholeWord) src = `\\b(?:${src})\\b`
  try { return new RegExp(src, opts.caseSensitive ? 'gu' : 'giu') } catch (e) { return e instanceof Error ? e.message : 'Expresión no válida' }
}

const git = (root: string): Promise<string[] | null> => new Promise((resolve) => {
  execFile('git', ['-C', root, 'ls-files', '-z', '-co', '--exclude-standard'], { maxBuffer: 64 * 1024 * 1024 }, (err, out) => resolve(err ? null : out.split('\0').filter(Boolean)))
})

async function walk(root: string, dir = root, out: string[] = []): Promise<string[]> {
  let entries
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) await walk(root, join(dir, e.name), out) }
    else if (e.isFile()) out.push(relative(root, join(dir, e.name)).split(sep).join('/'))
  }
  return out
}

export async function searchFiles(root: string, opts: SearchOptions): Promise<SearchResult> {
  const empty: SearchResult = { files: [], total: 0, truncated: false }
  if (!opts.query) return empty
  const re = buildMatcher(opts)
  if (typeof re === 'string') return { ...empty, error: re }
  const include = globsToRegex(opts.include ?? '')
  const exclude = globsToRegex(opts.exclude ?? '')
  const names = (await git(root)) ?? (await walk(root))
  const files: SearchFile[] = []
  let total = 0
  let truncated = false
  for (const rel of names.sort()) {
    if (include.length && !include.some((r) => r.test(rel))) continue
    if (exclude.some((r) => r.test(rel))) continue
    const path = join(root, rel)
    let buf: Buffer
    try { const info = await stat(path); if (!info.isFile() || info.size > MAX_FILE_BYTES) continue; buf = await readFile(path) } catch { continue }
    if (buf.subarray(0, 8000).includes(0)) continue
    const lines = buf.toString('utf8').split(/\r?\n/)
    const matches: SearchFile['matches'] = []
    for (let i = 0; i < lines.length && total < MAX_MATCHES; i++) {
      const line = lines[i]
      re.lastIndex = 0
      for (let m = re.exec(line); m; m = re.exec(line)) {
        if (!m[0]) { re.lastIndex++; continue }                     // coincidencia vacía (p. ej. «a*»): se ignora
        // la línea se recorta alrededor de la coincidencia para que el panel no cargue textos enormes
        const from = Math.max(0, m.index - 40)
        const text = line.slice(from, from + MAX_LINE)
        matches.push({ line: i + 1, col: m.index, length: m[0].length, text, offset: from })
        total++
        if (total >= MAX_MATCHES) break
      }
    }
    if (matches.length) files.push({ path, rel, matches })
    if (total >= MAX_MATCHES || files.length >= MAX_FILES) { truncated = true; break }
  }
  return { files, total, truncated }
}

/**
 * Reemplaza en los archivos indicados (los que salieron en la búsqueda). Línea a línea, igual que al buscar, y conservando
 * los fines de línea. Con expresión regular la sustitución admite $1, $&…; sin ella el texto se pone tal cual.
 */
export async function replaceInFiles(root: string, opts: SearchOptions, replacement: string, paths: string[]): Promise<ReplaceResult> {
  const re = buildMatcher(opts)
  if (typeof re === 'string') return { files: 0, count: 0, error: re }
  let files = 0
  let count = 0
  for (const path of paths) {
    const rel = relative(root, path)
    if (rel.startsWith('..') || isAbsolute(rel)) continue            // solo dentro del proyecto
    try {
      const info = await stat(path)
      if (!info.isFile() || info.size > MAX_FILE_BYTES) continue
      const buf = await readFile(path)
      if (buf.subarray(0, 8000).includes(0)) continue
      let n = 0
      const text = buf.toString('utf8').split(/(\r?\n)/).map((part, i) => {
        if (i % 2) return part                                      // el separador de línea se deja como estaba
        return part.replace(re, (...m) => {
          if (!m[0]) return m[0]
          n++
          if (!opts.regex) return replacement
          const groups = m.slice(1, m.findIndex((x) => typeof x === 'number'))
          return replacement.replace(/\$(\$|&|\d{1,2})/g, (_, k: string) => k === '$' ? '$' : k === '&' ? m[0] : (groups[Number(k) - 1] ?? ''))
        })
      }).join('')
      if (!n) continue
      await writeFile(path, text, 'utf8')
      files++; count += n
    } catch { /* un archivo que no se puede escribir se salta */ }
  }
  return { files, count }
}
