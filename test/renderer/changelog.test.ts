import { describe, expect, it } from 'vitest'
import { compareVersions, newSince, parseChangelog } from '../../src/renderer/src/lib/changelog'

const text = `# Novedades\n\n## 1.1.0\n\n- **Uno:** algo\n- Dos\n\n## 1.0.4\n- Tres\n\n## v1.0.3\n* Cuatro\n`

describe('novedades de cada versión', () => {
  it('lee las secciones y sus frases', () => {
    expect(parseChangelog(text)).toEqual([
      { version: '1.1.0', items: ['**Uno:** algo', 'Dos'] }, { version: '1.0.4', items: ['Tres'] }, { version: '1.0.3', items: ['Cuatro'] }
    ])
  })
  it('compara versiones numéricamente', () => {
    expect(compareVersions('1.0.10', '1.0.9')).toBeGreaterThan(0)
    expect(compareVersions('1.0.3', '1.0.3')).toBe(0)
  })
  it('junta lo de las versiones que se saltó el usuario, sin pasarse de la instalada', () => {
    const all = parseChangelog(text)
    expect(newSince(all, '1.0.3', '1.1.0').map((e) => e.version)).toEqual(['1.1.0', '1.0.4'])
    expect(newSince(all, '1.0.3', '1.0.4').map((e) => e.version)).toEqual(['1.0.4'])
    expect(newSince(all, '1.1.0', '1.1.0')).toEqual([])
  })
})
