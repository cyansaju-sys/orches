/** Textos que el proceso principal muestra al usuario (avisos y errores): el idioma sale del ajuste `language`. */
import { app } from 'electron'
import { isLangPref, resolveLang, translate, type Lang, type MsgKey, type Vars } from '../shared/i18n'
import { getSetting } from './settings'

export function currentLang(): Lang {
  const pref = getSetting('language')
  let locale = 'es'
  try { locale = app.getLocale() } catch { /* fuera de Electron (pruebas) */ }
  return resolveLang(isLangPref(pref) ? pref : 'auto', locale)
}

export const tm = (key: MsgKey, vars?: Vars): string => translate(currentLang(), key, vars)
