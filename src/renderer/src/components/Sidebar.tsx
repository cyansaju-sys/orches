import { clsx } from 'clsx'
import { useState } from 'react'
import { MdCheck, MdSettings } from 'react-icons/md'
import { Menu } from '@/components/Menu'
import { sidebarIcon } from '@/lib/icons'
import { useStore, type SidebarTab } from '@/store'
import { AgentsView } from '@/views/AgentsView'
import { FilesView } from '@/views/FilesView'
import { GitView } from '@/views/GitView'
import { ContextView } from '@/views/ContextView'
import { SearchView } from '@/views/SearchView'
import { McpView } from '@/views/McpView'
import { UsageView } from '@/views/UsageView'

export const TABS: Array<{ id: SidebarTab; icon: string; title: string; key: string }> = [
  { id: 'files', icon: 'files', title: 'Archivos', key: 'E' },
  { id: 'search', icon: 'search', title: 'Buscar', key: 'F' },
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
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const [menu, setMenu] = useState<DOMRect | null>(null)
  const check = (on: boolean) => on ? <MdCheck size={15} /> : <span className="inline-block size-[15px]" />

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
        <button
          title="Ajustes"
          onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())}
          className={clsx('mt-auto grid size-10 place-items-center rounded-md text-muted transition-colors hover:bg-accent-bg hover:text-accent', menu && 'bg-accent-bg text-accent')}
        >
          <MdSettings size={22} />
        </button>
      </div>
      {menu && (
        <Menu width={210} anchor={menu} onClose={() => setMenu(null)} items={[
          { label: 'Tema oscuro', icon: check(theme === 'dark'), onClick: () => setTheme('dark') },
          { label: 'Tema claro', icon: check(theme === 'light'), onClick: () => setTheme('light') },
          { label: 'Automático (sistema)', icon: check(theme === 'system'), onClick: () => setTheme('system') }
        ]} />
      )}
      {open && <div className="min-w-0 flex-1 overflow-hidden pt-1.5">
        {tab === 'files' && <FilesView />}
        {tab === 'search' && <SearchView />}
        {tab === 'agents' && <AgentsView />}
        {tab === 'git' && <GitView />}
        {tab === 'context' && <ContextView />}
        {tab === 'mcp' && <McpView />}
        {tab === 'ai' && <UsageView />}
      </div>}
    </div>
  )
}
