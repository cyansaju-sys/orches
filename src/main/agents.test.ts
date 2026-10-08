import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const store: Record<string, unknown> = {}
vi.mock('./settings', () => ({ getSetting: (k: string) => store[k], setSetting: (k: string, v: unknown) => { store[k] = v } }))
// `which` simulado: solo «encuentra» lo que cada prueba declara instalado
const installed = new Map<string, string>()
vi.mock('./shellpath', () => ({ which: (c: string) => installed.get(c) ?? null, extendedPath: () => '' }))

import { addCustomAgent, candidateExecutables, customAgents, detectAgents, removeCustomAgent, resolveExecutable, splitCommand } from './agents'

const exe = (dir: string, name: string): string => {
  const path = join(dir, name)
  writeFileSync(path, '#!/bin/sh\nexit 0\n')
  chmodSync(path, 0o755)
  return path
}

beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; installed.clear() })

describe('dividir un comando', () => {
  it('ejecutable y argumentos, con comillas', () => {
    expect(splitCommand('mi-agente --modo rapido')).toEqual(['mi-agente', '--modo', 'rapido'])
    expect(splitCommand(`agente --nombre "con espacios" 'otro valor'`)).toEqual(['agente', '--nombre', 'con espacios', 'otro valor'])
    expect(splitCommand('  agente   -x  ')).toEqual(['agente', '-x'])
    expect(splitCommand('')).toEqual([])
    expect(splitCommand('a "" b')).toEqual(['a', '', 'b'])        // un argumento vacío entre comillas cuenta
  })
})

describe('detectar agentes', () => {
  it('reconoce los conocidos que estén instalados; agy no está en la lista (se añade como propio)', () => {
    installed.set('agy', '/home/u/.local/bin/agy')
    installed.set('codex', '/home/u/.local/bin/codex')
    installed.set('claude', '/home/u/.local/bin/claude')
    expect(detectAgents()).toEqual([
      { name: 'Claude Code', command: 'claude', path: '/home/u/.local/bin/claude' },
      { name: 'Codex', command: 'codex', path: '/home/u/.local/bin/codex' }
    ])
  })
  it('un agente que no está instalado no aparece', () => {
    expect(detectAgents()).toEqual([])
  })
})

describe('agentes propios', () => {
  it('se añade con su comando y argumentos, y luego aparece junto a los conocidos', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orches-agents-'))
    const path = exe(dir, 'mi-agente')
    expect(addCustomAgent('Mi agente', `${path} --modo "muy rapido"`)).toEqual({ ok: true, message: 'Agente «Mi agente» añadido' })
    expect(customAgents()).toEqual([{ name: 'Mi agente', command: path, args: ['--modo', 'muy rapido'] }])
    expect(detectAgents()).toEqual([{ name: 'Mi agente', command: path, path, args: ['--modo', 'muy rapido'], custom: true }])
    removeCustomAgent(path)
    expect(customAgents()).toEqual([])
  })
  it('se puede escribir solo el nombre del programa si está en el PATH', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orches-agents-'))
    installed.set('nuevo-ia', exe(dir, 'nuevo-ia'))
    expect(addCustomAgent('Nuevo', 'nuevo-ia').ok).toBe(true)
    expect(detectAgents()[0]).toMatchObject({ name: 'Nuevo', command: 'nuevo-ia', custom: true })
  })
  it('valida: comando vacío, nombre vacío, programa inexistente y repetidos', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orches-agents-'))
    const path = exe(dir, 'ok')
    expect(addCustomAgent('X', '   ').message).toContain('comando')
    expect(addCustomAgent('  ', path).message).toContain('nombre')
    expect(addCustomAgent('X', '/no/existe/agente').message).toContain('No se encontró')
    expect(addCustomAgent('A'.repeat(41), path).message).toContain('largo')
    expect(addCustomAgent('Uno', path).ok).toBe(true)
    expect(addCustomAgent('Dos', path).message).toContain('ya está')
    installed.set('claude', '/x/claude')
    expect(addCustomAgent('Mi Claude', 'claude').message).toContain('ya está')           // los conocidos no se duplican
  })
  it('un agente propio cuyo programa desapareció no se lista (ni rompe la detección)', () => {
    store.custom_agents = [{ name: 'Fantasma', command: '/ya/no/existe', args: [] }, { name: 'Roto' }, null]
    expect(detectAgents()).toEqual([])
  })
})

describe('ejecutables instalados por el usuario', () => {
  it('lista los de las carpetas del usuario, sin los ya conocidos, sin archivos no ejecutables ni carpetas del sistema', () => {
    const home = mkdtempSync(join(tmpdir(), 'orches-home-'))
    const bin = join(home, '.local', 'bin')
    const cargo = join(home, '.cargo', 'bin')
    mkdirSync(bin, { recursive: true })
    mkdirSync(cargo, { recursive: true })
    exe(bin, 'raro-agente')
    exe(bin, 'claude')                                       // conocido: ya aparece como agente
    writeFileSync(join(bin, 'notas.txt'), 'no ejecutable')   // sin permiso de ejecución
    mkdirSync(join(bin, 'subcarpeta'))
    exe(cargo, 'otro')
    symlinkSync(join(bin, 'raro-agente'), join(bin, 'enlace'))      // los enlaces cuentan
    const system = mkdtempSync(join(tmpdir(), 'orches-sys-'))
    exe(system, 'ls')                                        // fuera del home: es del sistema
    const found = candidateExecutables(home, [bin, cargo, system, ''].join(delimiter))
    expect(found.map((c) => c.name)).toEqual(['enlace', 'otro', 'raro-agente'])
  })
})

describe('resolver un ejecutable', () => {
  it('ruta absoluta existente y ejecutable; si no, null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orches-agents-'))
    expect(resolveExecutable(exe(dir, 'a'))).toBe(join(dir, 'a'))
    writeFileSync(join(dir, 'b'), 'x')
    expect(resolveExecutable(join(dir, 'b'))).toBeNull()               // sin permiso de ejecución
    expect(resolveExecutable(dir)).toBeNull()                          // una carpeta no es un ejecutable
  })
})
