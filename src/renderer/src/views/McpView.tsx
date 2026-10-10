import { clsx } from 'clsx'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { MdAdd, MdCheckCircle, MdChevronRight, MdCloudQueue, MdContentCopy, MdDeleteOutline, MdRemoveCircleOutline, MdTerminal, MdVisibility, MdVisibilityOff } from 'react-icons/md'
import type { AppMcpInfo, McpAgent, McpScope, McpServer, McpSpec, RegistryServer } from '@shared/types'
import { FIELD, FIELD_SLIM, Modal } from '@/components/ui'
import { AGENT_NAMES, agentsMissing, GLOBAL_ONLY, isSecret, mask, parsePairs, prefillFrom, SCOPE_KEYS, specFromServer, splitArgs, type Prefill } from '@/lib/mcp'
import { useT } from '@/lib/i18n'
import { useStore } from '@/store'
import { McpStoreDetail, McpStoreList } from './McpStore'

const SUPPORTED: McpAgent[] = ['claude', 'opencode', 'gemini', 'codex', 'agy']
const REFRESH_MS = 5000

/** Sección plegable: el título con una flecha; se recuerda si estaba cerrada. */
function Fold({ id, title, count, children }: { id: string; title: string; count?: number; children: React.ReactNode }) {
  const key = `tutti.mcp.${id}.collapsed`
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(key) === '1' } catch { return false } })
  const toggle = (): void => setCollapsed((c) => { try { localStorage.setItem(key, c ? '0' : '1') } catch { /* sin almacenamiento */ } return !c })
  return (
    <section className="mb-2">
      <button onClick={toggle} aria-expanded={!collapsed} className="flex w-full items-center gap-0.5 rounded px-1 py-1 text-left text-muted/80 transition-colors hover:text-text">
        <MdChevronRight size={14} className={clsx('shrink-0 transition-transform', !collapsed && 'rotate-90')} />
        <h4 className="truncate text-[10px] font-semibold uppercase tracking-wider">{title}</h4>
        {count !== undefined && <span className="ml-1 rounded-full bg-ov/[0.07] px-1.5 text-[9px] font-medium">{count}</span>}
      </button>
      {!collapsed && children}
    </section>
  )
}

const Tag = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-[10px] font-medium text-accent">{children}</span>
)

/** Servidores MCP de cada agente instalado, con + para añadir uno y papelera para quitarlo. */
export function McpView() {
  const t = useT()
  const project = useStore((s) => s.project)
  const agents = useStore((s) => s.agents)
  const set = useStore((s) => s.set)
  const toast = useStore((s) => s.toast)
  const [servers, setServers] = useState<McpServer[] | null>(null)
  const [details, setDetails] = useState<string | null>(null)          // nombre (en minúsculas) del servidor abierto
  const [removing, setRemoving] = useState<McpServer[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [prefill, setPrefill] = useState<Prefill | null>(null)          // instalar desde el registro: el diálogo de añadir con los datos rellenos
  const [storeItem, setStoreItem] = useState<RegistryServer | null>(null)
  const [query, setQuery] = useState('')
  const [app, setApp] = useState<AppMcpInfo | null>(null)

  const installed = useMemo(() => SUPPORTED.filter((a) => agents.some((x) => x.command === a)), [agents])
  const refresh = useCallback(async () => {
    const next = await window.api.mcp.list(project)
    setServers((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    const info = await window.api.mcp.app()
    setApp((prev) => (JSON.stringify(prev) === JSON.stringify(info) ? prev : info))
  }, [project])

  useEffect(() => { void window.api.agents.detect().then((a) => set({ agents: a })) }, [set])
  useEffect(() => { void refresh(); const t = setInterval(() => void refresh(), REFRESH_MS); return () => clearInterval(t) }, [refresh])

  const visible = (servers ?? []).filter((s) => installed.includes(s.agent) && !(s.agent === 'agy' && s.name === 'tutti'))      // el de la app va en su propia sección
  /** Un servidor por nombre, con todos los agentes (y alcances) donde está. */
  const groups = useMemo(() => {
    const map = new Map<string, McpServer[]>()
    for (const sv of visible) map.set(sv.name.toLowerCase(), [...(map.get(sv.name.toLowerCase()) ?? []), sv])
    return [...map.values()].sort((a, b) => a[0].name.localeCompare(b[0].name))
  }, [visible])
  const open = details ? groups.find((g) => g[0].name.toLowerCase() === details) : undefined

  const installedNames = useMemo(() => new Set((servers ?? []).map((x) => x.name.toLowerCase())), [servers])
  const remove = async (targets: McpServer[]): Promise<void> => {
    setRemoving(null)
    const failed: string[] = []
    for (const server of targets) { const res = await window.api.mcp.remove(server, project); if (!res.ok) failed.push(res.message) }
    toast(failed.length ? t('mcp.removeFailed', { message: failed[0] }) : t('mcp.removed', { name: targets[0].name }), failed.length ? 'error' : 'ok')
    void refresh()
  }

  return (
    <div className="flex h-full flex-col px-2">
      <div className="flex items-center justify-between px-1.5 pb-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{t('mcp.title')}</h3>
        <button title={t('mcp.addTip')} disabled={!installed.length} onClick={() => setAdding(true)}
          className="grid size-6 place-items-center rounded-md text-muted transition-colors hover:bg-accent-bg hover:text-accent disabled:opacity-40">
          <MdAdd size={17} />
        </button>
      </div>
      <div className="px-1.5 pb-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('st.search')} spellCheck={false}
          onKeyDown={(e) => { if (e.key === 'Escape') setQuery('') }} className={FIELD_SLIM} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {!query.trim() && (
          <>
        {app && <AppSection info={app} />}
        {servers === null && <p className="px-2 text-[11px] text-muted">{t('mcp.reading')}</p>}
        {servers && installed.length === 0 && <p className="px-2 text-[11px] text-muted">{t('mcp.noneSupported')}</p>}
        {servers && installed.length > 0 && visible.length === 0 && <p className="px-2 text-[11px] text-muted">{t('mcp.empty')}</p>}
        {groups.length > 0 && <Fold id="installed" title={t('st.installed')} count={groups.length}>
        {groups.map((g) => {
          const first = g[0]
          const agentNames = [...new Set(g.map((x) => AGENT_NAMES[x.agent]))]
          return (
            <div key={first.name.toLowerCase()} className="group flex items-center gap-1 rounded-lg transition-colors hover:bg-accent-bg">
              <button onClick={() => setDetails(first.name.toLowerCase())} title={t('mcp.details')} className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left">
                <span className="grid size-7 shrink-0 place-items-center rounded-md bg-ov/[0.05] text-accent">
                  {first.kind === 'remote' ? <MdCloudQueue size={15} /> : <MdTerminal size={15} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold">{first.name}</span>
                  <span className="block truncate text-[10px] text-muted">{t(SCOPE_KEYS[first.scope])} · {agentNames.join(', ')}</span>
                </span>
              </button>
              <button title={t('mcp.remove')} onClick={() => setRemoving(g)}
                className="mr-1 grid size-6 shrink-0 place-items-center rounded-md text-muted opacity-0 transition-all hover:bg-danger/15 hover:text-danger group-hover:opacity-100">
                <MdDeleteOutline size={16} />
              </button>
            </div>
          )
        })}
        </Fold>}
          </>
        )}
        {!query.trim() && (
          <Fold id="featured" title={t('st.featured')}>
            <McpStoreList featured query="" installedNames={installedNames} onOpen={setStoreItem} />
          </Fold>
        )}
        <Fold id={query.trim() ? 'results' : 'available'} title={query.trim() ? t('st.results') : t('st.available')}>
          <McpStoreList query={query.trim()} installedNames={installedNames} onOpen={setStoreItem} />
        </Fold>
      </div>

      {storeItem && <McpStoreDetail server={storeItem} onClose={() => setStoreItem(null)} onInstall={(option) => { setPrefill(prefillFrom(storeItem, option)); setStoreItem(null) }} />}
      {prefill && <AddDialog installed={installed} project={project} prefill={prefill} onClose={() => setPrefill(null)} onDone={() => void refresh()} />}
      {open && <Details group={open} installed={installed} project={project} onClose={() => setDetails(null)} onChanged={() => void refresh()} onRemove={setRemoving} />}
      {removing && (
        <Modal onClose={() => setRemoving(null)} width={400} title={t('mcp.removeTitle')}>
          <div className="px-4 pb-4">
            <p className="text-[12px] leading-relaxed text-muted">{removing.length === 1 ? t('mcp.removeBody', { name: removing[0].name, agent: AGENT_NAMES[removing[0].agent], scope: t(SCOPE_KEYS[removing[0].scope]) }) : t('mcp.removeMany', { name: removing[0].name, agents: [...new Set(removing.map((x) => AGENT_NAMES[x.agent]))].join(', ') })}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setRemoving(null)} className="rounded-lg px-3 py-1.5 text-[12px] text-muted transition-colors hover:text-text">{t('dlg.cancel')}</button>
              <button onClick={() => void remove(removing)} className="rounded-lg bg-danger/15 px-3 py-1.5 text-[12px] font-medium text-danger transition-colors hover:bg-danger/25">{t('mcp.remove')}</button>
            </div>
          </div>
        </Modal>
      )}
      {adding && <AddDialog installed={installed} project={project} onClose={() => setAdding(false)} onDone={() => void refresh()} />}
    </div>
  )
}

/** El MCP de la propia app («tutti»): una sola tarjeta global; al abrirla se ve a qué agentes llega. */
function AppSection({ info }: { info: AppMcpInfo }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const shown = info.agents.filter((a) => a.installed)
  const applied = shown.filter((a) => a.applied).map((a) => a.name)
  const broken = shown.some((a) => a.problem)
  return (
    <Fold id="tutti" title={t('mcp.appHeading')}>
      <button onClick={() => setOpen(true)} title={t('mcp.appCardTip')} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent-bg">
        <span className={clsx('grid size-7 shrink-0 place-items-center rounded-md bg-ov/[0.05]', broken ? 'text-danger' : 'text-accent')}><MdTerminal size={15} /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-semibold">tutti</span>
          <span className="block truncate text-[10px] text-muted">{info.running ? `${t('mcp.scope.global')} · ${applied.length ? applied.join(', ') : t('mcp.noAgent')}` : t('mcp.inactive')}</span>
        </span>
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)} width={460} title="tutti">
          <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto px-4 pb-4">
            <div className="flex flex-wrap gap-1.5"><Tag>{t('mcp.global')}</Tag><Tag>{info.running ? t('mcp.active') : t('mcp.inactive')}</Tag></div>
            <p className="text-[12px] leading-relaxed text-muted">
              {info.running ? t('mcp.appTools', { tools: info.tools.join(', ') }) : t('mcp.appOff')}
            </p>
            <div className="flex flex-col gap-1">
              {shown.map((a) => (
                <div key={a.command} className="flex items-center gap-2.5 rounded-lg bg-ov/[0.04] px-2.5 py-1.5">
                  <span className={clsx('shrink-0', a.applied ? 'text-accent' : a.problem ? 'text-danger' : 'text-muted')}>{a.applied ? <MdCheckCircle size={16} /> : <MdRemoveCircleOutline size={16} />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-semibold">{a.name}</span>
                    <span className={clsx('block break-all text-[10px]', a.problem ? 'text-danger' : 'text-muted')}>{a.problem ?? a.how}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </Fold>
  )
}

function Details({ group, installed, project, onClose, onChanged, onRemove }: {
  group: McpServer[]; installed: McpAgent[]; project: string | null; onClose: () => void; onChanged: () => void; onRemove: (targets: McpServer[]) => void
}) {
  const t = useT()
  const server = group[0]
  const all = group
  const toast = useStore((s) => s.toast)
  const [reveal, setReveal] = useState(false)
  const cfg = server.config as Record<string, unknown>
  const headers = (cfg.headers as Record<string, string>) ?? {}
  const env = { ...((cfg.environment as Record<string, string>) ?? {}), ...((cfg.env as Record<string, string>) ?? {}) }
  const hasSecrets = [...Object.keys(headers), ...Object.keys(env)].some(isSecret)
  const projectOnly = server.scope !== 'global'          // un servidor de proyecto no se puede copiar a un agente que solo guarda globales
  const missing = agentsMissing(server, all, SUPPORTED).filter((a) => installed.includes(a as McpAgent) && !(projectOnly && GLOBAL_ONLY.includes(a))) as McpAgent[]
  const copy = async (text: string): Promise<void> => { await navigator.clipboard.writeText(text); toast(t('mcp.copied'), 'ok') }

  const copyTo = async (agent: McpAgent): Promise<void> => {
    const res = await window.api.mcp.add(agent, specFromServer(server), server.scope === 'shared' ? 'project' : server.scope, project)
    toast(res.ok ? t('mcp.addedTo', { name: server.name, agent: AGENT_NAMES[agent] }) : t('mcp.addFailed', { message: res.message }), res.ok ? 'ok' : 'error')
    onChanged()
    if (res.ok) onClose()
  }
  const Field = ({ label, value, copyable }: { label: string; value: string; copyable?: boolean }) => (
    <div>
      <div className="text-[10px] text-muted">{label}</div>
      <div className="flex items-start gap-1.5">
        <div className="selectable min-w-0 flex-1 whitespace-pre-wrap break-all text-[12px]">{value || '—'}</div>
        {copyable && value && <button title={t('mcp.copyTip')} onClick={() => void copy(value)} className="grid size-6 shrink-0 place-items-center rounded text-muted transition-colors hover:text-accent"><MdContentCopy size={14} /></button>}
      </div>
    </div>
  )
  const pairs = (label: string, map: Record<string, string>): React.ReactNode =>
    Object.keys(map).length ? <Field label={label} value={Object.entries(map).map(([k, v]) => `${k}: ${mask(k, String(v), reveal)}`).join('\n')} /> : null

  return (
    <Modal onClose={onClose} width={500} title={server.name}>
      <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto px-4 pb-4">
        <div className="flex flex-wrap gap-1.5">{[...new Set(group.map((x) => x.scope))].map((sc) => <Tag key={sc}>{t(SCOPE_KEYS[sc])}</Tag>)}<Tag>{server.kind === 'remote' ? t('mcp.remote') : t('mcp.local')}</Tag></div>
        <Field label={server.kind === 'remote' ? t('mcp.url') : t('mcp.command')} value={server.target} copyable />
        {pairs(t('mcp.headers'), headers)}
        {pairs(t('mcp.envVars'), env)}
        <Field label={t('mcp.savedIn')} value={[...new Set(group.map((x) => x.source))].join('\n')} copyable />
        <div>
          <div className="pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">{t('mcp.appliedTo')}</div>
          <div className="flex flex-col gap-1">
            {group.map((x) => (
              <div key={`${x.agent}${x.scope}${x.source}`} className="group flex items-center gap-2.5 rounded-lg bg-ov/[0.04] px-2.5 py-1.5">
                <MdCheckCircle size={16} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-semibold">{AGENT_NAMES[x.agent]}</span>
                  <span className="block truncate text-[10px] text-muted">{t(SCOPE_KEYS[x.scope])}</span>
                </span>
                <button title={t('mcp.removeFrom', { agent: AGENT_NAMES[x.agent] })} onClick={() => { onClose(); onRemove([x]) }}
                  className="grid size-6 shrink-0 place-items-center rounded-md text-muted opacity-0 transition-all hover:bg-danger/15 hover:text-danger group-hover:opacity-100"><MdDeleteOutline size={15} /></button>
              </div>
            ))}
          </div>
        </div>
        {hasSecrets && (
          <button onClick={() => setReveal(!reveal)} className="flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted transition-colors hover:bg-accent-bg">
            {reveal ? <MdVisibilityOff size={14} /> : <MdVisibility size={14} />} {reveal ? t('mcp.hideValues') : t('mcp.showValues')}
          </button>
        )}
        {missing.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-ov/[0.06] pt-3">
            {missing.map((a) => (
              <button key={a} onClick={() => void copyTo(a)} className="flex items-center gap-1.5 rounded-lg bg-ov/[0.05] px-3 py-1.5 text-[12px] transition-colors hover:bg-accent-bg">
                <MdAdd size={15} className="text-accent" /> {t('mcp.copyTo', { agent: AGENT_NAMES[a] })}
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

const input = FIELD

function AddDialog({ installed, project, prefill, onClose, onDone }: { installed: McpAgent[]; project: string | null; prefill?: Prefill; onClose: () => void; onDone: () => void }) {
  const t = useT()
  const toast = useStore((s) => s.toast)
  const [kind, setKind] = useState<'remote' | 'local'>(prefill?.kind ?? 'remote')
  const [name, setName] = useState(prefill?.name ?? '')
  const [url, setUrl] = useState(prefill?.url ?? '')
  const [headers, setHeaders] = useState(prefill?.headers ?? '')
  const [command, setCommand] = useState(prefill?.command ?? '')
  const [args, setArgs] = useState(prefill?.args ?? '')
  const [env, setEnv] = useState(prefill?.env ?? '')
  const [targets, setTargets] = useState<McpAgent[]>(installed)
  const [scope, setScope] = useState<McpScope>('global')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const Choice = ({ on, label, onClick, disabled }: { on: boolean; label: string; onClick: () => void; disabled?: boolean }) => (
    <button disabled={disabled} onClick={onClick} className={clsx('rounded-lg px-3 py-1.5 text-[12px] transition-colors disabled:opacity-40', on ? 'bg-accent/20 text-accent' : 'bg-ov/[0.05] text-muted hover:bg-ov/[0.08]')}>{label}</button>
  )

  const submit = async (): Promise<void> => {
    const spec: McpSpec = kind === 'remote'
      ? { name: name.trim(), kind, url: url.trim(), headers: parsePairs(headers, [': ', ':']) }
      : { name: name.trim(), kind, command: command.trim(), args: splitArgs(args), env: parsePairs(env, ['=']) }
    const chosen = scope === 'project' ? targets.filter((a) => !GLOBAL_ONLY.includes(a)) : targets
    if (!chosen.length) { setError(t('mcp.pickOne')); return }
    setBusy(true); setError('')
    const failed: string[] = []
    for (const agent of chosen) {
      const res = await window.api.mcp.add(agent, spec, scope, project)
      if (!res.ok) failed.push(`${AGENT_NAMES[agent]}: ${res.message}`)
    }
    setBusy(false)
    onDone()
    if (failed.length) { setError(failed.join('\n')); return }
    toast(t('mcp.addedMany', { name: spec.name, agents: chosen.map((a) => AGENT_NAMES[a]).join(t('mcp.and')) }), 'ok')
    onClose()
  }

  return (
    <Modal onClose={onClose} width={520} title={t('mcp.addTitle')}>
      <div className="flex max-h-[68vh] flex-col gap-3 overflow-y-auto px-4 pb-4">
        <div className="flex gap-2"><Choice on={kind === 'remote'} label={t('mcp.kindRemote')} onClick={() => setKind('remote')} /><Choice on={kind === 'local'} label={t('mcp.kindLocal')} onClick={() => setKind('local')} /></div>
        <input className={input} placeholder={t('mcp.namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} autoFocus spellCheck={false} />
        {kind === 'remote' ? (
          <>
            <input className={input} placeholder="https://server.example.com/mcp" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
            <textarea className={clsx(input, 'min-h-[64px] resize-y')} placeholder={t('mcp.headersPlaceholder')} value={headers} onChange={(e) => setHeaders(e.target.value)} spellCheck={false} />
          </>
        ) : (
          <>
            <input className={input} placeholder={t('mcp.cmdPlaceholder')} value={command} onChange={(e) => setCommand(e.target.value)} spellCheck={false} />
            <input className={input} placeholder={t('mcp.argsPlaceholder')} value={args} onChange={(e) => setArgs(e.target.value)} spellCheck={false} />
            <textarea className={clsx(input, 'min-h-[64px] resize-y')} placeholder={t('mcp.envPlaceholder')} value={env} onChange={(e) => setEnv(e.target.value)} spellCheck={false} />
          </>
        )}
        {prefill && prefill.fields.length > 0 && <p className="text-[11px] leading-snug text-muted">{t('st.fieldsHelp')}</p>}
        <div>
          <div className="pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">{t('mcp.agents')}</div>
          <div className="flex flex-wrap gap-2">
            {installed.map((a) => <Choice key={a} on={targets.includes(a) && !(scope === 'project' && GLOBAL_ONLY.includes(a))} disabled={scope === 'project' && GLOBAL_ONLY.includes(a)} label={AGENT_NAMES[a]} onClick={() => setTargets((t) => (t.includes(a) ? t.filter((x) => x !== a) : [...t, a]))} />)}
          </div>
        </div>
        <div>
          <div className="pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">{t('mcp.where')}</div>
          <div className="flex flex-wrap gap-2">
            <Choice on={scope === 'global'} label={t(SCOPE_KEYS.global)} onClick={() => setScope('global')} />
            <Choice on={scope === 'project'} label={t(SCOPE_KEYS.project)} onClick={() => setScope('project')} disabled={!project} />
          </div>
        </div>
        {scope === 'project' && installed.some((a) => GLOBAL_ONLY.includes(a)) && (
          <p className="text-[11px] text-muted">{t(installed.filter((a) => GLOBAL_ONLY.includes(a)).length > 1 ? 'mcp.onlyGlobalMany' : 'mcp.onlyGlobal', { agents: installed.filter((a) => GLOBAL_ONLY.includes(a)).map((a) => AGENT_NAMES[a]).join(t('mcp.and')), scope: t(SCOPE_KEYS.global) })}</p>
        )}
        {error && <pre className="selectable whitespace-pre-wrap text-[11px] leading-snug text-danger">{error}</pre>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-[12px] text-muted transition-colors hover:text-text">{t('dlg.cancel')}</button>
          <button disabled={busy} onClick={() => void submit()} className="rounded-lg bg-accent px-4 py-1.5 text-[12px] font-medium text-bg transition-colors hover:brightness-110 disabled:opacity-50">{busy ? t('mcp.adding') : t('dlg.add')}</button>
        </div>
      </div>
    </Modal>
  )
}
