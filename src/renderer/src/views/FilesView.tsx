import { clsx } from 'clsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MdFolderOpen } from 'react-icons/md'
import type { DirEntry } from '@shared/types'
import { GIT_COLOR } from '@/lib/gitSync'
import { iconFor } from '@/lib/icons'
import { basename, relative, toPosix } from '@/lib/paths'
import { useStore } from '@/store'

interface Row { entry: DirEntry; depth: number }

export function FilesView() {
  const project = useStore((s) => s.project)
  const git = useStore((s) => s.git)
  const setProject = useStore((s) => s.setProject)
  const openDoc = useStore((s) => s.openDoc)
  const set = useStore((s) => s.set)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [children, setChildren] = useState<Record<string, DirEntry[]>>({})
  const [ignored, setIgnored] = useState<Set<string>>(new Set())
  const [cursor, setCursor] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)

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

  // navegación con el teclado: ↑↓ mueven la selección, → abre, ← cierra o sube, Enter abre, Esc devuelve el teclado a la terminal
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.ctrlKey || e.altKey || e.metaKey) return
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
        <p className="px-3 pt-2 text-[11px] text-muted">Abre un proyecto para ver su contenido</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-2 pb-1">
        <span title={project} className="truncate pl-2 text-[11px] text-muted">{basename(project)}</span>
        <button title="Abrir otro proyecto" onClick={() => void chooseProject(setProject)} className="grid size-[26px] place-items-center rounded-md text-muted transition-colors hover:bg-accent-bg hover:text-accent">
          <MdFolderOpen size={16} />
        </button>
      </div>
      <div ref={box} tabIndex={0} onKeyDown={onKeyDown} onFocus={() => set({ focus: 'tree' })} className="min-h-0 flex-1 overflow-y-auto px-1 pb-2 outline-none">
        {rows.length === 0 && <p className="px-3 py-1 text-[11px] text-muted">Carpeta vacía</p>}
        {rows.map((row) => {
          const { entry, depth } = row
          const code = status.get(toPosix(relative(project, entry.path)))
          const color = code ? (GIT_COLOR[code] ?? '#e6e8ef') : undefined
          return (
            <button
              key={entry.path}
              title={entry.path}
              onClick={() => activate(row)}
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
          )
        })}
      </div>
    </div>
  )
}

async function chooseProject(setProject: (p: string | null) => void): Promise<void> {
  const picked = await window.api.dialog.chooseFolder(useStore.getState().project ?? undefined)
  if (picked) setProject(picked)
}
