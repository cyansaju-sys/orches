import { clsx } from 'clsx'
import { useEffect, useState } from 'react'
import { MdAdd, MdCheckCircle, MdClose, MdDeleteSweep, MdOpenInNew } from 'react-icons/md'
import type { TaskInfo } from '@shared/types'
import { AgentIcon } from '@/components/AgentIcon'
import { fmtDelta } from '@/lib/format'
import { useStore } from '@/store'

/** Duración con segundos mientras es corta (fmtDelta solo llega a minutos). */
const span = (ms: number): string => (ms < 60_000 ? `${Math.max(0, Math.floor(ms / 1000))} s` : fmtDelta(ms))

const SHOWN = 5
const BORDER = { working: 'border-accent', done: 'border-ok/60', closed: 'border-line' } as const
const STATUS = { working: ['Trabajando', 'text-accent'], done: ['Terminada', 'text-ok'], closed: ['Cerrada', 'text-muted'] } as const

/** Tareas que un agente delegó a otros: a quién, con qué modelo, cuánto lleva y si ya terminó. */
function Tasks() {
  const [tasks, setTasks] = useState<TaskInfo[]>([])
  const [now, setNow] = useState(Date.now())
  const [all, setAll] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)
  const panes = useStore((s) => s.panes)
  const set = useStore((s) => s.set)
  useEffect(() => {
    const load = (): void => { void window.api.orchestra.tasks().then((t) => { setTasks(t); setNow(Date.now()) }) }
    load()
    const timer = setInterval(load, 2000)
    return () => clearInterval(timer)
  }, [])
  if (!tasks.length) return null
  const finished = tasks.some((t) => t.status !== 'working')
  const running = tasks.filter((t) => t.status === 'working').length
  const shown = all ? tasks : tasks.slice(0, SHOWN)
  return (
    <div className="mt-2 flex flex-col gap-1 border-t border-line pt-2">
      <div className="flex items-center justify-between px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
        <span>Tareas delegadas{running > 0 && <span className="ml-1.5 rounded-full bg-accent/15 px-1.5 py-0.5 text-[9px] normal-case tracking-normal text-accent">{running} en curso</span>}</span>
        {finished && (
          <button onClick={() => void window.api.orchestra.clearTasks().then(() => setTasks((t) => t.filter((x) => x.status === 'working')))} title="Quitar las terminadas"
            className="grid size-6 place-items-center rounded-md transition-colors hover:bg-accent-bg hover:text-accent"><MdDeleteSweep size={15} /></button>
        )}
      </div>
      <ul className="flex flex-col gap-0.5 px-1.5">
        {shown.map((t) => {
          const [label, tone] = STATUS[t.status]
          const open = panes.some((p) => p.id === t.agentId)
          return (
            <li key={t.id} onClick={() => setExpanded(expanded === t.id ? null : t.id)}
              className={clsx('cursor-pointer rounded-md border-l-2 px-2.5 py-1.5 transition-colors hover:bg-accent-bg', BORDER[t.status])}>
              <div className="flex items-center gap-2 text-[12px]">
                <span className={clsx('flex shrink-0 items-center gap-1 text-[10px] font-medium', tone)}>
                  {t.status === 'working' ? <span className="size-2 animate-pulse rounded-full bg-accent" /> : <MdCheckCircle size={12} />}{label}
                </span>
                <span className="min-w-0 flex-1 truncate">{t.agent}</span>
                <span className="shrink-0 text-[10px] tabular-nums text-muted">{span((t.endedAt ?? now) - t.startedAt)}</span>
                {open && <button title="Ir a su panel" onClick={(e) => { e.stopPropagation(); set({ activePane: t.agentId, focus: 'pane' }) }} className="grid size-5 shrink-0 place-items-center rounded text-muted hover:text-accent"><MdOpenInNew size={12} /></button>}
              </div>
              <div className={clsx('mt-0.5 whitespace-pre-wrap break-words text-[11px] leading-snug text-muted', expanded !== t.id && 'line-clamp-2')}>{t.task}</div>
              <div className="mt-0.5 truncate text-[10px] text-muted/80">de {t.caller}{t.model ? ` · ${t.model}` : ''}{t.difficulty ? ` · ${t.difficulty}` : ''}</div>
            </li>
          )
        })}
      </ul>
      {tasks.length > SHOWN && (
        <button onClick={() => setAll(!all)} className="mx-1.5 rounded-md px-2.5 py-1 text-left text-[11px] text-muted transition-colors hover:bg-accent-bg hover:text-accent">
          {all ? 'Ver menos' : `Ver todas (${tasks.length})`}
        </button>
      )}
    </div>
  )
}

export function AgentsView() {
  const agents = useStore((s) => s.agents)
  const openAgent = useStore((s) => s.openAgent)
  const set = useStore((s) => s.set)
  const refresh = (): void => { void window.api.agents.detect().then((agents) => set({ agents })) }
  useEffect(refresh, [set])   // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async (command: string): Promise<void> => { await window.api.agents.removeCustom(command); refresh() }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between px-3 pt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
        Agentes
        <button onClick={() => set({ modal: 'addAgent' })} title="Añadir un agente que no aparece" className="grid size-6 place-items-center rounded-md text-muted transition-colors hover:bg-accent-bg hover:text-accent">
          <MdAdd size={15} />
        </button>
      </div>
      {!agents.length && <p className="px-3 py-2 text-[12px] text-muted">Sin agentes instalados. Si tienes uno que no aparece, pulsa + para añadirlo.</p>}
      <ul className="flex flex-col gap-0.5 px-1.5">
        {agents.map((a) => (
          <li key={a.command} className="group relative">
            <button onClick={() => void openAgent(a)} title={a.path} className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-accent-bg">
              <AgentIcon name={a.name} command={a.command} size={20} />
              {a.name}
              {a.custom && <span className="rounded-full bg-ov/[0.05] px-1.5 py-0.5 text-[9px] text-muted">propio</span>}
            </button>
            {a.custom && (
              <button onClick={() => void remove(a.command)} title="Quitar de la lista" className="absolute right-1.5 top-1/2 hidden size-6 -translate-y-1/2 place-items-center rounded-md text-muted hover:bg-[#3a1620] hover:text-danger group-hover:grid">
                <MdClose size={13} />
              </button>
            )}
          </li>
        ))}
      </ul>
      <Tasks />
    </div>
  )
}
