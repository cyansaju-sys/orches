import { clsx } from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { MdAltRoute, MdCallMerge, MdCallSplit, MdContentCopy, MdLabelOutline, MdRestartAlt, MdSubdirectoryArrowRight, MdUndo, MdOutlineNotes, MdCheckCircleOutline } from 'react-icons/md'
import type { GitCommit, GitOp } from '@shared/types'
import { refreshGit } from '@/lib/gitSync'
import { layoutGraph, type GraphRow } from '@/lib/graphLayout'
import { useStore } from '@/store'
import { Menu, type MenuItem } from './Menu'
import { Modal } from './ui'

const COLORS = ['#8fa6c4', '#7ee0a1', '#e2c08d', '#ff8a9b', '#c792ea', '#4cc9b0', '#f0a674', '#82aaff']
const STEP = 16, HEIGHT = 28, LIMIT = 400

const when = (ms: number): string => {
  const mins = Math.max(0, (Date.now() - ms) / 60000)
  if (mins < 60) return `hace ${Math.max(1, Math.round(mins))} min`
  if (mins < 60 * 24) return `hace ${Math.round(mins / 60)} h`
  if (mins < 60 * 24 * 30) return `hace ${Math.round(mins / 60 / 24)} d`
  return new Date(ms).toLocaleDateString()
}

/** Etiquetas de un commit: «HEAD -> main» se queda en «main» (la actual), y se distinguen remotas y tags. */
function refBadges(refs: string[]): Array<{ label: string; kind: 'head' | 'branch' | 'remote' | 'tag' }> {
  return refs.map((r) => {
    if (r.startsWith('HEAD -> ')) return { label: r.slice(8), kind: 'head' as const }
    if (r === 'HEAD') return { label: 'HEAD', kind: 'head' as const }
    if (r.startsWith('tag: ')) return { label: r.slice(5), kind: 'tag' as const }
    return { label: r, kind: r.includes('/') ? ('remote' as const) : ('branch' as const) }
  })
}
const BADGE = { head: 'bg-accent/25 text-accent', branch: 'bg-ok/15 text-ok', remote: 'bg-white/[0.07] text-muted', tag: 'bg-warn/15 text-warn' }

function Lines({ row, lanes }: { row: GraphRow; lanes: number }) {
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
      <circle cx={x(row.lane)} cy={mid} r={row.commit.parents.length > 1 ? 3.5 : 4.5} fill={row.commit.parents.length > 1 ? '#0f121a' : col(row.color)} stroke={col(row.color)} strokeWidth={1.8} />
    </svg>
  )
}

const SHORT = (c: GitCommit): string => c.hash.slice(0, 7)

/** Diálogo pendiente de una operación sobre un commit. */
type Ask =
  | { kind: 'name'; op: 'tag' | 'branch'; commit: GitCommit }
  | { kind: 'confirm'; op: GitOp; commit: GitCommit; title: string; text: string; danger?: boolean; arg?: string }
  | { kind: 'reset'; commit: GitCommit }

/** Grafo de commits de todas las ramas, con sus etiquetas (se abre como una pestaña más). */
export function GitGraph() {
  const project = useStore((s) => s.project)
  const status = useStore((s) => s.git)
  const toast = useStore((s) => s.toast)
  const [commits, setCommits] = useState<GitCommit[] | null>(null)
  const [reloads, setReloads] = useState(0)
  const [menu, setMenu] = useState<{ commit: GitCommit; anchor: DOMRect } | null>(null)
  const [ask, setAsk] = useState<Ask | null>(null)
  const [busy, setBusy] = useState(false)

  // se relee al abrir, al operar y cuando cambia el estado de git (commit, cambio de rama, pull…)
  useEffect(() => { if (project) void window.api.git.log(project, LIMIT).then(setCommits) }, [project, reloads, status?.branch, status?.ahead, status?.behind, status?.files.length])
  const graph = useMemo(() => layoutGraph(commits ?? []), [commits])
  const copy = (text: string): void => { navigator.clipboard.writeText(text).catch(() => toast('No se pudo copiar', 'error')) }

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
      ...local.filter((b) => b !== status?.branch).map((b) => ({ label: `Cambiar a la rama ${b}`, icon: <MdCheckCircleOutline size={14} />, onClick: () => void go(b, false) })),
      ...remote.map((b) => ({ label: `Cambiar a ${b} (crea la local)`, icon: <MdCheckCircleOutline size={14} />, onClick: () => void go(b, true) }))
    ]
    if (!switches.length) switches.push({ label: 'Checkout de este commit…', icon: <MdCheckCircleOutline size={14} />,
      onClick: () => setAsk({ kind: 'confirm', op: 'checkout', commit: c, title: 'Checkout de un commit', text: `Te pondrás en ${SHORT(c)} sin rama (HEAD separado). Para conservar lo que hagas, crea una rama antes de hacer commits.` }) })
    return [
      { label: 'Añadir etiqueta…', icon: <MdLabelOutline size={14} />, onClick: () => setAsk({ kind: 'name', op: 'tag', commit: c }) },
      { label: 'Crear rama aquí…', icon: <MdCallSplit size={14} />, onClick: () => setAsk({ kind: 'name', op: 'branch', commit: c }) },
      ...switches,
      { label: 'Cherry-pick…', icon: <MdSubdirectoryArrowRight size={14} />, onClick: () => setAsk({ kind: 'confirm', op: 'cherry-pick', commit: c, title: 'Cherry-pick', text: `Se aplicarán los cambios de ${SHORT(c)} como un commit nuevo en «${status?.branch}».` }) },
      { label: 'Revertir…', icon: <MdUndo size={14} />, onClick: () => setAsk({ kind: 'confirm', op: 'revert', commit: c, title: 'Revertir', text: `Se creará un commit nuevo en «${status?.branch}» que deshace los cambios de ${SHORT(c)}.` }) },
      { label: 'Unir a la rama actual…', icon: <MdCallMerge size={14} />, onClick: () => setAsk({ kind: 'confirm', op: 'merge', commit: c, title: 'Unir (merge)', text: `Se unirá ${SHORT(c)} a «${status?.branch}».` }) },
      { label: 'Rebase de la rama actual sobre este commit…', icon: <MdAltRoute size={14} />, onClick: () => setAsk({ kind: 'confirm', op: 'rebase', commit: c, title: 'Rebase', text: `Los commits de «${status?.branch}» se volverán a aplicar encima de ${SHORT(c)}. Cambia su historial.`, danger: true }) },
      { label: 'Reset de la rama actual a este commit…', icon: <MdRestartAlt size={14} />, onClick: () => setAsk({ kind: 'reset', commit: c }) },
      { label: 'Copiar hash', icon: <MdContentCopy size={14} />, onClick: () => copy(c.hash) },
      { label: 'Copiar mensaje', icon: <MdOutlineNotes size={14} />, onClick: () => copy(c.subject) }
    ]
  }

  if (!project) return <div className="grid flex-1 place-items-center text-[12px] text-muted">Abre un proyecto para ver su grafo</div>
  return (
    <div className="@container min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-2">
      {commits === null && <p className="px-2 py-4 text-[12px] text-muted">Leyendo el historial…</p>}
      {commits?.length === 0 && <p className="px-2 py-4 text-[12px] text-muted">Este repositorio todavía no tiene commits</p>}
      {graph.rows.map((row) => {
        const merge = row.commit.parents.length > 1 || /^(Merge|Merged)\b/i.test(row.commit.subject)      // merges de dos padres y los que solo dicen «Merge…»
        return (
          <div key={row.commit.hash} onClick={() => copy(row.commit.hash)} onContextMenu={(e) => { e.preventDefault(); setMenu({ commit: row.commit, anchor: new DOMRect(e.clientX + 290, e.clientY, 0, 0) }) }}
            title={`${row.commit.hash}\n${row.commit.author} · ${new Date(row.commit.time).toLocaleString()}\nClic: copiar hash · clic derecho: más acciones`}
            className="flex cursor-pointer items-center gap-2 rounded-md pr-2 text-[12px] transition-colors hover:bg-accent-bg" style={{ height: HEIGHT }}>
            <Lines row={row} lanes={graph.lanes} />
            <div className={clsx('flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden', merge && 'opacity-50')}>
              {refBadges(row.commit.refs).map((b) => <span key={b.label} className={clsx('max-w-[9rem] shrink-0 truncate rounded px-1.5 py-px text-[10px] font-medium', BADGE[b.kind])}>{b.label}</span>)}
              <span className="min-w-0 flex-1 truncate">{row.commit.subject}</span>
            </div>
            <span className="hidden w-28 shrink-0 truncate text-[11px] text-muted @2xl:block">{row.commit.author}</span>
            <span className="hidden w-24 shrink-0 text-right text-[11px] text-muted @md:block">{when(row.commit.time)}</span>
            <span className="hidden w-14 shrink-0 text-right font-mono text-[11px] text-muted/70 @lg:block">{SHORT(row.commit)}</span>
          </div>
        )
      })}
      {commits && commits.length >= LIMIT && <p className="px-2 pt-2 text-center text-[11px] text-muted">Se muestran los últimos {LIMIT} commits</p>}
      {menu && <Menu width={290} anchor={menu.anchor} onClose={() => setMenu(null)} items={menuItems(menu.commit)} />}
      {ask && <AskDialog ask={ask} busy={busy} onClose={() => setAsk(null)} onOk={(op, commit, arg, done) => { setAsk(null); void run(op, commit, arg, done) }} />}
    </div>
  )
}

function AskDialog({ ask, busy, onClose, onOk }: { ask: Ask; busy: boolean; onClose: () => void; onOk: (op: GitOp, commit: GitCommit, arg?: string, done?: string) => void }) {
  const [name, setName] = useState('')
  const btn = 'rounded-lg px-4 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50'
  const cancel = <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-[12px] text-muted transition-colors hover:bg-white/[0.05]">Cancelar</button>

  if (ask.kind === 'name') {
    const label = ask.op === 'tag' ? 'etiqueta' : 'rama'
    const valid = /^(?!-)[A-Za-z0-9._/-]+$/.test(name) && !name.endsWith('/') && !name.includes('..')
    const submit = (): void => { if (valid) onOk(ask.op, ask.commit, name, ask.op === 'tag' ? `Etiqueta «${name}» creada` : `Rama «${name}» creada`) }
    return (
      <Modal onClose={onClose} width={400} title={ask.op === 'tag' ? 'Añadir etiqueta' : 'Crear rama'}>
        <div className="flex flex-col gap-3 px-4 pb-4">
          <p className="text-[12px] text-muted">En el commit {SHORT(ask.commit)} · {ask.commit.subject}</p>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} spellCheck={false} placeholder={`Nombre de la ${label}`}
            className="w-full rounded-lg bg-white/[0.05] px-3 py-2 text-[12px] caret-accent outline-none transition-colors placeholder:text-muted/70 focus:bg-white/[0.08]" />
          <div className="flex justify-end gap-2">{cancel}<button disabled={!valid || busy} onClick={submit} className={`${btn} bg-accent/20 text-accent hover:bg-accent/30`}>Crear</button></div>
        </div>
      </Modal>
    )
  }
  if (ask.kind === 'reset') {
    const go = (op: GitOp, done: string): void => onOk(op, ask.commit, undefined, done)
    return (
      <Modal onClose={onClose} width={460} title="Reset de la rama actual">
        <div className="flex flex-col gap-3 px-4 pb-4">
          <p className="text-[12px] leading-relaxed text-muted">La rama se moverá a {SHORT(ask.commit)} · {ask.commit.subject}. Elige qué pasa con los cambios:</p>
          <div className="flex flex-col gap-1.5 text-[12px]">
            <button disabled={busy} onClick={() => go('reset-soft', 'Reset suave hecho')} className={`${btn} bg-white/[0.05] text-left font-normal hover:bg-white/[0.09]`}><b>Suave</b> <span className="text-muted">· conserva los cambios preparados</span></button>
            <button disabled={busy} onClick={() => go('reset-mixed', 'Reset hecho')} className={`${btn} bg-white/[0.05] text-left font-normal hover:bg-white/[0.09]`}><b>Mixto</b> <span className="text-muted">· conserva los cambios sin preparar</span></button>
            <button disabled={busy} onClick={() => go('reset-hard', 'Reset duro hecho')} className={`${btn} bg-danger/15 text-left font-normal text-danger hover:bg-danger/25`}><b>Duro</b> · descarta todos los cambios sin guardar</button>
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
          <button autoFocus disabled={busy} onClick={() => onOk(ask.op, ask.commit, ask.arg, `${ask.title} hecho`)} className={`${btn} ${ask.danger ? 'bg-danger/20 text-danger hover:bg-danger/30' : 'bg-accent/20 text-accent hover:bg-accent/30'}`}>Aceptar</button>
        </div>
      </div>
    </Modal>
  )
}
