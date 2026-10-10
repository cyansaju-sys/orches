import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import { useEffect, useRef, useState } from 'react'
import { useT } from '@/lib/i18n'
import { Menu } from './Menu'
import { t as tr } from '@/lib/i18n'
import { isGlobalShortcut } from '@/lib/shortcuts'
import { TERMINAL_THEMES } from '@/lib/theme'
import { useStore, type Pane } from '@/store'

// los prompts con íconos (powerlevel10k, starship) usan una Nerd Font: se prueban las más comunes antes de la fuente base
const FONT = '"MesloLGS NF", "JetBrainsMono Nerd Font", "FiraCode Nerd Font", "Hack Nerd Font", "DejaVu Sans Mono", "Symbols Nerd Font Mono", monospace'

const terms = new Map<string, Terminal>()      // id del panel -> terminal que muestra su salida
const spawned = new Set<string>()              // procesos ya iniciados (React puede montar dos veces en desarrollo)
let wired = false

/** Copia lo seleccionado al portapapeles y quita la selección. */
function copySelection(t: Terminal): void {
  const text = t.getSelection()
  if (!text) return
  void navigator.clipboard.writeText(text)
  t.clearSelection()
}

/** Pega el texto del portapapeles (respeta el pegado entre corchetes del programa). Si no hay texto —p. ej. una imagen—, deja pasar Ctrl+V para que el agente la lea él mismo. */
async function pasteInto(id: string, t: Terminal): Promise<void> {
  let text = ''
  try { text = await navigator.clipboard.readText() } catch { /* sin permiso: se trata como vacío */ }
  if (text) t.paste(text)
  else window.api.pty.write(id, '\x16')
}

function wire(): void {
  if (wired) return
  wired = true
  window.api.pty.onData((id, data) => terms.get(id)?.write(data))
  window.api.pty.onExit(({ id, code }) => {
    spawned.delete(id)
    const pane = [...useStore.getState().panes, ...useStore.getState().shells].find((p) => p.id === id)
    const name = pane?.command.split(/[\\/]/).pop() ?? tr('proc.default')
    const toast = useStore.getState().toast
    if (code === 0) toast(tr('proc.ended', { name }), 'info')
    else if (code === 127) toast(tr('proc.notFound', { name }), 'error')
    else if (code !== null && code < 0) toast(tr('proc.signal', { name, code: -code }), 'error')
    else toast(tr('proc.exitCode', { name, code: code ?? '?' }), 'error')
  })
}


export function TerminalPane({ pane, active }: { pane: Pane; active: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)

  useEffect(() => {
    wire()
    let disposed = false
    let cleanup = (): void => undefined
    // las fuentes se cargan ANTES de medir: si no, al llegar cambia el tamaño de la celda, cambian las columnas y zsh redibuja el prompt
    void (async () => {
    await Promise.all([document.fonts.load('13px "DejaVu Sans Mono"'), document.fonts.load('13px "Symbols Nerd Font Mono"')]).catch(() => undefined)
    if (disposed || !host.current) return
    const t = new Terminal({ fontFamily: FONT, fontSize: 13, lineHeight: 1.15, cursorBlink: true, scrollback: 5000, scrollOnUserInput: true, theme: TERMINAL_THEMES[useStore.getState().themeMode], allowProposedApi: true })
    const fit = new FitAddon()
    t.loadAddon(fit)
    t.loadAddon(new WebLinksAddon((_e, url) => window.open(url)))
    t.open(host.current!)
    term.current = t
    terms.set(pane.id, t)
    t.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      const key = e.key.toUpperCase()
      if (e.ctrlKey && !e.altKey && key === 'C' && (e.shiftKey || t.hasSelection())) { e.preventDefault(); copySelection(t); return false }      // Ctrl+C copia si hay texto seleccionado; si no, sigue siendo «interrumpir»
      if ((e.ctrlKey && !e.altKey && key === 'V') || (e.shiftKey && e.key === 'Insert')) { e.preventDefault(); void pasteInto(pane.id, t); return false }      // preventDefault: si no, el navegador pega también por su cuenta y sale doble
      return !isGlobalShortcut(e)                  // los atajos globales los atiende la app, no el shell
    })
    // el tamaño se avisa al proceso con una pausa: si cambia varias veces seguidas, zsh redibuja el prompt en cada una
    let timer: ReturnType<typeof setTimeout> | undefined
    const sendSize = (): void => {
      clearTimeout(timer)
      timer = setTimeout(() => { try { const atEnd = t.buffer.active.viewportY >= t.buffer.active.baseY; fit.fit(); window.api.pty.resize(pane.id, t.cols, t.rows); if (atEnd) t.scrollToBottom() } catch { /* aún sin tamaño */ } }, 90)
    }
    // el proceso se inicia cuando el contenedor ya tiene su tamaño definitivo (así nace con las columnas correctas)
    let cancelled = false
    const start = (tries = 0): void => {
      if (cancelled) return
      const box = host.current
      if ((!box || box.clientWidth < 40 || box.clientHeight < 20) && tries < 60) { requestAnimationFrame(() => start(tries + 1)); return }
      fit.fit()
      if (spawned.has(pane.id)) return
      spawned.add(pane.id)
      void window.api.pty.spawn({ id: pane.id, kind: pane.kind, name: pane.name, command: pane.command, args: pane.args, cwd: pane.cwd, cols: t.cols, rows: t.rows, prompt: pane.prompt, parentId: pane.parentId }).then((res) => {
        if (!res.ok) { spawned.delete(pane.id); useStore.getState().toast(res.error ?? tr('proc.startFailed'), 'error') }
      })
    }
    start()
    const data = t.onData((d) => window.api.pty.write(pane.id, d))
    const observer = new ResizeObserver(() => { try { sendSize() } catch { /* aún sin tamaño */ } })
    observer.observe(host.current!)
    cleanup = () => { cancelled = true; clearTimeout(timer); data.dispose(); observer.disconnect(); terms.delete(pane.id); t.dispose(); term.current = null }
    })()
    return () => { disposed = true; cleanup() }
  }, [pane.id])  // eslint-disable-line react-hooks/exhaustive-deps

  const mode = useStore((s) => s.themeMode)
  useEffect(() => { if (term.current) term.current.options.theme = TERMINAL_THEMES[mode] }, [mode])
  useEffect(() => { if (active) { term.current?.focus(); term.current?.scrollToBottom() } }, [active])
  const t = useT()
  const [menu, setMenu] = useState<{ anchor: DOMRect; selected: boolean } | null>(null)
  return (
    <>
      <div ref={host} className="min-h-0 flex-1 overflow-hidden bg-surface px-2 pb-3 pt-1.5"
        onContextMenu={(e) => { e.preventDefault(); setMenu({ anchor: new DOMRect(e.clientX + 190, e.clientY, 0, 0), selected: !!term.current?.hasSelection() }) }} />
      {menu && term.current && (
        <Menu anchor={menu.anchor} onClose={() => { setMenu(null); term.current?.focus() }} items={[
          { label: t('term.copy'), hidden: !menu.selected, onClick: () => copySelection(term.current!) },
          { label: t('term.paste'), onClick: () => void pasteInto(pane.id, term.current!) },
          { label: t('term.selectAll'), separator: true, onClick: () => term.current?.selectAll() }
        ]} />
      )}
    </>
  )
}
