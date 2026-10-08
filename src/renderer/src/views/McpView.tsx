import { clsx } from 'clsx'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { MdAdd, MdCloudQueue, MdContentCopy, MdDeleteOutline, MdTerminal, MdVisibility, MdVisibilityOff } from 'react-icons/md'
import type { McpAgent, McpScope, McpServer, McpSpec } from '@shared/types'
import { Modal } from '@/components/ui'
import { AGENT_NAMES, agentsMissing, GLOBAL_ONLY, isSecret, mask, parsePairs, SCOPE_LABELS, specFromServer, splitArgs } from '@/lib/mcp'
import { useStore } from '@/store'

const SUPPORTED: McpAgent[] = ['claude', 'opencode', 'gemini', 'codex', 'agy']
const REFRESH_MS = 5000

const Tag = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-[10px] font-medium text-accent">{children}</span>
)

/** Servidores MCP de cada agente instalado, con + para añadir uno y papelera para quitarlo. */
export function McpView() {
  const project = useStore((s) => s.project)
  const agents = useStore((s) => s.agents)
  const set = useStore((s) => s.set)
  const toast = useStore((s) => s.toast)
  const [servers, setServers] = useState<McpServer[] | null>(null)
  const [details, setDetails] = useState<McpServer | null>(null)
  const [removing, setRemoving] = useState<McpServer | null>(null)
  const [adding, setAdding] = useState(false)

  const installed = useMemo(() => SUPPORTED.filter((a) => agents.some((x) => x.command === a)), [agents])
  const refresh = useCallback(async () => {
    const next = await window.api.mcp.list(project)
    setServers((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
  }, [project])

  useEffect(() => { void window.api.agents.detect().then((a) => set({ agents: a })) }, [set])
  useEffect(() => { void refresh(); const t = setInterval(() => void refresh(), REFRESH_MS); return () => clearInterval(t) }, [refresh])

  const visible = (servers ?? []).filter((s) => installed.includes(s.agent))
  const byAgent = installed.map((agent) => ({ agent, items: visible.filter((s) => s.agent === agent) }))

  const remove = async (server: McpServer): Promise<void> => {
    setRemoving(null)
    const res = await window.api.mcp.remove(server, project)
    toast(res.ok ? `«${server.name}» quitado` : `No se pudo quitar: ${res.message}`, res.ok ? 'ok' : 'error')
    void refresh()
  }

  return (
    <div className="flex h-full flex-col px-2">
      <div className="flex items-center justify-between px-1.5 pb-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Servidores MCP</h3>
        <button title="Añadir un servidor MCP" disabled={!installed.length} onClick={() => setAdding(true)}
          className="grid size-6 place-items-center rounded-md text-muted transition-colors hover:bg-accent-bg hover:text-accent disabled:opacity-40">
          <MdAdd size={17} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {servers === null && <p className="px-2 text-[11px] text-muted">Leyendo servidores…</p>}
        {servers && installed.length === 0 && <p className="px-2 text-[11px] text-muted">Ninguno de tus agentes instalados admite MCP desde aquí</p>}
        {servers && installed.length > 0 && visible.length === 0 && <p className="px-2 text-[11px] text-muted">Sin servidores. Pulsa + para añadir uno a tus agentes.</p>}
        {byAgent.filter((g) => g.items.length).map(({ agent, items }) => (
          <section key={agent} className="mb-3">
            <h4 className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted/80">{AGENT_NAMES[agent]}</h4>
            {items.map((s) => (
              <div key={`${s.scope}${s.name}${s.source}`} className="group flex items-center gap-1 rounded-lg transition-colors hover:bg-accent-bg">
                <button onClick={() => setDetails(s)} title="Ver detalles" className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left">
                  <span className="grid size-7 shrink-0 place-items-center rounded-md bg-white/[0.05] text-accent">
                    {s.kind === 'remote' ? <MdCloudQueue size={15} /> : <MdTerminal size={15} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold">{s.name}</span>
                    <span className="block truncate text-[10px] text-muted">{SCOPE_LABELS[s.scope]} · {s.target}</span>
                  </span>
                </button>
                <button title="Quitar" onClick={() => setRemoving(s)}
                  className="mr-1 grid size-6 shrink-0 place-items-center rounded-md text-muted opacity-0 transition-all hover:bg-[#2a1a22] hover:text-danger group-hover:opacity-100">
                  <MdDeleteOutline size={16} />
                </button>
              </div>
            ))}
          </section>
        ))}
      </div>

      {details && <Details server={details} all={servers ?? []} installed={installed} project={project} onClose={() => setDetails(null)} onChanged={() => void refresh()} />}
      {removing && (
        <Modal onClose={() => setRemoving(null)} width={400} title="¿Quitar este servidor?">
          <div className="px-4 pb-4">
            <p className="text-[12px] leading-relaxed text-muted">«{removing.name}» se quitará de {AGENT_NAMES[removing.agent]} ({SCOPE_LABELS[removing.scope]}).</p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setRemoving(null)} className="rounded-lg px-3 py-1.5 text-[12px] text-muted transition-colors hover:bg-white/[0.05]">Cancelar</button>
              <button onClick={() => void remove(removing)} className="rounded-lg bg-danger/15 px-3 py-1.5 text-[12px] font-medium text-danger transition-colors hover:bg-danger/25">Quitar</button>
            </div>
          </div>
        </Modal>
      )}
      {adding && <AddDialog installed={installed} project={project} onClose={() => setAdding(false)} onDone={() => void refresh()} />}
    </div>
  )
}

function Details({ server, all, installed, project, onClose, onChanged }: {
  server: McpServer; all: McpServer[]; installed: McpAgent[]; project: string | null; onClose: () => void; onChanged: () => void
}) {
  const toast = useStore((s) => s.toast)
  const [reveal, setReveal] = useState(false)
  const cfg = server.config as Record<string, unknown>
  const headers = (cfg.headers as Record<string, string>) ?? {}
  const env = { ...((cfg.environment as Record<string, string>) ?? {}), ...((cfg.env as Record<string, string>) ?? {}) }
  const hasSecrets = [...Object.keys(headers), ...Object.keys(env)].some(isSecret)
  const projectOnly = server.scope !== 'global'          // un servidor de proyecto no se puede copiar a un agente que solo guarda globales
  const missing = agentsMissing(server, all, SUPPORTED).filter((a) => installed.includes(a as McpAgent) && !(projectOnly && GLOBAL_ONLY.includes(a))) as McpAgent[]
  const copy = async (text: string): Promise<void> => { await navigator.clipboard.writeText(text); toast('Copiado', 'ok') }

  const copyTo = async (agent: McpAgent): Promise<void> => {
    const res = await window.api.mcp.add(agent, specFromServer(server), server.scope === 'shared' ? 'project' : server.scope, project)
    toast(res.ok ? `«${server.name}» añadido a ${AGENT_NAMES[agent]}` : `No se pudo añadir: ${res.message}`, res.ok ? 'ok' : 'error')
    onChanged()
    if (res.ok) onClose()
  }
  const Field = ({ label, value, copyable }: { label: string; value: string; copyable?: boolean }) => (
    <div>
      <div className="text-[10px] text-muted">{label}</div>
      <div className="flex items-start gap-1.5">
        <div className="selectable min-w-0 flex-1 whitespace-pre-wrap break-all text-[12px]">{value || '—'}</div>
        {copyable && value && <button title="Copiar" onClick={() => void copy(value)} className="grid size-6 shrink-0 place-items-center rounded text-muted transition-colors hover:text-accent"><MdContentCopy size={14} /></button>}
      </div>
    </div>
  )
  const pairs = (label: string, map: Record<string, string>): React.ReactNode =>
    Object.keys(map).length ? <Field label={label} value={Object.entries(map).map(([k, v]) => `${k}: ${mask(k, String(v), reveal)}`).join('\n')} /> : null

  return (
    <Modal onClose={onClose} width={500} title={server.name}>
      <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto px-4 pb-4">
        <div className="flex flex-wrap gap-1.5"><Tag>{AGENT_NAMES[server.agent]}</Tag><Tag>{SCOPE_LABELS[server.scope]}</Tag><Tag>{server.kind === 'remote' ? 'Remoto (HTTP)' : 'Local (stdio)'}</Tag></div>
        <Field label={server.kind === 'remote' ? 'URL' : 'Comando'} value={server.target} copyable />
        {pairs('Cabeceras', headers)}
        {pairs('Variables de entorno', env)}
        <Field label="Guardado en" value={server.source} copyable />
        {hasSecrets && (
          <button onClick={() => setReveal(!reveal)} className="flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted transition-colors hover:bg-accent-bg">
            {reveal ? <MdVisibilityOff size={14} /> : <MdVisibility size={14} />} {reveal ? 'Ocultar valores' : 'Mostrar valores'}
          </button>
        )}
        {missing.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-3">
            {missing.map((a) => (
              <button key={a} onClick={() => void copyTo(a)} className="flex items-center gap-1.5 rounded-lg bg-white/[0.05] px-3 py-1.5 text-[12px] transition-colors hover:bg-accent-bg">
                <MdAdd size={15} className="text-accent" /> Copiar a {AGENT_NAMES[a]}
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

const input = 'w-full rounded-lg bg-white/[0.05] px-3 py-2 text-[12px] caret-accent outline-none transition-colors placeholder:text-muted/70 focus:bg-white/[0.08]'

function AddDialog({ installed, project, onClose, onDone }: { installed: McpAgent[]; project: string | null; onClose: () => void; onDone: () => void }) {
  const toast = useStore((s) => s.toast)
  const [kind, setKind] = useState<'remote' | 'local'>('remote')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [headers, setHeaders] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [env, setEnv] = useState('')
  const [targets, setTargets] = useState<McpAgent[]>(installed)
  const [scope, setScope] = useState<McpScope>('global')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const Choice = ({ on, label, onClick, disabled }: { on: boolean; label: string; onClick: () => void; disabled?: boolean }) => (
    <button disabled={disabled} onClick={onClick} className={clsx('rounded-lg px-3 py-1.5 text-[12px] transition-colors disabled:opacity-40', on ? 'bg-accent/20 text-accent' : 'bg-white/[0.05] text-muted hover:bg-white/[0.08]')}>{label}</button>
  )

  const submit = async (): Promise<void> => {
    const spec: McpSpec = kind === 'remote'
      ? { name: name.trim(), kind, url: url.trim(), headers: parsePairs(headers, [': ', ':']) }
      : { name: name.trim(), kind, command: command.trim(), args: splitArgs(args), env: parsePairs(env, ['=']) }
    const chosen = scope === 'project' ? targets.filter((a) => !GLOBAL_ONLY.includes(a)) : targets
    if (!chosen.length) { setError('Elige al menos un agente'); return }
    setBusy(true); setError('')
    const failed: string[] = []
    for (const agent of chosen) {
      const res = await window.api.mcp.add(agent, spec, scope, project)
      if (!res.ok) failed.push(`${AGENT_NAMES[agent]}: ${res.message}`)
    }
    setBusy(false)
    onDone()
    if (failed.length) { setError(failed.join('\n')); return }
    toast(`«${spec.name}» añadido a ${chosen.map((a) => AGENT_NAMES[a]).join(' y ')}`, 'ok')
    onClose()
  }

  return (
    <Modal onClose={onClose} width={520} title="Añadir servidor MCP">
      <div className="flex max-h-[68vh] flex-col gap-3 overflow-y-auto px-4 pb-4">
        <div className="flex gap-2"><Choice on={kind === 'remote'} label="Remoto (URL)" onClick={() => setKind('remote')} /><Choice on={kind === 'local'} label="Local (comando)" onClick={() => setKind('local')} /></div>
        <input className={input} placeholder="Nombre (letras, números, - y _)" value={name} onChange={(e) => setName(e.target.value)} autoFocus spellCheck={false} />
        {kind === 'remote' ? (
          <>
            <input className={input} placeholder="https://servidor.com/mcp" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
            <textarea className={clsx(input, 'min-h-[64px] resize-y')} placeholder={'Cabeceras (una por línea)\nAuthorization: Bearer …'} value={headers} onChange={(e) => setHeaders(e.target.value)} spellCheck={false} />
          </>
        ) : (
          <>
            <input className={input} placeholder="Comando (npx, uvx, node…)" value={command} onChange={(e) => setCommand(e.target.value)} spellCheck={false} />
            <input className={input} placeholder="Argumentos: -y @scope/paquete --flag" value={args} onChange={(e) => setArgs(e.target.value)} spellCheck={false} />
            <textarea className={clsx(input, 'min-h-[64px] resize-y')} placeholder={'Variables de entorno (una por línea)\nCLAVE=valor'} value={env} onChange={(e) => setEnv(e.target.value)} spellCheck={false} />
          </>
        )}
        <div>
          <div className="pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">Agentes</div>
          <div className="flex flex-wrap gap-2">
            {installed.map((a) => <Choice key={a} on={targets.includes(a) && !(scope === 'project' && GLOBAL_ONLY.includes(a))} disabled={scope === 'project' && GLOBAL_ONLY.includes(a)} label={AGENT_NAMES[a]} onClick={() => setTargets((t) => (t.includes(a) ? t.filter((x) => x !== a) : [...t, a]))} />)}
          </div>
        </div>
        <div>
          <div className="pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">Dónde</div>
          <div className="flex flex-wrap gap-2">
            <Choice on={scope === 'global'} label={SCOPE_LABELS.global} onClick={() => setScope('global')} />
            <Choice on={scope === 'project'} label={SCOPE_LABELS.project} onClick={() => setScope('project')} disabled={!project} />
          </div>
        </div>
        {scope === 'project' && installed.some((a) => GLOBAL_ONLY.includes(a)) && (
          <p className="text-[11px] text-muted">{installed.filter((a) => GLOBAL_ONLY.includes(a)).map((a) => AGENT_NAMES[a]).join(' y ')} solo guarda{installed.filter((a) => GLOBAL_ONLY.includes(a)).length > 1 ? 'n' : ''} MCP globales: para añadirlo ahí elige «{SCOPE_LABELS.global}».</p>
        )}
        {error && <pre className="selectable whitespace-pre-wrap text-[11px] leading-snug text-danger">{error}</pre>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-[12px] text-muted transition-colors hover:bg-white/[0.05]">Cancelar</button>
          <button disabled={busy} onClick={() => void submit()} className="rounded-lg bg-accent/20 px-4 py-1.5 text-[12px] font-medium text-accent transition-colors hover:bg-accent/30 disabled:opacity-50">{busy ? 'Añadiendo…' : 'Añadir'}</button>
        </div>
      </div>
    </Modal>
  )
}
