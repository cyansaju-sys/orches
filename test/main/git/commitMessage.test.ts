import { describe, expect, it } from 'vitest'
import { buildPrompt, cleanMessage, headlessArgs, heuristicMessage } from '../../../src/main/git/commitMessage'

describe('mensaje de commit con un agente', () => {
  it('limpia comillas, bloques de código y charla previa', () => {
    expect(cleanMessage('```\nfeat(git): añade la comparación\n```')).toBe('feat(git): añade la comparación')
    expect(cleanMessage('Claro, aquí tienes:\n\n"fix: corrige el scroll."')).toBe('fix: corrige el scroll')
    expect(cleanMessage('feat!: cambia la API\n\nCuerpo con motivo.')).toBe('feat!: cambia la API')
  })
  it('rechaza lo que no es Conventional Commits', () => {
    expect(cleanMessage('Añadí cosas al proyecto')).toBeNull()
    expect(cleanMessage('feature: algo')).toBeNull()
    expect(cleanMessage('')).toBeNull()
  })
  it('el prompt lleva el diff, el estilo y recorta lo muy largo', () => {
    const p = buildPrompt('diff --git a b', 'feat: x')
    expect(p).toContain('diff --git a b')
    expect(p).toContain('feat: x')
    expect(buildPrompt('z'.repeat(50_000), '')).toContain('diff recortado')
  })
  it('cada agente se lanza en modo de una sola respuesta', () => {
    expect(headlessArgs('claude', 'P')).toEqual(['-p', 'P'])
    expect(headlessArgs('opencode', 'P')).toEqual(['run', 'P'])
    expect(headlessArgs('codex', 'P')).toEqual(['exec', 'P'])
    expect(headlessArgs('aider', 'P')).toBeNull()
  })
})

describe('mensaje sin IA', () => {
  const f = (status: string, path: string, added = 1, deleted = 0) => ({ status, path, added, deleted })
  it('un archivo de código nuevo es feat con su nombre como ámbito', () => {
    expect(heuristicMessage([f('A', 'src/main/commitMessage.ts')])).toBe('feat(commitMessage): añade commitMessage.ts')
  })
  it('solo documentación, tests o CI marcan su tipo', () => {
    expect(heuristicMessage([f('M', 'README.md')])).toBe('docs(README): actualiza README.md')
    expect(heuristicMessage([f('M', 'src/a.test.ts')])?.startsWith('test')).toBe(true)
    expect(heuristicMessage([f('M', '.github/workflows/release.yml')])?.startsWith('ci')).toBe(true)
    expect(heuristicMessage([f('M', 'package.json'), f('M', 'package-lock.json')])?.startsWith('build')).toBe(true)
  })
  it('varios archivos: ámbito de la carpeta común, en una sola línea', () => {
    const msg = heuristicMessage([f('M', 'src/renderer/src/views/A.tsx', 3, 1), f('M', 'src/renderer/src/views/B.tsx', 2, 2), f('M', 'src/renderer/src/views/C.tsx'), f('M', 'src/renderer/src/views/D.tsx')])!
    expect(msg).toBe('refactor(views): actualiza 4 archivos')
  })
  it('lo que lo tocan juntos con código manda el tipo del código; sin archivos no hay mensaje', () => {
    expect(heuristicMessage([f('D', 'src/x.ts'), f('M', 'README.md')])?.startsWith('chore(x)')).toBe(true)
    expect(heuristicMessage([])).toBeNull()
  })
  it('cumple el formato de Conventional Commits', () => {
    expect(cleanMessage(heuristicMessage([f('A', 'src/a.ts'), f('A', 'src/b.ts')])!)).not.toBeNull()
  })
})
