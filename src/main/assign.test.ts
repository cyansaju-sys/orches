import { describe, expect, it } from 'vitest'
import { capableFor, pickAgent, type Candidate } from './assign'

const c = (patch: Partial<Candidate>): Candidate => ({ name: 'X', command: 'x', tier: 'standard', busy: false, ...patch })

describe('reparto según la capacidad', () => {
  it('qué dificultades asume cada nivel', () => {
    expect(capableFor({ tier: 'basic' })).toEqual(['easy'])
    expect(capableFor({ tier: 'standard' })).toEqual(['easy', 'medium'])
    expect(capableFor({ tier: 'advanced' })).toEqual(['easy', 'medium', 'hard'])
  })
  it('una tarea fácil va al más barato que sirva, no al avanzado', () => {
    const r = pickAgent([c({ id: 'a1', tier: 'advanced' }), c({ id: 'a2', tier: 'basic' })], 'easy')
    expect(r.chosen?.id).toBe('a2')
  })
  it('una tarea difícil exige nivel avanzado', () => {
    const r = pickAgent([c({ id: 'a1', tier: 'basic' }), c({ id: 'a2', tier: 'standard' }), c({ id: 'a3', tier: 'advanced' })], 'hard')
    expect(r.chosen?.id).toBe('a3')
  })
  it('prefiere uno libre y abierto antes que uno ocupado o por abrir', () => {
    expect(pickAgent([c({ id: 'a1', busy: true }), c({ id: 'a2' })], 'medium').chosen?.id).toBe('a2')
    expect(pickAgent([c({ command: 'codex' }), c({ id: 'a2' })], 'medium').chosen?.id).toBe('a2')
  })
  it('descarta al que agotó su límite y evita al que va justo', () => {
    expect(pickAgent([c({ id: 'a1', quota: 97 }), c({ id: 'a2', tier: 'advanced' })], 'medium').chosen?.id).toBe('a2')
    expect(pickAgent([c({ id: 'a1', quota: 85 }), c({ id: 'a2' })], 'medium').chosen?.id).toBe('a2')
  })
  it('si nadie llega al nivel, elige el más capaz y lo dice', () => {
    const r = pickAgent([c({ id: 'a1', tier: 'basic' }), c({ id: 'a2', tier: 'standard' })], 'hard')
    expect(r.chosen?.id).toBe('a2')
    expect(r.reason).toContain('ninguno llega')
  })
  it('sin candidatos válidos no elige a nadie', () => {
    expect(pickAgent([], 'easy').chosen).toBeNull()
    expect(pickAgent([c({ quota: 99 })], 'easy').chosen).toBeNull()
  })
})
