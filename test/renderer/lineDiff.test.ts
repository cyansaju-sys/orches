import { describe, expect, it } from 'vitest'
import { diffRows, hasChanges } from '../../src/renderer/src/lib/lineDiff'

const kinds = (a: string, b: string, ctx = 0): string[] => diffRows(a, b, ctx).map((r) => r.kind).filter((k) => k !== 'fold')

describe('comparación de líneas', () => {
  it('sin cambios no hay filas con diferencias', () => {
    expect(hasChanges(diffRows('a\nb\n', 'a\nb\n'))).toBe(false)
  })
  it('una línea cambiada sale como chg con sus números', () => {
    const rows = diffRows('a\nb\nc', 'a\nX\nc', 0).filter((r) => r.kind !== 'fold')
    expect(rows).toEqual([{ kind: 'chg', left: { n: 2, text: 'b' }, right: { n: 2, text: 'X' } }])
  })
  it('añadidas y borradas', () => {
    expect(kinds('a\nb', 'a\nb\nc\nd')).toEqual(['add', 'add'])
    expect(kinds('a\nb\nc', 'a')).toEqual(['del', 'del'])
  })
  it('archivo nuevo y archivo vacío', () => {
    expect(kinds('', 'x\ny')).toEqual(['add', 'add'])
    expect(kinds('x', '')).toEqual(['del'])
  })
  it('pliega los tramos largos sin cambios', () => {
    const base = Array.from({ length: 30 }, (_, i) => `l${i}`)
    const changed = [...base]; changed[15] = 'cambiada'
    const rows = diffRows(base.join('\n'), changed.join('\n'), 2)
    expect(rows.filter((r) => r.kind === 'fold')).toEqual([{ kind: 'fold', count: 13 }, { kind: 'fold', count: 12 }])
    expect(rows.some((r) => r.kind === 'chg')).toBe(true)
  })
  it('ignora el salto de línea final y CRLF', () => {
    expect(hasChanges(diffRows('a\r\nb\r\n', 'a\nb'))).toBe(false)
  })
})
