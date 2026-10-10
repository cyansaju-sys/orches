import { useT } from '@/lib/i18n'
import { clsx } from 'clsx'
import { useEffect, useRef, type ReactNode } from 'react'
import { MdClose } from 'react-icons/md'

/** Botón de ícono sin borde: el estilo base de toda la barra. */
export function IconButton({ title, onClick, children, className, danger }: {
  title?: string; onClick?: () => void; children: ReactNode; className?: string; danger?: boolean
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={clsx(
        'no-drag grid h-[26px] w-8 place-items-center rounded-md text-muted transition-colors',
        danger ? 'hover:bg-danger/15 hover:text-danger' : 'hover:bg-accent-bg hover:text-accent',
        className
      )}
    >
      {children}
    </button>
  )
}

/** Chip pulsable de la barra de título. */
export function Chip({ icon, label, onClick, title, active }: {
  icon: ReactNode; label: string; onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void; title?: string; active?: boolean
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={clsx(
        'no-drag flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] transition-colors hover:bg-accent-bg',
        active ? 'text-text' : 'text-muted'
      )}
    >
      <span className="text-accent">{icon}</span>
      {label}
    </button>
  )
}

/** Divisor que se arrastra para cambiar el tamaño de un panel. `onDrag` recibe el desplazamiento acumulado. */
export function Resizer({ onDrag, direction = 'x' }: { onDrag: (delta: number, done: boolean) => void; direction?: 'x' | 'y' }) {
  const start = useRef<number | null>(null)
  const down = (e: React.PointerEvent): void => {
    start.current = direction === 'x' ? e.clientX : e.clientY
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const move = (e: React.PointerEvent): void => {
    if (start.current === null) return
    onDrag((direction === 'x' ? e.clientX : e.clientY) - start.current, false)
  }
  const up = (e: React.PointerEvent): void => {
    if (start.current === null) return
    onDrag((direction === 'x' ? e.clientX : e.clientY) - start.current, true)
    start.current = null
  }
  return (
    <div
      onPointerDown={down} onPointerMove={move} onPointerUp={up}
      className={clsx('group relative shrink-0 touch-none', direction === 'x' ? 'w-1.5 cursor-col-resize' : 'h-1.5 cursor-row-resize')}
    >
      <div className={clsx('absolute bg-accent/0 transition-colors group-hover:bg-accent/60 group-active:bg-accent',
        direction === 'x' ? 'inset-y-0 left-[2px] w-[2px]' : 'inset-x-0 top-[2px] h-[2px]')} />
    </div>
  )
}

/** Diálogo modal centrado arriba, se cierra con Esc o al pulsar fuera. */
/** `top`: se ancla arriba y al centro (como los selectores rápidos), en vez de centrarse en vertical. */
export function Modal({ onClose, children, width = 520, title, top }: { onClose: () => void; children: ReactNode; width?: number; title?: string; top?: boolean }) {
  const t = useT()
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <div className={`fixed inset-0 z-50 flex animate-fade-in justify-center bg-black/12 backdrop-blur-[1px] ${top ? 'items-start pt-[9vh]' : 'items-center'}`} onMouseDown={onClose}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width }}
        className="max-h-[78vh] animate-pop-in overflow-hidden rounded-xl border border-ov/[0.06] bg-pop shadow-[0_18px_50px_-18px_rgba(0,0,0,0.75)]"
      >
        {title && (
          <div className="flex items-center justify-between px-5 pt-4">
            <h2 className="text-[13px] font-medium tracking-[0.01em] text-text">{title}</h2>
            <button onClick={onClose} title={t('title.close')} className="-mr-1.5 grid size-6 place-items-center rounded-md text-muted/70 transition-colors hover:bg-ov/[0.06] hover:text-text"><MdClose size={14} /></button>
          </div>
        )}
        {title ? <div className="pt-3.5">{children}</div> : children}
      </div>
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-line px-2 py-0.5 font-mono text-[10px] text-accent">{children}</kbd>
}

/** Aspecto común de los campos de texto: fondo suave, sin borde ni resaltado de foco. */
export const FIELD = 'w-full rounded-md bg-ov/[0.04] px-3 py-2 text-[12px] caret-accent outline-none placeholder:text-muted/70'
/** Igual, más delgado: para los campos de la barra lateral (buscar, reemplazar, filtros). */
export const FIELD_SLIM = 'w-full rounded-md bg-ov/[0.04] px-2.5 py-1 text-[12px] caret-accent outline-none placeholder:text-muted/70'
