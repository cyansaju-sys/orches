import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { agentColors, agentInitial, agentLogo, hash } from '../../src/renderer/src/lib/agentIcon'

describe('colores del icono de un agente', () => {
  it('los agentes conocidos tienen su color, sin importar mayúsculas ni la ruta', () => {
    expect(agentColors('claude').from).toBe('#e8825f')
    expect(agentColors('CLAUDE')).toEqual(agentColors('claude'))
    expect(agentColors('/home/u/.local/bin/agy')).toEqual(agentColors('agy'))
  })
  it('cualquier otro agente recibe un color propio y siempre el mismo', () => {
    const a = agentColors('mi-agente-raro')
    expect(a).toEqual(agentColors('mi-agente-raro'))
    expect(a.from).toMatch(/^hsl\(\d+ 68% 60%\)$/)
    expect(agentColors('otro-agente')).not.toEqual(a)
  })
  it('el color se reparte bien entre nombres distintos', () => {
    const hues = new Set(Array.from({ length: 40 }, (_, i) => hash(`agente-${i}`) % 360))
    expect(hues.size).toBeGreaterThan(30)
  })
  it('la letra es la primera letra o cifra del nombre', () => {
    expect(agentInitial('Claude Code')).toBe('C')
    expect(agentInitial('  ¡hola')).toBe('H')
    expect(agentInitial('7zip')).toBe('7')
    expect(agentInitial('ñandú')).toBe('Ñ')
    expect(agentInitial('---')).toBe('?')
  })
})

describe('logos de los agentes', () => {
  it('los conocidos tienen logo (también por su otro nombre o con ruta) y los demás no', () => {
    expect(agentLogo('agy')).toEqual({ file: 'antigravity-color', mono: false })
    expect(agentLogo('Antigravity')).toEqual(agentLogo('agy'))
    expect(agentLogo('/home/u/.local/bin/claude')).toEqual({ file: 'claudecode-color', mono: false })
    expect(agentLogo('opencode')?.mono).toBe(true)
    expect(agentLogo('aider')).toBeNull()                     // sin logo: usa el icono generado
    expect(agentLogo('mi-agente-raro')).toBeNull()
  })
  it('cada logo apunta a un SVG que existe en public/icons/agents', () => {
    const dir = join(__dirname, '../../src/renderer/public/icons/agents')
    for (const id of ['claude', 'opencode', 'agy', 'codex', 'gemini', 'cursor-agent', 'goose', 'amp', 'kimi', 'kilo', 'cline', 'qwen', 'copilot', 'vibe']) {
      expect(existsSync(join(dir, `${agentLogo(id)!.file}.svg`)), id).toBe(true)
    }
  })
  it('un agente con logo también conserva su color de reserva', () => {
    expect(agentColors('antigravity')).toEqual(agentColors('agy'))
  })
})
