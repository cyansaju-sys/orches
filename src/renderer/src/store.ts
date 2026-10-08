import { create } from 'zustand'
import type { AgentInfo, FileData, GitStatus, UpdateState } from '@shared/types'
import { basename } from '@/lib/paths'

export type SidebarTab = 'files' | 'agents' | 'git' | 'mcp' | 'ai'
export type ToastKind = 'ok' | 'error' | 'info'
export type Modal = null | 'agents' | 'addAgent' | 'shortcuts' | 'branches'
export type Focus = 'tree' | 'editor' | 'pane'

/** Pestaña de archivo o, con kind 'diff', de comparación: `original` = antes, `text` = después, `diffOf` = el archivo real. */
export interface Doc extends FileData { path: string; title: string; savedText: string; original?: string; diffOf?: string; diffLabel?: string }
export interface Pane {
  id: string; kind: 'agent' | 'shell'; title: string; command: string; args: string[]; cwd: string
  name?: string; prompt?: string; parentId?: string      // agente que lo abrió y su tarea inicial (reparto de tareas)
}
export interface Toast { id: number; kind: ToastKind; message: string }

interface State {
  project: string | null
  tab: SidebarTab
  sidebarOpen: boolean
  sidebarWidth: number
  editorWidth: number
  shellHeight: number
  editEnabled: boolean
  docs: Doc[]
  activeDoc: string | null
  panes: Pane[]
  shell: Pane | null
  activePane: string | null
  focus: Focus
  git: GitStatus | null
  modal: Modal
  toasts: Toast[]
  maximized: boolean
  agents: AgentInfo[]
  update: UpdateState

  set: (patch: Partial<State>) => void
  setProject: (path: string | null) => void
  toast: (message: string, kind?: ToastKind) => void
  dismissToast: (id: number) => void
  openDoc: (path: string) => Promise<void>
  closeDoc: (path: string) => void
  openDiff: (file: string, staged: boolean) => Promise<void>
  openGraph: () => void
  openCommitDiff: (hash: string, parent: string | null, path: string, label: string) => Promise<void>
  renameDocs: (from: string, to: string) => void      // un archivo o carpeta cambió de nombre: sus pestañas lo siguen
  dropDocs: (path: string) => void                    // se borró: se cierran sus pestañas
  updateDocText: (path: string, text: string) => void
  markSaved: (path: string, text: string, mtimeMs: number) => void
  replaceDoc: (path: string, data: FileData) => void
  openAgent: (agent: { name: string; command: string; args?: string[] }, args?: string[], opts?: { cwd?: string; title?: string }) => Promise<void>
  addPane: (pane: Pane) => void
  toggleShell: () => Promise<void>
  closePane: (id: string) => void
  setEdit: (enabled: boolean) => void
}

let toastId = 1
let paneId = 1   // solo para la terminal (los agentes piden su id a la app)

/** Deduce el tipo de aviso a partir del texto cuando no se indica. */
const guessKind = (m: string): ToastKind => {
  const low = m.toLowerCase()
  if (['no se pudo', 'falló', 'error', 'no se encontr', 'no existe'].some((w) => low.includes(w))) return 'error'
  if (['copiad', 'guardad', 'creada', 'creado', 'hecho', 'subido'].some((w) => low.includes(w))) return 'ok'
  return 'info'
}

export const useStore = create<State>((set, get) => ({
  project: null, tab: 'files', sidebarOpen: true, sidebarWidth: 300, editorWidth: 720, shellHeight: 240, editEnabled: true,
  docs: [], activeDoc: null, panes: [], shell: null, activePane: null, focus: 'tree', git: null, modal: null, toasts: [],
  maximized: false, agents: [], update: { status: 'idle' },

  set: (patch) => set(patch),

  setProject: (path) => { set({ project: path, git: null }); void window.api.settings.set('project', path) },

  toast: (message, kind) => {
    const id = toastId++
    set((s) => ({ toasts: [...s.toasts, { id, kind: kind ?? guessKind(message), message }].slice(-4) }))
    const long = (kind ?? guessKind(message)) === 'error'
    setTimeout(() => get().dismissToast(id), long ? 6000 : 3500)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  openDoc: async (path) => {
    if (get().docs.some((d) => d.path === path)) { set({ activeDoc: path, focus: 'editor' }); return }
    try {
      const data = await window.api.fs.read(path)
      const doc: Doc = { ...data, path, title: basename(path), savedText: data.text }
      set((s) => ({ docs: [...s.docs, doc], activeDoc: path, focus: 'editor' }))
    } catch (e) {
      get().toast(`No se pudo abrir ${basename(path)}: ${e instanceof Error ? e.message : String(e)}`, 'error')
    }
  },
  openGraph: () => {
    const path = 'graph:git'
    const doc: Doc = { kind: 'graph', text: '', savedText: '', crlf: false, truncated: false, readOnly: true, mtimeMs: 0, path, title: 'Commits' }
    set((s) => ({ docs: s.docs.some((d) => d.path === path) ? s.docs : [...s.docs, doc], activeDoc: path, focus: 'editor' }))
  },
  openCommitDiff: async (hash, parent, path, label) => {
    const root = get().project
    if (!root) return
    try {
      const before = parent ? ((await window.api.git.show(root, parent, path)) ?? '') : ''
      const after = (await window.api.git.show(root, hash, path)) ?? ''
      const key = `diff:commit:${hash}:${path}`
      const doc: Doc = { kind: 'diff', text: after, savedText: after, original: before, crlf: false, truncated: false, readOnly: true, mtimeMs: 0,
        path: key, title: `${basename(path)} (${hash.slice(0, 7)})`, diffOf: `${root}/${path}`, diffLabel: label }
      set((s) => ({ docs: s.docs.some((d) => d.path === key) ? s.docs : [...s.docs, doc], activeDoc: key, focus: 'editor' }))
    } catch (e) {
      get().toast(`No se pudo comparar ${basename(path)}: ${e instanceof Error ? e.message : String(e)}`, 'error')
    }
  },
  openDiff: async (file, staged) => {
    const root = get().project
    if (!root) return
    const rel = file.slice(root.length).replace(/^[\\/]+/, '').replace(/\\/g, '/')
    try {
      // preparados: HEAD → lo preparado. Sin preparar: lo preparado (o HEAD) → el archivo en disco.
      const head = await window.api.git.show(root, 'HEAD', rel)
      const index = await window.api.git.show(root, 'index', rel)
      const before = staged ? (head ?? '') : (index ?? head ?? '')
      const after = staged ? (index ?? '') : await window.api.fs.read(file).then((d) => d.text, () => '')
      const path = `diff:${staged ? 'staged' : 'work'}:${file}`
      const doc: Doc = { kind: 'diff', text: after, savedText: after, original: before, crlf: false, truncated: false, readOnly: true, mtimeMs: 0,
        path, title: `${basename(file)} (cambios)`, diffOf: file, diffLabel: staged ? 'Preparado ↔ HEAD' : index !== null ? 'Archivo ↔ preparado' : 'Archivo ↔ HEAD' }
      set((s) => ({ docs: s.docs.some((d) => d.path === path) ? s.docs.map((d) => (d.path === path ? doc : d)) : [...s.docs, doc], activeDoc: path, focus: 'editor' }))
    } catch (e) {
      get().toast(`No se pudo comparar ${basename(file)}: ${e instanceof Error ? e.message : String(e)}`, 'error')
    }
  },
  closeDoc: (path) => set((s) => {
    const i = s.docs.findIndex((d) => d.path === path)
    const docs = s.docs.filter((d) => d.path !== path)
    const activeDoc = s.activeDoc === path ? (docs[Math.min(i, docs.length - 1)]?.path ?? null) : s.activeDoc
    return { docs, activeDoc }
  }),
  renameDocs: (from, to) => set((s) => {
    const move = (p: string): string => (p === from ? to : p.startsWith(from + '/') || p.startsWith(from + '\\') ? to + p.slice(from.length) : p)
    return { docs: s.docs.map((d) => { const path = move(d.path); return path === d.path ? d : { ...d, path, title: path.split(/[\\/]/).pop() ?? d.title } }), activeDoc: s.activeDoc ? move(s.activeDoc) : null }
  }),
  dropDocs: (path) => set((s) => {
    const inside = (p: string): boolean => p === path || p.startsWith(path + '/') || p.startsWith(path + '\\')
    const docs = s.docs.filter((d) => !inside(d.path))
    return { docs, activeDoc: s.activeDoc && inside(s.activeDoc) ? (docs[docs.length - 1]?.path ?? null) : s.activeDoc }
  }),
  updateDocText: (path, text) => set((s) => ({ docs: s.docs.map((d) => (d.path === path ? { ...d, text } : d)) })),
  markSaved: (path, text, mtimeMs) => set((s) => ({ docs: s.docs.map((d) => (d.path === path ? { ...d, savedText: text, mtimeMs } : d)) })),
  replaceDoc: (path, data) => set((s) => ({ docs: s.docs.map((d) => (d.path === path ? { ...d, ...data, savedText: data.text } : d)) })),

  openAgent: async (agent, args = [], opts = {}) => {
    const cwd = opts.cwd || get().project
    if (!cwd) { get().toast('Abre un proyecto primero (pestaña Archivos)', 'error'); return }
    const id = await window.api.orchestra.newId()          // los ids los reparte la app: así no chocan con los de los sub-agentes
    const title = opts.title ?? `${agent.name} · ${basename(cwd)}`
    set((s) => ({ panes: [...s.panes, { id, kind: 'agent', title, name: agent.name, command: agent.command, args: [...(agent.args ?? []), ...args], cwd }], activePane: id, focus: 'pane', modal: null }))
  },
  /** Un agente pidió abrir otro (reparto de tareas): se añade su panel y la terminal inicia el proceso con la tarea. */
  addPane: (pane) => set((s) => (s.panes.some((p) => p.id === pane.id) ? s : { panes: [...s.panes, pane] })),
  toggleShell: async () => {
    if (get().shell) { window.api.pty.kill(get().shell!.id); set({ shell: null, activePane: get().panes.at(-1)?.id ?? null }); return }
    const project = get().project
    const cwd = project ?? ''
    const command = await window.api.agents.shell()
    const id = `s${paneId++}`
    set({ shell: { id, kind: 'shell', title: `Terminal · ${project ? basename(project) : '~'}`, command, args: [], cwd }, activePane: id, focus: 'pane' })
  },
  closePane: (id) => set((s) => {
    window.api.pty.kill(id)
    const panes = s.panes.filter((p) => p.id !== id)
    const shell = s.shell?.id === id ? null : s.shell
    const activePane = s.activePane === id ? (panes.at(-1)?.id ?? shell?.id ?? null) : s.activePane
    return { panes, shell, activePane }
  }),

  setEdit: (enabled) => { set({ editEnabled: enabled }); void window.api.settings.set('edit_enabled', enabled) }
}))

export const isDirty = (d: Doc): boolean => d.text !== d.savedText
