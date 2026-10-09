import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { projectRoot } from '../../../src/main/context/projectRoot'

describe('proyecto al que pertenece una carpeta', () => {
  it('una subcarpeta resuelve al proyecto conocido', () => {
    expect(projectRoot('/a/proy/src/main', ['/a/otro', '/a/proy'])).toBe('/a/proy')
  })
  it('con proyectos anidados gana el más profundo', () => {
    expect(projectRoot('/a/mono/pkg/x', ['/a/mono', '/a/mono/pkg'])).toBe('/a/mono/pkg')
  })
  it('un nombre que solo empieza igual no cuenta', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orches-root-'))
    expect(projectRoot(`${dir}-2`, [dir])).toBe(`${dir}-2`)
  })
  it('sin proyecto conocido ni git usa la carpeta misma', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orches-root-'))
    mkdirSync(join(dir, 'x'))
    expect(projectRoot(join(dir, 'x'), [])).toBe(join(dir, 'x'))
  })
})
