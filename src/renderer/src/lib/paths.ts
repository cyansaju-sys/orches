export const sep = (p: string): string => (p.includes('\\') && !p.includes('/') ? '\\' : '/')
export const basename = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p
export const dirname = (p: string): string => p.replace(/[\\/][^\\/]*$/, '') || p
export function relative(root: string, path: string): string {
  const r = root.replace(/[\\/]+$/, '')
  return path.startsWith(r) ? path.slice(r.length).replace(/^[\\/]+/, '') : path
}
export const toPosix = (p: string): string => p.replace(/\\/g, '/')
export function crumbs(root: string | null, path: string): string[] {
  const rel = root ? relative(root, path) : path
  return toPosix(rel).split('/').filter(Boolean)
}
