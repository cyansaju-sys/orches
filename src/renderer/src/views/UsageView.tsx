import { clsx } from 'clsx'
import { useCallback, useEffect, useState } from 'react'
import { MdDeleteOutline, MdDeleteSweep, MdEdit, MdKeyboardArrowDown, MdKeyboardArrowRight, MdMoreHoriz, MdPlayArrow } from 'react-icons/md'
import type { AgentUsage, LimitInfo, SessionInfo, UsageData } from '@shared/types'
import { AgentIcon } from '@/components/AgentIcon'
import { Menu } from '@/components/Menu'
import { FIELD, Modal } from '@/components/ui'
import { ago, fmtDelta, fmtTokens, resumeArgs, severity } from '@/lib/format'
import { basename } from '@/lib/paths'
import { useStore } from '@/store'

const REFRESH_MS = 30_000
const WINDOW_MS = 5 * 3_600_000
const BAR: Record<string, string> = { danger: 'bg-danger', warn: 'bg-warn', accent: 'bg-accent' }

function Bar({ value, tone = 'accent' }: { value: number; tone?: string }) {
  return (
    <div className="h-[5px] overflow-hidden rounded-full bg-white/[0.07]">
      <div className={clsx('h-full rounded-full transition-all duration-500', BAR[tone])} style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} />
    </div>
  )
}

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between text-[11px]"><span className="text-muted">{label}</span><span>{value}</span></div>
)

function Limit({ limit, extra, now }: { limit: LimitInfo; extra?: string; now: number }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-[12px]"><span>{limit.label}</span><span className="tabular-nums">{limit.percent.toFixed(0)}%</span></div>
      <Bar value={limit.percent / 100} tone={severity(limit.percent)} />
      <div className="text-[10px] text-muted">Se reinicia en {fmtDelta(limit.resetsAt - now)}{extra ? ` · ${extra}` : ''}</div>
    </div>
  )
}

function Card({ u, now }: { u: AgentUsage; now: number }) {
  const w = u.window
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-surface p-3">
      <div className="flex items-center gap-2"><AgentIcon name={u.name} command={u.command} size={18} /><span className="text-[13px] font-semibold">{u.name}</span></div>
      {u.limits.length > 0 ? (
        <>
          {u.limits.map((l, i) => <Limit key={l.label} limit={l} now={now} extra={i === 0 && w ? `${fmtTokens(w.tokens)} tokens` : undefined} />)}
          {u.limitsAge > 600 && <div className="text-[10px] text-muted">Actualizado hace {fmtDelta(u.limitsAge * 1000)}</div>}
        </>
      ) : w ? (
        <>
          <div className="text-[20px] font-semibold text-accent">{fmtTokens(w.tokens)} tokens</div>
          <div className="-mt-1.5 text-[11px] text-muted">en la sesión actual</div>
          <Bar value={(now - w.start) / WINDOW_MS} />
          <div className="text-[11px]">Se reinicia en {fmtDelta(w.end - now)} · {new Date(w.end).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })} (estimado)</div>
        </>
      ) : u.note ? (
        <div className="text-[11px] text-muted">{u.note}</div>
      ) : (
        <div className="text-[11px] text-muted">Sin sesión activa. La ventana de 5 h empieza con tu próximo mensaje.</div>
      )}
      {u.limitsError && u.limits.length === 0 && <div className="text-[10px] text-muted">{u.limitsError}</div>}
      {(u.total > 0) && (
        <div className="flex flex-col gap-1 border-t border-line pt-2">
          <Row label="Hoy" value={fmtTokens(u.today)} /><Row label="7 días" value={fmtTokens(u.week)} /><Row label="Total" value={fmtTokens(u.total)} />
          {u.note && (w || u.limits.length > 0) && <div className="pt-1 text-[10px] text-muted">{u.note}</div>}
        </div>
      )}
    </div>
  )
}

function Section({ title, id, detail, folded, onToggle, children }: { title: string; id: string; detail?: string; folded: boolean; onToggle: (id: string) => void; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <button onClick={() => onToggle(id)} className="flex items-center gap-1 rounded-md px-0.5 py-1 text-left transition-colors hover:bg-accent-bg">
        {folded ? <MdKeyboardArrowRight size={16} className="text-muted" /> : <MdKeyboardArrowDown size={16} className="text-muted" />}
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{title}</span>
        <span className="ml-1 min-w-0 flex-1 truncate text-[10px] text-muted">{detail}</span>
      </button>
      {!folded && children}
    </section>
  )
}

/** Consumo de tokens, reinicio e historial de cada agente instalado. */
export function UsageView() {
  const project = useStore((s) => s.project)
  const agents = useStore((s) => s.agents)
  const set = useStore((s) => s.set)
  const openAgent = useStore((s) => s.openAgent)
  const toast = useStore((s) => s.toast)
  const [data, setData] = useState<UsageData | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [folded, setFolded] = useState<Record<string, boolean>>({})
  const [menu, setMenu] = useState<{ session: SessionInfo; anchor: DOMRect } | null>(null)
  const [renaming, setRenaming] = useState<SessionInfo | null>(null)
  const [deleting, setDeleting] = useState<SessionInfo | null>(null)
  const [clearing, setClearing] = useState(false)
  const [now, setNow] = useState(Date.now())

  const load = useCallback(async (fetchLimits: boolean) => {
    const [usage, saved] = await Promise.all([window.api.usage.collect(project, fetchLimits), window.api.usage.names()])
    setData(usage); setNames(saved); setNow(Date.now())
  }, [project])

  useEffect(() => { void window.api.agents.detect().then((a) => set({ agents: a })); void window.api.settings.get('collapsed').then((c) => setFolded((c as Record<string, boolean>) ?? {})) }, [set])
  // al abrir la pestaña se consulta a Anthropic una vez (los límites reales); después solo se relee lo local
  useEffect(() => { void load(true); const t = setInterval(() => void load(false), REFRESH_MS); return () => clearInterval(t) }, [load])

  const toggle = (id: string): void => { const next = { ...folded, [id]: !folded[id] }; setFolded(next); void window.api.settings.set('collapsed', next) }
  const title = (s: SessionInfo): string => names[`${s.command}:${s.id}`] || s.title

  const resume = (s: SessionInfo): void => {
    const args = resumeArgs(s.command, s.id)
    const agent = agents.find((a) => a.command === s.command)
    if (!args || !agent) { toast('No se puede retomar esta sesión desde aquí', 'error'); return }
    void openAgent(agent, args, { cwd: s.cwd || undefined, title: `${s.agent} · ${title(s)}` })
  }

  if (!data) return <p className="px-3 text-[11px] text-muted">Leyendo consumo…</p>
  if (!data.agents.length) return <p className="px-3 text-[12px] text-muted">No hay agentes instalados</p>

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto px-2 pb-3">
      <Section title="Uso" id="usage" folded={!!folded.usage} onToggle={toggle}>
        {data.agents.map((u) => <Card key={u.command} u={u} now={now} />)}
      </Section>
      <Section title="Historial" id="history" detail={project ? basename(project) : ''} folded={!!folded.history} onToggle={toggle}>
        {!project && <p className="px-1 text-[11px] text-muted">Abre un proyecto para ver su historial</p>}
        {project && data.history.length === 0 && <p className="px-1 text-[11px] text-muted">Sin sesiones en este proyecto</p>}
        {project && data.history.length > 0 && (
          <button onClick={() => setClearing(true)} title="Borrar todas las sesiones de este proyecto"
            className="flex items-center gap-1.5 self-end rounded-md px-2 py-1 text-[11px] text-muted transition-colors hover:bg-danger/10 hover:text-danger">
            <MdDeleteSweep size={14} /> Borrar historial
          </button>
        )}
        <ul className="flex flex-col gap-0.5">
          {data.history.slice(0, 12).map((s) => {
            const can = resumeArgs(s.command, s.id) !== null
            return (
              <li key={`${s.command}:${s.id}`} className="group flex items-center rounded-lg transition-colors hover:bg-accent-bg">
                <button disabled={!can} onClick={() => resume(s)} title={can ? 'Retomar esta sesión' : undefined} className="min-w-0 flex-1 px-2 py-1.5 text-left">
                  <span className="block truncate text-[12px]">{title(s)}</span>
                  <span className="block truncate text-[10px] text-muted">{s.agent} · {s.project} · {ago(s.end, now)} · {fmtTokens(s.tokens)}</span>
                </button>
                <button title="Más acciones" onClick={(e) => setMenu({ session: s, anchor: e.currentTarget.getBoundingClientRect() })}
                  className={clsx('mr-1 grid size-6 shrink-0 place-items-center rounded-md text-muted transition-opacity hover:bg-white/10 hover:text-text group-hover:opacity-100',
                    menu?.session === s ? 'bg-white/10 text-text opacity-100' : 'opacity-0')}>
                  <MdMoreHoriz size={16} />
                </button>
              </li>
            )
          })}
        </ul>
      </Section>

      {menu && (
        <Menu anchor={menu.anchor} onClose={() => setMenu(null)} items={[
          { label: 'Retomar', icon: <MdPlayArrow size={16} />, hidden: !resumeArgs(menu.session.command, menu.session.id), onClick: () => resume(menu.session) },
          { label: 'Renombrar…', icon: <MdEdit size={15} />, onClick: () => setRenaming(menu.session) },
          { label: 'Borrar…', icon: <MdDeleteOutline size={16} />, danger: true, onClick: () => setDeleting(menu.session) }
        ]} />
      )}
      {renaming && <RenameDialog session={renaming} current={title(renaming)} onClose={() => setRenaming(null)} onSaved={() => void load(false)} />}
      {clearing && (
        <Modal onClose={() => setClearing(false)} width={420} title="¿Borrar el historial?">
          <div className="px-4 pb-4">
            <p className="text-[12px] leading-relaxed text-muted">Se borrarán las {data.history.length} sesiones de IA de este proyecto (de todos los agentes que lo permiten). No se puede deshacer.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setClearing(false)} className="rounded-lg px-3 py-1.5 text-[12px] text-muted transition-colors hover:text-text">Cancelar</button>
              <button onClick={() => {
                setClearing(false)
                void (async () => {
                  let failed = 0
                  for (const s of data.history) { const r = await window.api.usage.remove(s); if (!r.ok) failed++ }
                  toast(failed ? `Historial borrado; ${failed} sesiones no se pudieron borrar` : 'Historial borrado', failed ? 'error' : 'ok')
                  void load(false)
                })()
              }} className="rounded-lg bg-danger/15 px-3 py-1.5 text-[12px] font-medium text-danger transition-colors hover:bg-danger/25">Borrar todo</button>
            </div>
          </div>
        </Modal>
      )}
      {deleting && (
        <Modal onClose={() => setDeleting(null)} width={400} title="¿Borrar esta sesión?">
          <div className="px-4 pb-4">
            <p className="text-[12px] leading-relaxed text-muted">«{title(deleting)}» se borrará del historial de {deleting.agent}. No se puede deshacer.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setDeleting(null)} className="rounded-lg px-3 py-1.5 text-[12px] text-muted transition-colors hover:text-text">Cancelar</button>
              <button onClick={() => { const s = deleting; setDeleting(null); void window.api.usage.remove(s).then((r) => { toast(r.ok ? 'Sesión borrada' : `No se pudo borrar: ${r.message}`, r.ok ? 'ok' : 'error'); void load(false) }) }}
                className="rounded-lg bg-danger/15 px-3 py-1.5 text-[12px] font-medium text-danger transition-colors hover:bg-danger/25">Borrar</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function RenameDialog({ session, current, onClose, onSaved }: { session: SessionInfo; current: string; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState(current)
  const save = (): void => { void window.api.usage.rename(session, value).then(() => { onSaved(); onClose() }) }
  return (
    <Modal onClose={onClose} width={420} title="Renombrar sesión">
      <div className="px-4 pb-4">
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save() }} spellCheck={false}
          className={FIELD} />
        <p className="mt-2 text-[10px] text-muted">Solo cambia el nombre que ves aquí; no toca los archivos del agente. Vacío vuelve al original.</p>
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-[12px] text-muted transition-colors hover:text-text">Cancelar</button>
          <button onClick={save} className="rounded-lg bg-accent px-4 py-1.5 text-[12px] font-medium text-bg transition-colors hover:brightness-110">Guardar</button>
        </div>
      </div>
    </Modal>
  )
}
