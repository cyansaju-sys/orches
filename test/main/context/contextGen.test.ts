import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPrompt, cleanContext, fallbackContext, projectDigest, treeOf } from '../../../src/main/context/contextGen'

const project = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'orches-ctx-'))
  mkdirSync(join(dir, 'src')); mkdirSync(join(dir, 'node_modules')); mkdirSync(join(dir, '.git'))
  writeFileSync(join(dir, 'src', 'a.ts'), '')
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo', description: 'Una app', scripts: { test: 'vitest' } }))
  writeFileSync(join(dir, 'README.md'), '# Demo\nUna app de prueba')
  return dir
}

describe('contexto del proyecto con un agente', () => {
  it('el árbol omite lo generado y lo oculto', () => {
    expect(treeOf(project())).toEqual(['README.md', 'package.json', 'src/', 'src/a.ts'])
  })
  it('el resumen reúne manifiesto y README, y el prompt prohíbe usar herramientas', async () => {
    const digest = await projectDigest(project())
    expect(digest).toContain('package.json: demo')
    expect(digest).toContain('test: vitest')
    expect(digest).toContain('Una app de prueba')
    expect(buildPrompt(digest)).toContain('No uses herramientas')
  })
  it('limpia la respuesta del agente', () => {
    const md = '## Qué es\nUna aplicación de escritorio para trabajar con agentes.'
    expect(cleanContext(`Claro, aquí está:\n\n${md}`)).toBe(md)
    expect(cleanContext('```markdown\n' + md + '\n```')).toBe(md)
    expect(cleanContext('ok')).toBeNull()
  })
  it('sin agentes arma un borrador con reglas', async () => {
    const dir = project()
    expect(fallbackContext(dir, await projectDigest(dir))).toContain('## Estructura')
  })
})
