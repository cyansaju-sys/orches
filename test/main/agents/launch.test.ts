import { describe, expect, it } from 'vitest'
import { buildLaunch, parseMajor, type McpEntry } from '../../../src/main/agents/launch'

const entry: McpEntry = { type: 'http', url: 'http://127.0.0.1:5000/mcp/a2', headers: { Authorization: 'Bearer t' } }

describe('arranque de cada agente', () => {
  it('Claude: la tarea va primero y las herramientas quedan permitidas', () => {
    const l = buildLaunch('claude', entry, ' haz algo ', ['--model', 'opus'], 2)
    expect(l.args.slice(0, 3)).toEqual(['haz algo', '--model', 'opus'])
    expect(l.args[l.args.indexOf('--mcp-config') + 1]).toContain('"orches"')
    expect(l.args).toContain('mcp__orches__delegate_task')
    expect(JSON.parse(l.args[l.args.indexOf('--mcp-config') + 1]).mcpServers.orches.url).toBe(entry.url)
  })

  it('OpenCode 2.x: servidor privado por panel, formato mcp.servers y permiso para sus herramientas', () => {
    const l = buildLaunch('opencode', entry, 'tarea', [], 2)
    expect(l.args).toEqual(['--standalone', '--prompt', 'tarea'])
    const config = JSON.parse(l.env.OPENCODE_CONFIG_CONTENT)
    expect(config.mcp.servers.orches).toEqual({ type: 'remote', url: entry.url, headers: entry.headers })
    expect(config.permission['orches_*']).toBe('allow')
  })

  it('OpenCode 1.x: sin --standalone y con los servidores directamente bajo mcp', () => {
    const l = buildLaunch('opencode', entry, undefined, ['--continue'], 1)
    expect(l.args).toEqual(['--continue'])
    const config = JSON.parse(l.env.OPENCODE_CONFIG_CONTENT)
    expect(config.mcp.orches.type).toBe('remote')
    expect(config.mcp.servers).toBeUndefined()
    expect(config.permission).toBeUndefined()
  })

  it('cada panel recibe su propia dirección (el id va en la URL)', () => {
    const a = JSON.parse(buildLaunch('opencode', { ...entry, url: 'http://x/mcp/a1' }, undefined, [], 2).env.OPENCODE_CONFIG_CONTENT)
    const b = JSON.parse(buildLaunch('opencode', { ...entry, url: 'http://x/mcp/a2' }, undefined, [], 2).env.OPENCODE_CONFIG_CONTENT)
    expect(a.mcp.servers.orches.url).not.toBe(b.mcp.servers.orches.url)
  })

  it('otros agentes no reciben configuración MCP', () => {
    expect(buildLaunch('codex', entry, 'x', ['--a'], 2)).toEqual({ args: ['--a'], env: {} })
  })

  it('lee la versión principal', () => {
    expect(parseMajor('opencode v2.0.21')).toBe(2)
    expect(parseMajor('1.14.3\n')).toBe(1)
    expect(parseMajor('???')).toBe(2)
  })
})

describe('arranque sin servidor de reparto de tareas', () => {
  const context = { text: 'Es una app', file: '/cfg/orches/p-1/contexto.md' }
  it('Claude recibe solo el contexto', () => {
    expect(buildLaunch('claude', null, 'tarea', ['--model', 'x'], 2, context)).toEqual({ args: ['tarea', '--model', 'x', '--append-system-prompt', 'Es una app'], env: {} })
  })
  it('OpenCode recibe solo las instrucciones, sin MCP ni --standalone', () => {
    const l = buildLaunch('opencode', null, undefined, [], 2, context)
    expect(l.args).toEqual([])
    expect(JSON.parse(l.env.OPENCODE_CONFIG_CONTENT)).toEqual({ instructions: [context.file] })
  })
  it('sin servidor ni contexto no cambia nada', () => {
    expect(buildLaunch('claude', null, undefined, ['--a'], 2)).toEqual({ args: ['--a'], env: {} })
    expect(buildLaunch('opencode', null, undefined, ['--a'], 2)).toEqual({ args: ['--a'], env: {} })
  })
  it('con servidor y contexto, el contexto se suma', () => {
    expect(buildLaunch('claude', entry, undefined, [], 2, context).args).toContain('--append-system-prompt')
    expect(JSON.parse(buildLaunch('opencode', entry, undefined, [], 2, context).env.OPENCODE_CONFIG_CONTENT).instructions).toEqual([context.file])
  })
})
