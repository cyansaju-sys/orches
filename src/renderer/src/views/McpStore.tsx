import { clsx } from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { MdOpenInNew } from 'react-icons/md'
import type { RegistryOption, RegistryServer } from '@shared/types'
import { Modal } from '@/components/ui'
import { useT } from '@/lib/i18n'
import { publisherOf, quoteArg, shortName } from '@/lib/mcp'

const SEARCH_DELAY_MS = 350

/** Iniciales sobre un color propio de cada servidor (el registro no trae iconos). */
function Avatar({ name }: { name: string }) {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  const hue = hash % 360
  const letters = shortName(name).replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?'
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-lg text-[12px] font-semibold text-white" style={{ background: `linear-gradient(135deg, hsl(${hue} 55% 52%), hsl(${(hue + 30) % 360} 55% 38%))` }}>
      {letters}
    </span>
  )
}

const Badge = ({ children }: { children: React.ReactNode }) => <span className="rounded bg-ov/[0.07] px-1.5 py-px text-[9px] font-medium text-muted">{children}</span>

/** Resultados del registro, como la lista de extensiones de VS Code: icono, nombre, descripción, quién lo publica y el botón Instalar. */
export function McpStoreList({ query, installedNames, onOpen, featured = false }: { query: string; installedNames: Set<string>; onOpen: (server: RegistryServer) => void; featured?: boolean }) {
  const t = useT()
  const [items, setItems] = useState<RegistryServer[]>([])
  const [next, setNext] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const run = useRef(0)

  const load = (cursor: string, replace: boolean): void => {
    const id = ++run.current
    setLoading(true); setError('')
    const request = featured ? window.api.mcp.featured().then((servers) => ({ servers, next: '', error: '' })) : window.api.mcp.registry(query, cursor)
    void request.then((page) => {
      if (id !== run.current) return
      setItems((prev) => (replace ? page.servers : [...prev, ...page.servers.filter((s) => !prev.some((p) => p.name === s.name))]))
      setNext(page.next); setError(page.error); setLoading(false)
    })
  }
  useEffect(() => {
    setItems([]); setNext('')
    const timer = setTimeout(() => load('', true), query ? SEARCH_DELAY_MS : 0)
    return () => clearTimeout(timer)
  }, [query, retry, featured])  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col">
      {items.map((s) => {
        const done = installedNames.has(shortName(s.name).toLowerCase())
        const remote = s.options.some((o) => o.kind === 'remote')
        const local = s.options.some((o) => o.kind === 'local')
        return (
          <div key={s.name} onClick={() => onOpen(s)} title={s.name} className="group flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-accent-bg">
            <Avatar name={s.name} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="min-w-0 truncate text-[12px] font-semibold">{s.title}</span>
                {local && <Badge>{t('st.local')}</Badge>}{remote && <Badge>{t('st.remote')}</Badge>}
              </div>
              <div className="line-clamp-2 text-[11px] leading-snug text-muted">{s.description}</div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="truncate text-[10px] text-muted/80">{publisherOf(s.name) || s.name}</span>
                {done
                  ? <span className="shrink-0 text-[10px] text-muted">{t('st.isInstalled')}</span>
                  : <button onClick={(e) => { e.stopPropagation(); onOpen(s) }} className="shrink-0 rounded bg-accent px-2.5 py-0.5 text-[11px] font-medium text-bg transition-[filter] hover:brightness-110">{t('st.install')}</button>}
              </div>
            </div>
          </div>
        )
      })}
      {loading && <p className="px-2 py-2 text-[11px] text-muted">{t('st.loading')}</p>}
      {error && (
        <div className="px-2 py-2 text-[11px] text-danger">
          {error} <button onClick={() => setRetry((n) => n + 1)} className="underline hover:text-text">{t('st.retry')}</button>
        </div>
      )}
      {!loading && !error && items.length === 0 && <p className="px-2 py-2 text-[11px] text-muted">{t('st.none')}</p>}
      {!loading && next && (
        <button onClick={() => load(next, false)} className={clsx('mx-2 mt-1 rounded-md py-1.5 text-[11px] text-muted transition-colors hover:bg-accent-bg hover:text-accent')}>{t('st.more')}</button>
      )}
    </div>
  )
}

/** La línea de comando o la URL de una forma de instalación, como se va a ejecutar. */
export const previewOf = (o: RegistryOption): string => (o.kind === 'remote' ? (o.url ?? '') : [o.command, ...(o.args ?? []).map(quoteArg)].join(' '))

/** Ficha de un servidor (como la página de una extensión): qué es, quién lo publica, cómo se instala y el botón para continuar. */
export function McpStoreDetail({ server, onClose, onInstall }: { server: RegistryServer; onClose: () => void; onInstall: (option: RegistryOption) => void }) {
  const t = useT()
  const [index, setIndex] = useState(0)
  const option = server.options[index]
  const fields = [...option.env, ...option.headers]
  return (
    <Modal onClose={onClose} width={520} title={server.title}>
      <div className="flex max-h-[62vh] flex-col gap-3 overflow-y-auto px-4 pb-4">
        <div className="flex items-start gap-3">
          <Avatar name={server.name} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
              <span className="selectable truncate">{publisherOf(server.name) || server.name}</span>
              {server.version && <Badge>{t('st.version', { v: server.version })}</Badge>}
            </div>
            <p className="mt-1 text-[12px] leading-relaxed">{server.description}</p>
            {server.repository && (
              <button onClick={() => window.open(server.repository, '_blank')} className="mt-1.5 flex items-center gap-1 text-[11px] text-accent hover:underline">
                <MdOpenInNew size={13} /> {t('st.repo')}
              </button>
            )}
          </div>
        </div>
        <div>
          <div className="pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">{t('st.how')}</div>
          {server.options.length > 1 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {server.options.map((o, i) => (
                <button key={o.label} onClick={() => setIndex(i)} className={clsx('rounded-lg px-2.5 py-1 text-[11px] transition-colors', i === index ? 'bg-accent/20 text-accent' : 'bg-ov/[0.05] text-muted hover:bg-ov/[0.08]')}>{o.label}</button>
              ))}
            </div>
          )}
          <pre className="selectable overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-ov/[0.05] px-3 py-2 font-mono text-[11px] leading-relaxed">{previewOf(option)}</pre>
        </div>
        {fields.length > 0 && (
          <div>
            <div className="pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">{t('st.requires')}</div>
            <ul className="flex flex-col gap-1">
              {fields.map((f) => (
                <li key={f.name} className="text-[11px] leading-snug">
                  <span className="font-mono">{f.name}</span>{f.required && <span className="ml-1.5 rounded bg-warn/15 px-1 text-[9px] text-warn">{t('st.required')}</span>}
                  {f.description && <span className="block text-muted">{f.description}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="rounded-md bg-warn/10 px-3 py-2 text-[11px] leading-snug text-warn">{t('st.warn')}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-[12px] text-muted transition-colors hover:text-text">{t('dlg.cancel')}</button>
          <button onClick={() => onInstall(option)} className="rounded-lg bg-accent px-4 py-1.5 text-[12px] font-medium text-bg transition-colors hover:brightness-110">{t('st.continue')}</button>
        </div>
      </div>
    </Modal>
  )
}
