import { contextBridge, ipcRenderer } from 'electron'
import type { Api, OpenPane, PtyExit } from '../shared/types'

const subscribe = <T extends unknown[]>(channel: string, cb: (...args: T) => void): (() => void) => {
  const handler = (_e: unknown, ...args: unknown[]): void => cb(...(args as T))
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: Api = {
  settings: { get: (k) => ipcRenderer.invoke('settings:get', k), set: (k, v) => ipcRenderer.invoke('settings:set', k, v) },
  dialog: { chooseFolder: (start) => ipcRenderer.invoke('dialog:chooseFolder', start) },
  fs: {
    list: (d) => ipcRenderer.invoke('fs:list', d), read: (p) => ipcRenderer.invoke('fs:read', p),
    write: (p, t, c) => ipcRenderer.invoke('fs:write', p, t, c), mtime: (p) => ipcRenderer.invoke('fs:mtime', p)
  },
  git: {
    status: (r) => ipcRenderer.invoke('git:status', r), ignored: (r, p) => ipcRenderer.invoke('git:ignored', r, p),
    stage: (r, p) => ipcRenderer.invoke('git:stage', r, p), unstage: (r, p) => ipcRenderer.invoke('git:unstage', r, p),
    commit: (r, m) => ipcRenderer.invoke('git:commit', r, m), push: (r) => ipcRenderer.invoke('git:push', r),
    branches: (r) => ipcRenderer.invoke('git:branches', r), checkout: (r, n, rem) => ipcRenderer.invoke('git:checkout', r, n, rem),
    createBranch: (r, n) => ipcRenderer.invoke('git:createBranch', r, n), marks: (f) => ipcRenderer.invoke('git:marks', f)
  },
  agents: { detect: () => ipcRenderer.invoke('agents:detect'), shell: () => ipcRenderer.invoke('agents:shell') },
  orchestra: {
    newId: () => ipcRenderer.invoke('orchestra:newId'),
    onOpenPane: (cb) => subscribe<[OpenPane]>('orchestra:open-pane', cb),
    onToast: (cb) => subscribe<[string, 'ok' | 'error' | 'info']>('orchestra:toast', cb)
  },
  pty: {
    spawn: (o) => ipcRenderer.invoke('pty:spawn', o),
    write: (id, d) => ipcRenderer.send('pty:write', id, d),
    resize: (id, c, r) => ipcRenderer.send('pty:resize', id, c, r),
    kill: (id) => ipcRenderer.send('pty:kill', id),
    onData: (cb) => subscribe<[string, string]>('pty:data', cb),
    onExit: (cb) => subscribe<[PtyExit]>('pty:exit', cb)
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'), toggleMaximize: () => ipcRenderer.send('window:toggleMaximize'),
    close: () => ipcRenderer.send('window:close'), onMaximized: (cb) => subscribe<[boolean]>('window:maximized', cb)
  }
}

contextBridge.exposeInMainWorld('api', api)
