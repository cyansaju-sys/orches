import { clsx } from 'clsx'
import { MdClose, MdSearch, MdSmartToy, MdTerminal } from 'react-icons/md'
import { useStore, type Pane } from '@/store'
import { TerminalPane } from './TerminalPane'

export function PaneBox({ pane }: { pane: Pane }) {
  const active = useStore((s) => s.activePane === s.panes.find((p) => p.id === pane.id)?.id || s.activePane === pane.id)
  const set = useStore((s) => s.set)
  const closePane = useStore((s) => s.closePane)
  const leader = useStore((s) => pane.kind === 'agent' && s.panes.length > 1 && s.panes[0].id === pane.id)
  const parent = useStore((s) => (pane.parentId ? s.panes.find((p) => p.id === pane.parentId) : undefined))
  return (
    <div className="flex min-h-0 min-w-0 flex-col overflow-hidden" onMouseDown={() => set({ activePane: pane.id, focus: 'pane' })}>
      <div className={clsx('flex shrink-0 items-center gap-2 border-b-2 px-2.5 py-1 transition-colors', active ? 'border-accent bg-panel' : 'border-line')}>
        {pane.kind === 'agent' ? <MdSmartToy size={14} className="text-accent" /> : <MdTerminal size={14} className="text-accent" />}
        <span className={clsx('min-w-0 flex-1 truncate text-[12px]', active ? 'text-text' : 'text-muted')}>{pane.title}{leader && ' · líder'}</span>
        {pane.parentId && <span title={`Lo abrió ${parent?.title ?? pane.parentId}`} className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-medium text-accent">sub de {parent?.name ?? pane.parentId}</span>}
        <button title="Cerrar" onClick={(e) => { e.stopPropagation(); closePane(pane.id) }} className="grid size-5 place-items-center rounded text-muted transition-colors hover:bg-line hover:text-text">
          <MdClose size={13} />
        </button>
      </div>
      <TerminalPane pane={pane} active={active} />
    </div>
  )
}

export function AgentsArea() {
  const panes = useStore((s) => s.panes)
  const set = useStore((s) => s.set)
  // cuadrícula: 1-2 paneles en una fila, 3-4 en 2x2, 5-9 en 3 columnas...
  const cols = panes.length > 2 ? Math.ceil(Math.sqrt(panes.length)) : Math.max(panes.length, 1)

  return (
    <div className="min-h-0 min-w-[260px] flex-1 overflow-hidden rounded-lg border border-line bg-surface">
      {panes.length === 0 ? (
        <div className="grid h-full place-items-center">
          <div className="flex flex-col items-center gap-3">
            <MdSmartToy size={42} className="text-muted/70" />
            <p className="text-[12px] text-muted">Elige un agente para abrirlo aquí</p>
            <button onClick={() => set({ modal: 'agents' })} className="flex items-center gap-2 rounded-lg border border-line px-5 py-2.5 text-[13px] text-accent transition-colors hover:border-accent hover:bg-accent-bg">
              <MdSearch size={16} /> Elegir agente
            </button>
          </div>
        </div>
      ) : (
        <div className="grid h-full" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: 'minmax(0, 1fr)' }}>
          {panes.map((p) => <PaneBox key={p.id} pane={p} />)}
        </div>
      )}
    </div>
  )
}

/** La terminal es una sección aparte (con su propio borde), debajo del editor y los agentes, a todo el ancho. */
export function TerminalSection() {
  const shell = useStore((s) => s.shell)!
  const height = useStore((s) => s.shellHeight)
  return (
    <div style={{ height }} className="min-h-[140px] shrink-0 overflow-hidden rounded-lg border border-line bg-surface">
      <PaneBox pane={shell} />
    </div>
  )
}
