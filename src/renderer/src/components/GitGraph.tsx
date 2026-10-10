import { clsx } from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { MdAltRoute, MdCallMerge, MdCallSplit, MdContentCopy, MdLabelOutline, MdLocalOffer, MdRestartAlt, MdSubdirectoryArrowRight, MdUndo, MdOutlineNotes, MdCheckCircleOutline, MdClose } from 'react-icons/md'
import type { GitChangedFile, GitCommit, GitOp } from '@shared/types'
import { GIT_COLOR, refreshGit } from '@/lib/gitSync'
import { layoutGraph, type GraphRow } from '@/lib/graphLayout'
import { t, useT } from '@/lib/i18n'
import { useStore } from '@/store'
import { Menu, type MenuItem } from './Menu'
import { FIELD, Modal } from './ui'

const COLORS = ['#8fa6c4', '#7ee0a1', '#e2c08d', '#ff8a9b', '#c792ea', '#4cc9b0', '#f0a674', '#82aaff']
const STEP = 16, HEIGHT = 28, LIMIT = 400

const when = (ms: number): string => {
  const mins = Math.max(0, (Date.now() - ms) / 60000)
  if (mins < 60) return t('gg.minAgo', { n: Math.max(1, Math.round(mins)) })
  if (mins < 60 * 24) return t('gg.hAgo', { n: Math.round(mins / 60) })
  if (mins < 60 * 24 * 30) return t('gg.dAgo', { n: Math.round(mins / 60 / 24) })
  return new Date(ms).toLocaleDateString()
}

interface Badge { label: string; kind: 'head' | 'branch' | 'remote' | 'tag'; remote?: string }

/** Etiquetas de un commit: la rama local y su copia remota van en una sola etiqueta («main | origin»); la actual se resalta. */
function refBadges(refs: string[]): Badge[] {
  const heads = refs.filter((r) => r.startsWith('HEAD -> ')).map((r) => r.slice(8))
  const plain = refs.filter((r) => !r.startsWith('HEAD -> ') && r !== 'HEAD' && !r.startsWith('tag: '))
  const locals = [...heads, ...plain.filter((r) => !r.includes('/'))]
  const remotes = plain.filter((r) => r.includes('/'))
  const used = new Set<string>()
  const out: Badge[] = locals.map((name) => {
    const twin = remotes.find((r) => r.slice(r.indexOf('/') + 1) === name)
    if (twin) used.add(twin)
    return { label: name, kind: heads.includes(name) ? 'head' : 'branch', remote: twin?.slice(0, twin.indexOf('/')) }
  })
  for (const r of remotes) if (!used.has(r)) out.push({ label: r, kind: 'remote' })
  if (refs.includes('HEAD') && !heads.length) out.unshift({ label: 'HEAD', kind: 'head' })
  for (const r of refs) if (r.startsWith('tag: ')) out.push({ label: r.slice(5), kind: 'tag' })
  return out
}
const BADGE = {
  head: 'bg-accent/25 text-accent ring-1 ring-inset ring-accent/60', branch: 'bg-ok/15 text-ok',
  remote: 'bg-ov/[0.07] text-muted', tag: 'bg-warn/15 text-warn'
}

function RefBadge({ b }: { b: Badge }) {
  return (
    <span className={clsx('inline-flex max-w-[12rem] shrink-0 items-stretch overflow-hidden rounded text-[10px] font-medium', BADGE[b.kind])}>
      <span className="flex items-center gap-1 truncate px-1.5 py-px">
        {b.kind === 'tag' && <MdLocalOffer size={10} />}
        <span className="truncate">{b.label}</span>
      </span>
      {b.remote && <span className="border-l border-ov/10 bg-black/20 px-1.5 py-px text-[9px] opacity-80">{b.remote}</span>}
    </span>
  )
}

function Lines({ row, lanes, head }: { row: GraphRow; lanes: number; head: boolean }) {
  const x = (l: number): number => l * STEP + STEP / 2
  const mid = HEIGHT / 2
  const col = (c: number): string => COLORS[c % COLORS.length]
  const curve = (x1: number, y1: number, x2: number, y2: number): string => `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`
  return (
    <svg width={lanes * STEP} height={HEIGHT} className="shrink-0" style={{ overflow: 'visible' }}>
      {row.through.map((e, i) => <line key={`t${i}`} x1={x(e.lane)} y1={0} x2={x(e.lane)} y2={HEIGHT} stroke={col(e.color)} strokeWidth={1.6} />)}
      {row.incoming && <line x1={x(row.lane)} y1={0} x2={x(row.lane)} y2={mid} stroke={col(row.color)} strokeWidth={1.6} />}
      {row.merges.map((e, i) => <path key={`m${i}`} d={curve(x(e.lane), 0, x(row.lane), mid)} fill="none" stroke={col(e.color)} strokeWidth={1.6} />)}
      {row.parents.map((e, i) => (e.lane === row.lane
        ? <line key={`p${i}`} x1={x(row.lane)} y1={mid} x2={x(row.lane)} y2={HEIGHT} stroke={col(e.color)} strokeWidth={1.6} />
        : <path key={`p${i}`} d={curve(x(row.lane), mid, x(e.lane), HEIGHT)} fill="none" stroke={col(e.color)} strokeWidth={1.6} />))}
      {head && <circle cx={x(row.lane)} cy={mid} r={7} fill="none" stroke={col(row.color)} strokeWidth={1.4} opacity={0.7} />}
      <circle cx={x(row.lane)} cy={mid} r={row.commit.parents.length > 1 ? 3.5 : 4.5} fill={row.commit.parents.length > 1 ? 'var(--color-pop)' : col(row.color)} stroke={col(row.color)} strokeWidth={1.8} />
    </svg>
  )
}

const SHORT = (c: GitCommit): string => c.hash.slice(0, 7)

/** Diálogo pendiente de una operación sobre un commit. */
type Ask =
  | { kind: 'name'; op: 'tag' | 'branch'; commit: GitCommit }
  | { kind: 'confirm'; op: GitOp; commit: GitCommit; title: string; text: string; danger?: boolean; arg?: string }
  | { kind: 'reset'; commit: GitCommit }
  | { kind: 'merge'; commit: GitCommit; target: string; current: string }

/** Dos elementos dentro de una frase, donde el texto tiene los marcadores \u0001 y \u0002. */
const Rich2 = ({ text, a, b }: { text: string; a: React.ReactNode; b: React.ReactNode }) => {
  const [p1, rest = ''] = text.split('\u0001')
  const [p2, p3 = ''] = rest.split('\u0002')
  return <>{p1}{a}{p2}{b}{p3}</>
}

/** Grafo de commits de todas las ramas, con sus etiquetas (se abre como una pestaña más). */
export function GitGraph() {
  const t = useT()
  const project = useStore((s) => s.project)
  const status = useStore((s) => s.git)
  const set = useStore((s) => s.set)
  const toast = useStore((s) => s.toast)
  const [commits, setCommits] = useState<GitCommit[] | null>(null)
  const [reloads, setReloads] = useState(0)
  const [menu, setMenu] = useState<{ commit: GitCommit; anchor: DOMRect } | null>(null)
  const [ask, setAsk] = useState<Ask | null>(null)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  // se relee al abrir, al operar y cuando cambia el estado de git (commit, cambio de rama, pull…)
  useEffect(() => { if (project) void window.api.git.log(project, LIMIT).then(setCommits) }, [project, reloads, status?.branch, status?.ahead, status?.behind, status?.files.length])
  const graph = useMemo(() => layoutGraph(commits ?? []), [commits])
  const changes = status?.files.length ?? 0
  const detail = commits?.find((c) => c.hash === selected) ?? null
  const headIndex = graph.rows.findIndex((r) => r.commit.refs.some((x) => x === 'HEAD' || x.startsWith('HEAD -> ')))
  const headLane = headIndex >= 0 ? graph.rows[headIndex].lane : 0
  const copy = (text: string): void => { navigator.clipboard.writeText(text).catch(() => toast(t('fs.copyFailed'), 'error')) }

  const run = async (op: GitOp, commit: GitCommit, arg?: string, done?: string): Promise<void> => {
    if (!project) return
    setBusy(true)
    const error = await window.api.git.op(project, op, commit.hash, arg, commit.parents.length > 1)
    setBusy(false)
    await refreshGit()
    setReloads((n) => n + 1)
    if (error) toast(error, 'error')
    else if (done) toast(done, 'ok')
  }

  const menuItems = (c: GitCommit): MenuItem[] => {
    const names = c.refs.map((r) => (r.startsWith('HEAD -> ') ? r.slice(8) : r)).filter((r) => r !== 'HEAD' && !r.startsWith('tag: ') && !r.endsWith('/HEAD'))
    const local = names.filter((r) => !r.includes('/'))
    // ramas remotas de este commit que aún no tienen copia local (al cambiar a ellas se crea la local)
    const remote = names.filter((r) => r.includes('/') && !local.includes(r.slice(r.indexOf('/') + 1)))
    const go = async (name: string, isRemote: boolean): Promise<void> => {
      if (!project) return
      const error = await window.api.git.checkout(project, name, isRemote)
      await refreshGit(); setReloads((n) => n + 1)
      if (error) toast(error, 'error')
    }
    const switches: MenuItem[] = [
      ...local.filter((b) => b !== status?.branch).map((b) => ({ label: t('gg.switchBranch', { name: b }), icon: <MdCheckCircleOutline size={14} />, onClick: () => void go(b, false) })),
      ...remote.map((b) => ({ label: t('gg.switchRemote', { name: b }), icon: <MdCheckCircleOutline size={14} />, onClick: () => void go(b, true) }))
    ]
    if (!switches.length) switches.push({ label: t('gg.checkoutItem'), icon: <MdCheckCircleOutline size={14} />,
      onClick: () => setAsk({ kind: 'confirm', op: 'checkout', commit: c, title: t('gg.checkoutTitle'), text: t('gg.checkoutText', { hash: SHORT(c) }) }) })
    return [
      { label: t('gg.addTag'), icon: <MdLabelOutline size={14} />, onClick: () => setAsk({ kind: 'name', op: 'tag', commit: c }) },
      { label: t('gg.createBranchHere'), icon: <MdCallSplit size={14} />, onClick: () => setAsk({ kind: 'name', op: 'branch', commit: c }) },
      ...switches.map((x, i) => (i === 0 ? { ...x, separator: true } : x)),
      { label: 'Cherry-pick…', separator: true, icon: <MdSubdirectoryArrowRight size={14} />, onClick: () => setAsk({ kind: 'confirm', op: 'cherry-pick', commit: c, title: 'Cherry-pick', text: t('gg.cherryText', { hash: SHORT(c), branch: status?.branch ?? 'HEAD' }) }) },
      { label: t('gg.revert'), icon: <MdUndo size={14} />, onClick: () => setAsk({ kind: 'confirm', op: 'revert', commit: c, title: t('gg.revertTitle'), text: t('gg.revertText', { branch: status?.branch ?? 'HEAD', hash: SHORT(c) }) }) },
      { label: t('gg.mergeItem'), icon: <MdCallMerge size={14} />, onClick: () => setAsk({ kind: 'merge', commit: c, target: local.find((b) => b !== status?.branch) ?? remote[0] ?? SHORT(c), current: status?.branch ?? 'HEAD' }) },
      { label: t('gg.rebaseItem'), icon: <MdAltRoute size={14} />, onClick: () => setAsk({ kind: 'confirm', op: 'rebase', commit: c, title: t('gg.rebaseTitle'), text: t('gg.rebaseText', { branch: status?.branch ?? 'HEAD', hash: SHORT(c) }), danger: true }) },
      { label: t('gg.resetItem'), icon: <MdRestartAlt size={14} />, onClick: () => setAsk({ kind: 'reset', commit: c }) },
      { label: t('gg.copyHash'), separator: true, icon: <MdContentCopy size={14} />, onClick: () => copy(c.hash) },
      { label: t('gg.copyMessage'), icon: <MdOutlineNotes size={14} />, onClick: () => copy(c.subject) }
    ]
  }

  if (!project) return <div className="grid flex-1 place-items-center text-[12px] text-muted">{t('gg.openProject')}</div>
  return (
    <div className="flex min-h-0 flex-1 flex-col">
    <div className="@container min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-2">
      {commits === null && <p className="px-2 py-4 text-[12px] text-muted">{t('gg.reading')}</p>}
      {commits?.length === 0 && <p className="px-2 py-4 text-[12px] text-muted">{t('gg.noCommits')}</p>}
      <div className="relative">
        {commits && changes > 0 && headIndex >= 0 && (
          <svg className="pointer-events-none absolute left-0 top-0" width={graph.lanes * STEP} height={(headIndex + 2) * HEIGHT} style={{ overflow: 'visible' }}>
            <line x1={headLane * STEP + STEP / 2} y1={HEIGHT / 2 + 5} x2={headLane * STEP + STEP / 2} y2={(headIndex + 1) * HEIGHT + HEIGHT / 2 - 8} stroke="#8b92a8" strokeWidth={1.6} strokeDasharray="3 3" />
          </svg>
        )}
      {commits && changes > 0 && (
        <div onClick={() => set({ tab: 'git' })} title={t('gg.uncommittedTip')} style={{ height: HEIGHT }}
          className="flex cursor-pointer items-center gap-2 rounded-md pr-2 text-[12px] transition-colors hover:bg-accent-bg">
          <svg width={graph.lanes * STEP} height={HEIGHT} className="shrink-0" style={{ overflow: 'visible' }}>
            <circle cx={headLane * STEP + STEP / 2} cy={HEIGHT / 2} r={4.5} fill="var(--color-surface)" stroke="#8b92a8" strokeWidth={1.8} />
          </svg>
          <span className="font-medium text-muted">{t('gg.uncommitted', { n: changes })}</span>
        </div>
      )}
      {graph.rows.map((row) => {
        const merge = row.commit.parents.length > 1 || /^(Merge|Merged)\b/i.test(row.commit.subject)      // merges de dos padres y los que solo dicen «Merge…»
        return (
          <div key={row.commit.hash} onClick={() => setSelected((h) => (h === row.commit.hash ? null : row.commit.hash))} onContextMenu={(e) => { e.preventDefault(); setMenu({ commit: row.commit, anchor: new DOMRect(e.clientX + 290, e.clientY, 0, 0) }) }}
            title={t('gg.rowTip', { hash: row.commit.hash, author: row.commit.author, date: new Date(row.commit.time).toLocaleString() })}
            className={clsx('flex cursor-pointer items-center gap-2 rounded-md pr-2 text-[12px] transition-colors hover:bg-accent-bg', selected === row.commit.hash && 'bg-accent-bg ring-1 ring-inset ring-accent/40')} style={{ height: HEIGHT }}>
            <Lines row={row} lanes={graph.lanes} head={row.commit.refs.some((r) => r === 'HEAD' || r.startsWith('HEAD -> '))} />
            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
              {refBadges(row.commit.refs).map((b) => <RefBadge key={`${b.kind}${b.label}`} b={b} />)}
              <span className={clsx('min-w-0 flex-1 truncate', merge && 'opacity-50')}>{row.commit.subject}</span>
            </div>
            <span className="hidden w-28 shrink-0 truncate text-[11px] text-muted @2xl:block">{row.commit.author}</span>
            <span className="hidden w-24 shrink-0 text-right text-[11px] text-muted @md:block">{when(row.commit.time)}</span>
            <span className="hidden w-14 shrink-0 text-right font-mono text-[11px] text-muted/70 @lg:block">{SHORT(row.commit)}</span>
          </div>
        )
      })}
      </div>
      {commits && commits.length >= LIMIT && <p className="px-2 pt-2 text-center text-[11px] text-muted">{t('gg.lastN', { n: LIMIT })}</p>}
      {menu && <Menu width={290} anchor={menu.anchor} onClose={() => setMenu(null)} items={menuItems(menu.commit)} />}
      {ask && <AskDialog ask={ask} busy={busy} onClose={() => setAsk(null)} onOk={(op, commit, arg, done) => { setAsk(null); void run(op, commit, arg, done) }} />}
    </div>
    {detail && <CommitDetail commit={detail} project={project} onClose={() => setSelected(null)} onCopy={copy} />}
    </div>
  )
}

function AskDialog({ ask, busy, onClose, onOk }: { ask: Ask; busy: boolean; onClose: () => void; onOk: (op: GitOp, commit: GitCommit, arg?: string, done?: string) => void }) {
  const t = useT()
  const [name, setName] = useState('')
  const btn = 'rounded-lg px-4 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50'
  const cancel = <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-[12px] text-muted transition-colors hover:text-text">{t('dlg.cancel')}</button>

  if (ask.kind === 'name') {
        const valid = /^(?!-)[A-Za-z0-9._/-]+$/.test(name) && !name.endsWith('/') && !name.includes('..')
    const submit = (): void => { if (valid) onOk(ask.op, ask.commit, name, ask.op === 'tag' ? t('gg.tagDone', { name }) : t('gg.branchDone', { name })) }
    return (
      <Modal onClose={onClose} width={400} title={ask.op === 'tag' ? t('gg.addTagTitle') : t('gg.createBranchTitle')}>
        <div className="flex flex-col gap-3 px-4 pb-4">
          <p className="text-[12px] text-muted">{t('gg.atCommit', { hash: SHORT(ask.commit), subject: ask.commit.subject })}</p>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} spellCheck={false} placeholder={ask.op === 'tag' ? t('gg.namePlaceholderTag') : t('gg.namePlaceholderBranch')}
            className={FIELD} />
          <div className="flex justify-end gap-2">{cancel}<button disabled={!valid || busy} onClick={submit} className={`${btn} bg-accent text-bg hover:brightness-110`}>{t('gg.create')}</button></div>
        </div>
      </Modal>
    )
  }
  if (ask.kind === 'merge') return <MergeDialog ask={ask} busy={busy} onClose={onClose} onOk={onOk} />
  if (ask.kind === 'reset') {
    const go = (op: GitOp, done: string): void => onOk(op, ask.commit, undefined, done)
    return (
      <Modal onClose={onClose} width={460} title={t('gg.resetTitle')}>
        <div className="flex flex-col gap-3 px-4 pb-4">
          <p className="text-[12px] leading-relaxed text-muted">{t('gg.resetBody', { hash: SHORT(ask.commit), subject: ask.commit.subject })}</p>
          <div className="flex flex-col gap-1.5 text-[12px]">
            <button disabled={busy} onClick={() => go('reset-soft', t('gg.softDone'))} className={`${btn} bg-ov/[0.05] text-left font-normal hover:bg-ov/[0.09]`}><b>{t('gg.soft')}</b> <span className="text-muted">{t('gg.softNote')}</span></button>
            <button disabled={busy} onClick={() => go('reset-mixed', t('gg.mixedDone'))} className={`${btn} bg-ov/[0.05] text-left font-normal hover:bg-ov/[0.09]`}><b>{t('gg.mixed')}</b> <span className="text-muted">{t('gg.mixedNote')}</span></button>
            <button disabled={busy} onClick={() => go('reset-hard', t('gg.hardDone'))} className={`${btn} bg-danger/15 text-left font-normal text-danger hover:bg-danger/25`}><b>{t('gg.hard')}</b>{t('gg.hardNote')}</button>
          </div>
          <div className="flex justify-end">{cancel}</div>
        </div>
      </Modal>
    )
  }
  return (
    <Modal onClose={onClose} width={440} title={ask.title}>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <p className="text-[12px] leading-relaxed text-muted">{ask.text}</p>
        <div className="flex justify-end gap-2">{cancel}
          <button autoFocus disabled={busy} onClick={() => onOk(ask.op, ask.commit, ask.arg, t('gg.opDone', { title: ask.title }))} className={`${btn} ${ask.danger ? 'bg-danger/20 text-danger hover:bg-danger/30' : 'bg-accent text-bg hover:brightness-110'}`}>{t('gg.accept')}</button>
        </div>
      </div>
    </Modal>
  )
}

function MergeDialog({ ask, busy, onClose, onOk }: { ask: Extract<Ask, { kind: 'merge' }>; busy: boolean; onClose: () => void; onOk: (op: GitOp, commit: GitCommit, arg?: string, done?: string) => void }) {
  const t = useT()
  const btn = 'rounded-lg px-4 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50'
  const cancel = <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-[12px] text-muted transition-colors hover:text-text">Cancelar</button>
    const [noff, setNoff] = useState(true)
    const [squash, setSquash] = useState(false)
    const [nocommit, setNocommit] = useState(false)
    const opts = squash ? 'squash' : [noff && 'noff', nocommit && 'nocommit'].filter(Boolean).join(',')
    const Check = ({ on, set, label, hint, disabled }: { on: boolean; set: (v: boolean) => void; label: string; hint: string; disabled?: boolean }) => (
      <label title={hint} className={clsx('flex items-center gap-2.5 text-[12px]', disabled ? 'opacity-40' : 'cursor-pointer')}>
        <input type="checkbox" checked={on && !disabled} disabled={disabled} onChange={(e) => set(e.target.checked)} className="size-3.5 accent-[var(--color-accent)]" />
        {label}
      </label>
    )
    return (
      <Modal onClose={onClose} width={480} title={t('gg.mergeTitle')}>
        <div className="flex flex-col gap-3 px-4 pb-4">
          <p className="text-[12px] leading-relaxed text-muted"><Rich2 text={t('gg.mergeBody', { target: '\u0001', current: '\u0002' })} a={<b className="text-text">{ask.target}</b>} b={<b className="text-text">{ask.current}</b>} /></p>
          <div className="flex flex-col gap-2">
            <Check on={noff} set={setNoff} disabled={squash} label={t('gg.noff')} hint={t('gg.noffHint')} />
            <Check on={squash} set={setSquash} label={t('gg.squash')} hint={t('gg.squashHint')} />
            <Check on={nocommit} set={setNocommit} disabled={squash} label={t('gg.nocommit')} hint={t('gg.nocommitHint')} />
          </div>
          <div className="flex justify-end gap-2">{cancel}
            <button autoFocus disabled={busy} onClick={() => onOk('merge', ask.commit, opts, squash || nocommit ? t('gg.mergedPending') : t('gg.mergeDone'))} className={`${btn} bg-accent text-bg hover:brightness-110`}>{t('gg.yesMerge')}</button>
          </div>
        </div>
      </Modal>
    )
}

/** Panel de abajo: datos del commit y los archivos que cambió (en un merge, lo que trajo la rama unida). */
function CommitDetail({ commit, project, onClose, onCopy }: { commit: GitCommit; project: string; onClose: () => void; onCopy: (text: string) => void }) {
  const t = useT()
  const openCommitDiff = useStore((s) => s.openCommitDiff)
  const [files, setFiles] = useState<GitChangedFile[] | null>(null)
  const parent = commit.parents[0] ?? null
  const merge = commit.parents.length > 1

  useEffect(() => { setFiles(null); void window.api.git.commitFiles(project, commit.hash, parent).then(setFiles) }, [project, commit.hash, parent])
  const label = parent ? `${parent.slice(0, 7)} → ${commit.hash.slice(0, 7)}` : t('gg.initial', { hash: commit.hash.slice(0, 7) })
  const total = (files ?? []).reduce((n, f) => [n[0] + f.added, n[1] + f.deleted], [0, 0])

  return (
    <div className="flex max-h-[48%] min-h-[120px] shrink-0 flex-col border-t border-line bg-panel">
      <div className="flex items-start gap-2 px-3 pb-1.5 pt-2">
        <div className="min-w-0 flex-1">
          <p className="break-words text-[12.5px] font-medium leading-snug">{commit.subject}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
            <button title={t('gg.copyFull')} onClick={() => onCopy(commit.hash)} className="font-mono transition-colors hover:text-accent">{commit.hash.slice(0, 10)}</button>
            <span>{commit.author}</span><span>{new Date(commit.time).toLocaleString()}</span>
            {merge && <span className="text-accent">{t('gg.mergeOf', { parents: commit.parents.map((p) => p.slice(0, 7)).join(' + ') })}</span>}
          </p>
        </div>
        <button title={t('gg.close')} onClick={onClose} className="grid size-5 shrink-0 place-items-center rounded text-muted transition-colors hover:bg-line hover:text-text"><MdClose size={13} /></button>
      </div>
      <div className="flex items-center gap-2 px-3 pb-1 text-[10px] font-semibold tracking-wide text-muted">
        <span>{merge ? t('gg.mergeBrought') : t('gg.changedFiles')} · {files?.length ?? '…'}</span>
        {files && <><span className="text-ok">+{total[0]}</span><span className="text-danger">−{total[1]}</span></>}
        {merge && <span className="font-normal opacity-70">{t('gg.relativeTo', { hash: parent!.slice(0, 7) })}</span>}
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {files?.length === 0 && <li className="px-2 py-1 text-[11px] text-muted">{t('gg.noFileChanges')}</li>}
        {files?.map((f) => (
          <li key={f.path}>
            <button onClick={() => void openCommitDiff(commit.hash, parent, f.path, label)} title={t('gg.viewFile')}
              className="flex w-full items-center gap-2 rounded px-2 py-[3px] text-left text-[12px] transition-colors hover:bg-accent-bg">
              <span className="w-3 shrink-0 text-center text-[10px] font-semibold" style={{ color: GIT_COLOR[f.status] }}>{f.status}</span>
              <span className="min-w-0 flex-1 truncate" style={{ direction: 'rtl', textAlign: 'left' }}><bdi>{f.path}</bdi></span>
              <span className="shrink-0 text-[11px] text-ok">+{f.added}</span>
              <span className="shrink-0 text-[11px] text-danger">−{f.deleted}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
