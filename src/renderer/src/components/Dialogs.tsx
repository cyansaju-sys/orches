import { clsx } from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { MdAdd, MdCallSplit, MdCloudQueue, MdSearch, MdTerminal } from 'react-icons/md'
import type { AgentCandidate, GitBranch } from '@shared/types'
import { newSince, parseChangelog } from '@/lib/changelog'
import { refreshGit } from '@/lib/gitSync'
import { SECTIONS } from '@/lib/shortcuts'
import { useStore } from '@/store'
import { AgentIcon } from './AgentIcon'
import changelogText from '../../../../CHANGELOG.md?raw'
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
          render={(a, active) => (<><Chip active={active}><AgentIcon name={a.name} command={a.command} size={20} /></Chip><span className="flex-1 truncate">{a.name}</span><Tag>{a.command}</Tag></>)}
          onPick={(a) => { if (a) void openAgent(a) }}
          footer={() => (
            <button onClick={() => set({ modal: 'addAgent' })}
              className="mx-2 mb-2 flex w-[calc(100%-1rem)] items-center gap-3 rounded-lg border border-dashed border-line px-3 py-2 text-left text-[12px] text-muted transition-colors hover:border-accent/50 hover:bg-accent-bg/70 hover:text-accent">
              <Chip active={false}><MdAdd size={15} /></Chip> ¿No aparece el tuyo? Añadir otro agente…
            </button>)}
        />
      )}
    </Modal>
  )
}

const field = 'w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[12px] caret-accent outline-none transition-colors placeholder:text-muted/60 focus:border-accent/40 focus:bg-white/[0.045]'

/** Añadir un agente que la app no conoce: se escribe su comando o se elige uno de los ejecutables instalados. */
export function AddAgentDialog() {
  const set = useStore((s) => s.set)
  const toast = useStore((s) => s.toast)
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [filter, setFilter] = useState('')
  const [candidates, setCandidates] = useState<AgentCandidate[]>([])
  const [error, setError] = useState('')
  useEffect(() => { void window.api.agents.candidates().then(setCandidates) }, [])
  const shown = useMemo(() => candidates.filter((c) => matches(c.name, filter)).slice(0, 60), [candidates, filter])
  const pick = (c: AgentCandidate): void => {
    setCommand(c.name)
    if (!name.trim()) setName(c.name.charAt(0).toUpperCase() + c.name.slice(1))
    setError('')
  }
  const save = async (): Promise<void> => {
    const r = await window.api.agents.addCustom(name, command)
    if (!r.ok) { setError(r.message); return }
    set({ agents: await window.api.agents.detect(), modal: null })
    toast(r.message, 'ok')
  }
  return (
    <Modal onClose={() => set({ modal: null, focus: 'pane' })} width={500} title="Añadir agente">
      <div className="flex flex-col gap-3 px-4 pb-4">
        <p className="text-[12px] text-muted">Cualquier programa de terminal sirve. Escribe su comando (puede llevar argumentos) o elige uno de los instalados.</p>
        <div className="flex items-center gap-3">
          <AgentIcon name={name || '?'} command={command.trim().split(/\s+/)[0] || name || '?'} size={36} />
          <input className={field} placeholder="Nombre (p. ej. Mi agente)" value={name} onChange={(e) => { setName(e.target.value); setError('') }} spellCheck={false} />
        </div>
        <input className={field} placeholder="Comando: mi-agente --modo rapido" value={command} autoFocus
          onChange={(e) => { setCommand(e.target.value); setError('') }} onKeyDown={(e) => { if (e.key === 'Enter') void save() }} spellCheck={false} />
        <div>
          <input className={field} placeholder={`Buscar entre ${candidates.length} ejecutables instalados…`} value={filter} onChange={(e) => setFilter(e.target.value)} spellCheck={false} />
          <ul className="mt-1.5 max-h-[170px] overflow-y-auto rounded-lg bg-black/20 p-1">
            {shown.map((c) => (
              <li key={c.path}>
                <button onClick={() => pick(c)} title={c.path}
                  className={clsx('flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[12px] transition-colors hover:bg-accent-bg', command === c.name && 'bg-accent/15 text-accent')}>
                  <MdTerminal size={14} className="shrink-0 text-muted" /><span className="truncate">{c.name}</span>
                  <span className="ml-auto truncate pl-3 font-mono text-[10px] text-muted">{c.path.replace(/[\\/][^\\/]+$/, '')}</span>
                </button>
              </li>
            ))}
            {!shown.length && <li className="px-3 py-3 text-center text-[11px] text-muted">{candidates.length ? 'Ningún ejecutable coincide' : 'No se encontraron ejecutables en tus carpetas'}</li>}
          </ul>
        </div>
        {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={() => set({ modal: null, focus: 'pane' })} className="rounded-lg px-3 py-1.5 text-[12px] text-muted transition-colors hover:bg-white/[0.06]">Cancelar</button>
          <button onClick={() => void save()} disabled={!name.trim() || !command.trim()}
            className="rounded-lg bg-accent px-3.5 py-1.5 text-[12px] font-medium text-bg transition-colors hover:brightness-110 disabled:opacity-40">Añadir</button>
        </div>
      </div>
    </Modal>
  )
}

export function BranchPicker() {
  const set = useStore((s) => s.set)
  const project = useStore((s) => s.project)!
  const toast = useStore((s) => s.toast)
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [creating, setCreating] = useState<string | null>(null)       // nombre inicial del formulario de «nueva rama»; null = lista
  useEffect(() => { void window.api.git.branches(project).then(setBranches) }, [project])
  const done = async (error: string, ok: string): Promise<void> => {
    await refreshGit()
    if (error) toast(error, 'error'); else { toast(ok, 'ok'); set({ modal: null }) }
  }
  const close = (): void => set({ modal: null })
  if (creating !== null) {
    return (
      <Modal onClose={close} width={460} title="Nueva rama">
        <NewBranchForm initial={creating} branches={branches} project={project} onBack={() => setCreating(null)} onDone={done} />
      </Modal>
    )
  }
  return (
    <Modal onClose={close} width={460}>
      <Palette
        placeholder="Busca una rama…" items={branches} label={(b) => b.name} empty=""
        group={(b) => (b.remote ? 'Remotas' : 'Locales')}
        render={(b, active) => (<><Chip active={active || b.current}>{b.remote ? <MdCloudQueue size={15} /> : <MdCallSplit size={15} />}</Chip>
          <span className={clsx('flex-1 truncate', b.current && 'font-semibold')}>{b.name}</span>{b.current && <Tag tone="accent">actual</Tag>}</>)}
        onPick={(b, query) => {
          if (b) { if (!b.current) void window.api.git.checkout(project, b.name, b.remote).then((e) => done(e, `Ahora en «${b.name}»`)) }
          else if (query.trim()) setCreating(query.trim())              // sin coincidencias: se ofrece crearla
        }}
        footer={(query) => (
          <button onClick={() => setCreating(query.trim())}
            className="mx-2 mb-2 flex w-[calc(100%-1rem)] items-center gap-3 rounded-lg px-3 py-2 text-left text-[12px] text-muted transition-colors hover:bg-white/[0.04] hover:text-accent">
            <Chip active><MdAdd size={15} /></Chip>
            {query.trim() && !branches.some((b) => b.name === query.trim()) ? <>Crear la rama «{query.trim()}»…</> : <>Nueva rama…</>}
          </button>)}
      />
    </Modal>
  )
}

/** Formulario de «nueva rama»: nombre, rama de origen y si te cambias a ella. */
function NewBranchForm({ initial, branches, project, onBack, onDone }: {
  initial: string; branches: GitBranch[]; project: string; onBack: () => void; onDone: (error: string, ok: string) => Promise<void>
}) {
  const current = branches.find((b) => b.current)?.name ?? ''
  const [name, setName] = useState(initial.replace(/\s+/g, '-'))
  const [base, setBase] = useState(current)
  const [switchTo, setSwitchTo] = useState(true)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!base && current) setBase(current) }, [current, base])
  const valid = /^(?!-)[A-Za-z0-9._/-]+$/.test(name) && !name.includes('..') && !name.includes('//') && !/[/.]$/.test(name) && !name.endsWith('.lock')
  const taken = branches.some((b) => !b.remote && b.name === name)
  const create = async (): Promise<void> => {
    if (!valid || taken || busy) return
    setBusy(true)
    const error = await window.api.git.createBranch(project, name, base || undefined, switchTo)
    setBusy(false)
    await onDone(error, switchTo ? `Rama «${name}» creada y activa` : `Rama «${name}» creada`)
  }
  const field = 'w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[12px] caret-accent outline-none transition-colors placeholder:text-muted/60 focus:border-accent/40 focus:bg-white/[0.045]'
  return (
    <div className="flex flex-col gap-3 px-4 pb-4">
      <div>
        <div className="pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">Nombre</div>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void create() }} spellCheck={false} placeholder="feat/mi-rama" className={field} />
        {name && !valid && <p className="pt-1 text-[11px] text-danger">Nombre no válido: sin espacios, «..», ni empezar con «-» ni terminar en «/» o «.»</p>}
        {taken && <p className="pt-1 text-[11px] text-danger">Ya existe una rama con ese nombre</p>}
      </div>
      <div>
        <div className="pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">Crear desde</div>
        <select value={base} onChange={(e) => setBase(e.target.value)} className={`${field} appearance-none`}>
          {branches.map((b) => <option key={`${b.remote}${b.name}`} value={b.name} className="bg-[#0f121a]">{b.name}{b.current ? ' (actual)' : ''}{b.remote ? ' · remota' : ''}</option>)}
        </select>
      </div>
      <label className="flex cursor-pointer items-center gap-2.5 text-[12px]">
        <input type="checkbox" checked={switchTo} onChange={(e) => setSwitchTo(e.target.checked)} className="size-3.5 accent-[var(--color-accent)]" />
        Cambiarme a la rama nueva
      </label>
      <div className="flex justify-end gap-2">
        <button onClick={onBack} className="rounded-lg px-3 py-1.5 text-[12px] text-muted transition-colors hover:text-text">Volver</button>
        <button disabled={!valid || taken || busy} onClick={() => void create()} className="rounded-lg bg-accent px-4 py-1.5 text-[12px] font-medium text-bg transition-colors hover:brightness-110 disabled:opacity-50">{busy ? 'Creando…' : 'Crear rama'}</button>
      </div>
    </div>
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

/** Estructura mínima de **negrita** en las frases del changelog. */
const bold = (text: string): React.ReactNode[] =>
  text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i} className="font-semibold text-text">{part}</strong> : part))

/** Novedades de la versión instalada (o de todas las que se saltó el usuario). */
export function NewsDialog() {
  const set = useStore((s) => s.set)
  const since = useStore((s) => s.newsSince)
  const [version, setVersion] = useState('')
  useEffect(() => { void window.api.update.version().then(setVersion) }, [])
  const all = useMemo(() => parseChangelog(changelogText), [])
  const shown = useMemo(() => {
    if (!version) return []
    const list = since ? newSince(all, since, version) : all.filter((e) => e.version === version)
    return list.length ? list : all.slice(0, 1)
  }, [all, since, version])
  return (
    <Modal onClose={() => set({ modal: null })} width={520} title={`Novedades${version ? ` de v${version}` : ''}`}>
      <div className="max-h-[60vh] overflow-y-auto px-5 pb-4">
        {shown.map((entry) => (
          <section key={entry.version} className="mt-1">
            {shown.length > 1 && <h3 className="pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted">v{entry.version}</h3>}
            <ul className="flex flex-col gap-2">
              {entry.items.map((item, i) => <li key={i} className="flex gap-2 text-[12px] leading-snug text-muted"><span className="mt-[7px] size-1 shrink-0 rounded-full bg-accent" /><span>{bold(item)}</span></li>)}
            </ul>
          </section>
        ))}
        <div className="mt-4 flex justify-end">
          <button onClick={() => set({ modal: null })} className="rounded-md bg-accent px-4 py-1.5 text-[12px] font-medium text-bg transition-[filter] hover:brightness-110">Entendido</button>
        </div>
      </div>
    </Modal>
  )
}
