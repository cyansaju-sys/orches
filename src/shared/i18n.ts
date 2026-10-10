/**
 * Textos de la interfaz: src/shared/locales/es.json y en.json (mismas claves; si falta una en inglés no compila).
 * `{nombre}` se sustituye por el valor de `vars`.
 */
import en from './locales/en.json'
import es from './locales/es.json'

export type Lang = 'es' | 'en'
export type LangPref = Lang | 'auto'
export type MsgKey = keyof typeof es
export type Vars = Record<string, string | number>

const TEXTS: Record<Lang, Record<MsgKey, string>> = { es, en }      // si a en.json le falta una clave de es.json, no compila

export const isLangPref = (v: unknown): v is LangPref => v === 'es' || v === 'en' || v === 'auto'

/** «auto» sigue al sistema: español si el idioma empieza por «es», inglés en cualquier otro caso. */
export const resolveLang = (pref: LangPref, locale: string): Lang => (pref !== 'auto' ? pref : locale.toLowerCase().startsWith('es') ? 'es' : 'en')

export function translate(lang: Lang, key: MsgKey, vars?: Vars): string {
  const text = TEXTS[lang][key]
  return vars ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m)) : text
}
