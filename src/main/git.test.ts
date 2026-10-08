import { describe, expect, it } from 'vitest'
import { opArgs } from './git'

const H = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

describe('operaciones sobre un commit', () => {
  it('arma los comandos', () => {
    expect(opArgs('tag', H, 'v1.0')).toEqual(['tag', 'v1.0', H])
    expect(opArgs('branch', H, 'feat/x')).toEqual(['branch', 'feat/x', H])
    expect(opArgs('checkout', H)).toEqual(['checkout', H])
    expect(opArgs('merge', H)).toEqual(['merge', '--no-edit', H])
    expect(opArgs('merge', H, 'noff')).toEqual(['merge', '--no-ff', '--no-edit', H])
    expect(opArgs('merge', H, 'noff,nocommit')).toEqual(['merge', '--no-ff', '--no-commit', H])
    expect(opArgs('merge', H, 'noff,squash')).toEqual(['merge', '--squash', H])
    expect(opArgs('merge', H, '--x')).toBeNull()
    expect(opArgs('reset-hard', H)).toEqual(['reset', '--hard', H])
  })
  it('en un merge, cherry-pick y revert indican el padre', () => {
    expect(opArgs('cherry-pick', H, '', true)).toEqual(['cherry-pick', '-m', '1', H])
    expect(opArgs('revert', H, '', true)).toEqual(['revert', '--no-edit', '-m', '1', H])
    expect(opArgs('revert', H)).toEqual(['revert', '--no-edit', H])
  })
  it('rechaza hashes y nombres peligrosos', () => {
    expect(opArgs('checkout', '--upload-pack=x')).toBeNull()
    expect(opArgs('checkout', 'abc')).toBeNull()
    for (const bad of ['', '-f', 'a b', 'a..b', 'rama/', 'x;rm']) expect(opArgs('branch', H, bad)).toBeNull()
  })
})
