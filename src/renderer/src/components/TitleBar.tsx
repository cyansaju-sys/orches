import { useEffect } from 'react'
import { MdCallSplit, MdCropSquare, MdClose, MdEdit, MdEditOff, MdFileDownload, MdKeyboard, MdKeyboardArrowDown, MdOpenInNew, MdRefresh, MdRemove, MdTerminal } from 'react-icons/md'
import { useStore } from '@/store'
import { Chip, IconButton } from './ui'

/** Botón de actualización: solo aparece cuando hay una release nueva (o mientras se descarga). */
function UpdateButton() {
  const update = useStore((s) => s.update)
  const base = 'no-drag relative mr-1 flex h-[24px] items-center gap-1.5 overflow-hidden rounded-full px-3 text-[11px] font-medium transition-colors'
  if (update.status === 'available') {
    return (
      <button onClick={() => void window.api.update.install()} title={update.canInstall ? 'Descarga la versión nueva y reinicia la app' : 'Abre la página de la release'}
        className={`${base} bg-accent text-bg hover:brightness-110`}>
        {update.canInstall ? <MdFileDownload size={14} /> : <MdOpenInNew size={13} />}
        {update.canInstall ? `Actualizar a v${update.version}` : `Nueva versión v${update.version}`}
      </button>
    )
  }
  if (update.status === 'downloading') {
    return (
      <div className={`${base} bg-accent-bg text-accent`}>
        <span className="absolute inset-y-0 left-0 bg-accent/30 transition-all" style={{ width: `${update.percent}%` }} />
        <MdFileDownload size={14} className="relative" /><span className="relative tabular-nums">Descargando {update.percent}%</span>
      </div>
    )
  }
  if (update.status === 'restarting') return <div className={`${base} bg-accent-bg text-accent`}><MdRefresh size={14} className="animate-spin" />Reiniciando…</div>
  if (update.status === 'error') {
    return (
      <button onClick={() => void window.api.update.check()} title={update.message} className={`${base} bg-danger/15 text-danger hover:bg-danger/25`}>
        <MdRefresh size={14} />Reintentar actualización
      </button>
    )
  }
  return null
}

export function TitleBar() {
  const git = useStore((s) => s.git)
  const shell = useStore((s) => s.shell)
  const editEnabled = useStore((s) => s.editEnabled)
  const set = useStore((s) => s.set)
  const setEdit = useStore((s) => s.setEdit)
  const toggleShell = useStore((s) => s.toggleShell)

  useEffect(() => window.api.window.onMaximized((maximized) => set({ maximized })), [set])

  return (
    <div className="drag flex h-[34px] shrink-0 items-center justify-between bg-bg pl-3 pr-1" onDoubleClick={() => window.api.window.toggleMaximize()}>
      <div className="flex items-center gap-3">
        <span className="text-[12px] font-medium text-muted">Orches</span>
        <Chip icon={<MdTerminal size={14} />} label="Terminal" active={!!shell} onClick={() => void toggleShell()} title="Abrir o cerrar la terminal (Ctrl+Shift+T)" />
        {git?.isRepo && (
          <Chip
            icon={<MdCallSplit size={14} />}
            label={git.branch}
            onClick={() => set({ modal: 'branches' })}
            title="Cambiar de rama"
          />
        )}
        <Chip
          icon={editEnabled ? <MdEdit size={14} /> : <MdEditOff size={14} />}
          label={editEnabled ? 'Edición' : 'Solo lectura'}
          onClick={() => setEdit(!editEnabled)}
          title="Edición de archivos: activa = editables; bloqueada = solo lectura (Ctrl+Shift+L)"
        />
      </div>
      <div className="flex items-center gap-0.5">
        <UpdateButton />
        <IconButton title="Atajos (F1)" onClick={() => set({ modal: 'shortcuts' })}><MdKeyboard size={16} /></IconButton>
        <IconButton title="Minimizar" onClick={() => window.api.window.minimize()}><MdRemove size={16} /></IconButton>
        <IconButton title="Maximizar" onClick={() => window.api.window.toggleMaximize()}><MdCropSquare size={15} /></IconButton>
        <IconButton title="Cerrar" danger onClick={() => window.api.window.close()}><MdClose size={16} /></IconButton>
      </div>
      <MdKeyboardArrowDown className="hidden" />
    </div>
  )
}
