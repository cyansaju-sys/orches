import { useEffect, useRef, useState } from 'react'
import { AgentsArea, TerminalSection } from '@/components/AgentsArea'
import { AgentPicker, AddAgentDialog, BranchPicker, NewsDialog, ShortcutsDialog } from '@/components/Dialogs'
import { EditorArea, saveDoc } from '@/components/EditorArea'
import { Sidebar, TABS } from '@/components/Sidebar'
import { Toasts } from '@/components/Toasts'
import { TitleBar } from '@/components/TitleBar'
import { Resizer } from '@/components/ui'
import { refreshGit } from '@/lib/gitSync'
import { isGlobalShortcut } from '@/lib/shortcuts'
import { loadIconTheme } from '@/lib/icons'
import { isDirty, useStore } from '@/store'

/** Arrastra un divisor: parte del ancho que tenía al empezar y suma el desplazamiento. */
function useDrag(get: () => number, apply: (value: number) => void, min: number, max: number, invert = false) {
  const base = useRef<number | null>(null)
  return (delta: number, done: boolean): void => {
    if (base.current === null) base.current = get()
    apply(Math.max(min, Math.min(max, base.current + (invert ? -delta : delta))))
    if (done) base.current = null
  }
}

export function App() {
  const s = useStore()
  const [ready, setReady] = useState(false)

  // arranque: tema de íconos, ajustes guardados y proyecto
  useEffect(() => {
    void (async () => {
      await loadIconTheme()
      const project = (await window.api.settings.get('project')) as string | undefined
      const edit = await window.api.settings.get('edit_enabled')
      const saved = (await window.api.settings.get('recent_projects')) as string[] | undefined
      const recentProjects = [...new Set([...(project ? [project] : []), ...(Array.isArray(saved) ? saved : [])])].slice(0, 10)
      useStore.setState({ project: project ?? null, recentProjects, editEnabled: edit === undefined ? true : Boolean(edit) })
      // tras actualizar: se muestran las novedades una vez (la primera instalación solo apunta la versión)
      const current = await window.api.update.version()
      const seen = (await window.api.settings.get('last_seen_version')) as string | undefined
      if (seen && seen !== current) useStore.setState({ modal: 'news', newsSince: seen })
      void window.api.settings.set('last_seen_version', current)
      setReady(true)
    })()
  }, [])

  // un agente pidió abrir otro (reparto de tareas) o avisó de algo
  useEffect(() => {
    const offPane = window.api.orchestra.onOpenPane((p) => {
      const st = useStore.getState()
      st.addPane({ id: p.id, kind: 'agent', name: p.name, title: `${p.name} · ${p.cwd.split(/[\\/]/).filter(Boolean).pop() ?? ''}`, command: p.command, args: p.args ?? [], cwd: p.cwd, prompt: p.prompt, parentId: p.parentId })
    })
    const offToast = window.api.orchestra.onToast((message, kind) => useStore.getState().toast(message, kind))
    return () => { offPane(); offToast() }
  }, [])

  // actualizaciones: el estado llega del proceso principal; al haber una release nueva se avisa una vez por versión
  useEffect(() => {
    const announced = new Set<string>()
    const apply = (update: import('@shared/types').UpdateState): void => {
      useStore.setState({ update })
      if (update.status === 'available' && !announced.has(update.version)) { announced.add(update.version); useStore.getState().toast(`Hay una versión nueva: v${update.version}`, 'info') }
      if (update.status === 'error') useStore.getState().toast(`No se pudo actualizar: ${update.message}`, 'error')
    }
    void window.api.update.state().then(apply)
    return window.api.update.onState(apply)
  }, [])

  // git se vigila cada pocos segundos: letras en el árbol, globo del ícono y rama de la barra de título
  useEffect(() => {
    void refreshGit()
    const timer = setInterval(() => void refreshGit(), 3000)
    return () => clearInterval(timer)
  }, [s.project])

  // atajos globales (en la fase de captura: llegan antes que a la terminal o al editor)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const st = useStore.getState()
      if (st.modal) return
      const key = e.key.toUpperCase()
      const doc = st.docs.find((d) => d.path === st.activeDoc)
      if (e.ctrlKey && !e.shiftKey && !e.altKey && key === 'W' && st.focus === 'editor' && doc) {
        e.preventDefault(); e.stopPropagation()
        if (!isDirty(doc) || window.confirm(`«${doc.title}» tiene cambios sin guardar. ¿Cerrarlo sin guardar?`)) st.closeDoc(doc.path)
        return
      }
      if (e.ctrlKey && !e.shiftKey && key === 'S' && doc) { e.preventDefault(); void saveDoc(doc); return }
      if (!isGlobalShortcut(e)) return
      e.preventDefault(); e.stopPropagation()
      if (e.key === 'F1') { st.set({ modal: 'shortcuts' }); return }
      if (e.key === 'PageUp' || e.key === 'PageDown') {
        const all = [...st.panes, ...st.shells]
        if (!all.length) return
        const i = all.findIndex((p) => p.id === st.activePane)
        st.set({ activePane: all[(i + (e.key === 'PageDown' ? 1 : -1) + all.length) % all.length].id, focus: 'pane' })
        return
      }
      const tab = TABS.find((t) => t.key === key)
      if (tab) { st.set({ tab: tab.id, sidebarOpen: true }); return }
      if (key === 'N') st.set({ modal: 'agents' })
      else if (key === 'T') void st.toggleShell()
      else if (key === 'B') st.set({ sidebarOpen: !st.sidebarOpen })
      else if (key === 'L') st.setEdit(!st.editEnabled)
      else if (key === 'W') { const id = st.activePane; if (id) st.closePane(id) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const dragSidebar = useDrag(() => useStore.getState().sidebarWidth, (v) => s.set({ sidebarWidth: v }), 220, 520)
  const dragEditor = useDrag(() => useStore.getState().editorWidth, (v) => s.set({ editorWidth: v }), 320, 1600)
  const dragShell = useDrag(() => useStore.getState().shellHeight, (v) => s.set({ shellHeight: v }), 140, 700, true)
  if (!ready) return <div className="h-full bg-bg" />

  return (
    <div className="flex h-full flex-col bg-bg">
      <TitleBar />
      <div className="flex min-h-0 flex-1 p-1.5 pt-0.5">
        <Sidebar />
        {s.sidebarOpen && <Resizer onDrag={dragSidebar} />}
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            {s.docs.length > 0 && s.panes.length === 0 ? (
              // sin agentes abiertos, el editor ocupa el espacio de «Elegir agente»
              <div className="flex min-w-[260px] flex-1 flex-col"><EditorArea /></div>
            ) : (
              <>
                {s.docs.length > 0 && (
                  <>
                    <div style={{ flexBasis: s.editorWidth }} className="flex min-w-[260px] shrink flex-col"><EditorArea /></div>
                    <Resizer onDrag={dragEditor} />
                  </>
                )}
                <AgentsArea />
              </>
            )}
          </div>
          {s.shells.length > 0 && (
            <>
              {!s.shellMax && <Resizer direction="y" onDrag={dragShell} />}
              <TerminalSection />
            </>
          )}
        </div>
      </div>
      {s.modal === 'agents' && <AgentPicker />}
      {s.modal === 'addAgent' && <AddAgentDialog />}
      {s.modal === 'shortcuts' && <ShortcutsDialog />}
      {s.modal === 'news' && <NewsDialog />}
      {s.modal === 'branches' && s.project && <BranchPicker />}
      <Toasts />
    </div>
  )
}
