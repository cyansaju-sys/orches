/**
 * Actualizaciones: avisa cuando hay una release nueva en GitHub y, al pulsar «Actualizar», descarga la nueva versión y la
 * app se reinicia sola para aplicarla.
 *
 * - AppImage (Linux): electron-updater descarga el AppImage nuevo, verifica su hash y lo coloca en el lugar del actual.
 * - Instalador de Windows (NSIS): descarga el instalador nuevo (latest.yml), lo ejecuta en silencio y reinicia la app.
 * - Cualquier otra forma de ejecutarla (código, desarrollo): solo se avisa y el botón abre la página de la release.
 *
 * TUTTI_UPDATE_URL apunta a una carpeta con `latest-linux.yml` o `latest.yml` (pruebas) en lugar de GitHub.
 */
import { app, shell, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '../shared/types'
import { isNewer } from './version'

const REPO = 'cyansaju-sys/orches'
const FIRST_CHECK_MS = 8_000
const EVERY_MS = 30 * 60_000

let state: UpdateState = { status: 'idle' }
let notify: (s: UpdateState) => void = () => undefined
let timer: ReturnType<typeof setInterval> | undefined

/** ¿Puede actualizarse sola? Solo un AppImage (Linux) o la app instalada en Windows; o la carpeta de pruebas. */
export const canAutoUpdate = (): boolean =>
  Boolean(process.env.TUTTI_UPDATE_URL) || (app.isPackaged && (process.platform === 'win32' || Boolean(process.env.APPIMAGE)))

function set(next: UpdateState): void { state = next; notify(next) }
const releaseUrl = (version?: string): string => `https://github.com/${REPO}/releases${version ? `/tag/v${version}` : '/latest'}`

/** Sin actualización automática: se consulta la última release de GitHub solo para avisar. */
async function checkManually(): Promise<void> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'tutti' }, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`GitHub respondió ${res.status}`)
  const tag = String(((await res.json()) as { tag_name?: string }).tag_name ?? '')
  const version = tag.replace(/^v/, '')
  set(version && isNewer(version, app.getVersion()) ? { status: 'available', version, canInstall: false, url: releaseUrl(version) } : { status: 'idle' })
}

export async function checkForUpdates(): Promise<void> {
  if (state.status === 'downloading' || state.status === 'restarting') return
  try {
    if (!canAutoUpdate()) { await checkManually(); return }
    set({ status: 'checking' })
    await autoUpdater.checkForUpdates()                         // el resultado llega por los eventos
  } catch (e) {
    set(state.status === 'checking' ? { status: 'idle' } : state)   // sin red no se molesta al usuario
    void e
  }
}

/** Descarga la versión nueva y reinicia la app para aplicarla. */
export async function installUpdate(): Promise<void> {
  if (state.status !== 'available') return
  if (!state.canInstall) { void shell.openExternal(state.url); return }
  const { version } = state
  set({ status: 'downloading', version, percent: 0 })
  try { await autoUpdater.downloadUpdate() } catch (e) { set({ status: 'error', message: e instanceof Error ? e.message : String(e) }) }
}

export function setupUpdater(window: () => BrowserWindow | null): void {
  notify = (s) => { const w = window(); if (w && !w.isDestroyed()) w.webContents.send('update:state', s) }
  autoUpdater.autoDownload = false                // lo decide el usuario con el botón
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false
  autoUpdater.logger = null
  if (process.env.TUTTI_UPDATE_URL) {
    autoUpdater.setFeedURL({ provider: 'generic', url: process.env.TUTTI_UPDATE_URL })
    autoUpdater.forceDevUpdateConfig = true
  }
  autoUpdater.on('update-available', (info) => {
    set({ status: 'available', version: info.version, canInstall: true, url: releaseUrl(info.version) })
    if (process.env.TUTTI_UPDATE_AUTOINSTALL) void installUpdate()          // solo para pruebas: pulsa «Actualizar» por ti
  })
  autoUpdater.on('update-not-available', () => set({ status: 'idle' }))
  autoUpdater.on('download-progress', (p) => { if (state.status === 'downloading') set({ ...state, percent: Math.round(p.percent) }) })
  autoUpdater.on('update-downloaded', (info) => {
    set({ status: 'restarting', version: info.version })
    setTimeout(() => autoUpdater.quitAndInstall(false, true), 700)    // un instante para que se vea «Reiniciando…»
  })
  autoUpdater.on('error', (e) => { if (state.status === 'downloading') set({ status: 'error', message: e.message }) })

  setTimeout(() => void checkForUpdates(), FIRST_CHECK_MS)
  timer = setInterval(() => void checkForUpdates(), EVERY_MS)
}

export const updateState = (): UpdateState => state
export const stopUpdater = (): void => { if (timer) clearInterval(timer) }
