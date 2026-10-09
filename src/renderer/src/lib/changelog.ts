export interface ChangelogEntry { version: string; items: string[] }

/** Secciones `## x.y.z` de CHANGELOG.md, de la más nueva a la más antigua (el orden del archivo). */
export function parseChangelog(text: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = []
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const head = /^##\s+v?(\d+\.\d+\.\d+)/.exec(line)
    if (head) { entries.push({ version: head[1], items: [] }); continue }
    const item = /^[-*]\s+(.*\S)/.exec(line)
    if (item && entries.length) entries[entries.length - 1].items.push(item[1])
  }
  return entries
}

const parts = (v: string): number[] => v.split('.').map((n) => Number(n) || 0)
export function compareVersions(a: string, b: string): number {
  const x = parts(a), y = parts(b)
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}

/** Novedades de las versiones posteriores a `seen` y hasta `current` (las que se saltó el usuario también cuentan). */
export function newSince(entries: ChangelogEntry[], seen: string, current: string): ChangelogEntry[] {
  return entries.filter((e) => compareVersions(e.version, seen) > 0 && compareVersions(e.version, current) <= 0)
}
