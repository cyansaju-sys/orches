import { MdExtension } from 'react-icons/md'

/** Pestaña de extensiones: todavía no existe en la versión TypeScript. */
export function ComingSoon() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 pb-16 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-accent/10 text-accent"><MdExtension size={28} /></span>
      <h3 className="text-[14px] font-semibold">Extensiones</h3>
      <p className="text-[12px] leading-relaxed text-muted">Esto vendrá pronto.</p>
    </div>
  )
}
