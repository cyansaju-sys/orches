import { describe, expect, it } from 'vitest'
import type { GitCommit } from '@shared/types'
import { layoutGraph } from './graphLayout'

const c = (hash: string, ...parents: string[]): GitCommit => ({ hash, parents, author: 'a', time: 0, refs: [], subject: hash })

describe('grafo de git', () => {
  it('una historia lineal usa un solo carril', () => {
    const g = layoutGraph([c('c', 'b'), c('b', 'a'), c('a')])
    expect(g.lanes).toBe(1)
    expect(g.rows.map((r) => r.lane)).toEqual([0, 0, 0])
    expect(g.rows[2].parents).toEqual([])
  })
  it('una rama que se une abre un segundo carril y las dos líneas se juntan en el ancestro', () => {
    // m = merge de (b, f); f sale de a
    const g = layoutGraph([c('m', 'b', 'f'), c('f', 'a'), c('b', 'a'), c('a')])
    expect(g.lanes).toBe(2)
    expect(g.rows[0].parents.map((e) => e.lane)).toEqual([0, 1])
    expect(g.rows[1].lane).toBe(1)                      // f vive en el carril 1
    expect(g.rows[2].lane).toBe(0)
    expect(g.rows[2].through.map((e) => e.lane)).toEqual([1])   // mientras tanto el carril 1 sigue pasando
    expect(g.rows[2].parents.map((e) => e.lane)).toEqual([1])   // b se une a la línea que ya esperaba a `a`
    expect(g.rows[3].lane).toBe(1)
  })
  it('dos ramas que no se tocan quedan en carriles distintos', () => {
    const g = layoutGraph([c('x', 'a'), c('y', 'b'), c('a'), c('b')])
    expect(g.rows[0].lane).toBe(0)
    expect(g.rows[1].lane).toBe(1)
    expect(g.lanes).toBe(2)
  })
  it('sin commits hay al menos un carril', () => {
    expect(layoutGraph([]).lanes).toBe(1)
  })
})
