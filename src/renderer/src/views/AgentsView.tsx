import { useEffect } from 'react'
import { MdAdd, MdClose } from 'react-icons/md'
import { AgentIcon } from '@/components/AgentIcon'
import { useStore } from '@/store'

export function AgentsView() {
  const agents = useStore((s) => s.agents)
  const openAgent = useStore((s) => s.openAgent)
  const set = useStore((s) => s.set)
  const refresh = (): void => { void window.api.agents.detect().then((agents) => set({ agents })) }
  useEffect(refresh, [set])   // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async (command: string): Promise<void> => { await window.api.agents.removeCustom(command); refresh() }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between px-3 pt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
        Agentes
        <button onClick={() => set({ modal: 'addAgent' })} title="Añadir un agente que no aparece" className="grid size-6 place-items-center rounded-md text-muted transition-colors hover:bg-accent-bg hover:text-accent">
          <MdAdd size={15} />
        </button>
      </div>
      {!agents.length && <p className="px-3 py-2 text-[12px] text-muted">Sin agentes instalados. Si tienes uno que no aparece, pulsa + para añadirlo.</p>}
      <ul className="flex flex-col gap-0.5 px-1.5">
        {agents.map((a) => (
          <li key={a.command} className="group relative">
            <button onClick={() => void openAgent(a)} title={a.path} className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-accent-bg">
              <AgentIcon name={a.name} command={a.command} size={20} />
              {a.name}
              {a.custom && <span className="rounded-full bg-white/[0.05] px-1.5 py-0.5 text-[9px] text-muted">propio</span>}
            </button>
            {a.custom && (
              <button onClick={() => void remove(a.command)} title="Quitar de la lista" className="absolute right-1.5 top-1/2 hidden size-6 -translate-y-1/2 place-items-center rounded-md text-muted hover:bg-[#3a1620] hover:text-danger group-hover:grid">
                <MdClose size={13} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
