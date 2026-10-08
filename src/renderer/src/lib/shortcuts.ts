/** Atajos globales: llevan Ctrl+Shift para no chocar con las teclas que usan los agentes y las shells. */
export const GLOBAL_KEYS = new Set(['N', 'T', 'W', 'B', 'L', 'E', 'A', 'G', 'X', 'U', 'Z'])

export function isGlobalShortcut(e: KeyboardEvent): boolean {
  if (e.key === 'F1') return true
  if (e.ctrlKey && !e.shiftKey && (e.key === 'PageUp' || e.key === 'PageDown')) return true
  return e.ctrlKey && e.shiftKey && !e.altKey && GLOBAL_KEYS.has(e.key.toUpperCase())
}

export const SECTIONS: Array<{ title: string; items: Array<[string, string]> }> = [
  { title: 'Archivos', items: [
    ['Ctrl + S', 'Guardar el archivo abierto'], ['Ctrl + W', 'Cerrar la pestaña del archivo'],
    ['Ctrl + Shift + L', 'Permitir o bloquear la edición de archivos'], ['Tab / Shift + Tab', 'Sangría al editar'],
    ['Ctrl + Espacio', 'Pedir sugerencias de autocompletado'], ['↑ ↓ · Enter o Tab · Esc', 'Elegir, aceptar o cerrar una sugerencia'],
    ['↑ ↓ ← → · Enter · Esc', 'Moverse por el árbol de archivos (tras pulsar uno)']
  ] },
  { title: 'Paneles', items: [
    ['Ctrl + Shift + N', 'Abrir un agente'], ['Ctrl + Shift + T', 'Mostrar u ocultar la terminal'],
    ['Ctrl + Shift + W', 'Cerrar el panel activo'], ['Ctrl + Av Pág / Re Pág', 'Panel siguiente / anterior']
  ] },
  { title: 'Barra lateral', items: [
    ['Ctrl + Shift + B', 'Mostrar u ocultar la barra lateral'], ['Ctrl + Shift + E', 'Archivos'], ['Ctrl + Shift + A', 'Agentes'],
    ['Ctrl + Shift + G', 'Git'], ['Ctrl + Shift + X', 'Servidores MCP'], ['Ctrl + Shift + U', 'Consumo e historial de IA'],
    ['Ctrl + Shift + Z', 'Extensiones']
  ] },
  { title: 'General', items: [['Ctrl + Shift + V', 'Pegar en la terminal'], ['F1', 'Esta ayuda']] }
]
