import { clsx } from 'clsx'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MdContentCopy, MdCreateNewFolder, MdDeleteOutline, MdDriveFileRenameOutline, MdFolderOpen, MdLink, MdNoteAdd, MdRefresh, MdSend, MdUnfoldLess } from 'react-icons/md'
import type { DirEntry } from '@shared/types'
import { Menu } from '@/components/Menu'
import { FIELD, Modal } from '@/components/ui'
import { GIT_COLOR } from '@/lib/gitSync'
import { iconFor } from '@/lib/icons'
import { basename, relative, toPosix } from '@/lib/paths'
import { agentRef } from '@/lib/agentRef'
import { useT } from '@/lib/i18n'
import { useStore } from '@/store'

const dirname = (p: string): string => p.replace(/[\\/][^\\/]*$/, '')

interface Row { entry: DirEntry; depth: number }
/** Diálogo pendiente: pedir un nombre (crear / renombrar) o confirmar un borrado. */
type Ask =
  | { kind: 'create'; dir: string; isDir: boolean }
  | { kind: 'rename'; entry: DirEntry }
  | { kind: 'delete'; entry: DirEntry }

export function FilesView() {
  const t = useT()
  const project = useStore((s) => s.project)
  const git = useStore((s) => s.git)
  const setProject = useStore((s) => s.setProject)
  const openDoc = useStore((s) => s.openDoc)
  const set = useStore((s) => s.set)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [children, setChildren] = useState<Record<string, DirEntry[]>>({})
  const [ignored, setIgnored] = useState<Set<string>>(new Set())
  const [cursor, setCursor] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ entry: DirEntry; anchor: DOMRect } | null>(null)
  const [rootMenu, setRootMenu] = useState<DOMRect | null>(null)      // clic en un espacio vacío: crear en la raíz del proyecto
  const toast = useStore((s) => s.toast)
  const [ask, setAsk] = useState<Ask | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const creating = ask?.kind === 'create' ? ask : null

  const load = useCallback(async (dir: string) => {
    const entries = await window.api.fs.list(dir)
    setChildren((c) => ({ ...c, [dir]: entries }))
    if (project) {
      const hit = await window.api.git.ignored(project, entries.map((e) => e.path))
      setIgnored((prev) => new Set([...prev, ...hit]))
    }
  }, [project])

  // al cambiar de proyecto se empieza de cero
  useEffect(() => { setExpanded(new Set()); setChildren({}); setIgnored(new Set()); setCursor(null); if (project) void load(project) }, [project])  // eslint-disable-line react-hooks/exhaustive-deps
  // las carpetas abiertas se releen cuando cambia git y cada pocos segundos
  const reload = useCallback(() => { if (project) { void load(project); expanded.forEach((d) => void load(d)) } }, [project, expanded, load])
  useEffect(() => { const t = setInterval(reload, 5000); return () => clearInterval(t) }, [reload])
  useEffect(() => { reload() }, [git?.files.length])  // eslint-disable-line react-hooks/exhaustive-deps

  const status = useMemo(() => {
    const map = new Map<string, string>()
    if (project && git) for (const f of git.files) {
      map.set(toPosix(f.path), f.code)
      const parts = toPosix(f.path).split('/')
      for (let i = 1; i < parts.length; i++) map.set(parts.slice(0, i).join('/'), '●')       // carpetas: un punto
    }
    return map
  }, [project, git])

  const rows = useMemo(() => {
    const out: Row[] = []
    const walk = (dir: string, depth: number): void => {
      for (const entry of children[dir] ?? []) {
        out.push({ entry, depth })
        if (entry.isDir && expanded.has(entry.path)) walk(entry.path, depth + 1)
      }
    }
    if (project) walk(project, 0)
    return out
  }, [project, children, expanded])

  const toggle = (path: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else { next.add(path); void load(path) }
      return next
    })
  }

  const activate = (row: Row): void => {
    setCursor(row.entry.path)
    set({ focus: 'tree' })
    if (row.entry.isDir) toggle(row.entry.path)
    else void openDoc(row.entry.path)
  }

  /** Crea dentro de `dir`: se abre la carpeta y el campo de nombre aparece en el propio árbol. */
  const startCreate = (dir: string, isDir: boolean): void => {
    if (dir !== project) { setExpanded((p) => new Set(p).add(dir)); void load(dir) }
    setAsk({ kind: 'create', dir, isDir })
  }

  const copy = (text: string): void => { navigator.clipboard.writeText(text).catch(() => toast(t('fs.copyFailed'), 'error')) }

  /** Escribe la ruta en el agente activo (sin Enter, para que el usuario siga escribiendo). */
  const sendToAgent = (entry: DirEntry): void => {
    const { panes, activePane } = useStore.getState()
    const pane = panes.find((p) => p.id === activePane && p.kind === 'agent') ?? panes.find((p) => p.kind === 'agent')
    if (!pane) { toast(t('fs.noAgent'), 'error'); return }
    window.api.pty.write(pane.id, agentRef(pane.command, toPosix(relative(project!, entry.path))) + ' ')
    set({ activePane: pane.id, focus: 'pane' })
  }

  const run = async (job: Promise<{ ok: boolean; message: string }>, after: (message: string) => void): Promise<void> => {
    const res = await job
    if (!res.ok) { toast(res.message, 'error'); return }
    after(res.message)
    reload()
  }
  const confirmAsk = async (value: string): Promise<void> => {
    if (!ask) return
    const current = ask
    setAsk(null)
    if (current.kind === 'create') {
      await run(window.api.fs.create(current.dir, value, current.isDir), (path) => {
        setExpanded((p) => new Set(p).add(current.dir)); void load(current.dir)
        if (!current.isDir) void openDoc(path)
      })
    } else if (current.kind === 'rename') {
      await run(window.api.fs.rename(current.entry.path, value), (to) => { useStore.getState().renameDocs(current.entry.path, to); setCursor(to) })
    } else {
      await run(window.api.fs.trash(current.entry.path), () => useStore.getState().dropDocs(current.entry.path))
    }
  }

  // navegación con el teclado: ↑↓ mueven la selección, → abre, ← cierra o sube, Enter abre, Esc devuelve el teclado a la terminal
  const onKeyDown = (e: React.KeyboardEvent): void => {
    const menuKey = e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')
    if (e.ctrlKey || e.altKey || e.metaKey) return
    if (menuKey) {          // la tecla de menú abre el de la fila marcada (la que sigue al ratón), no la que tenga el foco del navegador
      const target = rows.find((r) => r.entry.path === cursor)
      const el = target && [...e.currentTarget.querySelectorAll('button[title]')].find((b) => b.getAttribute('title') === target.entry.path)
      if (target && el) { const r = el.getBoundingClientRect(); setMenu({ entry: target.entry, anchor: new DOMRect(r.left + 24 + 190, r.bottom, 0, 0) }); e.preventDefault() }
      return
    }
    const i = rows.findIndex((r) => r.entry.path === cursor)
    const current = rows[i]
    const go = (n: number): void => { const r = rows[Math.max(0, Math.min(rows.length - 1, n))]; if (r) setCursor(r.entry.path) }
    switch (e.key) {
      case 'ArrowDown': go(i + 1); break
      case 'ArrowUp': go(i < 0 ? 0 : i - 1); break
      case 'ArrowRight':
        if (current?.entry.isDir && !expanded.has(current.entry.path)) toggle(current.entry.path)
        else if (current?.entry.isDir) go(i + 1)
        break
      case 'ArrowLeft':
        if (current?.entry.isDir && expanded.has(current.entry.path)) toggle(current.entry.path)
        else if (current) { const parent = rows.slice(0, i).reverse().find((r) => r.depth < current.depth); if (parent) setCursor(parent.entry.path) }
        break
      case 'Enter': if (current) activate(current); break
      case 'Escape': set({ focus: 'pane' }); return
      default: return
    }
    e.preventDefault()
  }

  if (!project) {
    return (
      <div className="px-2">
        <button onClick={() => void chooseProject(setProject)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-[12px] text-accent transition-colors hover:bg-accent-bg">
          <MdFolderOpen size={16} /> Abrir proyecto
        </button>
        <p className="px-3 pt-2 text-[11px] text-muted">{t('fs.openProject')}</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-2 pb-1">
        <span title={project} className="truncate pl-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{basename(project)}</span>
        <div className="flex items-center">
          {[
            { title: t('fs.newFile'), icon: <MdNoteAdd size={16} />, onClick: () => startCreate(project, false) },
            { title: t('fs.newFolder'), icon: <MdCreateNewFolder size={16} />, onClick: () => startCreate(project, true) },
            { title: t('fs.refresh'), icon: <MdRefresh size={16} />, onClick: reload },
            { title: t('fs.collapse'), icon: <MdUnfoldLess size={16} />, onClick: () => setExpanded(new Set()) },
            { title: t('fs.openOther'), icon: <MdFolderOpen size={16} />, onClick: () => void chooseProject(setProject) }
          ].map((b) => (
            <button key={b.title} title={b.title} onClick={b.onClick} className="grid size-[26px] place-items-center rounded-md text-muted transition-colors hover:bg-accent-bg hover:text-accent">{b.icon}</button>
          ))}
        </div>
      </div>
      <div ref={box} tabIndex={0} onKeyDown={onKeyDown} onFocus={() => set({ focus: 'tree' })} className="min-h-0 flex-1 overflow-y-auto px-1 pb-2 outline-none"
        onClick={(e) => { if (e.target === e.currentTarget) setRootMenu(new DOMRect(e.clientX + 190, e.clientY, 0, 0)) }}
        onContextMenu={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); setRootMenu(new DOMRect(e.clientX + 190, e.clientY, 0, 0)) } }}>
        {creating && creating.dir === project && <NameInput isDir={creating.isDir} depth={0} onOk={(v) => void confirmAsk(v)} onCancel={() => setAsk(null)} />}
        {rows.length === 0 && !creating && <p className="px-3 py-1 text-[11px] text-muted">{t('fs.emptyFolder')}</p>}
        {rows.map((row) => {
          const { entry, depth } = row
          const code = status.get(toPosix(relative(project, entry.path)))
          const color = code ? (GIT_COLOR[code] ?? 'var(--color-text)') : undefined
          return (
            <Fragment key={entry.path}>
            <button
              title={entry.path}
              onClick={() => activate(row)}
              onMouseMove={() => { if (cursor !== entry.path) setCursor(entry.path) }}      // el resaltado sigue al ratón (y desde ahí siguen las flechas)
              onContextMenu={(e) => {
                e.preventDefault()
                if (!(e.nativeEvent as PointerEvent).pointerType) return      // lo generó la tecla de menú: lo gestiona onKeyDown con la fila marcada
                setCursor(entry.path)
                setMenu({ entry, anchor: new DOMRect(e.clientX + 190, e.clientY, 0, 0) })      // el menú se abre justo en el cursor
              }}
              style={{ paddingLeft: 6 + depth * 12 }}
              className={clsx(
                'flex w-full items-center gap-1.5 rounded-[4px] py-[3px] pr-1.5 text-left text-[12px] transition-colors hover:bg-accent-bg',
                cursor === entry.path && 'bg-accent-bg ring-1 ring-inset ring-accent/40',
                ignored.has(entry.path) && 'opacity-40'
              )}
            >
              <img src={iconFor(entry.name, entry.isDir, expanded.has(entry.path))} alt="" className="size-4 shrink-0" draggable={false} />
              <span className="min-w-0 flex-1 truncate" style={{ color }}>{entry.name}</span>
              {code && <span className={clsx('shrink-0 font-semibold', code === '●' ? 'text-[9px]' : 'text-[11px]')} style={{ color }}>{code}</span>}
            </button>
            {creating && creating.dir === entry.path && <NameInput isDir={creating.isDir} depth={depth + 1} onOk={(v) => void confirmAsk(v)} onCancel={() => setAsk(null)} />}
            </Fragment>
          )
        })}
      </div>
      {rootMenu && (
        <Menu anchor={rootMenu} onClose={() => setRootMenu(null)} items={[
          { label: t('fs.newFile'), icon: <MdNoteAdd size={14} />, onClick: () => startCreate(project, false) },
          { label: t('fs.newFolder'), icon: <MdCreateNewFolder size={14} />, onClick: () => startCreate(project, true) }
        ]} />
      )}
      {menu && (
        <Menu anchor={menu.anchor} onClose={() => setMenu(null)} items={[
          { label: t('fs.sendToAgent'), icon: <MdSend size={14} />, onClick: () => sendToAgent(menu.entry) },
          { label: t('fs.newFile'), separator: true, icon: <MdNoteAdd size={14} />, onClick: () => startCreate(menu.entry.isDir ? menu.entry.path : dirname(menu.entry.path), false) },
          { label: t('fs.newFolder'), icon: <MdCreateNewFolder size={14} />, onClick: () => startCreate(menu.entry.isDir ? menu.entry.path : dirname(menu.entry.path), true) },
          { label: t('fs.rename'), separator: true, icon: <MdDriveFileRenameOutline size={14} />, onClick: () => setAsk({ kind: 'rename', entry: menu.entry }) },
          { label: t('fs.copyPath'), icon: <MdContentCopy size={14} />, onClick: () => copy(menu.entry.path) },
          { label: t('fs.copyRelative'), icon: <MdLink size={14} />, onClick: () => copy(toPosix(relative(project, menu.entry.path))) },
          { label: t('fs.delete'), separator: true, icon: <MdDeleteOutline size={14} />, danger: true, onClick: () => setAsk({ kind: 'delete', entry: menu.entry }) }
        ]} />
      )}
      {ask && ask.kind !== 'create' && <AskDialog ask={ask} onClose={() => setAsk(null)} onOk={(v) => void confirmAsk(v)} />}
    </div>
  )
}

async function chooseProject(setProject: (p: string | null) => void): Promise<void> {
  const picked = await window.api.dialog.chooseFolder(useStore.getState().project ?? undefined)
  if (picked) setProject(picked)
}

function AskDialog({ ask, onClose, onOk }: { ask: Ask; onClose: () => void; onOk: (value: string) => void }) {
  const t = useT()
  const initial = ask.kind === 'rename' ? ask.entry.name : ''
  const [value, setValue] = useState(initial)
  const del = ask.kind === 'delete'
  const title = ask.kind === 'create' ? (ask.isDir ? t('fs.newFolder') : t('fs.newFile')) : ask.kind === 'rename' ? t('fs.rename') : t('fs.delete')
  const submit = (): void => { if (del || value.trim()) onOk(del ? '' : value.trim()) }
  return (
    <Modal onClose={onClose} width={400} title={title}>
      <div className="flex flex-col gap-3 px-4 pb-4">
        {del ? (
          <p className="text-[12px] leading-relaxed text-muted">{t('fs.trashNote', { name: ask.entry.name, contents: ask.entry.isDir ? t('fs.andContents') : '' })}</p>
        ) : (
          <input
            autoFocus value={value} spellCheck={false} placeholder={t('fs.name')}
            onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            onFocus={(e) => { if (initial) e.currentTarget.setSelectionRange(0, initial.lastIndexOf('.') > 0 ? initial.lastIndexOf('.') : initial.length) }}
            className={FIELD}
          />
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-[12px] text-muted transition-colors hover:text-text">{t('dlg.cancel')}</button>
          <button autoFocus={del} onClick={submit} className={`rounded-lg px-4 py-1.5 text-[12px] font-medium transition-colors ${del ? 'bg-danger/20 text-danger hover:bg-danger/30' : 'bg-accent text-bg hover:brightness-110'}`}>
            {del ? t('fs.delete') : t('fs.ok')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** Campo de nombre dentro del árbol (como en VS Code): Enter crea, Esc o salir del campo cancela. */
function NameInput({ isDir, depth, onOk, onCancel }: { isDir: boolean; depth: number; onOk: (value: string) => void; onCancel: () => void }) {
  const t = useT()
  const [value, setValue] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const ready = useRef(false)
  // el foco se pide tras montar: el menú que lo abrió acaba de cerrarse y no debe cancelarlo
  useEffect(() => { const t = setTimeout(() => { input.current?.focus(); ready.current = true }, 30); return () => clearTimeout(t) }, [])
  return (
    <div style={{ paddingLeft: 6 + depth * 12 }} className="flex items-center gap-1.5 py-[3px] pr-1.5">
      <img src={iconFor(value || 'archivo', isDir, false)} alt="" className="size-4 shrink-0" draggable={false} />
      <input
        ref={input} value={value} spellCheck={false} placeholder={isDir ? t('fs.folderName') : t('fs.fileName')}
        onChange={(e) => setValue(e.target.value)} onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && value.trim()) onOk(value.trim()); else if (e.key === 'Escape') onCancel() }}
        onBlur={() => { if (ready.current) onCancel() }}
        className="min-w-0 flex-1 rounded-[3px] bg-ov/[0.08] px-1.5 py-[1px] text-[12px] caret-accent outline-none placeholder:text-muted/70"
      />
    </div>
  )
}
