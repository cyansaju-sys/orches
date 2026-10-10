/**
 * Tienda de servidores MCP: lee el registro oficial (registry.modelcontextprotocol.io) y traduce cada entrada a las formas de
 * instalarla que Tutti sabe hacer: un comando local (npm con npx, pypi con uvx) o una URL remota. El registro está en
 * preparación y su API puede cambiar: todo lo que depende de ella vive en este archivo.
 */
import type { RegistryField, RegistryOption, RegistryPage, RegistryServer } from '../shared/types'
import { tm } from './i18n'

const BASE = 'https://registry.modelcontextprotocol.io/v0/servers'
const PAGE = 30
const TTL_MS = 5 * 60_000
const cache = new Map<string, { at: number; page: RegistryPage }>()

type Raw = Record<string, unknown>
const obj = (v: unknown): Raw => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Raw) : {})
const list = (v: unknown): Raw[] => (Array.isArray(v) ? v.map(obj) : [])
const text = (v: unknown): string => (typeof v === 'string' ? v : '')

const field = (raw: Raw): RegistryField => ({
  name: text(raw.name), description: text(raw.description), required: raw.isRequired === true, secret: raw.isSecret === true, default: text(raw.default)
})
const argValues = (raw: unknown): string[] => list(raw).map((a) => text(a.value) || text(a.name)).filter(Boolean)

/** Las formas de instalar una entrada: cada paquete npm o pypi con transporte stdio y cada URL remota (sin variables en la URL). */
export function optionsOf(server: Raw): RegistryOption[] {
  const out: RegistryOption[] = []
  for (const p of list(server.packages)) {
    const type = text(p.registryType)
    const transport = text(obj(p.transport).type) || 'stdio'
    const id = text(p.identifier)
    if (!id || transport !== 'stdio') continue
    const version = text(p.version)
    const env = list(p.environmentVariables).map(field).filter((f) => f.name)
    const extra = argValues(p.packageArguments)
    if (type === 'npm') {
      out.push({ label: `npm · ${id}`, kind: 'local', command: 'npx', args: [...(argValues(p.runtimeArguments).length ? argValues(p.runtimeArguments) : ['-y']), version ? `${id}@${version}` : id, ...extra], env, headers: [] })
    } else if (type === 'pypi') {
      out.push({ label: `pypi · ${id}`, kind: 'local', command: 'uvx', args: [...argValues(p.runtimeArguments), id, ...extra], env, headers: [] })
    }
  }
  for (const r of list(server.remotes)) {
    const type = text(r.type)
    const url = text(r.url)
    if (!/^https?:\/\//.test(url) || url.includes('{') || !['streamable-http', 'sse', 'http'].includes(type)) continue
    out.push({ label: `${tm('m.reg.remote')} · ${new URL(url).host}`, kind: 'remote', url, env: [], headers: list(r.headers).map(field).filter((f) => f.name) })
  }
  return out
}

/** Nombre legible si el registro no trae título: «com.notion/mcp» -> «Notion», «io.github.acme/files» -> «files». */
export function niceName(name: string): string {
  const short = name.split('/').pop() || name
  if (!/^(mcp|server|mcp-server|[a-z]+-mcp-server)$/i.test(short) || !name.includes('/')) return short
  const owner = name.slice(0, name.lastIndexOf('/')).split('.').filter((p) => !['com', 'io', 'github', 'app', 'dev', 'ai', 'org', 'net'].includes(p)).pop()
  return owner ? owner.charAt(0).toUpperCase() + owner.slice(1) : short
}

/** Una entrada del registro como la usa la interfaz; null si no se puede instalar desde Tutti. */
export function toServer(entry: Raw): RegistryServer | null {
  const server = obj(entry.server)
  const name = text(server.name)
  const options = optionsOf(server)
  if (!name || !options.length) return null
  return { name, title: text(server.title) || niceName(name), description: text(server.description), version: text(server.version), repository: text(obj(server.repository).url), options }
}

/** Servidores conocidos y mantenidos por sus propias empresas: el registro no ordena por popularidad, así que se fijan arriba. */
export const FEATURED = [
  'io.github.upstash/context7', 'io.github.microsoft/playwright-mcp', 'io.github.github/github-mcp-server', 'io.github.ChromeDevTools/chrome-devtools-mcp',
  'com.notion/mcp', 'com.figma.mcp/mcp', 'app.linear/linear', 'com.atlassian/atlassian-mcp-server', 'io.github.getsentry/sentry-mcp',
  'com.supabase/mcp', 'com.stripe/mcp', 'com.cloudflare.mcp/mcp', 'com.vercel/vercel-mcp', 'io.github.oraios/serena'
]

/** Los destacados, en ese orden. Los que el registro no devuelva (cambió de nombre, sin conexión) se omiten. */
export async function featuredServers(): Promise<RegistryServer[]> {
  const hit = cache.get('featured')
  if (hit && Date.now() - hit.at < 60 * 60_000) return hit.page.servers
  const found = await Promise.all(FEATURED.map(async (name) => {
    try {
      const res = await fetch(`${BASE}/${encodeURIComponent(name)}/versions/latest`, { headers: { Accept: 'application/json', 'User-Agent': 'tutti' }, signal: AbortSignal.timeout(12_000) })
      return res.ok ? toServer(obj(await res.json())) : null
    } catch { return null }
  }))
  const servers = found.filter((s): s is RegistryServer => s !== null)
  if (servers.length) cache.set('featured', { at: Date.now(), page: { servers, next: '', error: '' } })
  return servers
}

/** Qué tan bien responde un servidor a lo buscado: coincidencia con el nombre, con el título y si es de los recomendados. */
export function relevance(s: RegistryServer, q: string): number {
  const query = q.toLowerCase()
  const short = (s.name.split('/').pop() ?? s.name).toLowerCase()
  let score = FEATURED.includes(s.name) ? 100 : 0
  if (query) {
    if (short === query || s.title.toLowerCase() === query) score += 50
    else if (short.startsWith(query) || s.title.toLowerCase().startsWith(query)) score += 20
    else if (short.includes(query) || s.title.toLowerCase().includes(query)) score += 10
  }
  return score
}

export async function searchRegistry(query: string, cursor: string): Promise<RegistryPage> {
  const q = query.trim().slice(0, 80)
  const key = `${q}|${cursor}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.page
  const params = new URLSearchParams({ limit: String(PAGE), version: 'latest' })
  if (q) params.set('search', q)
  if (cursor) params.set('cursor', cursor)
  try {
    const res = await fetch(`${BASE}?${params}`, { headers: { Accept: 'application/json', 'User-Agent': 'tutti' }, signal: AbortSignal.timeout(12_000) })
    if (!res.ok) return { servers: [], next: '', error: tm('m.reg.http', { status: res.status }) }
    const data = obj(await res.json())
    let servers = list(data.servers).map(toServer).filter((s): s is RegistryServer => s !== null)
    if (!q) servers = servers.filter((s) => !FEATURED.includes(s.name))          // sin búsqueda, los destacados ya salen en su sección
    else servers = servers.map((s, i) => ({ s, i })).sort((a, b) => relevance(b.s, q) - relevance(a.s, q) || a.i - b.i).map((x) => x.s)
    const page = { servers, next: text(obj(data.metadata).nextCursor), error: '' }
    cache.set(key, { at: Date.now(), page })
    return page
  } catch {
    return { servers: [], next: '', error: tm('m.reg.offline') }
  }
}
