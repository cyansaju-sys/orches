import { describe, expect, it } from 'vitest'
import { joinSummary, numstatPath, opArgs, validBranchName } from '../../../src/main/git/git'

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

describe('resumen de archivos de un commit', () => {
  it('une estado y líneas, también con renombrados y binarios', () => {
    const names = 'M\tsrc/a.ts\nA\tsrc/b.ts\nR100\told/x.ts\tnew/x.ts\nM\timg.png\n'
    const stats = '4\t1\tsrc/a.ts\n10\t0\tsrc/b.ts\n0\t0\t{old => new}/x.ts\n-\t-\timg.png\n'
    expect(joinSummary(names, stats)).toEqual([
      { status: 'M', path: 'src/a.ts', added: 4, deleted: 1 },
      { status: 'A', path: 'src/b.ts', added: 10, deleted: 0 },
      { status: 'R', path: 'new/x.ts', added: 0, deleted: 0 },
      { status: 'M', path: 'img.png', added: 0, deleted: 0 }
    ])
  })
  it('numstatPath entiende las dos formas de renombrado', () => {
    expect(numstatPath('a/{b => c}/d.ts')).toBe('a/c/d.ts')
    expect(numstatPath('x.ts => y.ts')).toBe('y.ts')
    expect(numstatPath('plano.ts')).toBe('plano.ts')
  })
})

describe('nombres de rama', () => {
  it('acepta los habituales y rechaza los que git no admite', () => {
    for (const ok of ['feat/x', 'fix-1', 'release_1.2', 'a']) expect(validBranchName(ok)).toBe(true)
    for (const bad of ['', '-x', 'a b', 'a..b', 'a//b', 'x/', 'x.', 'x.lock', 'a~1', 'a:b']) expect(validBranchName(bad)).toBe(false)
  })
})
