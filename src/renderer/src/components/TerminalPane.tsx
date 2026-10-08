import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import { useEffect, useRef } from 'react'
import { isGlobalShortcut } from '@/lib/shortcuts'
import { useStore, type Pane } from '@/store'

// los prompts con íconos (powerlevel10k, starship) usan una Nerd Font: se prueban las más comunes antes de la fuente base
const FONT = '"MesloLGS NF", "JetBrainsMono Nerd Font", "FiraCode Nerd Font", "Hack Nerd Font", "DejaVu Sans Mono", "Symbols Nerd Font Mono", monospace'

const terms = new Map<string, Terminal>()      // id del panel -> terminal que muestra su salida
const spawned = new Set<string>()              // procesos ya iniciados (React puede montar dos veces en desarrollo)
let wired = false

function wire(): void {
  if (wired) return
  wired = true
  window.api.pty.onData((id, data) => terms.get(id)?.write(data))
  window.api.pty.onExit(({ id, code }) => {
    spawned.delete(id)
    const pane = [...useStore.getState().panes, useStore.getState().shell].find((p) => p?.id === id)
    const name = pane?.command.split(/[\\/]/).pop() ?? 'El proceso'
    const toast = useStore.getState().toast
    if (code === 0) toast(`«${name}» terminó`, 'info')
    else if (code === 127) toast(`No se pudo iniciar «${name}»: comando no encontrado`, 'error')
    else if (code !== null && code < 0) toast(`«${name}» se cerró por una señal (${-code})`, 'error')
    else toast(`«${name}» terminó con código ${code}`, 'error')
  })
}

const theme = {
  background: '#0d0f16', foreground: '#e6e8ef', cursor: '#8fa6c4', cursorAccent: '#0d0f16', selectionBackground: '#2c3a50',
  black: '#1a1d2b', red: '#ff6b81', green: '#7ee0a1', yellow: '#e2c08d', blue: '#82aaff', magenta: '#c792ea', cyan: '#4cc9b0', white: '#e6e8ef',
  brightBlack: '#6b7088', brightRed: '#ff8a9b', brightGreen: '#9bf0b9', brightYellow: '#f0d4a8', brightBlue: '#a3bdff',
  brightMagenta: '#d9b3f5', brightCyan: '#6fe0c9', brightWhite: '#ffffff'
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
    const t = new Terminal({ fontFamily: FONT, fontSize: 13, lineHeight: 1.15, cursorBlink: true, scrollback: 5000, scrollOnUserInput: true, theme, allowProposedApi: true })
    const fit = new FitAddon()
    t.loadAddon(fit)
    t.loadAddon(new WebLinksAddon((_e, url) => window.open(url)))
    t.open(host.current!)
    term.current = t
    terms.set(pane.id, t)
    t.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      if (e.ctrlKey && e.shiftKey && e.key.toUpperCase() === 'C') { void navigator.clipboard.writeText(t.getSelection()); return false }
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
        if (!res.ok) { spawned.delete(pane.id); useStore.getState().toast(res.error ?? 'No se pudo iniciar el proceso', 'error') }
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

  useEffect(() => { if (active) { term.current?.focus(); term.current?.scrollToBottom() } }, [active])
  return <div ref={host} className="min-h-0 flex-1 overflow-hidden bg-surface px-2 pb-3 pt-1.5" />
}
