/**
 * Modo captura: ORCHES_CAPTURE=<carpeta> abre la app con una configuración temporal, recorre las pantallas,
 * guarda un PNG de cada una y cierra. Sirve para regenerar las capturas de la documentación.
 */
import { app, type BrowserWindow } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function runCapture(win: BrowserWindow, outDir: string, project: string): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const run = (code: string): Promise<unknown> => win.webContents.executeJavaScript(code)
  const snap = async (name: string, wait = 900): Promise<void> => {
    await sleep(wait)
    const image = await win.webContents.capturePage()
    writeFileSync(join(outDir, `${name}.png`), image.toPNG())
    console.log('capturada', name)
  }
  const store = 'window.__orches.getState()'
  const open = (file: string): Promise<unknown> => (existsSync(join(project, file)) ? run(`${store}.openDoc(${JSON.stringify(join(project, file))})`) : Promise.resolve())
  win.setContentSize(1360, 860)
  await sleep(1500)
  await run(`${store}.setProject(${JSON.stringify(project)})`)
  await run(`${store}.set({ tab: 'files' })`)
  if (process.env.ORCHES_CAPTURE_TERMINAL) {          // solo para verificar la terminal sola, ocupando todo el espacio
    await run(`${store}.toggleShell()`)
    await snap('terminal-sola', 2500)
    await run(`${store}.toggleShell()`)
  }
  await open('src/main/git.ts')
  await snap('01-archivos-y-editor', 1800)
  await open('docs/demo/Contador.tsx')
  await snap('02-sintaxis-tsx')
  await open('docs/demo/ejemplo.sql')
  await snap('03-sql')
  await run(`${store}.set({ tab: 'git' })`)
  await snap('04-git', 1200)
  await run(`${store}.set({ tab: 'agents' })`)
  await snap('05-agentes')
  await run(`${store}.set({ modal: 'agents' })`)
  await snap('06-elegir-agente')
  await run(`${store}.set({ modal: 'branches' })`)
  await snap('06b-ramas')
  await run(`${store}.set({ modal: 'shortcuts' })`)
  await snap('07-atajos')
  await run(`${store}.set({ modal: null }); ${store}.toast('Commit hecho', 'ok'); ${store}.toast('No se pudo iniciar «claude»: comando no encontrado', 'error')`)
  await snap('08-avisos', 400)
  await run(`${store}.set({ toasts: [] })`)
  if (process.env.ORCHES_CAPTURE_TERMINAL) {          // solo para verificar los sub-agentes, con procesos falsos (`cat`)
    await run(`${store}.set({ docs: [], activeDoc: null, tab: 'agents' })`)
    await run(`${store}.addPane({ id: 'a1', kind: 'agent', name: 'Claude Code', title: 'Claude Code · orches', command: 'cat', args: [], cwd: ${JSON.stringify(project)} })`)
    await run(`${store}.addPane({ id: 'a2', kind: 'agent', name: 'Claude Code', title: 'Claude Code · orches', command: 'cat', args: [], cwd: ${JSON.stringify(project)}, parentId: 'a1' })`)
    await run(`${store}.addPane({ id: 'a3', kind: 'agent', name: 'OpenCode', title: 'OpenCode · orches', command: 'cat', args: [], cwd: ${JSON.stringify(project)}, parentId: 'a1' })`)
    await snap('subagentes', 2000)
    await run(`${store}.set({ panes: [], activePane: null })`)
  }
  if (process.env.ORCHES_CAPTURE_TERMINAL) {          // solo para verificar: el prompt de tu shell no debe ir a la documentación
    await run(`${store}.set({ modal: null }); ${store}.toggleShell()`)
    await snap('terminal-verificacion', 2500)
  }
  if (process.env.ORCHES_CAPTURE_UPDATE) {            // el botón de actualización en sus estados (el estado real lo pone el actualizador)
    await run(`${store}.set({ modal: null, tab: 'files', update: { status: 'available', version: '0.2.1', canInstall: true, url: '' } })`)
    await snap('14-actualizar-disponible', 500)
    await run(`${store}.set({ update: { status: 'downloading', version: '0.2.1', percent: 42 } })`)
    await snap('15-actualizar-descargando', 400)
    await run(`${store}.set({ update: { status: 'restarting', version: '0.2.1' } })`)
    await snap('16-actualizar-reiniciando', 400)
    await run(`${store}.set({ update: { status: 'idle' }, tab: 'files' })`)
  }
  if (process.env.ORCHES_CAPTURE_GRAPH) {             // el grafo de git del proyecto abierto
    await run(`${store}.openGraph()`)
    await snap('18-grafo', 1500)
    await run(`[...document.querySelectorAll('[title*="Clic: ver"]')].find((e) => e.textContent.includes("Merge branch"))?.click()`)
    await snap('19-grafo-detalle', 1200)
    await run(`${store}.set({ modal: null })`)
  }
  if (process.env.ORCHES_CAPTURE_USAGE) {            // lee el consumo e historial reales del HOME
    await run(`${store}.set({ modal: null, tab: 'ai' })`)
    await snap('12-consumo', 2500)
    await run(`(() => { const b = document.querySelectorAll('[title="Más acciones"]')[0]; b?.scrollIntoView({ block: 'center' }); b?.click() })()`)
    await snap('13-consumo-menu', 500)
  }
  if (process.env.ORCHES_CAPTURE_MCP) {              // requiere servidores de ejemplo en el HOME (ver docs)
    await run(`${store}.set({ modal: null, tab: 'mcp' })`)
    await snap('09-mcp', 1500)
    await run(`document.querySelector('[title="Ver detalles"]')?.click()`)
    await snap('10-mcp-detalles', 600)
    await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
    await sleep(300)
    await run(`document.querySelector('[title^="Añadir un servidor"]')?.click()`)
    await snap('11-mcp-anadir', 600)
  }
  app.quit()
}
