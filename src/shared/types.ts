/** Tipos compartidos entre el proceso principal, el preload y la interfaz. */

export interface DirEntry { name: string; path: string; isDir: boolean }

export interface FileData {
  kind: 'text' | 'image' | 'binary'
  text: string
  crlf: boolean
  truncated: boolean
  readOnly: boolean       // muy grande, no UTF-8...
  mtimeMs: number
  dataUrl?: string        // imágenes
}

export interface GitFile { path: string; index: string; work: string; code: string }
export interface GitStatus { isRepo: boolean; branch: string; ahead: number; behind: number; hasUpstream: boolean; files: GitFile[] }
export interface GitBranch { name: string; current: boolean; remote: boolean }
export type GitMarks = Record<number, 'added' | 'modified' | 'deleted'>

export interface AgentInfo { name: string; command: string; path: string }

export interface PtyOptions {
  id: string; command: string; args?: string[]; cwd: string; cols: number; rows: number
  kind?: 'agent' | 'shell'; name?: string       // los agentes se registran para el reparto de tareas
  prompt?: string                                // tarea inicial (agentes abiertos por otro agente)
  parentId?: string                              // agente que lo abrió
}
/** Panel que un agente pide abrir (reparto de tareas): la interfaz lo crea y su terminal inicia el proceso. */
export interface OpenPane { id: string; name: string; command: string; cwd: string; prompt: string; parentId: string }
export interface PtyExit { id: string; code: number | null; error?: string }

export type Settings = Record<string, unknown>

export interface Api {
  settings: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> }
  dialog: { chooseFolder(start?: string): Promise<string | null> }
  fs: {
    list(dir: string): Promise<DirEntry[]>
    read(path: string): Promise<FileData>
    write(path: string, text: string, crlf: boolean): Promise<number>
    mtime(path: string): Promise<number>
  }
  git: {
    status(root: string): Promise<GitStatus>
    ignored(root: string, paths: string[]): Promise<string[]>
    stage(root: string, paths: string[]): Promise<string>
    unstage(root: string, paths: string[]): Promise<string>
    commit(root: string, message: string): Promise<string>
    push(root: string): Promise<string>
    branches(root: string): Promise<GitBranch[]>
    checkout(root: string, name: string, remote: boolean): Promise<string>
    createBranch(root: string, name: string): Promise<string>
    marks(file: string): Promise<GitMarks>
  }
  agents: { detect(): Promise<AgentInfo[]>; shell(): Promise<string> }
  orchestra: {
    newId(): Promise<string>
    onOpenPane(cb: (pane: OpenPane) => void): () => void
    onToast(cb: (message: string, kind: 'ok' | 'error' | 'info') => void): () => void
  }
  pty: {
    spawn(opts: PtyOptions): Promise<{ ok: boolean; error?: string }>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    kill(id: string): void
    onData(cb: (id: string, data: string) => void): () => void
    onExit(cb: (e: PtyExit) => void): () => void
  }
  window: {
    minimize(): void
    toggleMaximize(): void
    close(): void
    onMaximized(cb: (maximized: boolean) => void): () => void
  }
}
