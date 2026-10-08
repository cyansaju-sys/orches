/** Comparación línea a línea en dos columnas (original | nuevo), con los tramos sin cambios plegados. */
export interface Side { n: number; text: string }
export type Row =
  | { kind: 'same'; left: Side; right: Side }
  | { kind: 'del'; left: Side; right: null }
  | { kind: 'add'; left: null; right: Side }
  | { kind: 'chg'; left: Side; right: Side }
  | { kind: 'fold'; count: number }

const MAX_CELLS = 4_000_000          // tope de la tabla de coincidencias: si no cabe, el tramo se da por reemplazado

const lines = (text: string): string[] => (text === '' ? [] : text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n'))

/** Operaciones entre dos listas de líneas: '=' igual, '-' sólo en el original, '+' sólo en el nuevo. */
function ops(a: string[], b: string[]): Array<'=' | '-' | '+'> {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length, endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB-- }
  const out: Array<'=' | '-' | '+'> = Array(start).fill('=')
  const x = a.slice(start, endA), y = b.slice(start, endB)
  if (!x.length || !y.length || (x.length + 1) * (y.length + 1) > MAX_CELLS) {
    out.push(...Array<'-'>(x.length).fill('-'), ...Array<'+'>(y.length).fill('+'))
  } else {
    // tabla del mayor tramo común, de atrás hacia delante
    const w = y.length + 1
    const t = new Uint32Array((x.length + 1) * w)
    for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) {
      t[i * w + j] = x[i] === y[j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1])
    }
    let i = 0, j = 0
    while (i < x.length && j < y.length) {
      if (x[i] === y[j]) { out.push('='); i++; j++ }
      else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) { out.push('-'); i++ }
      else { out.push('+'); j++ }
    }
    while (i < x.length) { out.push('-'); i++ }
    while (j < y.length) { out.push('+'); j++ }
  }
  out.push(...Array<'='>(a.length - endA).fill('='))
  return out
}

/** Filas de la vista en dos columnas. `context` = líneas sin cambios que se dejan alrededor de cada cambio. */
export function diffRows(before: string, after: string, context = 3): Row[] {
  const a = lines(before), b = lines(after)
  const rows: Row[] = []
  let i = 0, j = 0, k = 0
  const list = ops(a, b)
  while (k < list.length) {
    if (list[k] === '=') { rows.push({ kind: 'same', left: { n: i + 1, text: a[i] }, right: { n: j + 1, text: b[j] } }); i++; j++; k++; continue }
    const del: Side[] = [], add: Side[] = []
    while (k < list.length && list[k] !== '=') {
      if (list[k] === '-') del.push({ n: i + 1, text: a[i++] })
      else add.push({ n: j + 1, text: b[j++] })
      k++
    }
    for (let r = 0; r < Math.max(del.length, add.length); r++) {          // lo borrado y lo añadido se emparejan fila a fila
      const l = del[r], rt = add[r]
      rows.push(l && rt ? { kind: 'chg', left: l, right: rt } : l ? { kind: 'del', left: l, right: null } : { kind: 'add', left: null, right: rt })
    }
  }
  return fold(rows, context)
}

function fold(rows: Row[], context: number): Row[] {
  const keep = new Array<boolean>(rows.length).fill(false)
  rows.forEach((r, idx) => {
    if (r.kind !== 'same') for (let d = -context; d <= context; d++) if (idx + d >= 0 && idx + d < rows.length) keep[idx + d] = true
  })
  const out: Row[] = []
  let hidden = 0
  rows.forEach((r, idx) => {
    if (keep[idx]) { if (hidden) out.push({ kind: 'fold', count: hidden }); hidden = 0; out.push(r) } else hidden++
  })
  if (hidden && out.length) out.push({ kind: 'fold', count: hidden })
  return out
}

export const hasChanges = (rows: Row[]): boolean => rows.some((r) => r.kind !== 'same' && r.kind !== 'fold')
