/** Idioma elegido: copia local para pintarlo bien desde el primer momento (sin depender del store). */
import { isLangPref, resolveLang, type Lang, type LangPref } from '@shared/i18n'

const KEY = 'tutti-lang'

export function cachedLangPref(): LangPref {
  try { const v = localStorage.getItem(KEY); return isLangPref(v) ? v : 'auto' } catch { return 'auto' }
}
export function cacheLangPref(pref: LangPref): void {
  try { localStorage.setItem(KEY, pref) } catch { /* sin almacenamiento: se usa el ajuste guardado */ }
}
export const resolveLangPref = (pref: LangPref): Lang => resolveLang(pref, navigator.language || 'en')
