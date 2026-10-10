import { clsx } from 'clsx'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MdAdd, MdArrowDownward, MdArrowUpward, MdCallSplit, MdAutoAwesome, MdCheck, MdChevronRight, MdOpenInNew, MdRemove } from 'react-icons/md'
import type { GitFile } from '@shared/types'
import { GIT_COLOR, refreshGit } from '@/lib/gitSync'
import { iconFor } from '@/lib/icons'
import { basename, dirname } from '@/lib/paths'
import { AgentIcon } from '@/components/AgentIcon'
import { useT } from '@/lib/i18n'
import { useStore } from '@/store'

export function GitView() {
  const t = useT()
  const project = useStore((s) => s.project)
  const git = useStore((s) => s.git)
  const toast = useStore((s) => s.toast)
  const openDoc = useStore((s) => s.openDoc)
  const openDiff = useStore((s) => s.openDiff)
  const set = useStore((s) => s.set)
  const [message, setMessage] = useState('')
  const [phase, setPhase] = useState<'idle' | 'commit' | 'push' | 'pull' | 'done'>('idle')
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

  // cambios que llegan de fuera del botón (terminal, otro programa): se anima igual que al sincronizar aquí
  const seen = useRef<{ project: string | null; remote: boolean; ahead: number; behind: number } | null>(null)
  useEffect(() => {
    if (!git?.isRepo) { seen.current = null; return }
    const prev = seen.current
    seen.current = { project, remote: git.hasRemote, ahead: git.ahead, behind: git.behind }
    if (!prev || prev.project !== project || busy) return                   // primera lectura, otro proyecto o cambio hecho por el botón
    const synced = git.hasRemote && ((prev.ahead > 0 && git.ahead === 0) || (prev.behind > 0 && git.behind === 0))
    if (synced) { setPhase('done'); setTimeout(() => setPhase('idle'), 1400) }
  }, [git?.isRepo, git?.hasRemote, git?.ahead, git?.behind, project])  // eslint-disable-line react-hooks/exhaustive-deps

  // al salir del apartado se deja de redactar el mensaje
  useEffect(() => () => { void window.api.ai.cancel('commit') }, [])

  if (!project) return <p className="px-3 py-2 text-[12px] text-muted">{t('dlg.openProjectFirst')}</p>
  if (!git?.isRepo) return <p className="px-3 py-2 text-[12px] text-muted">{t('git.noRepo')}</p>

  const run = async (label: string, action: () => Promise<string>): Promise<boolean> => {
    setBusy(true)
    const error = await action()
    setBusy(false)
    await refreshGit()
    if (error) toast(`${label}: ${error}`, 'error')
    return !error
  }
  const hasMessage = message.trim().length > 0
  // sin rama remota asociada no se sabe cuántos commits faltan: se ofrece subir en cuanto no queden cambios por confirmar
  const canPush = git.ahead > 0 || (!git.hasUpstream && git.files.length === 0)
  const action = !git.hasRemote ? { label: 'Commit', icon: 'commit', ready: hasMessage, count: 0, hint: t('git.noRemoteOnlyCommit') }
    : hasMessage ? { label: 'Commit', icon: 'commit', ready: true, count: 0, hint: t('git.commitHint') }
    : git.hasUpstream && git.behind > 0 ? { label: 'Pull', icon: 'pull', ready: true, count: git.behind, hint: t('git.behindHint', { n: git.behind }) }
    : canPush ? { label: 'Push', icon: 'push', ready: true, count: git.ahead, hint: t('git.pushHint') }
    : { label: 'Commit', icon: 'commit', ready: false, count: 0, hint: t('git.writeHint') }
  const iconKey = `${phase}-${action.icon}`
  const staged = git.files.filter((f) => f.index && f.index !== '?')
  const changes = git.files.filter((f) => f.work || f.index === '?')

  const suggest = async (): Promise<void> => {
    if (writing) return
    setWriting(t('git.anAgent'))
    setAuthor('')
    const off = window.api.git.onCommitAgent(setWriting)
    const res = await window.api.git.suggestCommit(project)
    off()
    setWriting('')
    if (res.ok) { setMessage(res.message); setAuthor(res.agent ?? '') }
    else if (res.message) toast(res.message, 'error')
    else toast(t('git.cancelled'), 'info')
  }

  const flash = (): void => { setPhase('done'); setTimeout(() => setPhase('idle'), 1400) }
  /** El botón único, un paso por pulsación: con mensaje hace commit; después pasa a «Push» (o «Pull» si faltan commits del remoto). */
  const sync = async (): Promise<void> => {
    if (busy) return
    const text = message.trim()
    if (text) {
      setPhase('commit')
      if (!(await run('Commit', () => window.api.git.commit(project, text)))) { setPhase('idle'); return }
      setMessage(''); setAuthor('')
      flash()          // el siguiente paso, subirlo, es otra pulsación: el botón pasa a «Push»
    } else if (!git.hasRemote) toast(t('git.noRemote'), 'error')
    else if (git.hasUpstream && git.behind > 0) {
      setPhase('pull')
      if (await run('Pull', () => window.api.git.pull(project))) { flash() } else setPhase('idle')
    } else if (canPush) {
      setPhase('push')
      if (await run('Push', () => window.api.git.push(project))) { flash() } else setPhase('idle')
    } else toast(t('git.writeMessage'), 'error')
  }
  const commit = sync

  const File = ({ f, isStaged }: { f: GitFile; isStaged: boolean }) => (
    <li className="group flex items-center gap-1.5 rounded-md px-2 py-[5px] transition-colors hover:bg-accent-bg">
      <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => void openDiff(`${project}/${f.path}`, isStaged)} title={t('git.viewChanges')}>
        <img src={iconFor(basename(f.path))} alt="" className="size-4 shrink-0" draggable={false} />
        <span className="truncate text-[12px]" style={{ color: GIT_COLOR[f.code] }}>{basename(f.path)}</span>
        <span className="truncate text-[10px] text-muted">{dirname(f.path) === f.path ? '' : dirname(f.path)}</span>
      </button>
      <button title={t('git.openFile')} onClick={() => void openDoc(`${project}/${f.path}`)} className="grid size-5 shrink-0 place-items-center rounded text-muted opacity-0 transition-opacity hover:text-accent group-hover:opacity-100">
        <MdOpenInNew size={14} />
      </button>
      <button
        title={isStaged ? t('git.unstageTip') : t('git.stageTip')}
        onClick={() => void run(isStaged ? t('git.unstage') : t('git.stage'), () => (isStaged ? window.api.git.unstage : window.api.git.stage)(project, [f.path]))}
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
          placeholder={writing ? t('git.writingMsg', { agent: writing }) : t('git.messagePlaceholder')}
          className="block max-h-[68px] w-full resize-none overflow-y-auto rounded-md bg-ov/[0.04] py-2 pl-2.5 pr-8 text-[12px] leading-snug outline-none placeholder:text-muted/70"
        />
        <button
          title={t('git.generateTip')} disabled={!!writing || busy} onClick={() => void suggest()}
          className={`absolute right-1.5 top-1.5 grid size-6 place-items-center rounded text-muted transition-colors hover:text-accent disabled:opacity-60 ${writing ? 'animate-pulse text-accent' : ''}`}
        >
          <MdAutoAwesome size={15} />
        </button>
      </div>
      {(writing || author) && (
        <div className="flex items-center gap-2 rounded-md bg-accent-bg px-2 py-1.5 text-[11px]">
          <AgentIcon name={writing || author} size={16} className={writing ? 'animate-pulse' : ''} />
          <span className="min-w-0 flex-1 leading-snug">
            <span className="text-muted">{writing ? t('git.writingCommit') : t('git.writtenBy')}</span>
            <span className="block break-words font-medium text-text">{writing || author}</span>
          </span>
        </div>
      )}
      <button disabled={busy} onClick={() => void sync()} title={action.hint}
        className={clsx('relative flex items-center justify-center gap-2 overflow-hidden rounded-md py-2 text-[12px] font-medium transition-colors disabled:cursor-default',
          phase === 'done' ? 'bg-ok/20 text-ok' : action.ready ? 'bg-accent text-bg hover:brightness-110' : 'bg-raised text-muted hover:bg-accent-bg')}>
        {busy && <span className="pointer-events-none absolute inset-0 animate-sweep bg-gradient-to-r from-transparent via-white/25 to-transparent" />}
        <span className="relative flex items-center gap-2">
          {/* el icono se vuelve a montar al cambiar (key), así entra con su animación */}
          <span key={iconKey} className="grid size-4 animate-icon-swap place-items-center">
            {phase === 'done' ? <MdCheck size={16} className="animate-check-pop" />
              : phase === 'pull' ? <MdArrowDownward size={16} className="animate-bounce" />
              : busy || action.icon === 'push' ? <MdArrowUpward size={16} className={busy ? 'animate-arrow-up' : ''} />
              : action.icon === 'pull' ? <MdArrowDownward size={16} />
              : <MdCheck size={16} />}
          </span>
          {phase === 'commit' ? t('git.committing') : phase === 'push' ? t('git.pushing') : phase === 'pull' ? t('git.pulling') : phase === 'done' ? t('git.done') : action.label}
          {phase === 'idle' && action.count > 0 && <span className="rounded-full bg-black/20 px-1.5 text-[10px]">{action.count}</span>}
        </span>
      </button>
      {!git.hasRemote && <p className="-mt-1 px-1 text-center text-[10px] text-muted">{t('git.noRemote')}</p>}
      <button onClick={() => set({ modal: 'branches' })} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-accent-bg">
        <MdCallSplit size={15} className="text-accent" />
        <span className="text-[13px] font-semibold">{git.branch}</span>
        <span className="ml-auto text-[11px] text-muted">
          {git.hasUpstream && (git.ahead || git.behind) ? `${git.behind}↓ ${git.ahead}↑ · ` : ''}{git.files.length} cambios
        </span>
      </button>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {staged.length > 0 && <Group id="staged" title={t('git.staged', { n: staged.length })}>{staged.map((f) => <File key={`s${f.path}`} f={f} isStaged />)}</Group>}
        <Group id="changes" title={t('git.changes', { n: changes.length })} action={changes.length > 0 ? { title: t('git.stageAll'), run: () => void run(t('git.stage'), () => window.api.git.stage(project, changes.map((f) => f.path))) } : undefined}>
          {changes.map((f) => <File key={`c${f.path}`} f={f} isStaged={false} />)}
        </Group>
        {git.files.length === 0 && <p className="px-2 py-3 text-[12px] text-muted">{t('git.clean')}</p>}
      </div>
    </div>
  )
}

function Group({ id, title, children, action }: { id: string; title: string; children: React.ReactNode; action?: { title: string; run: () => void } }) {
  const key = `tutti.git.${id}.collapsed`
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

