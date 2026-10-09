import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { join } from 'node:path'
import { addCustomAgent, candidateExecutables, defaultShell, detectAgents, removeCustomAgent } from './agents'
import { suggestCommit } from './commitMessage'
import { createEntry, listDir, mtime, renameEntry, readFileData, writeFileData } from './files'
import * as git from './git'
import * as pty from './pty'
import { getSetting, setSetting } from './settings'
import type { GitOp, PtyOptions } from '../shared/types'
import { runCapture } from '../../test/capture'
import { checkForUpdates, installUpdate, setupUpdater, stopUpdater, updateState } from './updater'
import * as mcp from './mcp'
import { collectUsage, deleteSession, renameSession, sessionNames } from './usage'
import { runSelfTest } from './selftest'
import { newId, startHub, stopHub } from './hub'

if (process.argv.includes('--orches-version')) { console.log(app.getVersion()); app.exit(0) }      // para comprobar qué versión es un AppImage
if (process.env.APPIMAGE) app.commandLine.appendSwitch('no-sandbox')     // un AppImage no puede dejar chrome-sandbox con permisos especiales

let win: BrowserWindow | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 900, minHeight: 560, show: false, frame: false, backgroundColor: '#07080C',
    title: 'Orches', icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true }
  })
  win.once('ready-to-show', () => win?.show())
  if (process.env.ORCHES_CAPTURE) {
    win.webContents.once('did-finish-load', () => void runCapture(win!, process.env.ORCHES_CAPTURE!, process.cwd()))
  }
  win.on('maximize', () => win?.webContents.send('window:maximized', true))
  win.on('unmaximize', () => win?.webContents.send('window:maximized', false))
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } }) // enlaces fuera de la app
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

function registerIpc(): void {
  ipcMain.handle('settings:get', (_e, key: string) => getSetting(key))
  ipcMain.handle('settings:set', (_e, key: string, value: unknown) => setSetting(key, value))
  ipcMain.handle('dialog:chooseFolder', async (_e, start?: string) => {
    const res = await dialog.showOpenDialog(win!, { properties: ['openDirectory'], defaultPath: start, title: 'Abrir proyecto' })
    return res.canceled ? null : res.filePaths[0]
  })
  ipcMain.handle('fs:list', (_e, dir: string) => listDir(dir))
  ipcMain.handle('fs:read', (_e, path: string) => readFileData(path))
  ipcMain.handle('fs:write', (_e, path: string, text: string, crlf: boolean) => writeFileData(path, text, crlf))
  ipcMain.handle('fs:create', (_e, dir: string, name: string, isDir: boolean) => createEntry(dir, name, isDir))
  ipcMain.handle('fs:rename', (_e, path: string, name: string) => renameEntry(path, name))
  ipcMain.handle('fs:trash', async (_e, path: string) => {         // a la papelera: se puede recuperar
    try { await shell.trashItem(path); return { ok: true, message: 'Movido a la papelera' } } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) } }
  })
  ipcMain.handle('fs:mtime', (_e, path: string) => mtime(path))

  ipcMain.handle('git:status', (_e, root: string) => git.status(root))
  ipcMain.handle('git:ignored', (_e, root: string, paths: string[]) => git.ignored(root, paths))
  ipcMain.handle('git:stage', (_e, root: string, paths: string[]) => git.stage(root, paths))
  ipcMain.handle('git:unstage', (_e, root: string, paths: string[]) => git.unstage(root, paths))
  ipcMain.handle('git:commit', (_e, root: string, message: string) => git.commit(root, message))
  ipcMain.handle('git:push', (_e, root: string) => git.push(root))
  ipcMain.handle('git:branches', (_e, root: string) => git.branches(root))
  ipcMain.handle('git:checkout', (_e, root: string, name: string, remote: boolean) => git.checkout(root, name, remote))
  ipcMain.handle('git:createBranch', (_e, root: string, name: string, base?: string, switchTo?: boolean) => git.createBranch(root, name, base, switchTo))
  ipcMain.handle('git:show', (_e, root: string, rev: string, path: string) => git.show(root, rev, path))
  ipcMain.handle('git:op', (_e, root: string, op: GitOp, hash: string, arg?: string, isMerge?: boolean) => git.commitOp(root, op, hash, arg, isMerge))
  ipcMain.handle('git:commitFiles', (_e, root: string, hash: string, parent: string | null) => git.commitFiles(root, hash, parent))
  ipcMain.handle('git:log', (_e, root: string, limit: number) => git.log(root, limit))
  ipcMain.handle('git:pull', (_e, root: string) => git.pull(root))
  ipcMain.handle('git:fetch', (_e, root: string) => git.fetch(root))
  ipcMain.handle('git:suggestCommit', (e, root: string) => suggestCommit(root, (name) => e.sender.send('git:commitAgent', name)))
  ipcMain.handle('git:marks', (_e, file: string) => git.marks(file))

  ipcMain.handle('mcp:list', (_e, project: string | null) => mcp.listServers(project))
  ipcMain.handle('mcp:add', (_e, agent, spec, scope, project) => mcp.addServer(agent, spec, scope, project))
  ipcMain.handle('mcp:remove', (_e, server, project) => mcp.removeServer(server, project))
  ipcMain.handle('usage:collect', (_e, project: string | null, fetchLimits: boolean) => collectUsage(detectAgents(), project, fetchLimits && !process.env.ORCHES_NO_LIMITS_FETCH))   // ORCHES_NO_LIMITS_FETCH: pruebas sin red
  ipcMain.handle('usage:rename', (_e, session, name: string) => renameSession(session, name))
  ipcMain.handle('usage:remove', (_e, session) => deleteSession(session))
  ipcMain.handle('usage:names', () => sessionNames())
  ipcMain.handle('update:state', () => updateState())
  ipcMain.handle('update:check', () => checkForUpdates())
  ipcMain.handle('update:install', () => installUpdate())
  ipcMain.handle('update:version', () => app.getVersion())
  ipcMain.handle('orchestra:newId', () => newId())
  ipcMain.handle('agents:detect', () => detectAgents())
  ipcMain.handle('agents:shell', () => defaultShell())
  ipcMain.handle('agents:candidates', () => candidateExecutables())
  ipcMain.handle('agents:addCustom', (_e, name: string, commandLine: string) => addCustomAgent(name, commandLine))
  ipcMain.handle('agents:removeCustom', (_e, command: string) => removeCustomAgent(command))

  ipcMain.handle('pty:spawn', (e, opts: PtyOptions) => pty.spawn(e.sender, opts))
  ipcMain.on('pty:write', (_e, id: string, data: string) => pty.write(id, data))
  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => pty.resize(id, cols, rows))
  ipcMain.on('pty:kill', (_e, id: string) => pty.kill(id))

  ipcMain.on('window:minimize', () => win?.minimize())
  ipcMain.on('window:toggleMaximize', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()))
  ipcMain.on('window:close', () => win?.close())
}

if (process.env.ORCHES_CAPTURE) app.setPath('appData', join(app.getPath('temp'), `orches-captura-${process.pid}`))   // ajustes aislados

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)             // sin menú: los atajos los gestiona la propia app
  registerIpc()
  if (!process.env.ORCHES_CAPTURE && !process.env.ORCHES_SELFTEST) setupUpdater(() => win)
  void startHub(() => win).then(() => { if (process.env.ORCHES_SELFTEST) void runSelfTest() })
  if (!process.env.ORCHES_SELFTEST) createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
let closing = false
app.on('before-quit', (event) => {
  if (closing) return
  closing = true
  event.preventDefault()          // se cierran los procesos y se espera un instante: node-pty aborta si la app sale con avisos de salida pendientes
  stopHub()
  stopUpdater()
  pty.killAll()
  setTimeout(() => app.quit(), 400)
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
