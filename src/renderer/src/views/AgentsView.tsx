import { useEffect } from 'react'
import { MdSmartToy } from 'react-icons/md'
import { useStore } from '@/store'

export function AgentsView() {
  const agents = useStore((s) => s.agents)
  const openAgent = useStore((s) => s.openAgent)
  const set = useStore((s) => s.set)
  useEffect(() => { void window.api.agents.detect().then((agents) => set({ agents })) }, [set])

  if (!agents.length) return <p className="px-3 py-2 text-[12px] text-muted">Sin agentes instalados</p>
  return (
    <ul className="flex flex-col gap-0.5 px-1.5">
      {agents.map((a) => (
        <li key={a.command}>
          <button onClick={() => void openAgent(a)} title={a.path} className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-accent-bg">
            <MdSmartToy size={16} className="text-accent" />
            {a.name}
          </button>
        </li>
      ))}
    </ul>
  )
}
