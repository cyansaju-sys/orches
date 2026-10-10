/** Tema de la app: oscuro, claro o el del sistema. El resuelto va en <html data-theme> y los colores salen de variables CSS. */
export type ThemePref = 'dark' | 'light' | 'system'
export type ThemeMode = 'dark' | 'light'

const KEY = 'tutti-theme'          // copia en localStorage para pintar el tema correcto antes de leer los ajustes

export const isPref = (v: unknown): v is ThemePref => v === 'dark' || v === 'light' || v === 'system'

export function resolveTheme(pref: ThemePref): ThemeMode {
  if (pref !== 'system') return pref
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function cachedTheme(): ThemePref {
  try { const v = localStorage.getItem(KEY); return isPref(v) ? v : 'dark' } catch { return 'dark' }
}

export function cacheTheme(pref: ThemePref): void {
  try { localStorage.setItem(KEY, pref) } catch { /* sin almacenamiento: se usa el ajuste guardado */ }
}

export function paintTheme(mode: ThemeMode): void { document.documentElement.dataset.theme = mode }

/** Colores de la terminal (xterm no lee variables CSS). */
export const TERMINAL_THEMES: Record<ThemeMode, Record<string, string>> = {
  dark: {
    background: '#0d0f16', foreground: '#e6e8ef', cursor: '#8fa6c4', cursorAccent: '#0d0f16', selectionBackground: '#2c3a50',
    black: '#1a1d2b', red: '#ff6b81', green: '#7ee0a1', yellow: '#e2c08d', blue: '#82aaff', magenta: '#c792ea', cyan: '#4cc9b0', white: '#e6e8ef',
    brightBlack: '#6b7088', brightRed: '#ff8a9b', brightGreen: '#9bf0b9', brightYellow: '#f0d4a8', brightBlue: '#a3bdff',
    brightMagenta: '#d9b3f5', brightCyan: '#6fe0c9', brightWhite: '#ffffff'
  },
  light: {
    background: '#ffffff', foreground: '#1c2030', cursor: '#3f628f', cursorAccent: '#ffffff', selectionBackground: '#cddcf1',
    black: '#1c2030', red: '#c92c47', green: '#17803f', yellow: '#8f5f00', blue: '#1f5fd1', magenta: '#8250df', cyan: '#0f7f6f', white: '#646a80',
    brightBlack: '#646a80', brightRed: '#e0455f', brightGreen: '#1f9a4d', brightYellow: '#a87000', brightBlue: '#3a74e0',
    brightMagenta: '#9a66ea', brightCyan: '#1a9886', brightWhite: '#8a90a6'
  }
}
