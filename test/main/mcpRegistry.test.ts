import { describe, expect, it } from 'vitest'
import { niceName, optionsOf, toServer } from '../../src/main/mcpRegistry'

const npm = {
  name: 'io.github.acme/files', description: 'Archivos', version: '1.2.0', repository: { url: 'https://github.com/acme/files' },
  packages: [{
    registryType: 'npm', identifier: '@acme/files-mcp', version: '1.2.0', transport: { type: 'stdio' },
    runtimeArguments: [{ type: 'positional', value: '-y' }], packageArguments: [{ type: 'positional', value: '/data' }],
    environmentVariables: [{ name: 'TOKEN', isRequired: true, isSecret: true, description: 'clave' }, { name: 'MODE', default: 'ro' }]
  }]
}

describe('registro de servidores MCP', () => {
  it('un paquete npm se instala con npx y su versión', () => {
    const [o] = optionsOf(npm)
    expect(o.kind).toBe('local')
    expect(o.command).toBe('npx')
    expect(o.args).toEqual(['-y', '@acme/files-mcp@1.2.0', '/data'])
    expect(o.env.map((f) => [f.name, f.required, f.secret, f.default])).toEqual([['TOKEN', true, true, ''], ['MODE', false, false, 'ro']])
  })

  it('pypi usa uvx y las URL remotas van tal cual', () => {
    const options = optionsOf({ packages: [{ registryType: 'pypi', identifier: 'mi-server', transport: { type: 'stdio' } }], remotes: [{ type: 'streamable-http', url: 'https://x.dev/mcp', headers: [{ name: 'Authorization', isRequired: true }] }] })
    expect(options.map((o) => [o.kind, o.command ?? o.url, o.args])).toEqual([['local', 'uvx', ['mi-server']], ['remote', 'https://x.dev/mcp', undefined]])
    expect(options[1].headers[0].name).toBe('Authorization')
  })

  it('se saltan los formatos que Tutti no sabe instalar', () => {
    expect(optionsOf({ packages: [{ registryType: 'oci', identifier: 'img', transport: { type: 'stdio' } }, { registryType: 'npm', identifier: 'x', transport: { type: 'sse', url: 'http://a' } }], remotes: [{ type: 'sse', url: 'https://x/{tenant}/mcp' }] })).toEqual([])
    expect(toServer({ server: { name: 'solo/oci', packages: [{ registryType: 'oci', identifier: 'img' }] } })).toBeNull()
  })

  it('una entrada válida se resume con su título y repositorio', () => {
    const s = toServer({ server: npm })!
    expect(s).toMatchObject({ name: 'io.github.acme/files', title: 'files', version: '1.2.0', repository: 'https://github.com/acme/files' })
  })
})

describe('orden por relevancia', () => {
  const s = (name: string, title = name.split('/').pop()!): import('../../src/shared/types').RegistryServer => ({ name, title, description: '', version: '1', repository: '', options: [] })
  it('los recomendados van primero y luego lo que mejor coincide con lo buscado', async () => {
    const { relevance } = await import('../../src/main/mcpRegistry')
    expect(relevance(s('io.github.upstash/context7'), '')).toBeGreaterThan(relevance(s('io.github.otro/cosa'), ''))
    expect(relevance(s('x/github'), 'github')).toBeGreaterThan(relevance(s('x/mi-github-tool'), 'github'))
    expect(relevance(s('x/github-tool'), 'github')).toBeGreaterThan(relevance(s('x/mi-github-tool'), 'github'))
  })
})

describe('nombre legible', () => {
  it('usa al publicador cuando el nombre es genérico', () => {
    expect(niceName('com.notion/mcp')).toBe('Notion')
    expect(niceName('io.github.acme/files')).toBe('files')
    expect(niceName('suelto')).toBe('suelto')
  })
})
