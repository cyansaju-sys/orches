import { contextBridge, ipcRenderer } from 'electron'
import type { Api, OpenPane, PtyExit, UpdateState } from '../shared/types'

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
    write: (p, t, c) => ipcRenderer.invoke('fs:write', p, t, c), mtime: (p) => ipcRenderer.invoke('fs:mtime', p),
    create: (d, n, dir) => ipcRenderer.invoke('fs:create', d, n, dir), rename: (p, n) => ipcRenderer.invoke('fs:rename', p, n), trash: (p) => ipcRenderer.invoke('fs:trash', p)
  },
  git: {
    status: (r) => ipcRenderer.invoke('git:status', r), ignored: (r, p) => ipcRenderer.invoke('git:ignored', r, p),
    stage: (r, p) => ipcRenderer.invoke('git:stage', r, p), unstage: (r, p) => ipcRenderer.invoke('git:unstage', r, p),
    commit: (r, m) => ipcRenderer.invoke('git:commit', r, m), push: (r) => ipcRenderer.invoke('git:push', r),
    branches: (r) => ipcRenderer.invoke('git:branches', r), checkout: (r, n, rem) => ipcRenderer.invoke('git:checkout', r, n, rem),
    createBranch: (r, n) => ipcRenderer.invoke('git:createBranch', r, n), marks: (f) => ipcRenderer.invoke('git:marks', f), pull: (r) => ipcRenderer.invoke('git:pull', r), fetch: (r) => ipcRenderer.invoke('git:fetch', r), suggestCommit: (r) => ipcRenderer.invoke('git:suggestCommit', r), onCommitAgent: (cb) => subscribe<[string]>('git:commitAgent', cb), show: (r, rev, p) => ipcRenderer.invoke('git:show', r, rev, p)
  },
  agents: {
    detect: () => ipcRenderer.invoke('agents:detect'), shell: () => ipcRenderer.invoke('agents:shell'),
    candidates: () => ipcRenderer.invoke('agents:candidates'),
    addCustom: (name, commandLine) => ipcRenderer.invoke('agents:addCustom', name, commandLine),
    removeCustom: (command) => ipcRenderer.invoke('agents:removeCustom', command)
  },
  update: {
    state: () => ipcRenderer.invoke('update:state'), check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'), version: () => ipcRenderer.invoke('update:version'),
    onState: (cb) => subscribe<[UpdateState]>('update:state', cb)
  },
  usage: {
    collect: (p, f) => ipcRenderer.invoke('usage:collect', p, f), rename: (s, n) => ipcRenderer.invoke('usage:rename', s, n),
    remove: (s) => ipcRenderer.invoke('usage:remove', s), names: () => ipcRenderer.invoke('usage:names')
  },
  mcp: {
    list: (p) => ipcRenderer.invoke('mcp:list', p), add: (a, s, sc, p) => ipcRenderer.invoke('mcp:add', a, s, sc, p),
    remove: (s, p) => ipcRenderer.invoke('mcp:remove', s, p)
  },
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
