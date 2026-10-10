import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildMatcher, globsToRegex, replaceInFiles, searchFiles } from '../../src/main/search'

const base = { caseSensitive: false, wholeWord: false, regex: false }
const project = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'orches-search-'))
  mkdirSync(join(d, 'src')); mkdirSync(join(d, 'node_modules'))
  writeFileSync(join(d, 'src', 'a.ts'), 'const Foo = 1\nlet foobar = Foo + 2\n')
  writeFileSync(join(d, 'src', 'b.md'), 'sin nada\nfoo\n')
  writeFileSync(join(d, 'node_modules', 'x.js'), 'foo')
  writeFileSync(join(d, 'bin.dat'), Buffer.from([102, 111, 111, 0, 1]))
  return d
}

describe('buscar en el proyecto', () => {
  it('encuentra por línea y columna, sin mayúsculas por defecto, y salta node_modules y binarios', async () => {
    const r = await searchFiles(project(), { ...base, query: 'foo' })
    expect(r.files.map((f) => f.rel)).toEqual(['src/a.ts', 'src/b.md'])
    expect(r.files[0].matches.map((m) => [m.line, m.col])).toEqual([[1, 6], [2, 4], [2, 13]])
    expect(r.total).toBe(4)
  })
  it('distingue mayúsculas y palabra completa', async () => {
    const d = project()
    expect((await searchFiles(d, { ...base, query: 'Foo', caseSensitive: true })).total).toBe(2)
    expect((await searchFiles(d, { ...base, query: 'foo', wholeWord: true })).total).toBe(3)       // «foobar» no cuenta
  })
  it('admite expresiones regulares y avisa si no son válidas', async () => {
    const d = project()
    expect((await searchFiles(d, { ...base, query: 'fo+b', regex: true })).total).toBe(1)
    expect((await searchFiles(d, { ...base, query: '(', regex: true })).error).toBeTruthy()
    expect(typeof buildMatcher({ ...base, query: 'a.b' })).toBe('object')
  })
  it('filtra con incluir y excluir', async () => {
    const d = project()
    expect((await searchFiles(d, { ...base, query: 'foo', include: '*.md' })).files.map((f) => f.rel)).toEqual(['src/b.md'])
    expect((await searchFiles(d, { ...base, query: 'foo', exclude: 'src/' })).files).toEqual([])
    expect(globsToRegex('*.ts')[0].test('src/x/a.ts')).toBe(true)
    expect(globsToRegex('src/*.ts')[0].test('src/x/a.ts')).toBe(false)
  })
})

describe('reemplazar', () => {
  it('reemplaza en los archivos dados, conserva CRLF y no toca fuera del proyecto', async () => {
    const d = project()
    const a = join(d, 'src', 'a.ts')
    writeFileSync(a, 'foo 1\r\nFoo 2\r\n')
    const outside = join(mkdtempSync(join(tmpdir(), 'orches-out-')), 'x.txt'); writeFileSync(outside, 'foo')
    const r = await replaceInFiles(d, { ...base, query: 'foo' }, 'bar', [a, outside])
    expect(r).toEqual({ files: 1, count: 2 })
    expect(readFileSync(a, 'utf8')).toBe('bar 1\r\nbar 2\r\n')
    expect(readFileSync(outside, 'utf8')).toBe('foo')
  })
  it('con regex admite grupos y $&', async () => {
    const d = project()
    const a = join(d, 'src', 'a.ts'); writeFileSync(a, 'let x = 1\n')
    await replaceInFiles(d, { ...base, query: '(\\w+) = (\\d)', regex: true }, '$2 <- $1 [$&] $$', [a])
    expect(readFileSync(a, 'utf8')).toBe('let 1 <- x [x = 1] $\n')
  })
})
