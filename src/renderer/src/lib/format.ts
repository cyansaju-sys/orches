import { t } from './i18n'

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} k`
  return String(n)
}

/** Duración corta: «5 min», «2 h 05 min», «3 d» (las abreviaturas valen en los dos idiomas). */
export function fmtDelta(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  if (minutes >= 24 * 60) return `${Math.floor(minutes / (24 * 60))} d`
  if (minutes >= 60) return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`
  return `${minutes} min`
}

export const ago = (ms: number, now = Date.now()): string => (now - ms < 90_000 ? t('time.now') : t('time.ago', { delta: fmtDelta(now - ms) }))

/** Color de una barra de uso según lo cerca que esté del límite. */
export const severity = (percent: number): 'danger' | 'warn' | 'accent' => (percent >= 85 ? 'danger' : percent >= 60 ? 'warn' : 'accent')

export const resumeArgs = (command: string, id: string): string[] | null =>
  command === 'claude' ? ['--resume', id] : command === 'opencode' ? ['--session', id] : command === 'agy' ? ['--conversation', id] : null
