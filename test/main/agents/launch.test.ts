import { describe, expect, it } from 'vitest'
import { buildLaunch, parseMajor, type McpEntry } from '../../../src/main/agents/launch'

const entry: McpEntry = { type: 'http', url: 'http://127.0.0.1:5000/mcp/a2', headers: { Authorization: 'Bearer t' } }

describe('arranque de cada agente', () => {
  it('Claude: la tarea va primero y las herramientas quedan permitidas', () => {
    const l = buildLaunch('claude', entry, ' haz algo ', ['--model', 'opus'], 2)
    expect(l.args.slice(0, 3)).toEqual(['haz algo', '--model', 'opus'])
    expect(l.args[l.args.indexOf('--mcp-config') + 1]).toContain('"tutti"')
    expect(l.args).toContain('mcp__tutti__delegate_task')
    expect(JSON.parse(l.args[l.args.indexOf('--mcp-config') + 1]).mcpServers.tutti.url).toBe(entry.url)
  })

  it('OpenCode 2.x: servidor privado por panel, formato mcp.servers y permiso para sus herramientas', () => {
    const l = buildLaunch('opencode', entry, 'tarea', [], 2)
    expect(l.args).toEqual(['--standalone', '--prompt', 'tarea'])
    const config = JSON.parse(l.env.OPENCODE_CONFIG_CONTENT)
    expect(config.mcp.servers.tutti).toEqual({ type: 'remote', url: entry.url, headers: entry.headers })
    expect(config.permission['tutti_*']).toBe('allow')
  })

  it('OpenCode 1.x: sin --standalone y con los servidores directamente bajo mcp', () => {
    const l = buildLaunch('opencode', entry, undefined, ['--continue'], 1)
    expect(l.args).toEqual(['--continue'])
    const config = JSON.parse(l.env.OPENCODE_CONFIG_CONTENT)
    expect(config.mcp.tutti.type).toBe('remote')
    expect(config.mcp.servers).toBeUndefined()
    expect(config.permission).toBeUndefined()
  })

  it('cada panel recibe su propia dirección (el id va en la URL)', () => {
    const a = JSON.parse(buildLaunch('opencode', { ...entry, url: 'http://x/mcp/a1' }, undefined, [], 2).env.OPENCODE_CONFIG_CONTENT)
    const b = JSON.parse(buildLaunch('opencode', { ...entry, url: 'http://x/mcp/a2' }, undefined, [], 2).env.OPENCODE_CONFIG_CONTENT)
    expect(a.mcp.servers.tutti.url).not.toBe(b.mcp.servers.tutti.url)
  })

  it('otros agentes no reciben configuración MCP', () => {
    expect(buildLaunch('aider', entry, 'x', ['--a'], 2)).toEqual({ args: ['--a'], env: {} })
  })

  it('Codex: la URL va por -c y la clave por entorno, sin tocar su config.toml', () => {
    const l = buildLaunch('codex', entry, undefined, ['--a'], 2)
    expect(l.args).toEqual(['-c', 'mcp_servers.tutti.url="http://127.0.0.1:5000/mcp/a2"', '-c', 'mcp_servers.tutti.bearer_token_env_var="TUTTI_MCP_TOKEN"',
      '-c', 'mcp_servers.tutti.default_tools_approval_mode="approve"', '--a'])
    expect(l.env).toEqual({ TUTTI_MCP_TOKEN: 't' })
  })

  it('lee la versión principal', () => {
    expect(parseMajor('opencode v2.0.21')).toBe(2)
    expect(parseMajor('1.14.3\n')).toBe(1)
    expect(parseMajor('???')).toBe(2)
  })
})

describe('arranque sin servidor de reparto de tareas', () => {
  const context = { text: 'Es una app', file: '/cfg/tutti/p-1/contexto.md' }
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

describe('Antigravity (puente MCP)', () => {
  const entry = { type: 'http' as const, url: 'http://127.0.0.1:5555/mcp/a3', headers: { Authorization: 'Bearer clave' } }
  it('recibe la URL y la clave de su sesión por entorno, sin tocar sus argumentos', () => {
    expect(buildLaunch('agy', entry, undefined, ['--model', 'x'], 2)).toEqual({ args: ['--model', 'x'], env: { TUTTI_MCP_URL: entry.url, TUTTI_MCP_AUTH: 'Bearer clave' } })
    expect(buildLaunch('agy', null, undefined, [], 2).env).toEqual({})
  })
})
