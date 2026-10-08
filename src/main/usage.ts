/**
 * Consumo de tokens e historial de los agentes, leído de sus archivos locales.
 *
 * - Claude Code: ~/.claude/projects/<proyecto>/<sesión>.jsonl (cada respuesta trae su `usage`).
 * - OpenCode: su base SQLite (tabla session_v2).
 * - Antigravity (agy): solo historial, desde conversation_summaries.db (no guarda tokens).
 *
 * Solo se lee: nunca se modifica nada de los agentes (salvo borrar una sesión si el usuario lo pide).
 */
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, relative, isAbsolute } from 'node:path'
import type { AgentInfo, AgentUsage, LimitInfo, McpResult, SessionInfo, UsageData } from '../shared/types'
import { readAgyConversations } from './agyDb'
import { readOpenCodeSessions } from './opencodeDb'
import { getSetting, setSetting } from './settings'
import { extendedPath } from './shellpath'

export const WINDOW_HOURS = 5          // Claude reinicia el límite de sesión en ventanas de 5 horas
const HOUR = 3_600_000

interface Tokens { input: number; output: number; cacheWrite: number; cacheRead: number }
/** Tokens procesados de verdad; la lectura de caché se cuenta aparte (es barata). */
const processed = (t: Tokens): number => t.input + t.output + t.cacheWrite

// --- límites de Claude (consulta a Anthropic) ---------------------------------------------------
const LIMITS_URL = 'https://api.anthropic.com/api/oauth/usage'
const LIMITS_TTL = 60                   // mínimo entre consultas reales (el endpoint limita las peticiones frecuentes)
const LIMITS_BACKOFF = 120              // espera mínima tras un 429
const LIMIT_LABELS: Array<[string, string]> = [
  ['five_hour', 'Sesión (5 h)'], ['seven_day', 'Semanal (7 días)'], ['seven_day_opus', 'Semanal Opus'], ['seven_day_sonnet', 'Semanal Sonnet']
]
const limitsState: { nextTry: number; error: string; good: { at: number; limits: LimitInfo[] } | null } = { nextTry: 0, error: '', good: null }

/** Último dato bueno guardado: sirve tras reiniciar o durante una espera (mismo formato que la versión anterior). */
function loadGood(): { at: number; limits: LimitInfo[] } | null {
  const saved = getSetting('limits_cache') as { at?: number; limits?: Array<{ label: string; percent: number; resets_at: string }> } | undefined
  try {
    const limits = (saved?.limits ?? []).map((i) => ({ label: i.label, percent: Number(i.percent), resetsAt: Date.parse(i.resets_at) }))
    return limits.length && saved?.at ? { at: saved.at, limits } : null
  } catch { return null }
}
const saveGood = (at: number, limits: LimitInfo[]): void =>
  setSetting('limits_cache', { at, limits: limits.map((l) => ({ label: l.label, percent: l.percent, resets_at: new Date(l.resetsAt).toISOString() })) })

function claudeCredentials(): { accessToken?: string; expiresAt?: number } | null {
  try { return (JSON.parse(readFileSync(join(homedir(), '.claude', '.credentials.json'), 'utf8')) as { claudeAiOauth?: object }).claudeAiOauth ?? null } catch { return null }
}

async function fetchLimits(token: string): Promise<LimitInfo[]> {
  const res = await fetch(LIMITS_URL, {
    headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'orches', Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000)
  })
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, retryAfter: Number(res.headers.get('retry-after')) || 0 })
  const data = (await res.json()) as Record<string, { utilization?: number | null; resets_at?: string } | undefined>
  const out: LimitInfo[] = []
  for (const [key, label] of LIMIT_LABELS) {
    const item = data[key]
    if (item && item.utilization != null && item.resets_at) out.push({ label, percent: Number(item.utilization), resetsAt: Date.parse(item.resets_at) })
  }
  return out
}

/**
 * Límites de Claude con el porcentaje y el reinicio reales. Solo consulta a Anthropic si `fetchNow` es true (al entrar en la
 * pestaña); si no, devuelve el último dato guardado. El token solo se envía a api.anthropic.com y nunca se guarda ni se
 * muestra. No se renueva: si caducó basta abrir Claude Code una vez. Ante un 429 se espera y se sigue mostrando el último
 * dato bueno (los límites que ya se reiniciaron se descartan).
 */
export async function claudeLimits(fetchNow: boolean): Promise<{ limits: LimitInfo[]; error: string; age: number }> {
  const now = Date.now()
  limitsState.good ??= loadGood()
  if (fetchNow && now >= limitsState.nextTry) {
    const creds = claudeCredentials()
    if (!creds?.accessToken) Object.assign(limitsState, { nextTry: now + 60_000, error: 'Inicia sesión en Claude Code para ver el porcentaje' })
    else if ((creds.expiresAt ?? 0) < now) Object.assign(limitsState, { nextTry: now + 60_000, error: 'La sesión de Claude caducó: abre Claude Code para renovarla' })
    else {
      try {
        const limits = await fetchLimits(creds.accessToken)
        if (limits.length) { limitsState.good = { at: now, limits }; Object.assign(limitsState, { error: '', nextTry: now + LIMITS_TTL * 1000 }); saveGood(now, limits) }
        else Object.assign(limitsState, { error: 'Anthropic no devolvió límites', nextTry: now + LIMITS_TTL * 1000 })
      } catch (e) {
        const err = e as { status?: number; retryAfter?: number }
        if (err.status) Object.assign(limitsState, { nextTry: now + Math.max(LIMITS_BACKOFF, (err.retryAfter ?? 0)) * 1000, error: `Anthropic respondió ${err.status}` })
        else Object.assign(limitsState, { nextTry: now + 60_000, error: 'Sin conexión con Anthropic' })
      }
    }
  }
  const good = limitsState.good
  if (good) {
    const current = good.limits.filter((l) => l.resetsAt > now)       // lo ya reiniciado no vale
    if (current.length) return { limits: current, error: '', age: (now - good.at) / 1000 }
  }
  return { limits: [], error: limitsState.error, age: 0 }
}

// --- Claude Code ------------------------------------------------------------------------------
interface ClaudeFile { msgs: Map<string, { ts: number; tokens: Tokens }>; title: string; cwd: string }
const claudeCache = new Map<string, { stamp: string; data: ClaudeFile }>()      // ruta -> datos (se reparsea solo si cambió)

export function parseClaudeJsonl(text: string): ClaudeFile {
  const msgs = new Map<string, { ts: number; tokens: Tokens }>()
  let title = '', lastPrompt = '', cwd = ''
  for (const line of text.split('\n')) {
    if (!line) continue
    let d: Record<string, any>   // eslint-disable-line @typescript-eslint/no-explicit-any
    try { d = JSON.parse(line) } catch { continue }
    cwd ||= d.cwd ?? ''                                  // carpeta inicial de la sesión
    if (d.type === 'ai-title') title = d.aiTitle || title
    else if (d.type === 'last-prompt') lastPrompt = d.lastPrompt || lastPrompt
    else if (d.type === 'assistant') {
      const m = d.message ?? {}
      const u = m.usage
      if (!u || !d.timestamp) continue
      msgs.set(`${m.id}|${d.requestId}`, {                // las respuestas parciales se sobrescriben con la final
        ts: Date.parse(d.timestamp),
        tokens: { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0 }
      })
    }
  }
  return { msgs, title: title || lastPrompt || '(sin título)', cwd }
}

const claudeFiles = (): string[] => {
  const root = join(homedir(), '.claude', 'projects')
  try {
    return readdirSync(root).flatMap((dir) => {
      try { return readdirSync(join(root, dir)).filter((f) => f.endsWith('.jsonl')).map((f) => join(root, dir, f)) } catch { return [] }
    })
  } catch { return [] }
}

export function claudeSessions(now: number): { usage: Omit<AgentUsage, 'limits' | 'limitsError' | 'limitsAge' | 'name'>; sessions: SessionInfo[] } {
  const data = new Map<string, ClaudeFile>()
  for (const path of claudeFiles()) {
    try {
      const st = statSync(path)
      const stamp = `${st.mtimeMs}:${st.size}`
      let cached = claudeCache.get(path)
      if (!cached || cached.stamp !== stamp) { cached = { stamp, data: parseClaudeJsonl(readFileSync(path, 'utf8')) }; claudeCache.set(path, cached) }
      data.set(path, cached.data)
    } catch { /* archivo en uso o borrado */ }
  }
  const seen = new Set<string>()                          // entradas únicas entre archivos (las sesiones reanudadas repiten mensajes)
  const entries: Array<{ ts: number; tokens: Tokens }> = []
  const sessions: SessionInfo[] = []
  for (const [path, d] of data) {
    let total = 0, first = Infinity, last = 0
    for (const [key, e] of d.msgs) {
      if (seen.has(key)) continue
      seen.add(key); entries.push(e)
      total += processed(e.tokens); first = Math.min(first, e.ts); last = Math.max(last, e.ts)
    }
    if (last) {
      sessions.push({ command: 'claude', agent: 'Claude Code', id: basename(path, '.jsonl'), title: d.title, cwd: d.cwd,
        project: d.cwd ? basename(d.cwd) : basename(join(path, '..')), tokens: total, start: first, end: last })
    }
  }
  entries.sort((a, b) => a.ts - b.ts)
  const startOfToday = new Date(now).setHours(0, 0, 0, 0)
  const weekStart = now - 7 * 24 * HOUR
  let today = 0, week = 0, total = 0
  let block: { start: number; end: number; tokens: number } | null = null
  for (const { ts, tokens } of entries) {
    const n = processed(tokens)
    total += n
    if (ts >= startOfToday) today += n
    if (ts >= weekStart) week += n
    if (!block || ts >= block.end) {                      // ventana nueva si el mensaje cae fuera de la anterior (inicio redondeado a la hora)
      const start = Math.floor(ts / HOUR) * HOUR
      block = { start, end: start + WINDOW_HOURS * HOUR, tokens: 0 }
    }
    block.tokens += n
  }
  sessions.sort((a, b) => b.end - a.end)
  return { usage: { command: 'claude', window: block && now < block.end ? block : null, today, week, total, note: '' }, sessions }
}

// --- OpenCode ---------------------------------------------------------------------------------
export function opencodeSessions(now: number): { usage: Omit<AgentUsage, 'limits' | 'limitsError' | 'limitsAge' | 'name'>; sessions: SessionInfo[] } | null {
  const rows = readOpenCodeSessions()
  if (rows === null) return null
  const startOfToday = new Date(now).setHours(0, 0, 0, 0)
  const weekStart = now - 7 * 24 * HOUR
  let today = 0, week = 0, total = 0
  const sessions: SessionInfo[] = rows.map((r) => {
    const tokens = (r.tokens_input ?? 0) + (r.tokens_output ?? 0) + (r.tokens_reasoning ?? 0) + (r.tokens_cache_write ?? 0)
    total += tokens
    if (r.time_updated >= startOfToday) today += tokens
    if (r.time_updated >= weekStart) week += tokens
    return { command: 'opencode', agent: 'OpenCode', id: r.id, title: r.title || '(sin título)', cwd: r.directory ?? '',
      project: basename(r.directory ?? ''), tokens, start: r.time_created, end: r.time_updated }
  })
  sessions.sort((a, b) => b.end - a.end)
  return { usage: { command: 'opencode', window: null, today, week, total, note: 'Sin límite propio: el reinicio depende del proveedor y del modelo.' }, sessions }
}

// --- Antigravity (agy) ------------------------------------------------------------------------
/** Fecha de la base: milisegundos, segundos o texto ISO. */
const toMs = (v: string | number): number => {
  const n = typeof v === 'number' ? v : Number(v)
  if (Number.isFinite(n) && n > 0) return n < 1e11 ? n * 1000 : n
  const t = Date.parse(String(v)); return Number.isFinite(t) ? t : 0
}
const uriToPath = (u: string): string => { try { return u.startsWith('file://') ? decodeURIComponent(new URL(u).pathname) : u } catch { return u } }
const firstWorkspace = (raw: string): string => {
  try { const v = JSON.parse(raw) as unknown; const first = Array.isArray(v) ? v[0] : v; return typeof first === 'string' ? uriToPath(first) : '' } catch { return uriToPath(raw.split(',')[0] ?? '') }
}

/** agy no guarda tokens en local: solo el historial de conversaciones (título, pasos, carpeta). */
export function agySessions(now: number): { usage: Omit<AgentUsage, 'limits' | 'limitsError' | 'limitsAge' | 'name'>; sessions: SessionInfo[] } | null {
  const rows = readAgyConversations()
  if (rows === null) return null
  const sessions: SessionInfo[] = rows.map((r) => {
    const cwd = firstWorkspace(r.workspace_uris)
    const end = toMs(r.last_modified_time)
    return { command: 'agy' as const, agent: 'Antigravity', id: r.conversation_id, title: r.title || r.preview || '(sin título)', cwd,
      project: basename(cwd), tokens: 0, start: end, end }
  }).sort((a, b) => b.end - a.end)
  const startOfToday = new Date(now).setHours(0, 0, 0, 0)
  const note = sessions.length
    ? `Antigravity no guarda tokens en local. Conversaciones: ${sessions.length} (hoy ${sessions.filter((s) => s.end >= startOfToday).length}).`
    : 'Sin conversaciones todavía. Antigravity no guarda tokens en local; aquí aparecerá el historial.'
  return { usage: { command: 'agy', window: null, today: 0, week: 0, total: 0, note }, sessions }
}

// --- reunir todo ------------------------------------------------------------------------------
const real = (p: string): string => { try { return realpathSync.native(p) } catch { return p } }
/** ¿La sesión se ejecutó en el proyecto (o en una de sus subcarpetas)? Sigue enlaces simbólicos. */
export function inProject(cwd: string, project: string): boolean {
  if (!cwd) return false
  const rel = relative(real(project), real(cwd))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export async function collectUsage(agents: AgentInfo[], project: string | null, fetchLimits: boolean): Promise<UsageData> {
  const now = Date.now()
  const out: AgentUsage[] = []
  const all: SessionInfo[] = []
  for (const agent of agents) {
    let found: ReturnType<typeof claudeSessions> | null = null
    if (agent.command === 'claude') found = claudeSessions(now)
    else if (agent.command === 'opencode') found = opencodeSessions(now)
    else if (agent.command === 'agy') found = agySessions(now)
    if (!found) {
      out.push({ name: agent.name, command: agent.command, window: null, today: 0, week: 0, total: 0, note: 'Todavía no se puede leer el consumo de este agente.', limits: [], limitsError: '', limitsAge: 0 })
      continue
    }
    const lim = agent.command === 'claude' ? await claudeLimits(fetchLimits) : { limits: [], error: '', age: 0 }
    out.push({ ...found.usage, name: agent.name, limits: lim.limits, limitsError: lim.error, limitsAge: lim.age })
    all.push(...found.sessions)
  }
  const history = project ? all.filter((s) => inProject(s.cwd, project)).sort((a, b) => b.end - a.end).slice(0, 40) : []
  return { agents: out, history }
}

// --- acciones sobre una sesión ----------------------------------------------------------------
export const sessionKey = (s: Pick<SessionInfo, 'command' | 'id'>): string => `${s.command}:${s.id}`
export const sessionNames = (): Record<string, string> => (getSetting('session_names') as Record<string, string>) ?? {}

/** Guarda un nombre propio (vacío = volver al original). No toca los archivos del agente. */
export function renameSession(session: SessionInfo, name: string): void {
  const names = { ...sessionNames() }
  if (name.trim()) names[sessionKey(session)] = name.trim()
  else delete names[sessionKey(session)]
  setSetting('session_names', names)
}

export function deleteSession(session: SessionInfo): Promise<McpResult> {
  const finish = (res: McpResult): McpResult => {
    if (res.ok) { const names = { ...sessionNames() }; if (delete names[sessionKey(session)]) setSetting('session_names', names) }
    return res
  }
  if (session.command === 'claude') {
    let removed = false
    const root = join(homedir(), '.claude', 'projects')
    for (const dir of existsSync(root) ? readdirSync(root) : []) {
      const file = join(root, dir, `${session.id}.jsonl`)
      if (existsSync(file)) {
        unlinkSync(file); claudeCache.delete(file); rmSync(join(root, dir, session.id), { recursive: true, force: true }); removed = true   // carpeta auxiliar de la sesión
      }
    }
    return Promise.resolve(finish({ ok: removed, message: removed ? 'Borrada' : 'No se encontró el archivo de la sesión' }))
  }
  if (session.command !== 'opencode') return Promise.resolve({ ok: false, message: 'Este agente no permite borrar sesiones desde aquí' })
  return new Promise((done) => {
    execFile('opencode', ['session', 'delete', session.id], { cwd: session.cwd || undefined, timeout: 30_000, encoding: 'utf8', env: { ...process.env, PATH: extendedPath() } },
      (err, stdout, stderr) => done(finish({ ok: !err, message: ((err ? stderr || stdout : stdout) || '').trim() || (err ? String(err.message) : 'Borrada') })))
  })
}
