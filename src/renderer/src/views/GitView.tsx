import { clsx } from 'clsx'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MdAdd, MdArrowDownward, MdArrowUpward, MdCallSplit, MdAutoAwesome, MdCheck, MdChevronRight, MdOpenInNew, MdRemove } from 'react-icons/md'
import type { GitFile } from '@shared/types'
import { GIT_COLOR, refreshGit } from '@/lib/gitSync'
import { iconFor } from '@/lib/icons'
import { basename, dirname } from '@/lib/paths'
import { AgentIcon } from '@/components/AgentIcon'
import { useStore } from '@/store'

export function GitView() {
  const project = useStore((s) => s.project)
  const git = useStore((s) => s.git)
  const toast = useStore((s) => s.toast)
  const openDoc = useStore((s) => s.openDoc)
  const openDiff = useStore((s) => s.openDiff)
  const set = useStore((s) => s.set)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const [writing, setWriting] = useState('')            // agente que está redactando (vacío = ninguno)
  const [author, setAuthor] = useState('')              // agente que redactó el mensaje que hay en el input

  // al abrir la sección se consulta el remoto (sin tocar nada local) para saber si hay que traer cambios
  useEffect(() => {
    if (!project || !git?.isRepo || !git.hasUpstream) return
    void window.api.git.fetch(project).then(() => refreshGit())
  }, [project, git?.branch, git?.isRepo, git?.hasUpstream])  // eslint-disable-line react-hooks/exhaustive-deps

  // la altura sigue al texto, con tope de 3 líneas (después aparece el scroll)
  useLayoutEffect(() => {
    const el = area.current
    if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px` }
  }, [message, git?.isRepo])

  // al salir del apartado se deja de redactar el mensaje
  useEffect(() => () => { void window.api.ai.cancel('commit') }, [])

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

  const suggest = async (): Promise<void> => {
    if (writing) return
    setWriting('un agente')
    setAuthor('')
    const off = window.api.git.onCommitAgent(setWriting)
    const res = await window.api.git.suggestCommit(project)
    off()
    setWriting('')
    if (res.ok) { setMessage(res.message); setAuthor(res.agent ?? '') }
    else if (res.message) toast(res.message, 'error')
    else toast('Se canceló el mensaje del commit', 'info')
  }

  const commit = async (): Promise<void> => {
    if (!message.trim()) { toast('Escribe el mensaje del commit', 'error'); return }
    if (await run('Commit', () => window.api.git.commit(project, message.trim()))) { setMessage(''); setAuthor(''); toast('Commit hecho', 'ok') }
  }
  const pull = async (): Promise<void> => { if (await run('Pull', () => window.api.git.pull(project))) toast('Cambios traídos', 'ok') }
  const push = async (): Promise<void> => { if (await run('Push', () => window.api.git.push(project))) toast('Cambios subidos', 'ok') }

  const File = ({ f, isStaged }: { f: GitFile; isStaged: boolean }) => (
    <li className="group flex items-center gap-1.5 rounded-md px-2 py-[5px] transition-colors hover:bg-accent-bg">
      <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => void openDiff(`${project}/${f.path}`, isStaged)} title="Ver cambios">
        <img src={iconFor(basename(f.path))} alt="" className="size-4 shrink-0" draggable={false} />
        <span className="truncate text-[12px]" style={{ color: GIT_COLOR[f.code] }}>{basename(f.path)}</span>
        <span className="truncate text-[10px] text-muted">{dirname(f.path) === f.path ? '' : dirname(f.path)}</span>
      </button>
      <button title="Abrir el archivo" onClick={() => void openDoc(`${project}/${f.path}`)} className="grid size-5 shrink-0 place-items-center rounded text-muted opacity-0 transition-opacity hover:text-accent group-hover:opacity-100">
        <MdOpenInNew size={14} />
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
      <div className="relative">
        <textarea
          ref={area} value={message} rows={1}
          onChange={(e) => { setMessage(e.target.value); setAuthor('') }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void commit() } }}
          placeholder={writing ? `${writing} está redactando el mensaje…` : 'Mensaje de commit'}
          className="block max-h-[68px] w-full resize-none overflow-y-auto rounded-md border border-line bg-surface py-2 pl-2.5 pr-8 text-[12px] leading-snug outline-none transition-colors placeholder:text-muted focus:border-accent"
        />
        <button
          title="Generar el mensaje con un agente (Conventional Commits)" disabled={!!writing || busy} onClick={() => void suggest()}
          className={`absolute right-1.5 top-1.5 grid size-6 place-items-center rounded text-muted transition-colors hover:text-accent disabled:opacity-60 ${writing ? 'animate-pulse text-accent' : ''}`}
        >
          <MdAutoAwesome size={15} />
        </button>
      </div>
      {(writing || author) && (
        <div className="flex items-center gap-2 rounded-md bg-accent-bg px-2 py-1.5 text-[11px]">
          <AgentIcon name={writing || author} size={16} className={writing ? 'animate-pulse' : ''} />
          <span className="min-w-0 flex-1 leading-snug">
            <span className="text-muted">{writing ? 'Redactando el commit' : 'Mensaje redactado por'}</span>
            <span className="block break-words font-medium text-text">{writing || author}</span>
          </span>
        </div>
      )}
      <div className="flex gap-2">
        <button disabled={busy} onClick={() => void commit()} className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-raised py-1.5 text-[12px] font-medium transition-colors hover:bg-accent-bg disabled:opacity-50">
          <MdCheck size={15} /> Commit
        </button>
        {git.hasUpstream && git.behind > 0 ? (
          <button disabled={busy} onClick={() => void pull()} title={`Faltan ${git.behind} commits del remoto`} className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-raised py-1.5 text-[12px] font-medium transition-colors hover:bg-accent-bg disabled:opacity-50">
            <MdArrowDownward size={15} /> Pull <span className="text-accent">{git.behind}</span>
          </button>
        ) : (
          <button disabled={busy} onClick={() => void push()} className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-raised py-1.5 text-[12px] font-medium transition-colors hover:bg-accent-bg disabled:opacity-50">
            <MdArrowUpward size={15} /> Push{git.ahead > 0 && <span className="text-accent">{git.ahead}</span>}
          </button>
        )}
      </div>
      <button onClick={() => set({ modal: 'branches' })} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-accent-bg">
        <MdCallSplit size={15} className="text-accent" />
        <span className="text-[13px] font-semibold">{git.branch}</span>
        <span className="ml-auto text-[11px] text-muted">
          {git.hasUpstream && (git.ahead || git.behind) ? `${git.behind}↓ ${git.ahead}↑ · ` : ''}{git.files.length} cambios
        </span>
      </button>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {staged.length > 0 && <Group id="staged" title={`preparados · ${staged.length}`}>{staged.map((f) => <File key={`s${f.path}`} f={f} isStaged />)}</Group>}
        <Group id="changes" title={`cambios · ${changes.length}`} action={changes.length > 0 ? { title: 'Preparar todo', run: () => void run('Preparar', () => window.api.git.stage(project, changes.map((f) => f.path))) } : undefined}>
          {changes.map((f) => <File key={`c${f.path}`} f={f} isStaged={false} />)}
        </Group>
        {git.files.length === 0 && <p className="px-2 py-3 text-[12px] text-muted">Todo al día: no hay cambios</p>}
      </div>
    </div>
  )
}

function Group({ id, title, children, action }: { id: string; title: string; children: React.ReactNode; action?: { title: string; run: () => void } }) {
  const key = `orches.git.${id}.collapsed`
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(key) === '1' } catch { return false } })
  const toggle = (): void => {
    setCollapsed((c) => { try { localStorage.setItem(key, c ? '0' : '1') } catch { /* sin almacenamiento */ } return !c })
  }
  return (
    <section className="mb-2">
      <div className="flex items-center justify-between pb-1 pt-1 pr-2">
        <button onClick={toggle} aria-expanded={!collapsed} className="flex min-w-0 flex-1 items-center gap-0.5 rounded px-1 text-left text-muted transition-colors hover:text-text">
          <MdChevronRight size={15} className={clsx('shrink-0 transition-transform', !collapsed && 'rotate-90')} />
          <h4 className="truncate text-[11px] font-semibold tracking-wide">{title}</h4>
        </button>
        {action && <button title={action.title} onClick={action.run} className={clsx('grid size-5 place-items-center rounded text-muted transition-colors hover:text-accent')}><MdAdd size={15} /></button>}
      </div>
      {!collapsed && <ul>{children}</ul>}
    </section>
  )
}

