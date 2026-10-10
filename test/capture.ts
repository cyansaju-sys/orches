/**
 * Modo captura: TUTTI_CAPTURE=<carpeta> abre la app con una configuración temporal, recorre las pantallas,
 * guarda un PNG de cada una y cierra. Sirve para regenerar las capturas de la documentación.
 */
import { app, type BrowserWindow } from 'electron'
import * as pty from '../src/main/agents/pty'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
  const store = 'window.__tutti.getState()'
  const open = (file: string): Promise<unknown> => (existsSync(join(project, file)) ? run(`${store}.openDoc(${JSON.stringify(join(project, file))})`) : Promise.resolve())
  win.setContentSize(1360, 860)          // tamaño fijo: las capturas salen siempre iguales
  await sleep(1500)
  await run(`${store}.setProject(${JSON.stringify(project)})`)
  await run(`${store}.set({ tab: 'files' })`)
  if (process.env.TUTTI_CAPTURE_LANG) await run(`${store}.setLang(${JSON.stringify(process.env.TUTTI_CAPTURE_LANG)})`)         // idioma de las capturas (es | en)
  if (process.env.TUTTI_CAPTURE_LIGHT) await run(`${store}.setTheme('light')`)         // todas las capturas en tema claro
  if (process.env.TUTTI_CAPTURE_TERMINAL) {          // solo para verificar la terminal sola, ocupando todo el espacio
    await run(`${store}.toggleShell()`)
    await snap('terminal-sola', 2500)
    await run(`${store}.toggleShell()`)
  }
  await open('src/main/git/git.ts')
  await snap('01-archivos-y-editor', 1800)
  await open('docs/demo/Contador.tsx')
  await snap('02-sintaxis-tsx')
  // tema claro, y el menú de ajustes de la barra lateral
  await run(`${store}.setTheme('light')`)
  await snap('02b-tema-claro', 900)
  await run(`${store}.set({ tab: 'agents' })`)
  await run(`document.querySelector('[title="${process.env.TUTTI_CAPTURE_LANG === 'en' ? 'Settings' : 'Ajustes'}"]')?.click()`)
  await snap('02c-ajustes', 500)
  await run(`[...document.querySelectorAll('[role="menuitem"]')].find((b) => /Idioma|Language/.test(b.textContent))?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))`)      // el submenú de idioma se abre al pasar el ratón
  await snap('02d-idioma', 500)
  await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)          // cierra el submenú
  await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)          // y el menú
  await run(`${store}.set({ tab: 'files' })`)
  await run(`${store}.setTheme('${process.env.TUTTI_CAPTURE_LIGHT ? 'light' : 'dark'}')`)
  await open('docs/demo/ejemplo.sql')
  await snap('03-sql')
  // buscar en el archivo abierto: Ctrl+H abre el cuadro flotante con la fila de reemplazo
  await open('src/main/git/git.ts')
  await run(`(() => {
    const type = (el, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) }
    document.querySelector('.cm-content')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', ctrlKey: true, bubbles: true }))
    setTimeout(() => { type(document.querySelector('.tutti-find-input'), 'root'); type(document.querySelectorAll('.tutti-find-input')[1], 'raiz') }, 150)
  })()`)
  await snap('03b-buscar-en-archivo', 900)
  await run(`[...document.querySelectorAll('.tutti-find-btn')].find((b) => b.textContent === '×')?.click()`)         // cierra el cuadro de buscar del editor
  // buscar y reemplazar en el proyecto
  await run(`${store}.set({ tab: 'search', searchReplace: true, searchToken: ${store}.searchToken + 1 })`)
  await sleep(300)
  await run(`(() => {
    const type = (el, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) }
    const [find, repl] = document.querySelectorAll('input[placeholder="Buscar"], input[placeholder="Reemplazar"]')
    type(find, 'agente'); if (repl) type(repl, 'asistente')
  })()`)
  await snap('03c-buscar-en-proyecto', 1500)
  await run(`${store}.set({ tab: 'files' })`)
  await run(`${store}.set({ tab: 'git' })`)
  await snap('04-git', 1200)
  await run(`${store}.set({ tab: 'agents' })`)
  await snap('05-agentes')
  await run(`${store}.set({ modal: 'agents' })`)
  await snap('06-elegir-agente')
  await run(`${store}.set({ modal: 'branches' })`)
  await snap('06b-ramas')
  // explorador: el campo de nombre dentro del propio árbol
  await run(`${store}.set({ modal: null, tab: 'files' })`)
  await run(`document.querySelector('[title="Nueva carpeta"]')?.click()`)
  await snap('06c-nueva-carpeta', 500)
  await run(`document.activeElement?.blur()`)
  // varias terminales: procesos `cat` (así no sale el prompt de tu shell) con un poco de texto escrito
  await run(`${store}.set({ shells: [{ id: 's1', kind: 'shell', title: 'zsh', command: 'cat', args: [], cwd: ${JSON.stringify(project)} }, { id: 's2', kind: 'shell', title: 'node', command: 'cat', args: [], cwd: ${JSON.stringify(project)} }, { id: 's3', kind: 'shell', title: 'zsh', command: 'cat', args: [], cwd: ${JSON.stringify(project)} }], shellActive: 's2', activePane: 's2' })`)
  await sleep(1800)
  pty.write('s2', '$ npm run dev\r')
  pty.write('s2', 'VITE v5 ready in 412 ms\r')
  await snap('06d-terminales', 800)
  await run(`${store}.closeShells()`)
  await run(`${store}.set({ modal: 'shortcuts' })`)
  await snap('07-atajos')
  await run(`${store}.set({ modal: null }); ${store}.toast('Commit hecho', 'ok'); ${store}.toast('No se pudo iniciar «claude»: comando no encontrado', 'error')`)
  await snap('08-avisos', 400)
  await run(`${store}.set({ toasts: [] })`)
  if (process.env.TUTTI_CAPTURE_TERMINAL) {          // solo para verificar los sub-agentes, con procesos falsos (`cat`)
    await run(`${store}.set({ docs: [], activeDoc: null, tab: 'agents' })`)
    await run(`${store}.addPane({ id: 'a1', kind: 'agent', name: 'Claude Code', title: 'Claude Code · tutti', command: 'cat', args: [], cwd: ${JSON.stringify(project)} })`)
    await run(`${store}.addPane({ id: 'a2', kind: 'agent', name: 'Claude Code', title: 'Claude Code · tutti', command: 'cat', args: [], cwd: ${JSON.stringify(project)}, parentId: 'a1' })`)
    await run(`${store}.addPane({ id: 'a3', kind: 'agent', name: 'OpenCode', title: 'OpenCode · tutti', command: 'cat', args: [], cwd: ${JSON.stringify(project)}, parentId: 'a1' })`)
    await snap('subagentes', 2000)
    await run(`${store}.set({ panes: [], activePane: null })`)
  }
  if (process.env.TUTTI_CAPTURE_TERMINAL) {          // solo para verificar: el prompt de tu shell no debe ir a la documentación
    await run(`${store}.set({ modal: null }); ${store}.toggleShell()`)
    await snap('terminal-verificacion', 2500)
  }
  if (process.env.TUTTI_CAPTURE_REAL) {              // agentes de verdad (gasta tokens): un líder arregla una función y delega las pruebas
    const dir = mkdtempSync(join(tmpdir(), 'tutti-demo-'))
    mkdirSync(join(dir, 'src')); mkdirSync(join(dir, '.claude'))
    writeFileSync(join(dir, 'package.json'), '{ "name": "demo-precios", "type": "module" }\n')
    writeFileSync(join(dir, 'src/precio.js'), '// Precio final de un artículo con su impuesto (la tasa es un porcentaje, p. ej. 15)\nexport function conImpuesto(monto, tasa) {\n  return monto + tasa\n}\n')
    // permisos solo de este proyecto de ejemplo: así ningún agente se queda esperando una confirmación
    writeFileSync(join(dir, '.claude/settings.json'), JSON.stringify({ permissions: { allow: ['Read', 'Edit', 'Write', 'mcp__tutti', 'Bash(node:*)'] } }))
    execFileSync('git', ['init', '-q'], { cwd: dir })
    await run(`${store}.setProject(${JSON.stringify(dir)})`)
    await run(`${store}.set({ docs: [], activeDoc: null, tab: 'agents', modal: null })`)
    const task = 'En src/precio.js la función conImpuesto está mal: suma la tasa en vez de aplicar el porcentaje. Corrígela tú. ' +
      'Después usa delegate_task con agent "claude", difficulty "easy" y new_instance true para pedirle a otro agente que escriba src/precio.test.js ' +
      'con 3 pruebas usando node:test, espera su resultado con wait_agent y cuéntame en una frase cómo quedó. Sé breve.'
    await run(`(async () => { const id = await window.api.orchestra.newId(); window.__tutti.getState().addPane({ id, kind: 'agent', name: 'Claude Code', title: 'Claude Code · demo-precios', command: 'claude', args: [], cwd: ${JSON.stringify(dir)}, prompt: ${JSON.stringify(task)} }) })()`)
    // la carpeta es nueva: Claude pregunta si se confía en ella (la opción marcada es «No»): se baja a «Sí» y se confirma
    const answerTrust = (): void => {
      for (const m of pty.agentSessions()) {
        if (pty.screenText(m.id, 60).includes('I trust this folder')) { pty.write(m.id, '\x1b[B'); setTimeout(() => pty.write(m.id, '\r'), 400) }
      }
    }
    let calm = 0
    for (let i = 0; i < 120 && calm < 4; i++) {         // hasta que haya sub-agente y todos estén quietos (máx. ~4 min)
      await sleep(2000)
      answerTrust()
      const open = pty.agentSessions()
      calm = open.length >= 2 && open.every((m) => pty.idleFor(m.id) > 8) ? calm + 1 : 0
    }
    await snap('agentes-reales', 3000)
    console.log('carpeta de ejemplo:', dir)
    await run(`${store}.set({ panes: [], activePane: null })`)
  }
  if (process.env.TUTTI_CAPTURE_NEW) {               // inicio sin agentes, contexto del proyecto y novedades
    const sample = '# Tutti\n\n## Qué es\nPanel de escritorio (Electron + React) para trabajar con varios agentes de programación a la vez.\n\n## Estructura\n- src/main: proceso principal (agentes, git, contexto, uso)\n- src/renderer: interfaz\n- test: pruebas con vitest\n\n## Cómo se ejecuta y se prueba\n- npm run dev\n- npm test y npm run typecheck\n\n## Convenciones\n- Mensajes de commit en Conventional Commits, en español.\n'
    await run(`window.api.context.ensure(${JSON.stringify(project)}).then((f) => window.api.fs.write(f, ${JSON.stringify(sample)}, false))`)
    await run(`${store}.set({ modal: null, docs: [], activeDoc: null, panes: [], activePane: null, tab: 'context', recentProjects: ['/home/usuario/proyectos/tienda-web', '/home/usuario/proyectos/api-pagos', '/home/usuario/proyectos/tutti-docs'] })`)
    await snap('21-contexto', 1500)
    await run(`${store}.set({ tab: 'files' })`)
    await snap('22-inicio', 800)
    await run(`${store}.set({ modal: 'news', newsSince: null })`)
    await snap('23-novedades', 800)
    await run(`${store}.set({ modal: null })`)
  }
  if (process.env.TUTTI_CAPTURE_UPDATE) {            // el botón de actualización en sus estados (el estado real lo pone el actualizador)
    await run(`${store}.set({ modal: null, tab: 'files', update: { status: 'available', version: '0.2.1', canInstall: true, url: '' } })`)
    await snap('14-actualizar-disponible', 500)
    await run(`${store}.set({ update: { status: 'downloading', version: '0.2.1', percent: 42 } })`)
    await snap('15-actualizar-descargando', 400)
    await run(`${store}.set({ update: { status: 'restarting', version: '0.2.1' } })`)
    await snap('16-actualizar-reiniciando', 400)
    await run(`${store}.set({ update: { status: 'idle' }, tab: 'files' })`)
  }
  if (process.env.TUTTI_CAPTURE_DIFF) {              // la comparación de cambios de un archivo modificado
    await run(`${store}.set({ tab: 'git', modal: null })`)
    await run(`${store}.openDiff(${JSON.stringify(join(project, process.env.TUTTI_CAPTURE_DIFF))}, false)`)
    await snap('20-comparacion', 1200)
  }
  if (process.env.TUTTI_CAPTURE_GRAPH) {             // el grafo de git del proyecto abierto
    await run(`${store}.openGraph()`)
    await snap('18-grafo', 1500)
    await run(`[...document.querySelectorAll('[title*="Clic: ver"]')].find((e) => e.textContent.includes("Merge branch"))?.click()`)
    await snap('19-grafo-detalle', 1200)
    await run(`${store}.set({ modal: null })`)
  }
  if (process.env.TUTTI_CAPTURE_USAGE) {            // lee el consumo e historial reales del HOME
    await run(`${store}.set({ modal: null, tab: 'ai' })`)
    await snap('12-consumo', 2500)
    await run(`(() => { const b = document.querySelectorAll('[title="Más acciones"]')[0]; b?.scrollIntoView({ block: 'center' }); b?.click() })()`)
    await snap('13-consumo-menu', 500)
  }
  if (process.env.TUTTI_CAPTURE_MCP) {              // requiere servidores de ejemplo en el HOME (ver docs)
    await run(`${store}.set({ modal: null, tab: 'mcp' })`)
    await snap('09-mcp', 5000)
    // la tienda: buscar en el registro y abrir la ficha de un servidor
    await run(`(() => { const i = document.querySelector('input[placeholder*="registr"], input[placeholder*="registry"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'filesystem'); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    await snap('09b-mcp-tienda', 7000)
    await run(`document.querySelector('[title*="/"]')?.click()`)
    await snap('09c-mcp-ficha', 700)
    await run(`[...document.querySelectorAll('button')].find((b) => /Continuar|Continue/.test(b.textContent))?.click()`)
    await snap('09d-mcp-instalar', 700)
    await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
    await run(`(() => { const i = document.querySelector('input[placeholder*="registr"], input[placeholder*="registry"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    await sleep(800)
    await run(`document.querySelector('[title="Ver detalles"]')?.click()`)
    await snap('10-mcp-detalles', 600)
    await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
    await sleep(300)
    await run(`document.querySelector('[title^="Añadir un servidor"]')?.click()`)
    await snap('11-mcp-anadir', 600)
  }
  app.quit()
}
