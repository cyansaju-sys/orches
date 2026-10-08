import { clsx } from 'clsx'
import { useCallback, useEffect, useState } from 'react'
import { MdClose } from 'react-icons/md'
import type { GitMarks } from '@shared/types'
import { GIT_COLOR, refreshGit } from '@/lib/gitSync'
import { iconFor } from '@/lib/icons'
import { languageName } from '@/lib/languages'
import { crumbs, relative, toPosix } from '@/lib/paths'
import { isDirty, useStore, type Doc } from '@/store'
import { CodeEditor } from './CodeEditor'
import { DiffView } from './DiffView'

export async function saveDoc(doc: Doc): Promise<void> {
  const { toast, markSaved } = useStore.getState()
  try {
    const mtime = await window.api.fs.write(doc.path, doc.text, doc.crlf)
    markSaved(doc.path, doc.text, mtime)
    void refreshGit()
  } catch (e) {
    toast(`No se pudo guardar ${doc.title}: ${e instanceof Error ? e.message : String(e)}`, 'error')
  }
}

export function EditorArea() {
  const docs = useStore((s) => s.docs)
  const activePath = useStore((s) => s.activeDoc)
  const project = useStore((s) => s.project)
  const git = useStore((s) => s.git)
  const editEnabled = useStore((s) => s.editEnabled)
  const focus = useStore((s) => s.focus)
  const set = useStore((s) => s.set)
  const closeDoc = useStore((s) => s.closeDoc)
  const updateDocText = useStore((s) => s.updateDocText)
  const [marks, setMarks] = useState<GitMarks>({})
  const doc = docs.find((d) => d.path === activePath) ?? null

  const loadMarks = useCallback(async () => { if (doc && doc.kind !== 'diff') setMarks(await window.api.git.marks(doc.path)) }, [doc?.path])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setMarks({}); void loadMarks() }, [doc?.path, git?.files.length, doc?.savedText])  // eslint-disable-line react-hooks/exhaustive-deps

  // si otra herramienta cambia el archivo y aquí no hay cambios sin guardar, se recarga solo
  useEffect(() => {
    if (!doc || doc.kind !== 'text') return
    const timer = setInterval(async () => {
      const current = useStore.getState().docs.find((d) => d.path === doc.path)
      if (!current || isDirty(current)) return
      const m = await window.api.fs.mtime(current.path)
      if (m && m !== current.mtimeMs) useStore.getState().replaceDoc(current.path, await window.api.fs.read(current.path))
    }, 2000)
    return () => clearInterval(timer)
  }, [doc?.path])  // eslint-disable-line react-hooks/exhaustive-deps

  const close = (d: Doc): void => {
    if (isDirty(d) && !window.confirm(`«${d.title}» tiene cambios sin guardar. ¿Cerrarlo sin guardar?`)) return
    closeDoc(d.path)
  }
  const statusOf = (d: Doc): string => {
    const rel = project ? toPosix(relative(project, d.diffOf ?? d.path)) : ''
    return git?.files.find((f) => toPosix(f.path) === rel)?.code ?? ''
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-surface" onMouseDown={() => set({ focus: 'editor' })}>
      <div className="flex shrink-0 items-end overflow-x-auto bg-bar pt-1">
        {docs.map((d) => {
          const active = d.path === activePath
          const code = statusOf(d)
          return (
            <div
              key={d.path}
              onClick={() => set({ activeDoc: d.path, focus: 'editor' })}
              onAuxClick={(e) => { if (e.button === 1) close(d) }}
              className={clsx(
                'group flex shrink-0 cursor-pointer items-center gap-1.5 border-t-2 px-3 py-[7px] transition-colors',
                active ? 'border-accent bg-surface text-text' : 'border-panel bg-panel text-muted hover:bg-raised'
              )}
            >
              <img src={iconFor(d.title)} alt="" className="size-4" draggable={false} />
              <span className="max-w-[160px] truncate text-[12px]" style={{ color: code ? GIT_COLOR[code] : undefined }}>{d.title}</span>
              {code && <span className="text-[10px] font-semibold" style={{ color: GIT_COLOR[code] }}>{code}</span>}
              {isDirty(d) && <span title="Cambios sin guardar" className="text-[10px] text-warn">●</span>}
              <button onClick={(e) => { e.stopPropagation(); close(d) }} className="grid size-5 place-items-center rounded text-muted transition-colors hover:bg-line hover:text-text">
                <MdClose size={12} />
              </button>
            </div>
          )
        })}
      </div>
      {doc && (
        <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-1.5">
          <div className="flex items-center gap-1 overflow-hidden text-[11px] text-muted">
            {crumbs(project, doc.diffOf ?? doc.path).map((c, i, all) => (
              <span key={i} className="flex items-center gap-1">
                <span className={clsx('truncate', i === all.length - 1 && 'font-medium text-text')}>{c}</span>
                {i < all.length - 1 && <span className="text-line">›</span>}
              </span>
            ))}
          </div>
          <span className="shrink-0 pl-3 text-[10px] text-muted">{doc.kind === 'diff' ? 'Comparación' : languageName(doc.title)}</span>
        </div>
      )}
      {doc && (doc.readOnly || !editEnabled) && doc.kind === 'text' && (
        <div className="shrink-0 bg-raised px-3 py-1 text-[10px] text-warn">
          {doc.truncated ? 'Solo el primer MB · solo lectura' : doc.readOnly ? 'Archivo muy grande o no UTF-8 · solo lectura' : 'Edición bloqueada (Ctrl+Shift+L para permitirla)'}
        </div>
      )}
      {doc?.kind === 'text' && (
        <CodeEditor
          path={doc.path} text={doc.text} readOnly={doc.readOnly || !editEnabled} marks={marks}
          onChange={(text) => updateDocText(doc.path, text)} onSave={() => void saveDoc(useStore.getState().docs.find((d) => d.path === doc.path)!)}
          focusToken={focus === 'editor' ? 1 : 0}
        />
      )}
      {doc?.kind === 'diff' && <DiffView before={doc.original ?? ''} after={doc.text} label={doc.diffLabel} />}
      {doc?.kind === 'image' && <div className="grid flex-1 place-items-center overflow-auto p-4"><img src={doc.dataUrl} alt={doc.title} className="max-h-full max-w-full object-contain" /></div>}
      {doc?.kind === 'binary' && <div className="grid flex-1 place-items-center text-[12px] text-muted">Archivo binario: no se puede mostrar como texto</div>}
    </div>
  )
}
