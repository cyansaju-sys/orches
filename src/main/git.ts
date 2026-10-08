import { execFile } from 'node:child_process'
import { dirname, basename } from 'node:path'
import type { GitBranch, GitMarks, GitStatus } from '../shared/types'
import { extendedPath } from './shellpath'

interface Result { ok: boolean; out: string }

function run(root: string, args: string[], input?: string, timeout = 15000): Promise<Result> {
  return new Promise((resolve) => {
    const child = execFile('git', ['-C', root, ...args], {
      encoding: 'utf8', timeout, maxBuffer: 20 * 1024 * 1024, windowsHide: true,
      env: { ...process.env, PATH: extendedPath(), GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }
    }, (err, stdout, stderr) => resolve({ ok: !err, out: (stdout || '') + (err ? (stderr || String(err.message)) : '') }))
    if (input !== undefined) { child.stdin?.write(input); child.stdin?.end() }
  })
}

/** Código corto de estado (M, A, U, R, D, C) a partir de las dos columnas de `git status --porcelain`. */
export function statusCode(xy: string): string {
  if (xy === '??') return 'U'
  if (xy.includes('U') || xy === 'AA' || xy === 'DD') return 'C'
  const c = xy.replace(/ /g, '')[0] ?? ''
  return c === 'R' || c === 'C' ? 'R' : c
}

export async function status(root: string): Promise<GitStatus> {
  const empty: GitStatus = { isRepo: false, branch: '', ahead: 0, behind: 0, hasUpstream: false, files: [] }
  const branch = await run(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (!branch.ok) return empty
  const res = await run(root, ['status', '--porcelain=v1', '-z', '-uall'])
  const parts = res.out.split('\0').filter(Boolean)
  const files = []
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]
    const xy = entry.slice(0, 2)
    const path = entry.slice(3)
    if (xy[0] === 'R' || xy[0] === 'C') i++                          // el nombre anterior viene aparte
    files.push({ path, index: xy[0].trim(), work: xy[1].trim(), code: statusCode(xy) })
  }
  const sync = await run(root, ['rev-list', '--left-right', '--count', '@{u}...HEAD'])
  const [behind, ahead] = sync.ok ? sync.out.trim().split(/\s+/).map(Number) : [0, 0]
  return { isRepo: true, branch: branch.out.trim(), ahead: ahead || 0, behind: behind || 0, hasUpstream: sync.ok, files }
}

export async function ignored(root: string, paths: string[]): Promise<string[]> {
  if (!paths.length) return []
  const res = await run(root, ['check-ignore', '-z', '--stdin'], paths.join('\0'), 5000)
  return res.out.split('\0').filter(Boolean)
}

const flat = (r: Result): string => (r.ok ? '' : r.out.trim() || 'git falló')

export const stage = async (root: string, paths: string[]): Promise<string> => flat(await run(root, ['add', '--', ...paths]))
export const unstage = async (root: string, paths: string[]): Promise<string> =>
  flat(await run(root, ['restore', '--staged', '--', ...paths]))

export async function commit(root: string, message: string): Promise<string> {
  const staged = await run(root, ['diff', '--cached', '--name-only'])
  if (staged.ok && !staged.out.trim()) {
    const all = await run(root, ['add', '-A'])                       // sin nada preparado se prepara todo, como hacía la app
    if (!all.ok) return flat(all)
  }
  return flat(await run(root, ['commit', '-m', message], undefined, 60000))
}

export interface StagedFile { status: string; path: string; added: number; deleted: number }

/** Archivos preparados con su estado (A, M, D, R…) y las líneas añadidas y borradas. */
export async function stagedSummary(root: string): Promise<StagedFile[]> {
  const names = await run(root, ['diff', '--cached', '--name-status', '-M'])
  const stats = await run(root, ['diff', '--cached', '--numstat', '-M'])
  if (!names.ok) return []
  const counts = new Map<string, [number, number]>()
  for (const line of stats.ok ? stats.out.split('\n') : []) {
    const [a, d, ...p] = line.split('\t')
    if (p.length) counts.set(p[p.length - 1].replace(/^.*=> /, '').replace(/[{}]/g, ''), [Number(a) || 0, Number(d) || 0])
  }
  return names.out.split('\n').filter(Boolean).map((l) => {
    const [status, ...p] = l.split('\t')
    const path = p[p.length - 1]
    const [added, deleted] = counts.get(path) ?? [0, 0]
    return { status: status[0], path, added, deleted }
  })
}

/** Lo que describirá el mensaje: solo lo preparado, y los últimos títulos para copiar el estilo. */
export async function changesForMessage(root: string): Promise<{ diff: string; recent: string }> {
  const staged = await run(root, ['diff', '--cached', '--no-color'])
  const log = await run(root, ['log', '-8', '--format=%s'])
  return { diff: staged.ok ? staged.out : '', recent: log.ok ? log.out : '' }
}

/** Trae lo nuevo del remoto sin tocar nada local (así se sabe cuántos commits faltan). Devuelve el error, o '' si salió bien. */
export const fetch = async (root: string): Promise<string> => {
  const res = await run(root, ['fetch', '--quiet'], undefined, 30000)
  return res.ok ? '' : flat(res)
}

/** Trae y une los cambios de la rama remota; solo avance simple (`--ff-only`): si las ramas divergieron, avisa en vez de unir a ciegas. */
export const pull = async (root: string): Promise<string> => flat(await run(root, ['pull', '--ff-only'], undefined, 120000))

export async function push(root: string): Promise<string> {
  const upstream = await run(root, ['rev-parse', '--abbrev-ref', '@{u}'])
  return flat(await (upstream.ok ? run(root, ['push'], undefined, 120000) : run(root, ['push', '-u', 'origin', 'HEAD'], undefined, 120000)))
}

export async function branches(root: string): Promise<GitBranch[]> {
  const res = await run(root, ['branch', '-a', '--format=%(refname:short)\t%(HEAD)'])
  if (!res.ok) return []
  const seen = new Set<string>()
  const out: GitBranch[] = []
  for (const line of res.out.split('\n').filter(Boolean)) {
    const [name, head] = line.split('\t')
    if (!name || name.endsWith('/HEAD') || name === 'origin' || seen.has(name)) continue
    seen.add(name)
    out.push({ name, current: head === '*', remote: name.includes('/') && name.startsWith('origin/') })
  }
  return out
}

export const checkout = async (root: string, name: string, remote: boolean): Promise<string> =>
  flat(await run(root, remote ? ['checkout', '--track', name] : ['checkout', name]))
export const createBranch = async (root: string, name: string): Promise<string> => flat(await run(root, ['checkout', '-b', name]))

/** Contenido de un archivo en HEAD (`rev` = 'HEAD') o en lo preparado (`rev` = 'index'); null si no existe ahí (archivo nuevo). */
export async function show(root: string, rev: 'HEAD' | 'index', path: string): Promise<string | null> {
  const res = await run(root, ['show', `${rev === 'HEAD' ? 'HEAD' : ''}:${path.replace(/\\/g, '/')}`])
  return res.ok ? res.out : null
}

/** Líneas añadidas, modificadas o borradas de un archivo respecto a HEAD (marcas del margen del editor). */
export async function marks(file: string): Promise<GitMarks> {
  const dir = dirname(file)
  const tracked = await run(dir, ['ls-files', '--error-unmatch', '--', basename(file)])
  if (!tracked.ok) return {}
  const diff = await run(dir, ['diff', '-U0', 'HEAD', '--', basename(file)])
  const out: GitMarks = {}
  for (const m of diff.out.matchAll(/^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    const removed = m[1] === undefined ? 1 : Number(m[1])
    const start = Number(m[2])
    const added = m[3] === undefined ? 1 : Number(m[3])
    if (added === 0) out[Math.max(start, 1)] = 'deleted'
    else for (let i = 0; i < added; i++) out[start + i] = removed > 0 ? 'modified' : 'added'
  }
  return out
}
