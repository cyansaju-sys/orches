/** Tipos compartidos entre el proceso principal, el preload y la interfaz. */

export interface DirEntry { name: string; path: string; isDir: boolean }

export interface FileData {
  kind: 'text' | 'image' | 'binary' | 'diff' | 'graph'
  text: string
  crlf: boolean
  truncated: boolean
  readOnly: boolean       // muy grande, no UTF-8...
  mtimeMs: number
  dataUrl?: string        // imágenes
}

export interface GitFile { path: string; index: string; work: string; code: string }
export interface GitStatus { isRepo: boolean; branch: string; ahead: number; behind: number; hasUpstream: boolean; hasRemote: boolean; files: GitFile[] }
/** Rama con su último commit (fecha en ms, autor, hash corto y asunto) para mostrarla en el selector. */
export interface GitBranch { name: string; current: boolean; remote: boolean; date?: number; author?: string; hash?: string; subject?: string }
export type GitMarks = Record<number, 'added' | 'modified' | 'deleted'>

/** `custom`: lo añadió el usuario (no está en la lista conocida). `args`: argumentos fijos con los que se arranca. */
export interface AgentInfo { name: string; command: string; path: string; args?: string[]; custom?: boolean }
/** Ejecutable instalado por el usuario que podría ser un agente (para «Añadir agente»). */
export interface AgentCandidate { name: string; path: string }

export interface PtyOptions {
  id: string; command: string; args?: string[]; cwd: string; cols: number; rows: number
  kind?: 'agent' | 'shell'; name?: string       // los agentes se registran para el reparto de tareas
  prompt?: string                                // tarea inicial (agentes abiertos por otro agente)
  parentId?: string                              // agente que lo abrió
}
/** Panel que un agente pide abrir (reparto de tareas): la interfaz lo crea y su terminal inicia el proceso. */
export interface OpenPane { id: string; name: string; command: string; args?: string[]; cwd: string; prompt: string; parentId: string }
/** Una tarea que un agente delegó a otro. `closed`: el panel del agente ya no existe. */
export interface TaskInfo {
  id: number; agentId: string; agent: string; callerId: string; caller: string
  task: string; model: string | null; difficulty: string | null; startedAt: number; endedAt: number | null
  status: 'working' | 'done' | 'closed'
}
export interface PtyExit { id: string; code: number | null; error?: string }

export type McpScope = 'global' | 'project' | 'shared'
export type McpAgent = 'claude' | 'opencode' | 'gemini' | 'codex' | 'agy'
/** Servidor MCP ya configurado en un agente. */
export interface McpServer {
  name: string; agent: McpAgent; scope: McpScope; kind: 'remote' | 'local'; target: string
  config: Record<string, unknown>      // entrada original de la configuración
  source: string                       // archivo donde está guardada
}
/** Lo que se necesita para añadir un servidor. */
export interface McpSpec {
  name: string; kind: 'remote' | 'local'
  url?: string; headers?: Record<string, string>
  command?: string; args?: string[]; env?: Record<string, string>
}
export type GitOp = 'tag' | 'branch' | 'checkout' | 'cherry-pick' | 'revert' | 'merge' | 'rebase' | 'reset-soft' | 'reset-mixed' | 'reset-hard'
export interface GitChangedFile { status: string; path: string; added: number; deleted: number }
export interface GitCommit { hash: string; parents: string[]; author: string; time: number; refs: string[]; subject: string }
export interface McpResult { ok: boolean; message: string }

/** Una sesión del historial de un agente. */
export interface SessionInfo {
  command: 'claude' | 'opencode' | 'agy'; agent: string; id: string; title: string; project: string; cwd: string
  tokens: number; start: number; end: number      // fechas en milisegundos
}
export interface LimitInfo { label: string; percent: number; resetsAt: number }
export interface AgentUsage {
  name: string; command: string
  window: { start: number; end: number; tokens: number } | null      // ventana de 5 h en curso
  today: number; week: number; total: number
  note: string; limits: LimitInfo[]; limitsError: string; limitsAge: number
}
export interface UsageData { agents: AgentUsage[]; history: SessionInfo[] }

/** Estado de las actualizaciones: `available` muestra el botón «Actualizar». */
export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string; canInstall: boolean; url: string }   // canInstall=false: se abre la página de la release
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'restarting'; version: string }
  | { status: 'error'; message: string }

export type Settings = Record<string, unknown>

export interface Api {
  settings: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> }
  dialog: { chooseFolder(start?: string): Promise<string | null> }
  ai: { cancel(kind: 'commit' | 'context'): Promise<void> }
  context: {
    ensure(project: string): Promise<string>
    generate(project: string): Promise<McpResult & { text?: string; agent?: string }>
    onAgent(cb: (name: string) => void): () => void
  }
  fs: {
    list(dir: string): Promise<DirEntry[]>
    read(path: string): Promise<FileData>
    write(path: string, text: string, crlf: boolean): Promise<number>
    mtime(path: string): Promise<number>
    create(dir: string, name: string, isDir: boolean): Promise<McpResult>
    rename(path: string, name: string): Promise<McpResult>
    trash(path: string): Promise<McpResult>
  }
  git: {
    status(root: string): Promise<GitStatus>
    ignored(root: string, paths: string[]): Promise<string[]>
    stage(root: string, paths: string[]): Promise<string>
    unstage(root: string, paths: string[]): Promise<string>
    commit(root: string, message: string): Promise<string>
    push(root: string): Promise<string>
    branches(root: string): Promise<GitBranch[]>
    checkoutDetached(root: string, ref: string): Promise<string>
    checkout(root: string, name: string, remote: boolean): Promise<string>
    createBranch(root: string, name: string, base?: string, switchTo?: boolean): Promise<string>
    marks(file: string): Promise<GitMarks>
    op(root: string, op: GitOp, hash: string, arg?: string, isMerge?: boolean): Promise<string>
    log(root: string, limit: number): Promise<GitCommit[]>
    pull(root: string): Promise<string>
    fetch(root: string): Promise<string>
    suggestCommit(root: string): Promise<McpResult & { agent?: string }>
    onCommitAgent(cb: (name: string) => void): () => void
    show(root: string, rev: string, path: string): Promise<string | null>
    commitFiles(root: string, hash: string, parent: string | null): Promise<GitChangedFile[]>
  }
  agents: {
    detect(): Promise<AgentInfo[]>
    shell(): Promise<string>
    candidates(): Promise<AgentCandidate[]>
    addCustom(name: string, commandLine: string): Promise<McpResult>
    removeCustom(command: string): Promise<void>
  }
  update: {
    state(): Promise<UpdateState>
    check(): Promise<void>
    install(): Promise<void>
    version(): Promise<string>
    onState(cb: (state: UpdateState) => void): () => void
  }
  usage: {
    collect(project: string | null, fetchLimits: boolean): Promise<UsageData>
    rename(session: SessionInfo, name: string): Promise<void>
    remove(session: SessionInfo): Promise<McpResult>
    names(): Promise<Record<string, string>>
  }
  mcp: {
    list(project: string | null): Promise<McpServer[]>
    add(agent: McpAgent, spec: McpSpec, scope: McpScope, project: string | null): Promise<McpResult>
    remove(server: McpServer, project: string | null): Promise<McpResult>
  }
  orchestra: {
    newId(): Promise<string>
    onOpenPane(cb: (pane: OpenPane) => void): () => void
    tasks(): Promise<TaskInfo[]>
    clearTasks(): Promise<void>
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
