import { describe, expect, it } from 'vitest'
import { isNewer } from '../../src/main/version'

describe('versiones', () => {
  it.each([
    ['0.2.1', '0.2.0', true], ['v0.3.0', '0.2.9', true], ['1.0.0', '0.99.99', true], ['0.10.0', '0.9.0', true],     // 10 > 9, no por texto
    ['0.2.0', '0.2.0', false], ['0.2.0', '0.2.1', false], ['0.1.9', '0.2.0', false], ['0.2', '0.2.0', false], ['0.2.0.1', '0.2.0', true]
  ])('%s frente a %s', (a, b, expected) => { expect(isNewer(a, b)).toBe(expected) })
  it('ignora el sufijo de prelanzamiento', () => { expect(isNewer('0.2.0-alpha.1', '0.2.0')).toBe(false) })
})
