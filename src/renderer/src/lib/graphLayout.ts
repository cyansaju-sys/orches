/** Reparto de los commits en «carriles» para dibujar el grafo de git (cada rama o línea de historia ocupa un carril). */
import type { GitCommit } from '@shared/types'

export interface Edge { lane: number; color: number }
export interface GraphRow {
  commit: GitCommit
  lane: number; color: number
  incoming: boolean     // hay una línea que llega desde arriba al commit (algún hijo suyo ya salió)
  through: Edge[]       // carriles que atraviesan la fila sin tocar el commit
  merges: Edge[]        // carriles que llegan desde arriba al commit (otras ramas que terminan aquí)
  parents: Edge[]       // carriles hacia los que sale el commit por abajo (sus padres)
}
export interface Graph { rows: GraphRow[]; lanes: number }

/** `commits` en orden de más nuevo a más viejo, con los padres de cada uno. */
export function layoutGraph(commits: GitCommit[]): Graph {
  const active: Array<string | null> = []        // por carril: el commit que se espera ver ahí
  const colors: number[] = []
  let nextColor = 0
  let lanes = 0
  const free = (): number => { const i = active.indexOf(null); return i >= 0 ? i : active.length }
  const claim = (lane: number, hash: string, color?: number): void => {
    active[lane] = hash
    colors[lane] = color ?? nextColor++
  }
  const rows: GraphRow[] = []

  for (const commit of commits) {
    const waiting = active.flatMap((h, i) => (h === commit.hash ? [i] : []))
    const lane = waiting.length ? waiting[0] : free()
    if (!waiting.length) claim(lane, commit.hash)
    const color = colors[lane]
    const merges = waiting.slice(1).map((i) => ({ lane: i, color: colors[i] }))
    const through: Edge[] = active.flatMap((h, i) => (h !== null && h !== commit.hash ? [{ lane: i, color: colors[i] }] : []))
    for (const i of waiting) { active[i] = null }           // este commit ya llegó: los carriles que lo esperaban se liberan

    const parents: Edge[] = []
    commit.parents.forEach((p, n) => {
      const existing = active.indexOf(p)
      if (existing >= 0) { parents.push({ lane: existing, color: colors[existing] }); return }
      const target = n === 0 ? lane : free()                // el primer padre sigue en el mismo carril; los demás abren uno
      claim(target, p, n === 0 ? color : undefined)
      parents.push({ lane: target, color: colors[target] })
    })
    while (active.length && active[active.length - 1] === null) { active.pop(); colors.pop() }
    lanes = Math.max(lanes, active.length, lane + 1, ...parents.map((e) => e.lane + 1), ...merges.map((e) => e.lane + 1), ...through.map((e) => e.lane + 1))
    rows.push({ commit, lane, color, incoming: waiting.length > 0, through, merges, parents })
  }
  return { rows, lanes: Math.max(1, lanes) }
}
