import { describe, expect, it } from 'vitest'
import { resolveLang, translate } from '../../src/shared/i18n'
import en from '../../src/shared/locales/en.json'
import es from '../../src/shared/locales/es.json'

const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('textos de la interfaz', () => {
  it('cada texto está en español e inglés, con las mismas variables', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort())
    for (const [key, text] of Object.entries(es)) {
      const english = (en as Record<string, string>)[key]
      expect(text.trim(), key).not.toBe('')
      expect(english.trim(), key).not.toBe('')
      expect(placeholders(english), key).toEqual(placeholders(text))
    }
  })

  it('sustituye las variables y deja intactas las que no se pasan', () => {
    expect(translate('es', 'app.updateAvailable', { v: '1.2.3' })).toBe('Hay una versión nueva: v1.2.3')
    expect(translate('en', 'app.updateAvailable', { v: '1.2.3' })).toBe('A new version is available: v1.2.3')
    expect(translate('en', 'app.updateAvailable')).toBe('A new version is available: v{v}')
  })

  it('«auto» sigue al idioma del sistema', () => {
    expect(resolveLang('auto', 'es-AR')).toBe('es')
    expect(resolveLang('auto', 'en-US')).toBe('en')
    expect(resolveLang('auto', 'fr-FR')).toBe('en')
    expect(resolveLang('es', 'en-US')).toBe('es')
  })
})
