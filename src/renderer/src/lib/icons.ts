/** Íconos de «Material Icon Theme» (MIT, https://github.com/material-extensions/vscode-material-icon-theme): los mismos de antes. */
const base = import.meta.env.BASE_URL

interface Theme {
  file: string; folder: string; folderExpanded: string
  fileNames: Record<string, string>; fileExtensions: Record<string, string>
  folderNames: Record<string, string>; folderNamesExpanded: Record<string, string>
}

let theme: Theme | null = null

export const iconUrl = (name: string): string => `${base}icons/material/${name}.svg`
export const sidebarIcon = (name: string): string => `${base}icons/sidebar/${name}.svg`

export async function loadIconTheme(): Promise<void> {
  if (theme) return
  theme = (await (await fetch(`${base}icons/material.json`)).json()) as Theme
}

/** SVG que corresponde a un archivo o carpeta. */
export function iconFor(fileName: string, isDir = false, expanded = false): string {
  if (!theme) return ''
  const name = fileName.toLowerCase()
  if (isDir) {
    const table = expanded ? theme.folderNamesExpanded : theme.folderNames
    return iconUrl(table[name] ?? (expanded ? theme.folderExpanded : theme.folder))
  }
  if (theme.fileNames[name]) return iconUrl(theme.fileNames[name])
  const parts = name.split('.')
  for (let i = 1; i < parts.length; i++) {           // extensiones compuestas primero: «foo.test.ts» -> «test.ts», luego «ts»
    const ext = parts.slice(i).join('.')
    if (theme.fileExtensions[ext]) return iconUrl(theme.fileExtensions[ext])
  }
  return iconUrl(theme.file)
}
