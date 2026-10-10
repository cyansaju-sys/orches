import { clsx } from 'clsx'
import { useState } from 'react'
import { Menu } from './Menu'
import { MdAdd, MdFullscreen, MdFullscreenExit, MdKeyboardArrowDown, MdMoreHoriz, MdClose, MdCreateNewFolder, MdFolderOpen, MdSearch, MdTerminal } from 'react-icons/md'
import { AgentIcon } from './AgentIcon'
import { useStore, type Pane } from '@/store'
import { Kbd } from './ui'
import { useT } from '@/lib/i18n'
import { TerminalPane } from './TerminalPane'

export function PaneBox({ pane }: { pane: Pane }) {
  const t = useT()
  const active = useStore((s) => s.activePane === s.panes.find((p) => p.id === pane.id)?.id || s.activePane === pane.id)
  const set = useStore((s) => s.set)
  const closePane = useStore((s) => s.closePane)
  const leader = useStore((s) => pane.kind === 'agent' && s.panes.length > 1 && s.panes[0].id === pane.id)
  const parent = useStore((s) => (pane.parentId ? s.panes.find((p) => p.id === pane.parentId) : undefined))
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden" onMouseDown={() => set({ activePane: pane.id, focus: 'pane' })}>
      <div className={clsx('flex shrink-0 items-center gap-2 border-b-2 px-2.5 py-1 transition-colors', active ? 'border-accent bg-panel' : 'border-line')}>
        {pane.kind === 'agent' ? <AgentIcon name={pane.name ?? pane.title} command={pane.command} size={16} /> : <MdTerminal size={14} className="text-accent" />}
        <span className={clsx('min-w-0 flex-1 truncate text-[12px]', active ? 'text-text' : 'text-muted')}>{pane.title}{leader && ` · ${t('pane.leader')}`}</span>
        {pane.parentId && <span title={t('pane.openedBy', { title: parent?.title ?? pane.parentId })} className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-medium text-accent">{t('pane.subOf', { name: parent?.name ?? pane.parentId })}</span>}
        <button title={t('pane.close')} onClick={(e) => { e.stopPropagation(); closePane(pane.id) }} className="grid size-5 place-items-center rounded text-muted transition-colors hover:bg-line hover:text-text">
          <MdClose size={13} />
        </button>
      </div>
      <TerminalPane pane={pane} active={active} />
    </div>
  )
}

export function AgentsArea() {
  const t = useT()
  const panes = useStore((s) => s.panes)
  const set = useStore((s) => s.set)
  const mode = useStore((s) => s.themeMode)
  const project = useStore((s) => s.project)
  const recentAll = useStore((s) => s.recentProjects)
  const recent = recentAll.filter((p) => p !== project)
  const setProject = useStore((s) => s.setProject)
  const removeRecent = useStore((s) => s.removeRecentProject)
  const openOther = async (): Promise<void> => {
    const picked = await window.api.dialog.chooseFolder(project ?? undefined)
    if (picked) setProject(picked)
  }
  // cuadrícula: 1-2 paneles en una fila, 3-4 en 2x2, 5-9 en 3 columnas...
  const cols = panes.length > 2 ? Math.ceil(Math.sqrt(panes.length)) : Math.max(panes.length, 1)

  return (
    <div className="min-h-0 min-w-[260px] flex-1 overflow-hidden rounded-lg border border-line bg-surface">
      {panes.length === 0 ? (
        <div className="flex h-full flex-col items-center overflow-y-auto px-6 py-8">
          <div className="my-auto flex w-full max-w-[780px] flex-wrap items-start justify-center gap-x-12 gap-y-8">
            <div className="flex w-[300px] max-w-full flex-col items-center">
              <img src={`${import.meta.env.BASE_URL}icons/empty-agents${mode === 'light' ? '-light' : ''}.svg`} alt="" width={72} height={72} draggable={false} />
              <p className="mt-3 text-[12px] text-muted">{t('pane.pickAgent')}</p>
              <button onClick={() => set({ modal: 'agents' })} className="mt-3 flex items-center gap-2 rounded-lg border border-line px-5 py-2.5 text-[13px] text-accent transition-colors hover:border-accent hover:bg-accent-bg">
                <MdSearch size={16} /> {t('pane.chooseAgent')}
              </button>

              <div className="mt-8 flex w-full flex-col gap-1.5 border-t border-line pt-4">
                {([['Ctrl + Shift + N', 'pane.hintOpenAgent'], ['Ctrl + Shift + T', 'pane.hintOpenTerminal'], ['Ctrl + Shift + B', 'pane.hintHideSidebar']] as const).map(([keys, what]) => (
                  <div key={keys} className="flex items-center justify-between gap-6 text-[11px] text-muted">
                    <span>{t(what)}</span><Kbd>{keys}</Kbd>
                  </div>
                ))}
              </div>
            </div>

            <div className="w-[380px] max-w-full">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted">{t('pane.projects')}</span>
                <button onClick={() => void openOther()} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-accent transition-colors hover:bg-accent-bg">
                  <MdCreateNewFolder size={14} /> {t('pane.openOther')}
                </button>
              </div>
              {recent.length === 0 ? (
                <p className="px-1 py-2 text-[11px] text-muted">{t('pane.projectsEmpty')}</p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {recent.map((path) => (
                    <div key={path} title={path} onClick={() => setProject(path)}
                      className="group flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-1.5 transition-colors hover:bg-accent-bg">
                      <MdFolderOpen size={18} className="shrink-0 text-accent" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] text-text">{path.split(/[\\/]/).filter(Boolean).pop() ?? path}</div>
                        <div className="truncate text-[10px] text-muted">{path}</div>
                      </div>
                      <button title={t('pane.removeRecent')} onClick={(e) => { e.stopPropagation(); removeRecent(path) }}
                        className="grid size-5 shrink-0 place-items-center rounded text-muted opacity-0 transition-colors hover:bg-line hover:text-text group-hover:opacity-100">
                        <MdClose size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
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

/** El panel de terminales (como el de VS Code): barra de acciones arriba a la derecha y, con varias, la lista de terminales al costado. */
export function TerminalSection() {
  const t = useT()
  const shells = useStore((s) => s.shells)
  const active = useStore((s) => s.shellActive)
  const max = useStore((s) => s.shellMax)
  const height = useStore((s) => s.shellHeight)
  const set = useStore((s) => s.set)
  const addShell = useStore((s) => s.addShell)
  const closePane = useStore((s) => s.closePane)
  const closeShells = useStore((s) => s.closeShells)
  const [menu, setMenu] = useState<{ anchor: DOMRect; kind: 'new' | 'more' } | null>(null)
  const open = (kind: 'new' | 'more') => (e: React.MouseEvent<HTMLButtonElement>): void => {
    const r = e.currentTarget.getBoundingClientRect()
    setMenu({ kind, anchor: new DOMRect(r.left, r.bottom, 200, 0) })
  }
  const activePane = useStore((s) => s.activePane)
  return (
    <div style={max ? undefined : { height }} className={clsx('flex min-h-[140px] overflow-hidden rounded-lg border border-line bg-surface', max ? 'absolute inset-0 z-10' : 'shrink-0')}>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between px-2.5 py-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted">{t('term.title')}</span>
          <div className="flex items-center gap-0.5">
            <button title={t('term.new')} onClick={() => void addShell()} className="grid size-6 place-items-center rounded text-muted transition-colors hover:bg-line hover:text-text"><MdAdd size={16} /></button>
            <button title={t('term.newOptions')} onClick={open('new')} className="grid h-6 w-4 place-items-center rounded text-muted transition-colors hover:bg-line hover:text-text"><MdKeyboardArrowDown size={14} /></button>
            <button title={t('term.moreActions')} onClick={open('more')} className="grid size-6 place-items-center rounded text-muted transition-colors hover:bg-line hover:text-text"><MdMoreHoriz size={16} /></button>
            <button title={max ? t('term.restore') : t('term.maximize')} onClick={() => set({ shellMax: !max })} className="grid size-6 place-items-center rounded text-muted transition-colors hover:bg-line hover:text-text">
              {max ? <MdFullscreenExit size={15} /> : <MdFullscreen size={15} />}
            </button>
            <button title={t('term.closePanel')} onClick={closeShells} className="grid size-6 place-items-center rounded text-muted transition-colors hover:bg-line hover:text-text"><MdClose size={15} /></button>
          </div>
        </div>
        <div className="relative min-h-0 flex-1">
          {shells.map((p) => (
            <div key={p.id} className={clsx('absolute inset-0 flex flex-col', p.id !== active && 'invisible pointer-events-none')}
              onMouseDown={() => set({ shellActive: p.id, activePane: p.id, focus: 'pane' })}>
              <TerminalPane pane={p} active={p.id === active && activePane === p.id} />
            </div>
          ))}
        </div>
      </div>
      {shells.length > 1 && (
        <div className="flex w-[140px] shrink-0 flex-col gap-px border-l border-line p-1 pt-2">
          {shells.map((p) => (
            <div key={p.id} onClick={() => set({ shellActive: p.id, activePane: p.id, focus: 'pane' })}
              className={clsx('group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[12px] transition-colors', p.id === active ? 'bg-accent-bg text-text' : 'text-muted hover:bg-accent-bg')}>
              <MdTerminal size={14} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{p.title}</span>
              <button title={t('term.closeThis')} onClick={(e) => { e.stopPropagation(); closePane(p.id) }}
                className="grid size-4 shrink-0 place-items-center rounded opacity-0 transition-colors hover:bg-line group-hover:opacity-100"><MdClose size={12} /></button>
            </div>
          ))}
        </div>
      )}
      {menu && (
        <Menu width={200} anchor={menu.anchor} onClose={() => setMenu(null)} items={menu.kind === 'new'
          ? [{ label: t('term.new'), icon: <MdAdd size={15} />, onClick: () => void addShell() }]
          : [{ label: t('term.closeAll'), icon: <MdClose size={15} />, onClick: closeShells, danger: true }]} />
      )}
    </div>
  )
}
