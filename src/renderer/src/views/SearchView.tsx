import { clsx } from 'clsx'
import { Fragment, useEffect, useRef, useState } from 'react'
import { MdChevronRight, MdExpandMore, MdFindReplace, MdMoreHoriz, MdUnfoldLess } from 'react-icons/md'
import type { SearchFile, SearchResult } from '@shared/types'
import { iconFor } from '@/lib/icons'
import { basename } from '@/lib/paths'
import { FIELD } from '@/components/ui'
import { useStore } from '@/store'

const dirOf = (rel: string): string => rel.split('/').slice(0, -1).join('/')

/** Opción de la búsqueda (Aa, «palabra», .*): botón de dos estados dentro del campo. */
function Toggle({ on, label, title, onClick }: { on: boolean; label: string; title: string; onClick: () => void }) {
  return (
    <button title={title} onClick={onClick}
      className={clsx('grid h-5 min-w-5 place-items-center rounded px-1 font-mono text-[10.5px] transition-colors', on ? 'bg-accent-bg text-accent' : 'text-muted hover:text-text')}>
      {label}
    </button>
  )
}

/** El trozo de línea con la coincidencia resaltada. */
function Line({ m }: { m: SearchFile['matches'][number] }) {
  const start = m.col - m.offset
  const lead = m.text.slice(0, start)
  return (
    <span className="truncate font-mono text-[11.5px] text-muted">
      {m.offset > 0 && '…'}{lead.trimStart()}
      <mark className="rounded-[2px] bg-accent/30 text-text">{m.text.slice(start, start + m.length)}</mark>
      {m.text.slice(start + m.length)}
    </span>
  )
}

export function SearchView() {
  const project = useStore((s) => s.project)
  const token = useStore((s) => s.searchToken)
  const openAt = useStore((s) => s.openAt)
  const wantReplace = useStore((s) => s.searchReplace)
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [replacement, setReplacement] = useState('')
  const [rerun, setRerun] = useState(0)
  const [query, setQuery] = useState('')
  const [include, setInclude] = useState('')
  const [exclude, setExclude] = useState('')
  const [caseSensitive, setCase] = useState(false)
  const [wholeWord, setWord] = useState(false)
  const [regex, setRegex] = useState(false)
  const [filters, setFilters] = useState(false)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [active, setActive] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const run = useRef(0)

  useEffect(() => { if (wantReplace) setReplaceOpen(true); input.current?.focus(); input.current?.select() }, [token])  // eslint-disable-line react-hooks/exhaustive-deps

  // busca al escribir (con un respiro) y descarta las respuestas que llegan tarde
  useEffect(() => {
    if (!project || !query) { setResult(null); setBusy(false); return }
    const id = ++run.current
    setBusy(true)
    const timer = setTimeout(() => {
      void window.api.search.run(project, { query, caseSensitive, wholeWord, regex, include, exclude })
        .then((r) => { if (id === run.current) { setResult(r); setClosed(new Set()) } })
        .catch(() => { if (id === run.current) setResult({ files: [], total: 0, truncated: false, error: 'La búsqueda falló' }) })
        .finally(() => { if (id === run.current) setBusy(false) })
    }, 250)
    return () => clearTimeout(timer)
  }, [project, query, caseSensitive, wholeWord, regex, include, exclude, rerun])

  if (!project) return <div className="p-4 text-[12px] text-muted">Abre un proyecto para buscar en sus archivos.</div>

  /** Reemplaza en los archivos dados. Los abiertos con cambios sin guardar se saltan: pisarían lo que escribiste. */
  const replace = async (files: SearchFile[]): Promise<void> => {
    if (!project || !files.length) return
    const { docs, toast, replaceDoc } = useStore.getState()
    const dirty = new Set(docs.filter((d) => d.text !== d.savedText).map((d) => d.path))
    const targets = files.filter((f) => !dirty.has(f.path))
    const count = targets.reduce((n, f) => n + f.matches.length, 0)
    if (!targets.length) { toast('Los archivos tienen cambios sin guardar: guárdalos antes de reemplazar', 'error'); return }
    if (!window.confirm(`¿Reemplazar ${count} coincidencias en ${targets.length} archivo${targets.length === 1 ? '' : 's'} por «${replacement}»?`)) return
    const r = await window.api.search.replace(project, { query, caseSensitive, wholeWord, regex }, replacement, targets.map((f) => f.path))
    if (r.error) { toast(r.error, 'error'); return }
    for (const f of targets) if (docs.some((d) => d.path === f.path)) void window.api.fs.read(f.path).then((data) => replaceDoc(f.path, data)).catch(() => undefined)
    toast(`${r.count} reemplazos en ${r.files} archivo${r.files === 1 ? '' : 's'}${dirty.size && targets.length < files.length ? ' (se saltaron los que tienen cambios sin guardar)' : ''}`, 'ok')
    setRerun((n) => n + 1)
  }

  const toggle = (path: string): void => setClosed((c) => { const n = new Set(c); if (!n.delete(path)) n.add(path); return n })

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-1.5 px-2 pb-2">
        <div className="flex items-start gap-1">
        <button title={replaceOpen ? 'Ocultar reemplazo' : 'Mostrar reemplazo (Ctrl+Shift+H)'} onClick={() => setReplaceOpen(!replaceOpen)} className="mt-1.5 text-muted hover:text-text">
          {replaceOpen ? <MdExpandMore size={16} /> : <MdChevronRight size={16} />}
        </button>
        <div className="min-w-0 flex-1 space-y-1.5">
        <div className="relative">
          <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar" spellCheck={false}
            onKeyDown={(e) => { if (e.key === 'Escape') setQuery('') }} className={clsx(FIELD, 'pr-[84px]')} />
          <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 gap-0.5">
            <Toggle on={caseSensitive} label="Aa" title="Distinguir mayúsculas" onClick={() => setCase(!caseSensitive)} />
            <Toggle on={wholeWord} label="ab" title="Palabra completa" onClick={() => setWord(!wholeWord)} />
            <Toggle on={regex} label=".*" title="Expresión regular" onClick={() => setRegex(!regex)} />
          </div>
        </div>
        {replaceOpen && (
          <div className="relative">
            <input value={replacement} onChange={(e) => setReplacement(e.target.value)} placeholder="Reemplazar" spellCheck={false}
              onKeyDown={(e) => { if (e.key === 'Enter' && result) void replace(result.files) }} className={clsx(FIELD, 'pr-8')} />
            <button title="Reemplazar todo" disabled={!result?.files.length} onClick={() => result && void replace(result.files)}
              className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-muted transition-colors hover:text-accent disabled:opacity-30 disabled:hover:text-muted">
              <MdFindReplace size={16} />
            </button>
          </div>
        )}
        </div>
        </div>
        <button onClick={() => setFilters(!filters)} title="Archivos a incluir y excluir" className="flex items-center gap-1 text-[10.5px] text-muted hover:text-text">
          <MdMoreHoriz size={14} />Filtros{(include || exclude) && <span className="size-1.5 rounded-full bg-accent" />}
        </button>
        {filters && (
          <>
            <input value={include} onChange={(e) => setInclude(e.target.value)} placeholder="Incluir: *.ts, src/**" spellCheck={false} className={FIELD} />
            <input value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder="Excluir: *.test.ts, docs/" spellCheck={false} className={FIELD} />
          </>
        )}
      </div>
      <div className="flex items-center justify-between px-3 pb-1 text-[10.5px] text-muted">
        <span>
          {result?.error ? <span className="text-danger">{result.error}</span>
            : busy && !result ? 'Buscando…'
            : result ? (result.total ? `${result.total}${result.truncated ? '+' : ''} resultados en ${result.files.length} archivos` : 'Sin resultados')
            : ''}
        </span>
        {result && result.files.length > 0 && <button title="Contraer todo" onClick={() => setClosed(new Set(result.files.map((f) => f.path)))} className="hover:text-text"><MdUnfoldLess size={14} /></button>}
      </div>
      <div className={clsx('min-h-0 flex-1 overflow-y-auto pb-2 transition-opacity', busy && result && 'opacity-60')}>
        {result?.files.map((f) => {
          const open = !closed.has(f.path)
          return (
            <Fragment key={f.path}>
              <button onClick={() => toggle(f.path)} className="flex w-full items-center gap-1 px-2 py-[3px] text-left text-[12px] hover:bg-white/[0.04]">
                {open ? <MdExpandMore size={15} className="shrink-0 text-muted" /> : <MdChevronRight size={15} className="shrink-0 text-muted" />}
                <img src={iconFor(basename(f.path))} alt="" className="size-4 shrink-0" draggable={false} />
                <span className="truncate">{basename(f.path)}</span>
                <span className="truncate text-[10.5px] text-muted">{dirOf(f.rel)}</span>
                {replaceOpen && <span title="Reemplazar en este archivo" onClick={(e) => { e.stopPropagation(); void replace([f]) }} className="ml-auto grid size-5 shrink-0 place-items-center rounded text-muted hover:text-accent"><MdFindReplace size={14} /></span>}
                <span className={clsx('shrink-0 rounded-full bg-white/[0.07] px-1.5 text-[10px] text-muted', !replaceOpen && 'ml-auto')}>{f.matches.length}</span>
              </button>
              {open && f.matches.map((m, i) => {
                const key = `${f.path}:${m.line}:${m.col}:${i}`
                return (
                  <button key={key} onClick={() => { setActive(key); void openAt(f.path, m.line, m.col, m.length) }}
                    className={clsx('flex w-full items-center gap-2 py-[2px] pl-8 pr-2 text-left hover:bg-white/[0.04]', active === key && 'bg-accent-bg')}>
                    <Line m={m} />
                  </button>
                )
              })}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}
