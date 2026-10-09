import { describe, expect, it } from 'vitest'
import { agentRef } from '../../src/renderer/src/lib/agentRef'

describe('referencia a un archivo en el prompt del agente', () => {
  it('usa @ con los agentes que lo entienden', () => {
    expect(agentRef('claude', 'src/a.ts')).toBe('@src/a.ts')
    expect(agentRef('agy', 'src')).toBe('@src')
  })
  it('deja la ruta sola con los demás y entrecomilla si hay espacios', () => {
    expect(agentRef('aider', 'src/a.ts')).toBe('src/a.ts')
    expect(agentRef('claude', 'mi carpeta/a.ts')).toBe('@"mi carpeta/a.ts"')
  })
})
