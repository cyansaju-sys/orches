import { describe, expect, it } from 'vitest'
import { useStore } from '../../src/renderer/src/store'
import { ago, fmtDelta, fmtTokens, resumeArgs, severity } from '../../src/renderer/src/lib/format'

describe('formato', () => {
  it('tokens', () => { expect(fmtTokens(950)).toBe('950'); expect(fmtTokens(12_345)).toBe('12.3 k'); expect(fmtTokens(2_500_000)).toBe('2.5 M') })
  it('duraciones', () => {
    expect(fmtDelta(5 * 60_000)).toBe('5 min'); expect(fmtDelta(125 * 60_000)).toBe('2 h 05 min')
    expect(fmtDelta(3 * 24 * 3_600_000)).toBe('3 d'); expect(fmtDelta(-5)).toBe('0 min')
  })
  it('hace cuánto', () => {
    useStore.setState({ lang: 'es' })          // el idioma sale del sistema: se fija para que la prueba no dependa de dónde corra
    expect(ago(1000, 30_000)).toBe('ahora'); expect(ago(0, 3 * 3_600_000)).toBe('hace 3 h 00 min')
    useStore.setState({ lang: 'en' })
    expect(ago(1000, 30_000)).toBe('just now'); expect(ago(0, 3 * 3_600_000)).toBe('3 h 00 min ago')
  })
  it('gravedad', () => { expect(severity(10)).toBe('accent'); expect(severity(60)).toBe('warn'); expect(severity(90)).toBe('danger') })
  it('cómo retomar una sesión', () => {
    expect(resumeArgs('claude', 'x')).toEqual(['--resume', 'x']); expect(resumeArgs('opencode', 'y')).toEqual(['--session', 'y']); expect(resumeArgs('codex', 'z')).toBeNull()
  })
})
