/** Borrador del contexto de un proyecto. La app reúne un resumen pequeño y un agente solo lo redacta, para gastar pocos tokens. */
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { McpResult } from '../../shared/types'
import { detectAgents } from '../agents/agents'
import { ask } from '../git/commitMessage'
import { tm } from '../i18n'
import { extendedPath } from '../shellpath'

const SKIP = new Set(['node_modules', 'dist', 'out', 'build', 'target', 'release', 'coverage', '__pycache__', 'venv', 'vendor'])
const MANIFESTS = ['pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml', 'composer.json', 'Gemfile']
const MAX_TREE = 60

/** Orden de preferencia y cómo se lanza cada agente; el modelo pequeño basta para resumir (y cuesta mucho menos). */
const HEADLESS: Array<[string, (p: string) => string[]]> = [
  ['claude', (p) => ['--model', 'haiku', '-p', p]],
  ['opencode', (p) => ['run', p]],
  ['gemini', (p) => ['-p', p]],
  ['codex', (p) => ['exec', p]],
  ['agy', (p) => ['--print', p]]
]

const read = (path: string, max: number): string => {
  try { return readFileSync(path, 'utf8').slice(0, max) } catch { return '' }
}

/** Carpetas y archivos de los dos primeros niveles, sin lo generado ni lo oculto. */
export function treeOf(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string, rel: string, depth: number): void => {
    let names: string[] = []
    try { names = readdirSync(dir).sort() } catch { return }
    for (const name of names) {
      if (out.length >= MAX_TREE) return
      if (name.startsWith('.') || SKIP.has(name)) continue
      let isDir = false
      try { isDir = statSync(join(dir, name)).isDirectory() } catch { continue }
      out.push(`${rel}${name}${isDir ? '/' : ''}`)
      if (isDir && depth < 2) walk(join(dir, name), `${rel}${name}/`, depth + 1)
    }
  }
  walk(root, '', 1)
  return out
}

function packageSummary(root: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, unknown>
    const scripts = Object.entries((pkg.scripts ?? {}) as Record<string, string>).slice(0, 15).map(([k, v]) => `  ${k}: ${v}`)
    const deps = Object.keys({ ...(pkg.dependencies as object), ...(pkg.devDependencies as object) }).slice(0, 25)
    return [`package.json: ${pkg.name ?? ''} ${pkg.version ?? ''} — ${pkg.description ?? ''}`, scripts.length ? `scripts:\n${scripts.join('\n')}` : '', deps.length ? `dependencias: ${deps.join(', ')}` : ''].filter(Boolean).join('\n')
  } catch { return '' }
}

const gitSubjects = (root: string): Promise<string> =>
  new Promise((done) => {
    execFile('git', ['log', '--format=%s', '-n', '8'], { cwd: root, timeout: 5000, encoding: 'utf8', env: { ...process.env, PATH: extendedPath() } }, (err, out) => done(err ? '' : out.trim()))
  })

/** Todo lo que se le da al agente: poco texto, ya filtrado. */
export async function projectDigest(root: string): Promise<string> {
  const readme = ['README.md', 'readme.md', 'README'].map((f) => read(join(root, f), 1800)).find(Boolean) ?? ''
  const manifests = MANIFESTS.filter((f) => existsSync(join(root, f))).map((f) => `${f}:\n${read(join(root, f), 600)}`)
  const commits = await gitSubjects(root)
  return [
    `${tm('m.ctx.digestTree')}:\n${treeOf(root).join('\n')}`, packageSummary(root), ...manifests,
    readme && `${tm('m.ctx.digestReadme')}:\n${readme}`, commits && `${tm('m.ctx.digestCommits')}:\n${commits}`
  ].filter(Boolean).join('\n\n')
}

export function buildPrompt(digest: string): string {
  return `${tm('m.ctx.prompt')}

${digest}`
}

/** Quita charla previa y vallas de código que envuelven la respuesta. Null si no queda nada útil. */
export function cleanContext(raw: string): string | null {
  let text = raw.replace(/\r/g, '').trim()
  const fence = /^```(?:markdown|md)?\n([\s\S]*?)\n```$/i.exec(text)
  if (fence) text = fence[1].trim()
  const start = text.search(/^#{1,3} /m)
  if (start > 0) text = text.slice(start)
  return text.length >= 40 ? text : null
}

/** Sin IA: lo que se ve a simple vista en el resumen. */
export function fallbackContext(root: string, digest: string): string {
  const name = root.split(/[\\/]/).filter(Boolean).pop() ?? 'proyecto'
  const tree = digest.split('\n\n')[0].split('\n').slice(1, 25).join('\n')
  const pkg = packageSummary(root)
  return `# ${name}\n\n## ${tm('m.ctx.fbStructure')}\n\`\`\`\n${tree}\n\`\`\`\n${pkg ? `\n## ${tm('m.ctx.fbRun')}\n${pkg}\n` : ''}`
}

export async function generateContext(root: string, onAgent: (name: string) => void = () => undefined, signal?: AbortSignal): Promise<McpResult & { text?: string; agent?: string }> {
  const digest = await projectDigest(root)
  const prompt = buildPrompt(digest)
  const installed = detectAgents()
  for (const [command, args] of HEADLESS) {
    const agent = installed.find((a) => a.command === command)
    if (!agent) continue
    onAgent(agent.name)
    const out = await ask(agent, args(prompt), root, signal)
    if (signal?.aborted) return { ok: false, message: '' }               // cancelado: sin mensaje de error
    const text = out ? cleanContext(out) : null
    if (text) return { ok: true, message: '', text, agent: agent.name }
  }
  return { ok: true, message: '', text: fallbackContext(root, digest), agent: tm('m.autoRules') }
}
