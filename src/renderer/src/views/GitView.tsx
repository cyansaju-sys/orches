import { clsx } from 'clsx'
import { useState } from 'react'
import { MdAdd, MdArrowUpward, MdCallSplit, MdCheck, MdRemove } from 'react-icons/md'
import type { GitFile } from '@shared/types'
import { GIT_COLOR, refreshGit } from '@/lib/gitSync'
import { iconFor } from '@/lib/icons'
import { basename, dirname } from '@/lib/paths'
import { useStore } from '@/store'

export function GitView() {
  const project = useStore((s) => s.project)
  const git = useStore((s) => s.git)
  const toast = useStore((s) => s.toast)
  const openDoc = useStore((s) => s.openDoc)
  const set = useStore((s) => s.set)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  if (!project) return <p className="px-3 py-2 text-[12px] text-muted">Abre un proyecto primero (pestaña Archivos)</p>
  if (!git?.isRepo) return <p className="px-3 py-2 text-[12px] text-muted">Esta carpeta no es un repositorio git</p>

  const run = async (label: string, action: () => Promise<string>): Promise<boolean> => {
    setBusy(true)
    const error = await action()
    setBusy(false)
    await refreshGit()
    if (error) toast(`${label}: ${error}`, 'error')
    return !error
  }
  const staged = git.files.filter((f) => f.index && f.index !== '?')
  const changes = git.files.filter((f) => f.work || f.index === '?')

  const commit = async (): Promise<void> => {
    if (!message.trim()) { toast('Escribe el mensaje del commit', 'error'); return }
    if (await run('Commit', () => window.api.git.commit(project, message.trim()))) { setMessage(''); toast('Commit hecho', 'ok') }
  }
  const push = async (): Promise<void> => { if (await run('Push', () => window.api.git.push(project))) toast('Cambios subidos', 'ok') }

  const File = ({ f, isStaged }: { f: GitFile; isStaged: boolean }) => (
    <li className="group flex items-center gap-1.5 rounded-md px-2 py-[5px] transition-colors hover:bg-accent-bg">
      <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => void openDoc(`${project}/${f.path}`)}>
        <img src={iconFor(basename(f.path))} alt="" className="size-4 shrink-0" draggable={false} />
        <span className="truncate text-[12px]" style={{ color: GIT_COLOR[f.code] }}>{basename(f.path)}</span>
        <span className="truncate text-[10px] text-muted">{dirname(f.path) === f.path ? '' : dirname(f.path)}</span>
      </button>
      <button
        title={isStaged ? 'Quitar de lo preparado' : 'Preparar'}
        onClick={() => void run(isStaged ? 'Quitar' : 'Preparar', () => (isStaged ? window.api.git.unstage : window.api.git.stage)(project, [f.path]))}
        className="grid size-5 shrink-0 place-items-center rounded text-muted opacity-0 transition-opacity hover:text-accent group-hover:opacity-100"
      >
        {isStaged ? <MdRemove size={15} /> : <MdAdd size={15} />}
      </button>
      <span className="w-3 shrink-0 text-center text-[11px] font-semibold" style={{ color: GIT_COLOR[f.code] }}>{f.code}</span>
    </li>
  )

  return (
    <div className="flex h-full flex-col gap-2 px-2">
      <input
        value={message} onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void commit() }}
        placeholder="Mensaje de commit"
        className="rounded-md border border-line bg-surface px-2.5 py-2 text-[12px] outline-none transition-colors placeholder:text-muted focus:border-accent"
      />
      <div className="flex gap-2">
        <button disabled={busy} onClick={() => void commit()} className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-raised py-1.5 text-[12px] font-medium transition-colors hover:bg-accent-bg disabled:opacity-50">
          <MdCheck size={15} /> Commit
        </button>
        <button disabled={busy} onClick={() => void push()} className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-raised py-1.5 text-[12px] font-medium transition-colors hover:bg-accent-bg disabled:opacity-50">
          <MdArrowUpward size={15} /> Push{git.ahead > 0 && <span className="text-accent">{git.ahead}</span>}
        </button>
      </div>
      <button onClick={() => set({ modal: 'branches' })} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-accent-bg">
        <MdCallSplit size={15} className="text-accent" />
        <span className="text-[13px] font-semibold">{git.branch}</span>
        <span className="ml-auto text-[11px] text-muted">
          {git.hasUpstream && (git.ahead || git.behind) ? `${git.behind}↓ ${git.ahead}↑ · ` : ''}{git.files.length} cambios
        </span>
      </button>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {staged.length > 0 && <Group title={`Preparados · ${staged.length}`}>{staged.map((f) => <File key={`s${f.path}`} f={f} isStaged />)}</Group>}
        <Group title={`Cambios · ${changes.length}`} action={changes.length > 0 ? { title: 'Preparar todo', run: () => void run('Preparar', () => window.api.git.stage(project, changes.map((f) => f.path))) } : undefined}>
          {changes.map((f) => <File key={`c${f.path}`} f={f} isStaged={false} />)}
        </Group>
        {git.files.length === 0 && <p className="px-2 py-3 text-[12px] text-muted">Todo al día: no hay cambios</p>}
      </div>
    </div>
  )
}

function Group({ title, children, action }: { title: string; children: React.ReactNode; action?: { title: string; run: () => void } }) {
  return (
    <section className="mb-2">
      <div className="flex items-center justify-between px-2 pb-1 pt-1">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted">{title}</h4>
        {action && <button title={action.title} onClick={action.run} className={clsx('grid size-5 place-items-center rounded text-muted transition-colors hover:text-accent')}><MdAdd size={15} /></button>}
      </div>
      <ul>{children}</ul>
    </section>
  )
}

