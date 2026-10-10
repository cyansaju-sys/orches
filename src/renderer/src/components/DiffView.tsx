import { useT } from '@/lib/i18n'
import { clsx } from 'clsx'
import { useMemo } from 'react'
import { diffRows, hasChanges, type Row, type Side } from '@/lib/lineDiff'

const TINT = { del: 'bg-danger/[0.14]', add: 'bg-ok/[0.13]' }

function Cell({ side, tint, sign }: { side: Side | null; tint?: string; sign: string }) {
  return (
    <div className={clsx('flex min-w-0', side ? tint : 'bg-ov/[0.02]')}>
      <span className="w-10 shrink-0 select-none px-2 text-right text-muted/60">{side?.n ?? ''}</span>
      <span className="w-3 shrink-0 select-none text-muted/70">{side ? sign : ''}</span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{side?.text ?? ''}</span>
    </div>
  )
}

/** Comparación en dos columnas: a la izquierda lo anterior y a la derecha lo nuevo. */
export function DiffView({ before, after, label }: { before: string; after: string; label?: string }) {
  const t = useT()
  const rows = useMemo(() => diffRows(before, after), [before, after])
  const stats = useMemo(() => ({
    add: rows.filter((r) => r.kind === 'add' || r.kind === 'chg').length, del: rows.filter((r) => r.kind === 'del' || r.kind === 'chg').length
  }), [rows])

  if (!hasChanges(rows)) return <div className="grid flex-1 place-items-center text-[12px] text-muted">{t('diff.none')}{label ? ` (${label})` : ''}</div>
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-3 py-1 text-[10px] text-muted">
        {label && <span>{label}</span>}
        <span className="text-ok">+{stats.add}</span><span className="text-danger">−{stats.del}</span>
      </div>
      <div className="selectable min-h-0 flex-1 overflow-x-hidden overflow-y-auto font-mono text-[12px] leading-[1.5]">
        <div className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] divide-x divide-line">
          {rows.map((r: Row, i) => r.kind === 'fold' ? (
            <div key={i} className="col-span-2 select-none bg-ov/[0.03] px-3 py-0.5 text-center text-[11px] text-muted">{t('diff.unchanged', { n: r.count })}</div>
          ) : (
            <Pair key={i} row={r} />
          ))}
        </div>
      </div>
    </div>
  )
}

function Pair({ row }: { row: Exclude<Row, { kind: 'fold' }> }) {
  const del = row.kind === 'del' || row.kind === 'chg'
  const add = row.kind === 'add' || row.kind === 'chg'
  return (
    <>
      <Cell side={row.left} tint={del ? TINT.del : undefined} sign={del ? '−' : ''} />
      <Cell side={row.right} tint={add ? TINT.add : undefined} sign={add ? '+' : ''} />
    </>
  )
}
