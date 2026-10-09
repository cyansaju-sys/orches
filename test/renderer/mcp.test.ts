import { describe, expect, it } from 'vitest'
import type { McpServer } from '@shared/types'
import { agentsMissing, mask, parsePairs, specFromServer, splitArgs } from '../../src/renderer/src/lib/mcp'

const server = (patch: Partial<McpServer>): McpServer => ({ name: 'x', agent: 'claude', scope: 'global', kind: 'remote', target: '', config: {}, source: '', ...patch })

describe('MCP en la interfaz', () => {
  it('parsea pares con distintos separadores', () => {
    expect(parsePairs('Authorization: Bearer a:b\n\nX-Id: 1\nsin separador', [': '])).toEqual({ Authorization: 'Bearer a:b', 'X-Id': '1' })
    expect(parsePairs('A=1\nB = dos\n=vacio', ['='])).toEqual({ A: '1', B: 'dos' })
  })
  it('divide argumentos respetando comillas', () => {
    expect(splitArgs('-y @scope/pkg --flag "con espacios" \'otro valor\'')).toEqual(['-y', '@scope/pkg', '--flag', 'con espacios', 'otro valor'])
    expect(splitArgs('')).toEqual([])
    expect(splitArgs('a "" b')).toEqual(['a', '', 'b'])
  })
  it('oculta solo lo que parece un secreto', () => {
    expect(mask('Authorization', 'Bearer abcdef', false)).toMatch(/^•+$/)
    expect(mask('Authorization', 'Bearer abcdef', true)).toBe('Bearer abcdef')
    expect(mask('Content-Type', 'json', false)).toBe('json')
  })
  it('qué agentes aún no tienen el servidor', () => {
    const a = server({ name: 'n', agent: 'claude' })
    expect(agentsMissing(a, [a], ['claude', 'opencode'])).toEqual(['opencode'])
    expect(agentsMissing(a, [a, server({ name: 'n', agent: 'opencode' })], ['claude', 'opencode'])).toEqual([])
    expect(agentsMissing(a, [a, server({ name: 'n', agent: 'opencode', scope: 'project' })], ['claude', 'opencode'])).toEqual(['opencode'])   // otro alcance
  })
  it('convierte un servidor para copiarlo a otro agente', () => {
    const local = server({ kind: 'local', config: { type: 'local', command: ['npx', '-y', 'srv'], environment: { A: '1' } } })
    expect(specFromServer(local)).toMatchObject({ kind: 'local', command: 'npx', args: ['-y', 'srv'], env: { A: '1' } })
    const remote = server({ config: { type: 'http', url: 'https://x', headers: { H: 'v' } } })
    expect(specFromServer(remote)).toMatchObject({ kind: 'remote', url: 'https://x', headers: { H: 'v' } })
  })
})
