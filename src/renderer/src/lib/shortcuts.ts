import type { MsgKey } from '@shared/i18n'

/** Atajos globales: llevan Ctrl+Shift para no chocar con las teclas que usan los agentes y las shells. */
export const GLOBAL_KEYS = new Set(['N', 'T', 'W', 'B', 'L', 'E', 'A', 'G', 'X', 'U', 'K', 'F', 'H'])

export function isGlobalShortcut(e: KeyboardEvent): boolean {
  if (e.key === 'F1') return true
  if (e.ctrlKey && !e.shiftKey && (e.key === 'PageUp' || e.key === 'PageDown')) return true
  return e.ctrlKey && e.shiftKey && !e.altKey && GLOBAL_KEYS.has(e.key.toUpperCase())
}

export const SECTIONS: Array<{ title: MsgKey; items: Array<[string, MsgKey]> }> = [
  { title: 'sc.files', items: [
    ['Ctrl + S', 'sc.save'], ['Ctrl + W', 'sc.closeTab'],
    ['Ctrl + F', 'sc.find'], ['Ctrl + H', 'sc.replace'],
    ['Ctrl + Shift + L', 'sc.toggleEdit'], ['Tab / Shift + Tab', 'sc.indent'],
    ['key.ctrlSpace', 'sc.complete'], ['↑ ↓ · Enter / Tab · Esc', 'sc.suggest'],
    ['↑ ↓ ← → · Enter · Esc', 'sc.tree']
  ] },
  { title: 'sc.panels', items: [
    ['Ctrl + Shift + N', 'sc.openAgent'], ['Ctrl + Shift + T', 'sc.toggleTerminal'],
    ['Ctrl + Shift + W', 'sc.closePanel'], ['key.pageNav', 'sc.nextPanel']
  ] },
  { title: 'sc.sidebar', items: [
    ['Ctrl + Shift + B', 'sc.toggleSidebar'], ['Ctrl + Shift + E', 'tab.files'], ['Ctrl + Shift + F', 'sc.searchProject'], ['Ctrl + Shift + H', 'sc.replaceProject'], ['Ctrl + Shift + A', 'sc.agents'],
    ['Ctrl + Shift + G', 'sc.git'], ['Ctrl + Shift + K', 'sc.context'], ['Ctrl + Shift + X', 'sc.mcp'], ['Ctrl + Shift + U', 'sc.usage']
  ] },
  { title: 'sc.general', items: [['Ctrl + C / Ctrl + Shift + C', 'sc.copyTerminal'], ['Ctrl + V / Ctrl + Shift + V / Shift + Insert', 'sc.pasteAlt'], ['F1', 'sc.help']] }
]
