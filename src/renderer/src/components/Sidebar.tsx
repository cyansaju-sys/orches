import { clsx } from 'clsx'
import { sidebarIcon } from '@/lib/icons'
import { useStore, type SidebarTab } from '@/store'
import { AgentsView } from '@/views/AgentsView'
import { FilesView } from '@/views/FilesView'
import { GitView } from '@/views/GitView'
import { ContextView } from '@/views/ContextView'
import { McpView } from '@/views/McpView'
import { UsageView } from '@/views/UsageView'

export const TABS: Array<{ id: SidebarTab; icon: string; title: string; key: string }> = [
  { id: 'files', icon: 'files', title: 'Archivos', key: 'E' },
  { id: 'agents', icon: 'agents', title: 'Agentes', key: 'A' },
  { id: 'git', icon: 'git', title: 'Git', key: 'G' },
  { id: 'context', icon: 'context', title: 'Contexto del proyecto', key: 'K' },
  { id: 'mcp', icon: 'mcp', title: 'Servidores MCP', key: 'X' },
  { id: 'ai', icon: 'ai', title: 'Consumo e historial de IA', key: 'U' }
]

export function Sidebar() {
  const tab = useStore((s) => s.tab)
  const set = useStore((s) => s.set)
  const width = useStore((s) => s.sidebarWidth)
  const open = useStore((s) => s.sidebarOpen)
  const changes = useStore((s) => s.git?.files.length ?? 0)

  return (
    <div style={{ width: open ? width + 56 : 56 }} className={clsx('flex shrink-0 overflow-hidden rounded-lg border border-line bg-panel', !open && 'mr-1.5')}>
      <div className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-line py-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            title={`${t.title} (Ctrl+Shift+${t.key})`}
            onClick={() => set({ tab: t.id })}
            onDoubleClick={() => set({ tab: t.id, sidebarOpen: !open })}
            className={clsx('relative grid size-10 place-items-center rounded-md transition-colors hover:bg-accent-bg', tab === t.id && 'bg-accent-bg')}
          >
            <img src={sidebarIcon(t.icon)} alt="" className="size-6" draggable={false} />
            {t.id === 'git' && changes > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[9px] font-bold text-bg">
                {changes > 99 ? '99+' : changes}
              </span>
            )}
          </button>
        ))}
      </div>
      {open && <div className="min-w-0 flex-1 overflow-hidden pt-1.5">
        {tab === 'files' && <FilesView />}
        {tab === 'agents' && <AgentsView />}
        {tab === 'git' && <GitView />}
        {tab === 'context' && <ContextView />}
        {tab === 'mcp' && <McpView />}
        {tab === 'ai' && <UsageView />}
      </div>}
    </div>
  )
}
