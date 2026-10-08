import { clsx } from 'clsx'
import { MdCheckCircle, MdErrorOutline, MdInfoOutline } from 'react-icons/md'
import { useStore } from '@/store'

const look = {
  ok: { color: 'border-l-ok', icon: <MdCheckCircle size={16} className="text-ok" /> },
  error: { color: 'border-l-danger', icon: <MdErrorOutline size={16} className="text-danger" /> },
  info: { color: 'border-l-accent', icon: <MdInfoOutline size={16} className="text-accent" /> }
}

/** Avisos breves abajo a la derecha: se apilan y se cierran solos o al pulsarlos. */
export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={clsx(
            'pointer-events-auto flex w-[340px] animate-toast-in items-start gap-2.5 rounded-lg border border-l-[3px] border-line bg-raised px-3 py-2.5 text-left shadow-xl shadow-black/50',
            look[t.kind].color
          )}
        >
          <span className="mt-px">{look[t.kind].icon}</span>
          <span className="line-clamp-4 text-[12px] leading-snug">{t.message}</span>
        </button>
      ))}
    </div>
  )
}
