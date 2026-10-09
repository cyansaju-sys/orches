import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe as suite, expect, it } from 'vitest'
import { buildAddArgv, codexEntries, describe, listServers, opencodeEntries, removeFromOpencodeFile, samePath, validate } from '../../src/main/mcp'

const dir = (): string => mkdtempSync(join(tmpdir(), 'orches-mcp-'))

suite('describir una entrada', () => {
  it('remota por url o por tipo', () => {
    expect(describe({ type: 'http', url: 'https://x/mcp' })).toEqual({ kind: 'remote', target: 'https://x/mcp' })
    expect(describe({ type: 'remote', url: 'http://y' }).kind).toBe('remote')
  })
  it('local: comando con argumentos (Claude) o lista (OpenCode)', () => {
    expect(describe({ command: 'npx', args: ['-y', 'srv'] })).toEqual({ kind: 'local', target: 'npx -y srv' })
    expect(describe({ type: 'local', command: ['npx', '-y', 'srv'] })).toEqual({ kind: 'local', target: 'npx -y srv' })
  })
})

suite('validar', () => {
  it('nombre, URL y comando', () => {
    expect(validate({ name: 'ok-1', kind: 'remote', url: 'https://a.b' })).toBeNull()
    expect(validate({ name: 'mal nombre', kind: 'remote', url: 'https://a.b' })).toContain('nombre')
    expect(validate({ name: 'x', kind: 'remote', url: 'ftp://a' })).toContain('URL')
    expect(validate({ name: 'x', kind: 'local', command: '  ' })).toContain('comando')
  })
})

suite('comando de cada agente', () => {
  const remote = { name: 'api', kind: 'remote' as const, url: 'https://x/mcp', headers: { Authorization: 'Bearer t' } }
  const local = { name: 'loc', kind: 'local' as const, command: 'npx', args: ['-y', 'srv'], env: { A: '1' } }
  it('Claude remoto: nombre antes de las opciones que aceptan varios valores', () => {
    expect(buildAddArgv('claude', remote, 'global')).toEqual(['claude', 'mcp', 'add', 'api', 'https://x/mcp', '--transport', 'http', '-s', 'user', '-H', 'Authorization: Bearer t'])
  })
  it('Claude local de proyecto', () => {
    expect(buildAddArgv('claude', local, 'project')).toEqual(['claude', 'mcp', 'add', 'loc', '-s', 'local', '-e', 'A=1', '--', 'npx', '-y', 'srv'])
  })
  it('OpenCode remoto y local', () => {
    expect(buildAddArgv('opencode', remote, 'global')).toEqual(['opencode', 'mcp', 'add', '--global', '--url', 'https://x/mcp', '--header', 'Authorization=Bearer t', 'api'])
    expect(buildAddArgv('opencode', local, 'project')).toEqual(['opencode', 'mcp', 'add', '--env', 'A=1', 'loc', '--', 'npx', '-y', 'srv'])
  })
})

suite('opencode.json', () => {
  it('lee las dos formas (2.x: mcp.servers; 1.x: mcp.<nombre>) y quita de cualquiera', () => {
    const file = join(dir(), 'opencode.json')
    writeFileSync(file, JSON.stringify({ theme: 'x', mcp: { flat: { type: 'remote', url: 'http://a' }, servers: { nuevo: { type: 'local', command: ['npx', 'a'] } } } }))
    const found = opencodeEntries(file).map(([n, , f]) => `${n}:${f}`)
    expect(found.sort()).toEqual(['flat:flat', 'nuevo:servers'])
    expect(removeFromOpencodeFile(file, 'nuevo')).toBe(true)
    expect(removeFromOpencodeFile(file, 'flat')).toBe(true)
    expect(removeFromOpencodeFile(file, 'flat')).toBe(false)
    const after = JSON.parse(readFileSync(file, 'utf8'))
    expect(after.theme).toBe('x')                                     // lo demás del archivo se conserva
    expect(opencodeEntries(file)).toEqual([])
  })
  it('un archivo inexistente o roto no da error', () => { expect(opencodeEntries(join(dir(), 'no.json'))).toEqual([]) })
})

suite('proyecto abierto por un enlace simbólico', () => {
  it('encuentra los servidores de Claude guardados bajo la ruta real', () => {
    const base = dir()
    const real = join(base, 'real', 'proyecto')
    mkdirSync(real, { recursive: true })
    symlinkSync(join(base, 'real'), join(base, 'enlace'))
    const viaLink = join(base, 'enlace', 'proyecto')
    expect(samePath(real, viaLink)).toBe(true)
    expect(samePath(real, join(base, 'otro'))).toBe(false)

    const home = join(base, 'home')
    mkdirSync(home)
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ projects: { [real]: { mcpServers: { db: { type: 'stdio', command: 'npx', args: ['-y', 'srv'] } } } } }))
    const previous = process.env.HOME
    process.env.HOME = home
    try {
      const found = listServers(viaLink).filter((s) => s.agent === 'claude')
      expect(found.map((s) => `${s.name}:${s.scope}`)).toEqual(['db:project'])
    } finally { process.env.HOME = previous }
  })
})

suite('Gemini CLI y Codex', () => {
  const local = { name: 'loc', kind: 'local' as const, command: 'npx', args: ['-y', 'srv'], env: { A: '1' } }
  const remote = { name: 'api', kind: 'remote' as const, url: 'https://x/mcp', headers: { Authorization: 'Bearer t' } }
  it('arma el comando de gemini', () => {
    expect(buildAddArgv('gemini', local, 'global')).toEqual(['gemini', 'mcp', 'add', '-s', 'user', '-e', 'A=1', 'loc', 'npx', '-y', 'srv'])
    expect(buildAddArgv('gemini', remote, 'project')).toEqual(['gemini', 'mcp', 'add', '-s', 'project', '-t', 'http', '-H', 'Authorization: Bearer t', 'api', 'https://x/mcp'])
  })
  it('arma el comando de codex', () => {
    expect(buildAddArgv('codex', local, 'global')).toEqual(['codex', 'mcp', 'add', 'loc', '--env', 'A=1', '--', 'npx', '-y', 'srv'])
    expect(buildAddArgv('codex', remote, 'global')).toEqual(['codex', 'mcp', 'add', 'api', '--url', 'https://x/mcp'])
  })
  it('lee los servidores del config.toml de codex', () => {
    const file = join(dir(), 'config.toml')
    writeFileSync(file, 'model = "x"\n[mcp_servers.fs]\ncommand = "npx"\nargs = ["-y", "@a/b"]\n[mcp_servers.fs.env]\nK = "v"\n[mcp_servers."web"]\nurl = "https://w/mcp"\n[other]\ncommand = "no"\n')
    expect(codexEntries(file)).toEqual([
      ['fs', { command: 'npx', args: ['-y', '@a/b'], env: { K: 'v' } }],
      ['web', { url: 'https://w/mcp' }]
    ])
  })
  it('describe httpUrl de gemini como remoto', () => {
    expect(describe({ httpUrl: 'https://g/mcp' })).toEqual({ kind: 'remote', target: 'https://g/mcp' })
  })
})

suite('Antigravity (agy)', () => {
  it('arma el comando con las opciones antes del nombre', () => {
    expect(buildAddArgv('agy', { name: 'loc', kind: 'local', command: 'npx', args: ['-y', 'srv'], env: { A: '1' } }, 'global')).toEqual(['agy', 'mcp', 'add', '--env', 'A=1', 'loc', '--', 'npx', '-y', 'srv'])
    expect(buildAddArgv('agy', { name: 'api', kind: 'remote', url: 'https://x/mcp', headers: { Authorization: 'Bearer t' } }, 'global')).toEqual(['agy', 'mcp', 'add', '--header', 'Authorization: Bearer t', 'api', 'https://x/mcp'])
  })
  it('serverUrl cuenta como remoto', () => {
    expect(describe({ serverUrl: 'https://s/mcp' })).toEqual({ kind: 'remote', target: 'https://s/mcp' })
  })
})
