import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const store: Record<string, unknown> = {}
vi.mock('../../../src/main/settings', () => ({ getSetting: (k: string) => store[k], setSetting: (k: string, v: unknown) => { store[k] = v } }))

import { claudeLimits, claudeSessions, inProject, parseClaudeJsonl, renameSession, sessionKey, sessionNames } from '../../../src/main/usage/usage'

const HOUR = 3_600_000
const msg = (id: string, ts: number, input: number, output: number, extra: object = {}): string => JSON.stringify({
  type: 'assistant', timestamp: new Date(ts).toISOString(), requestId: `r-${id}`,
  message: { id, usage: { input_tokens: input, output_tokens: output, cache_creation_input_tokens: 5, cache_read_input_tokens: 1000, ...extra } }
})

let home: string
const previous = process.env.HOME
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'tutti-usage-')); process.env.HOME = home; for (const k of Object.keys(store)) delete store[k] })
afterEach(() => { process.env.HOME = previous })

function writeSession(project: string, id: string, lines: string[]): void {
  const dir = join(home, '.claude', 'projects', project)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${id}.jsonl`), lines.join('\n') + '\n')
}

describe('lectura de una sesión de Claude Code', () => {
  it('suma lo procesado (la caché leída no cuenta) y la respuesta final sustituye a la parcial', () => {
    const t = Date.UTC(2026, 9, 8, 12, 0)
    const data = parseClaudeJsonl([
      JSON.stringify({ type: 'ai-title', aiTitle: 'Arreglar el login', cwd: '/p/app' }),
      msg('m1', t, 10, 1), msg('m1', t, 10, 50),         // misma respuesta: parcial y final
      msg('m2', t + 1000, 20, 30), 'línea rota {'
    ].join('\n'))
    expect(data.title).toBe('Arreglar el login')
    expect(data.msgs.size).toBe(2)
    expect([...data.msgs.values()].map((m) => m.tokens.output).sort()).toEqual([30, 50])
  })
  it('sin título usa el último mensaje del usuario', () => {
    expect(parseClaudeJsonl(JSON.stringify({ type: 'last-prompt', lastPrompt: 'hola' })).title).toBe('hola')
    expect(parseClaudeJsonl('').title).toBe('(sin título)')
  })
})

describe('consumo de Claude Code', () => {
  it('ventana de 5 h, hoy, 7 días y total; las sesiones reanudadas no cuentan dos veces', () => {
    const now = Date.UTC(2026, 9, 8, 15, 30)
    const old = now - 10 * 24 * HOUR
    writeSession('-p-app', 'sesion-a', [JSON.stringify({ type: 'ai-title', aiTitle: 'A', cwd: '/p/app' }), msg('m1', now - HOUR, 100, 50), msg('m2', now - 30 * 60_000, 10, 5)])
    writeSession('-p-app', 'sesion-b', [JSON.stringify({ cwd: '/p/app' }), msg('m2', now - 30 * 60_000, 10, 5), msg('viejo', old, 1000, 1000)])   // m2 repetido
    const { usage, sessions } = claudeSessions(now)
    expect(usage.total).toBe((100 + 50 + 5) + (10 + 5 + 5) + (1000 + 1000 + 5))     // m2 una sola vez
    expect(usage.week).toBe((100 + 50 + 5) + (10 + 5 + 5))
    expect(usage.window?.tokens).toBe((100 + 50 + 5) + (10 + 5 + 5))
    expect(usage.window!.end - usage.window!.start).toBe(5 * HOUR)
    expect(sessions.map((s) => s.id).sort()).toEqual(['sesion-a', 'sesion-b'])
    expect(sessions[0].end).toBeGreaterThanOrEqual(sessions[1].end)                  // la más reciente primero
  })
  it('sin mensajes recientes no hay ventana activa', () => {
    const now = Date.UTC(2026, 9, 8, 15, 30)
    writeSession('-p-x', 's', [JSON.stringify({ cwd: '/p/x' }), msg('m', now - 8 * HOUR, 5, 5)])
    expect(claudeSessions(now).usage.window).toBeNull()
  })
})

describe('proyecto de una sesión', () => {
  it('incluye subcarpetas y sigue enlaces simbólicos', () => {
    const base = mkdtempSync(join(tmpdir(), 'tutti-proj-'))
    mkdirSync(join(base, 'real', 'app', 'src'), { recursive: true })
    symlinkSync(join(base, 'real'), join(base, 'enlace'))
    expect(inProject(join(base, 'real', 'app', 'src'), join(base, 'enlace', 'app'))).toBe(true)
    expect(inProject(join(base, 'real', 'otro'), join(base, 'real', 'app'))).toBe(false)
    expect(inProject('', join(base, 'real'))).toBe(false)
  })
})

describe('límites y nombres', () => {
  it('sin credenciales se explica por qué no hay porcentaje, y sin consultar la red', async () => {
    const r = await claudeLimits(true)
    expect(r.limits).toEqual([])
    expect(r.error).toContain('Inicia sesión en Claude Code')
  })
  it('un nombre propio no toca el archivo y vacío lo quita', () => {
    const s = { command: 'claude', id: 'abc' } as never
    renameSession(s, '  Mi tarea  ')
    expect(sessionNames()[sessionKey(s)]).toBe('Mi tarea')
    renameSession(s, '')
    expect(sessionNames()[sessionKey(s)]).toBeUndefined()
  })
})

describe('agySessions', () => {
  it('sin base de datos devuelve null', async () => {
    vi.resetModules()
    vi.doMock('../../../src/main/usage/agyDb', () => ({ readAgyConversations: () => null }))
    const { agySessions } = await import('../../../src/main/usage/usage')
    expect(agySessions(Date.now())).toBeNull()
  })
  it('lee el historial sin tokens', async () => {
    vi.resetModules()
    const t = Date.now()
    vi.doMock('../../../src/main/usage/agyDb', () => ({ readAgyConversations: () => [
      { conversation_id: 'a', title: 'Hola', preview: '', step_count: 3, last_modified_time: t, workspace_uris: '["file:///tmp/mi%20proj"]' }
    ] }))
    const { agySessions } = await import('../../../src/main/usage/usage')
    const r = agySessions(t)!
    expect(r.sessions[0]).toMatchObject({ command: 'agy', title: 'Hola', cwd: '/tmp/mi proj', project: 'mi proj', tokens: 0 })
    expect(r.usage.note).toContain('Conversaciones: 1')
  })
})
