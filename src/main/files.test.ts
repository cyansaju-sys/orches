import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createEntry, renameEntry, validName } from './files'

const dir = (): string => mkdtempSync(join(tmpdir(), 'orches-files-'))

describe('crear y renombrar', () => {
  it('solo acepta nombres simples', () => {
    for (const bad of ['', ' ', '..', '.', 'a/b', 'a\\b', ' a']) expect(validName(bad)).toBe(false)
    expect(validName('archivo.ts')).toBe(true)
  })
  it('crea archivo y carpeta, sin pisar lo que existe', async () => {
    const d = dir()
    expect((await createEntry(d, 'a.txt', false)).ok).toBe(true)
    expect((await createEntry(d, 'sub', true)).ok).toBe(true)
    expect(existsSync(join(d, 'a.txt')) && existsSync(join(d, 'sub'))).toBe(true)
    expect((await createEntry(d, 'a.txt', false)).ok).toBe(false)
    expect((await createEntry(d, '../fuera', false)).ok).toBe(false)
  })
  it('renombra en la misma carpeta y avisa si el nombre ya está', async () => {
    const d = dir()
    writeFileSync(join(d, 'a.txt'), 'x'); writeFileSync(join(d, 'b.txt'), 'y')
    const ok = await renameEntry(join(d, 'a.txt'), 'c.txt')
    expect(ok).toEqual({ ok: true, message: join(d, 'c.txt') })
    expect(existsSync(join(d, 'a.txt'))).toBe(false)
    expect((await renameEntry(join(d, 'c.txt'), 'b.txt')).ok).toBe(false)
    expect((await renameEntry(join(d, 'c.txt'), '../x')).ok).toBe(false)
  })
})
