/** Traducción en la interfaz: `useT()` en componentes (se repinta al cambiar de idioma) y `t()` fuera de ellos. */
import { translate, type MsgKey, type Vars } from '@shared/i18n'
import { useStore } from '@/store'

export type T = (key: MsgKey, vars?: Vars) => string
export function useT(): T {
  const lang = useStore((s) => s.lang)
  return (key, vars) => translate(lang, key, vars)
}
export const t: T = (key, vars) => translate(useStore.getState().lang, key, vars)
