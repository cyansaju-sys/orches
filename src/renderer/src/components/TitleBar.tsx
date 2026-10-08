import { useEffect } from 'react'
import { MdCallSplit, MdCropSquare, MdClose, MdEdit, MdEditOff, MdKeyboard, MdKeyboardArrowDown, MdRemove, MdTerminal } from 'react-icons/md'
import { useStore } from '@/store'
import { Chip, IconButton } from './ui'

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
        <IconButton title="Atajos (F1)" onClick={() => set({ modal: 'shortcuts' })}><MdKeyboard size={16} /></IconButton>
        <IconButton title="Minimizar" onClick={() => window.api.window.minimize()}><MdRemove size={16} /></IconButton>
        <IconButton title="Maximizar" onClick={() => window.api.window.toggleMaximize()}><MdCropSquare size={15} /></IconButton>
        <IconButton title="Cerrar" danger onClick={() => window.api.window.close()}><MdClose size={16} /></IconButton>
      </div>
      <MdKeyboardArrowDown className="hidden" />
    </div>
  )
}
