import { clsx } from 'clsx'
import { MdCheck, MdChevronRight } from 'react-icons/md'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/** Con `submenu`, el elemento abre una lista a un lado (y `onClick` no hace falta). */
export interface MenuItem { label: string; icon?: ReactNode; onClick?: () => void; danger?: boolean; hidden?: boolean; submenu?: MenuItem[]
  detail?: string          // texto tenue a la derecha (p. ej. el valor actual de un submenú)
  checked?: boolean        // marca de selección a la derecha
  separator?: boolean      // línea fina encima del elemento
}

const WIDTH = 190
const SUB_WIDTH = 190
const GAP = 4
const MARGIN = 8

/**
 * Menú desplegable anclado a un botón (`anchor` = su rectángulo en pantalla): se abre debajo, alineado a su borde derecho, y
 * pasa arriba si abajo no cabe. Se cierra con Esc, al pulsar fuera o al elegir algo. ↑↓ y Enter funcionan; → abre un submenú y ← lo cierra.
 */
export function Menu({ anchor, items, onClose, width = WIDTH }: { anchor: DOMRect; items: MenuItem[]; onClose: () => void; width?: number }) {
  const box = useRef<HTMLDivElement>(null)
  const shown = items.filter((i) => !i.hidden)
  const [index, setIndex] = useState(-1)          // nada resaltado hasta pasar el ratón o usar las flechas
  const [sub, setSub] = useState<number | null>(null)          // elemento cuyo submenú está abierto
  const [subIndex, setSubIndex] = useState(0)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>()          // el submenú se cierra con un respiro: da tiempo a llegar a él en diagonal
  const subItems = sub !== null ? shown[sub]?.submenu ?? [] : []
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  // se mide una vez montado: así se sabe si cabe debajo del botón
  useLayoutEffect(() => {
    const h = box.current?.offsetHeight ?? shown.length * 34 + 12
    const below = anchor.bottom + GAP + h <= window.innerHeight - MARGIN
    const wanted = below ? anchor.bottom + GAP : anchor.top - GAP - h
    const top = Math.max(MARGIN, Math.min(wanted, window.innerHeight - h - MARGIN))      // siempre dentro de la ventana
    const left = Math.min(Math.max(MARGIN, anchor.right - width), window.innerWidth - width - MARGIN)
    setPos({ top, left })
  }, [anchor, shown.length])

  useEffect(() => {
    const pick = (item: MenuItem | undefined): void => { if (item) { onClose(); item.onClick?.() } }
    const onKey = (e: KeyboardEvent): void => {
      const inSub = sub !== null
      const list = inSub ? subItems : shown
      const current = inSub ? subIndex : index
      const move = (i: number): void => (inSub ? setSubIndex(i) : setIndex(i))
      if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key)) e.stopPropagation()      // con el menú abierto, las teclas son suyas: no llegan al árbol ni a la terminal de abajo
      if (e.key === 'Escape') { e.stopPropagation(); if (inSub) setSub(null); else onClose() }
      else if (e.key === 'ArrowDown') { e.preventDefault(); move((current + 1) % list.length) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move((current - 1 + list.length) % list.length) }
      else if (e.key === 'ArrowRight' && !inSub && shown[index]?.submenu) { e.preventDefault(); setSub(index); setSubIndex(0) }
      else if (e.key === 'ArrowLeft' && inSub) { e.preventDefault(); setSub(null) }
      else if (e.key === 'Enter') {
        e.preventDefault()
        if (inSub) pick(subItems[subIndex])
        else if (shown[index]?.submenu) { setSub(index); setSubIndex(0) }
        else pick(shown[index])
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [index, shown, onClose, sub, subIndex, subItems])

  /** Pasar el ratón por un elemento lo resalta; si tiene submenú lo abre, y si no, cierra el que hubiera abierto. */
  const hover = (i: number): void => {
    setIndex(i)
    if (shown[i]?.submenu) {
      clearTimeout(closeTimer.current); closeTimer.current = undefined
      if (sub !== i) { setSub(i); setSubIndex(-1) }
    } else if (sub !== null && !closeTimer.current) closeTimer.current = setTimeout(() => { closeTimer.current = undefined; setSub(null) }, 180)
  }
  useEffect(() => () => clearTimeout(closeTimer.current), [])
  const row = (item: MenuItem, active: boolean): string =>
    clsx('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12px] transition-colors',
      item.danger ? 'text-danger' : 'text-text', active && (item.danger ? 'bg-danger/10' : 'bg-accent/[0.16]'))
  /** Sube el submenú lo justo para que no se salga por abajo de la ventana. */
  const fitSub = (el: HTMLDivElement | null): void => {
    if (!el) return
    el.style.top = '0px'
    const overflow = el.getBoundingClientRect().bottom - (window.innerHeight - MARGIN)
    if (overflow > 0) el.style.top = `${-overflow}px`
  }
  const EDGE = 5      // relleno (4) y borde (1) del menú: el submenú se mide desde el elemento, no desde el borde del menú
  const subLeft = pos && pos.left + width + SUB_WIDTH > window.innerWidth - MARGIN ? -SUB_WIDTH - EDGE : width - EDGE      // al otro lado si no cabe

  return (
    <div className="fixed inset-0 z-50" onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }}>
      <div
        ref={box} role="menu" onMouseDown={(e) => e.stopPropagation()}
        style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width }}
        className="absolute animate-pop-in rounded-xl border border-ov/[0.08] bg-pop p-1 shadow-[0_16px_44px_-8px_rgba(0,0,0,0.85)]"
      >
        {shown.map((item, i) => (
          <div key={item.label} className="relative">
            {item.separator && i > 0 && <div className="mx-2 my-1 border-t border-ov/[0.08]" />}
            <button
              role="menuitem" onMouseMove={() => hover(i)} aria-haspopup={item.submenu ? 'menu' : undefined}
              onClick={() => {
                if (item.submenu) { setSub(i); return }      // ya se abrió al pasar el ratón; el clic (o un táctil) lo deja abierto
                onClose(); item.onClick?.()
              }}
              className={row(item, i === index || sub === i)}
            >
              {item.icon && <span className={clsx('grid size-4 place-items-center', item.danger ? '' : 'text-muted')}>{item.icon}</span>}
              <span className="flex-1">{item.label}</span>
              {item.detail && <span className="text-[11px] text-muted">{item.detail}</span>}
              {item.checked && <MdCheck size={15} className="text-accent" />}
              {item.submenu && <MdChevronRight size={15} className="text-muted" />}
            </button>
            {item.submenu && sub === i && (
              <div role="menu" style={{ left: subLeft, width: SUB_WIDTH }} ref={fitSub} onMouseEnter={() => { clearTimeout(closeTimer.current); closeTimer.current = undefined }}
                className="absolute top-0 animate-pop-in rounded-xl border border-ov/[0.08] bg-pop p-1 shadow-[0_16px_44px_-8px_rgba(0,0,0,0.85)]">
                {item.submenu.map((child, j) => (
                  <button key={child.label} role="menuitem" onMouseMove={() => setSubIndex(j)} onClick={() => { onClose(); child.onClick?.() }} className={row(child, j === subIndex)}>
                    {child.icon && <span className="grid size-4 place-items-center text-muted">{child.icon}</span>}
                    <span className="flex-1">{child.label}</span>
                    {child.detail && <span className="text-[11px] text-muted">{child.detail}</span>}
                    {child.checked && <MdCheck size={15} className="text-accent" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
