import { execFile } from 'node:child_process'
import { dirname, basename } from 'node:path'
import type { GitBranch, GitCommit, GitMarks, GitOp, GitStatus } from '../../shared/types'
import { extendedPath } from '../shellpath'
import { tm } from '../i18n'

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
  const empty: GitStatus = { isRepo: false, branch: '', ahead: 0, behind: 0, hasUpstream: false, hasRemote: false, files: [] }
  // symbolic-ref funciona también en un repositorio recién creado, sin ningún commit (rev-parse --abbrev-ref HEAD falla ahí)
  let branch = await run(root, ['symbolic-ref', '--short', '-q', 'HEAD'])
  if (!branch.ok) {
    branch = await run(root, ['rev-parse', '--abbrev-ref', 'HEAD'])      // HEAD suelto: devuelve «HEAD»
    if (!branch.ok) return empty
  }
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
  const remotes = await run(root, ['remote'])
  return { isRepo: true, hasRemote: remotes.ok && remotes.out.trim().length > 0, branch: branch.out.trim(), ahead: ahead || 0, behind: behind || 0, hasUpstream: sync.ok, files }
}

export async function ignored(root: string, paths: string[]): Promise<string[]> {
  if (!paths.length) return []
  const res = await run(root, ['check-ignore', '-z', '--stdin'], paths.join('\0'), 5000)
  return res.out.split('\0').filter(Boolean)
}

const flat = (r: Result): string => (r.ok ? '' : r.out.trim() || tm('m.git.failed'))

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

/** Ruta final de una línea de `--numstat` (con renombrados: «a => b» o «dir/{a => b}/f»). */
export const numstatPath = (p: string): string => p.replace(/\{[^}]* => ([^}]*)\}/, '$1').replace(/\/\//g, '/').replace(/^.* => /, '')

/** Une `--name-status` y `--numstat` en una lista de archivos con estado y líneas añadidas / borradas. */
export function joinSummary(nameStatus: string, numstat: string): StagedFile[] {
  const counts = new Map<string, [number, number]>()
  for (const line of numstat.split('\n')) {
    const [a, d, ...p] = line.split('\t')
    if (p.length) counts.set(numstatPath(p.join('\t')), [Number(a) || 0, Number(d) || 0])      // binarios: «-» → 0
  }
  return nameStatus.split('\n').filter(Boolean).map((l) => {
    const [status, ...p] = l.split('\t')
    const path = p[p.length - 1]
    const [added, deleted] = counts.get(path) ?? [0, 0]
    return { status: status[0], path, added, deleted }
  })
}

/** Archivos preparados con su estado (A, M, D, R…) y las líneas añadidas y borradas. */
export async function stagedSummary(root: string): Promise<StagedFile[]> {
  const names = await run(root, ['diff', '--cached', '--name-status', '-M'])
  const stats = await run(root, ['diff', '--cached', '--numstat', '-M'])
  return names.ok ? joinSummary(names.out, stats.ok ? stats.out : '') : []
}

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/** Archivos que cambió un commit respecto a su primer padre (en un merge: lo que trajo la rama unida). */
export async function commitFiles(root: string, hash: string, parent: string | null): Promise<StagedFile[]> {
  if (!HASH.test(hash) || (parent && !HASH.test(parent))) return []
  const from = parent ?? EMPTY_TREE
  const names = await run(root, ['diff', '--name-status', '-M', from, hash])
  const stats = await run(root, ['diff', '--numstat', '-M', from, hash])
  return names.ok ? joinSummary(names.out, stats.ok ? stats.out : '') : []
}

/** Lo que describirá el mensaje: solo lo preparado, y los últimos títulos para copiar el estilo. */
export async function changesForMessage(root: string): Promise<{ diff: string; recent: string }> {
  const staged = await run(root, ['diff', '--cached', '--no-color'])
  const log = await run(root, ['log', '-8', '--format=%s'])
  return { diff: staged.ok ? staged.out : '', recent: log.ok ? log.out : '' }
}

const HASH = /^[0-9a-f]{7,40}$/
const REF_NAME = /^(?!-)[A-Za-z0-9._/-]+$/

/** Argumentos de git para una operación sobre un commit; null si el hash o el nombre no son válidos. */
export function opArgs(op: GitOp, hash: string, arg = '', isMerge = false): string[] | null {
  if (!HASH.test(hash)) return null
  const needsName = op === 'tag' || op === 'branch'
  if (op === 'merge' && !/^[a-z,]*$/.test(arg)) return null
  if (needsName && (!REF_NAME.test(arg) || arg.endsWith('/') || arg.includes('..'))) return null
  const parent = isMerge ? ['-m', '1'] : []                    // en un merge hay que decir con qué padre se compara
  switch (op) {
    case 'tag': return ['tag', arg, hash]
    case 'branch': return ['branch', arg, hash]
    case 'checkout': return ['checkout', hash]
    case 'cherry-pick': return ['cherry-pick', ...parent, hash]
    case 'revert': return ['revert', '--no-edit', ...parent, hash]
    case 'merge': {                                            // arg: opciones separadas por coma (noff, squash, nocommit)
      const o = new Set(arg.split(',').filter(Boolean))
      if (o.has('squash')) return ['merge', '--squash', hash]  // squash junta todo en el índice y nunca hace commit solo
      return ['merge', ...(o.has('noff') ? ['--no-ff'] : []), ...(o.has('nocommit') ? ['--no-commit'] : ['--no-edit']), hash]
    }
    case 'rebase': return ['rebase', hash]
    case 'reset-soft': return ['reset', '--soft', hash]
    case 'reset-mixed': return ['reset', '--mixed', hash]
    case 'reset-hard': return ['reset', '--hard', hash]
  }
}

/** Ejecuta una operación sobre un commit. Devuelve el error de git, o '' si salió bien. */
export async function commitOp(root: string, op: GitOp, hash: string, arg?: string, isMerge?: boolean): Promise<string> {
  const args = opArgs(op, hash, arg, isMerge)
  if (!args) return tm('m.git.badName')
  const res = await run(root, args, undefined, 60000)
  if (res.ok) return ''
  if (['cherry-pick', 'revert', 'merge', 'rebase'].includes(op) && /conflict/i.test(res.out)) {
    // no se deja el repositorio a medias (un merge --squash no deja estado de merge: se deshace con reset --merge)
    await run(root, op === 'merge' && arg?.includes('squash') ? ['reset', '--merge'] : [op, '--abort'])
    return tm('m.git.conflicts', { detail: flat(res) })
  }
  return flat(res)
}

/** Historial de todas las ramas, de lo más nuevo a lo más viejo, con sus padres (para dibujar el grafo). */
export async function log(root: string, limit: number): Promise<GitCommit[]> {
  const res = await run(root, ['log', '--all', '--date-order', `-n${Math.max(1, Math.min(limit, 2000))}`, '--format=%H%x1f%P%x1f%an%x1f%at%x1f%D%x1f%s'])
  if (!res.ok) return []
  return res.out.split('\n').filter(Boolean).map((line) => {
    const [hash, parents, author, time, refs, ...subject] = line.split('\x1f')
    return { hash, parents: parents ? parents.split(' ') : [], author, time: Number(time) * 1000, refs: refs ? refs.split(', ').filter(Boolean) : [], subject: subject.join('\x1f') }
  })
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
  const res = await run(root, ['branch', '-a', '--format=%(refname:short)\t%(HEAD)\t%(committerdate:unix)\t%(authorname)\t%(objectname:short)\t%(contents:subject)'])
  if (!res.ok) return []
  const seen = new Set<string>()
  const out: GitBranch[] = []
  for (const line of res.out.split('\n').filter(Boolean)) {
    const [name, head, date, author, hash, ...subject] = line.split('\t')
    if (!name || name.startsWith('(') || name.endsWith('/HEAD') || name === 'origin' || seen.has(name)) continue
    seen.add(name)
    out.push({ name, current: head === '*', remote: name.includes('/') && name.startsWith('origin/'), date: Number(date) * 1000 || undefined, author, hash, subject: subject.join('\t') })
  }
  return out.sort((a, b) => (b.date ?? 0) - (a.date ?? 0))      // lo más reciente primero
}

/** Se coloca en un commit o rama sin crear ninguna (HEAD suelto): para mirar o probar algo sin tocar ramas. */
export async function checkoutDetached(root: string, ref: string): Promise<string> {
  if (!REF_NAME.test(ref) || ref.includes('..')) return tm('m.git.badRef')
  return flat(await run(root, ['checkout', '--detach', ref]))
}

export const checkout = async (root: string, name: string, remote: boolean): Promise<string> =>
  flat(await run(root, remote ? ['checkout', '--track', name] : ['checkout', name]))
/** Nombre de rama que git acepta (sin espacios, «..», «-» al inicio ni terminar en «/» o «.lock»). */
export const validBranchName = (name: string): boolean =>
  /^(?!-)[A-Za-z0-9._/-]+$/.test(name) && !name.includes('..') && !name.includes('//') && !name.endsWith('/') && !name.endsWith('.') && !name.endsWith('.lock')

/** Crea una rama (desde `base`, o desde donde estás) y, por defecto, se cambia a ella. */
export async function createBranch(root: string, name: string, base?: string, switchTo = true): Promise<string> {
  if (!validBranchName(name)) return tm('m.git.badBranch')
  if (base && !REF_NAME.test(base)) return tm('m.git.badBase')
  const from = base ? [base] : []
  return flat(await run(root, switchTo ? ['checkout', '-b', name, ...from] : ['branch', name, ...from]))
}

/** Contenido de un archivo en HEAD (`rev` = 'HEAD') o en lo preparado (`rev` = 'index'); null si no existe ahí (archivo nuevo). */
export async function show(root: string, rev: string, path: string): Promise<string | null> {
  if (rev !== 'HEAD' && rev !== 'index' && !HASH.test(rev)) return null
  const res = await run(root, ['show', `${rev === 'index' ? '' : rev}:${path.replace(/\\/g, '/')}`])
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
