import { clsx } from 'clsx'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export interface MenuItem { label: string; icon?: ReactNode; onClick: () => void; danger?: boolean; hidden?: boolean }

const WIDTH = 190
const GAP = 4
const MARGIN = 8

/**
 * Menú desplegable anclado a un botón (`anchor` = su rectángulo en pantalla): se abre debajo, alineado a su borde derecho, y
 * pasa arriba si abajo no cabe. Se cierra con Esc, al pulsar fuera o al elegir algo. ↑↓ y Enter funcionan.
 */
export function Menu({ anchor, items, onClose }: { anchor: DOMRect; items: MenuItem[]; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const shown = items.filter((i) => !i.hidden)
  const [index, setIndex] = useState(0)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  // se mide una vez montado: así se sabe si cabe debajo del botón
  useLayoutEffect(() => {
    const h = box.current?.offsetHeight ?? shown.length * 34 + 12
    const below = anchor.bottom + GAP + h <= window.innerHeight - MARGIN
    const wanted = below ? anchor.bottom + GAP : anchor.top - GAP - h
    const top = Math.max(MARGIN, Math.min(wanted, window.innerHeight - h - MARGIN))      // siempre dentro de la ventana
    const left = Math.min(Math.max(MARGIN, anchor.right - WIDTH), window.innerWidth - WIDTH - MARGIN)
    setPos({ top, left })
  }, [anchor, shown.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => (i + 1) % shown.length) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => (i - 1 + shown.length) % shown.length) }
      else if (e.key === 'Enter') { e.preventDefault(); onClose(); shown[index]?.onClick() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [index, shown, onClose])

  return (
    <div className="fixed inset-0 z-50" onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }}>
      <div
        ref={box} role="menu" onMouseDown={(e) => e.stopPropagation()}
        style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: WIDTH }}
        className="absolute animate-pop-in rounded-xl border border-white/[0.08] bg-[#0f121a] p-1 shadow-[0_16px_44px_-8px_rgba(0,0,0,0.85)]"
      >
        {shown.map((item, i) => (
          <button
            key={item.label} role="menuitem" onMouseMove={() => setIndex(i)}
            onClick={() => { onClose(); item.onClick() }}
            className={clsx('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12px] transition-colors',
              item.danger ? 'text-danger' : 'text-text', i === index && (item.danger ? 'bg-danger/10' : 'bg-accent/[0.16]'))}
          >
            <span className={clsx('grid size-4 place-items-center', item.danger ? '' : 'text-muted')}>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}
