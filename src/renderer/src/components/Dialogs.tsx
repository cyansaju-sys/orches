import { clsx } from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { MdAdd, MdCallSplit, MdCloudQueue, MdSearch, MdSmartToy } from 'react-icons/md'
import type { GitBranch } from '@shared/types'
import { refreshGit } from '@/lib/gitSync'
import { SECTIONS } from '@/lib/shortcuts'
import { useStore } from '@/store'
import { Kbd, Modal } from './ui'

/** Coincidencia difusa: «clk» encuentra «Claude». */
const matches = (text: string, query: string): boolean => {
  const t = text.toLowerCase()
  let pos = 0
  for (const ch of query.toLowerCase()) { pos = t.indexOf(ch, pos) + 1; if (pos === 0) return false }
  return true
}

/** Lista con buscador y teclado: ↑↓ eligen, Enter acepta. `group` agrupa con títulos; `footer` va bajo la lista. */
function Palette<T>({ placeholder, items, label, render, onPick, empty, footer, group }: {
  placeholder: string; items: T[]; label: (i: T) => string; render: (i: T, active: boolean) => React.ReactNode
  onPick: (i: T, query: string) => void; empty: string; footer?: (query: string) => React.ReactNode; group?: (i: T) => string
}) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const shown = useMemo(() => items.filter((i) => matches(label(i), query)), [items, query])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => input.current?.focus(), [])
  useEffect(() => setIndex(0), [query])
  useEffect(() => { list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }) }, [index, shown])
  const key = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') { setIndex((i) => Math.min(i + 1, shown.length - 1)); e.preventDefault() }
    else if (e.key === 'ArrowUp') { setIndex((i) => Math.max(i - 1, 0)); e.preventDefault() }
    else if (e.key === 'Enter') { if (shown[index]) onPick(shown[index], query); else if (query) onPick(undefined as T, query) }
  }
  let lastGroup = ''
  return (
    <div>
      <div className="p-3 pb-2">
        <div className="flex items-center gap-2.5 rounded-xl bg-white/[0.04] px-3.5 transition-colors focus-within:bg-white/[0.07]">
          <MdSearch size={17} className={clsx('transition-colors', query ? 'text-accent' : 'text-muted')} />
          <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={key} placeholder={placeholder}
            spellCheck={false} className="h-10 flex-1 bg-transparent text-[13px] caret-accent outline-none placeholder:text-muted/80" />
          {query && <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-muted">{shown.length}</span>}
        </div>
      </div>
      <ul ref={list} className="max-h-[340px] overflow-y-auto px-2 pb-2">
        {shown.map((item, i) => {
          const g = group?.(item) ?? ''
          const heading = g && g !== lastGroup ? g : ''
          lastGroup = g || lastGroup
          const active = i === index
          return (
            <li key={label(item)}>
              {heading && <div className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted/80">{heading}</div>}
              <button data-active={active} onMouseMove={() => setIndex(i)} onClick={() => onPick(item, query)}
                className={clsx('relative flex w-full items-center gap-3 rounded-lg px-3 py-[7px] text-left text-[13px] transition-colors', active ? 'bg-accent/[0.16]' : 'hover:bg-white/[0.03]')}>
                <span className={clsx('absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-accent transition-opacity', active ? 'opacity-100' : 'opacity-0')} />
                {render(item, active)}
              </button>
            </li>
          )
        })}
        {shown.length === 0 && !footer && <li className="px-3 py-4 text-center text-[12px] text-muted">{empty}</li>}
      </ul>
      {footer?.(query)}
      <div className="flex items-center gap-4 border-t border-white/[0.06] bg-black/20 px-4 py-2 text-[10px] text-muted">
        <span><Kbd>↑↓</Kbd> navegar</span><span><Kbd>↵</Kbd> elegir</span><span><Kbd>esc</Kbd> cerrar</span>
      </div>
    </div>
  )
}

/** Ícono dentro de una pastilla cuadrada: da el mismo ritmo a todas las filas. */
const Chip = ({ active, children }: { active: boolean; children: React.ReactNode }) => (
  <span className={clsx('grid size-7 shrink-0 place-items-center rounded-md transition-colors', active ? 'bg-accent/15 text-accent' : 'bg-white/[0.04] text-muted')}>{children}</span>
)
const Tag = ({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'accent' }) => (
  <span className={clsx('ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium', tone === 'accent' ? 'bg-accent/15 text-accent' : 'bg-white/[0.05] text-muted')}>{children}</span>
)

export function AgentPicker() {
  const set = useStore((s) => s.set)
  const project = useStore((s) => s.project)
  const agents = useStore((s) => s.agents)
  const openAgent = useStore((s) => s.openAgent)
  useEffect(() => { void window.api.agents.detect().then((a) => set({ agents: a })) }, [set])
  return (
    <Modal onClose={() => set({ modal: null, focus: 'pane' })} width={480}>
      {!project ? (
        <p className="px-4 py-5 text-[12px] text-muted">Abre un proyecto primero (pestaña Archivos)</p>
      ) : (
        <Palette
          placeholder="Buscar agente…" items={agents} label={(a) => a.name} empty={agents.length ? 'Ningún agente coincide' : 'Sin agentes instalados'}
          render={(a, active) => (<><Chip active={active}><MdSmartToy size={15} /></Chip><span className="flex-1 truncate">{a.name}</span><Tag>{a.command}</Tag></>)}
          onPick={(a) => { if (a) void openAgent(a) }}
        />
      )}
    </Modal>
  )
}

export function BranchPicker() {
  const set = useStore((s) => s.set)
  const project = useStore((s) => s.project)!
  const toast = useStore((s) => s.toast)
  const [branches, setBranches] = useState<GitBranch[]>([])
  useEffect(() => { void window.api.git.branches(project).then(setBranches) }, [project])
  const done = async (error: string, ok: string): Promise<void> => {
    await refreshGit()
    if (error) toast(error, 'error'); else { toast(ok, 'ok'); set({ modal: null }) }
  }
  return (
    <Modal onClose={() => set({ modal: null })} width={460}>
      <Palette
        placeholder="Elige una rama o escribe el nombre de una nueva…" items={branches} label={(b) => b.name} empty=""
        group={(b) => (b.remote ? 'Remotas' : 'Locales')}
        render={(b, active) => (<><Chip active={active || b.current}>{b.remote ? <MdCloudQueue size={15} /> : <MdCallSplit size={15} />}</Chip>
          <span className={clsx('flex-1 truncate', b.current && 'font-semibold')}>{b.name}</span>{b.current && <Tag tone="accent">actual</Tag>}</>)}
        onPick={(b, query) => {
          if (b) { if (!b.current) void window.api.git.checkout(project, b.remote ? b.name : b.name, b.remote).then((e) => done(e, `Ahora en «${b.name}»`)) }
          else void window.api.git.createBranch(project, query.trim()).then((e) => done(e, `Rama «${query.trim()}» creada`))
        }}
        footer={(query) => (query.trim() && !branches.some((b) => b.name === query.trim())) ? (
          <button onClick={() => void window.api.git.createBranch(project, query.trim()).then((e) => done(e, `Rama «${query.trim()}» creada`))}
            className="mx-2 mb-2 flex w-[calc(100%-1rem)] items-center gap-3 rounded-lg border border-dashed border-accent/40 px-3 py-2 text-left text-[12px] text-accent transition-colors hover:bg-accent-bg/70">
            <Chip active><MdAdd size={15} /></Chip> Crear la rama «{query.trim()}»
          </button>) : null}
      />
    </Modal>
  )
}

export function ShortcutsDialog() {
  const set = useStore((s) => s.set)
  return (
    <Modal onClose={() => set({ modal: null })} width={560} title="Atajos de teclado">
      <div className="max-h-[60vh] overflow-y-auto px-4 pb-4">
        {SECTIONS.map((section) => (
          <section key={section.title} className="mt-3">
            <h3 className="pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">{section.title}</h3>
            {section.items.map(([keys, what]) => (
              <div key={keys} className="flex items-center justify-between gap-4 py-1.5">
                <span className="text-[12px]">{what}</span><Kbd>{keys}</Kbd>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  )
}
