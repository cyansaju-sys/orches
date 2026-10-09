import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const DELAY = 1000         // el cursor debe quedarse quieto este tiempo sobre el elemento
const QUICK = 300          // si acaba de verse otro, el siguiente sale sin espera
const GAP = 8
const MARGIN = 8

/** «Abrir la terminal (Ctrl+Shift+T)» -> texto y atajo por separado, para dibujar el atajo como tecla. */
function split(text: string): { label: string; keys: string[] } {
  const m = /^(.*?)\s*\(((?:Ctrl|Alt|Shift|Cmd|F\d+)[^)]*)\)\s*$/.exec(text)
  return m ? { label: m[1], keys: m[2].split(/\s*\+\s*/) } : { label: text, keys: [] }
}

/**
 * Tooltips propios en lugar de los del sistema: toma el atributo `title` de cualquier elemento al pasar el ratón,
 * lo retira mientras se muestra (para que no salga también el nativo) y lo devuelve al salir.
 */
export function Tooltips() {
  const [tip, setTip] = useState<{ text: string; rect: DOMRect } | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let current: HTMLElement | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let lastShown = 0
    let showing = false
    let anchor: { x: number; y: number } | null = null       // dónde estaba el cursor al empezar a esperar
    let show: () => void = () => undefined

    const restore = (): void => {
      if (current?.hasAttribute('data-tip')) { current.setAttribute('title', current.getAttribute('data-tip') ?? ''); current.removeAttribute('data-tip') }
    }
    const hide = (): void => {
      clearTimeout(timer)
      restore()
      current = null
      showing = false
      setTip((t) => { if (t) lastShown = Date.now(); return null })
      setPos(null)
    }
    const over = (e: MouseEvent): void => {
      const el = (e.target as Element | null)?.closest?.('[title], [data-tip]') as HTMLElement | null
      if (el === current) return
      hide()
      if (!el) return
      const text = el.getAttribute('title') ?? el.getAttribute('data-tip') ?? ''
      if (!text.trim()) return
      el.setAttribute('data-tip', text); el.removeAttribute('title')       // sin el atributo no sale el tooltip del sistema
      current = el
      show = (): void => { if (current === el) { showing = true; setTip({ text, rect: el.getBoundingClientRect() }) } }
      anchor = { x: e.clientX, y: e.clientY }
      if (Date.now() - lastShown < QUICK) show()
      else timer = setTimeout(show, DELAY)
    }
    // si el cursor se mueve de verdad sobre el elemento, la espera empieza de nuevo: solo sale si se queda quieto
    const move = (e: MouseEvent): void => {
      if (!current || showing || !anchor) return
      if (Math.hypot(e.clientX - anchor.x, e.clientY - anchor.y) < 5) return
      anchor = { x: e.clientX, y: e.clientY }
      clearTimeout(timer)
      timer = setTimeout(show, DELAY)
    }
    const out = (e: MouseEvent): void => { if (current && !current.contains(e.relatedTarget as Node | null)) hide() }

    document.addEventListener('mouseover', over, true)
    document.addEventListener('mouseout', out, true)
    document.addEventListener('mousemove', move, true)
    document.addEventListener('mousedown', hide, true)
    document.addEventListener('keydown', hide, true)
    window.addEventListener('blur', hide)
    document.addEventListener('scroll', hide, true)
    return () => {
      hide()
      document.removeEventListener('mouseover', over, true); document.removeEventListener('mouseout', out, true); document.removeEventListener('mousemove', move, true)
      document.removeEventListener('mousedown', hide, true); document.removeEventListener('keydown', hide, true)
      window.removeEventListener('blur', hide); document.removeEventListener('scroll', hide, true)
    }
  }, [])

  // se mide una vez montado para centrarlo bajo el elemento (o encima si abajo no cabe) sin salirse de la ventana
  useLayoutEffect(() => {
    if (!tip || !box.current) return
    const { width, height } = box.current.getBoundingClientRect()
    const below = tip.rect.bottom + GAP + height <= window.innerHeight - MARGIN
    const top = below ? tip.rect.bottom + GAP : Math.max(MARGIN, tip.rect.top - GAP - height)
    const left = Math.min(Math.max(MARGIN, tip.rect.left + tip.rect.width / 2 - width / 2), window.innerWidth - width - MARGIN)
    setPos({ top, left })
  }, [tip])

  if (!tip) return null
  const { label, keys } = split(tip.text)
  return (
    <div
      ref={box} role="tooltip"
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
      className="pointer-events-none fixed z-[70] flex max-w-[320px] animate-pop-in items-center gap-2 rounded-lg border border-white/[0.08] bg-[#0f121a] px-2.5 py-1.5 text-[11px] leading-snug text-text shadow-[0_8px_24px_-6px_rgba(0,0,0,0.8)]"
    >
      <span className="min-w-0 break-words [overflow-wrap:anywhere]">{label}</span>
      {keys.length > 0 && (
        <span className="flex shrink-0 items-center gap-0.5">
          {keys.map((k) => <kbd key={k} className="rounded border border-white/[0.12] bg-white/[0.06] px-1 py-px font-mono text-[10px] text-muted">{k}</kbd>)}
        </span>
      )}
    </div>
  )
}
