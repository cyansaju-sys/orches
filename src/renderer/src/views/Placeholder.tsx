export function Placeholder({ title, text }: { title: string; text: string }) {
  return (
    <div className="px-3 py-2">
      <h3 className="text-[12px] font-semibold">{title}</h3>
      <p className="mt-2 text-[12px] leading-relaxed text-muted">{text}</p>
      <p className="mt-3 rounded-md border border-line bg-raised px-2.5 py-2 text-[11px] text-muted">
        Todavía no está en la versión TypeScript; llegará en una próxima etapa de la migración.
      </p>
    </div>
  )
}
