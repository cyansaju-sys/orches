import { describe, expect, it } from 'vitest'
import { tier } from '../../../src/main/agents/models'

describe('nivel del modelo', () => {
  it.each([
    ['claude-haiku-4-5', 'basic', true], ['gpt-4o-mini', 'basic', true], ['gemini-2.0-flash', 'basic', true],
    ['claude-opus-4', 'advanced', true], ['gpt-5', 'advanced', true], ['claude-sonnet-4-5', 'standard', true],
    ['modelo-raro', 'standard', false], ['', 'standard', false]
  ])('%s -> %s', (model, level, known) => { expect(tier(model)).toEqual({ tier: level, known }) })

  it('sin modelo se asume intermedio y no reconocido', () => { expect(tier(null)).toEqual({ tier: 'standard', known: false }) })
})
