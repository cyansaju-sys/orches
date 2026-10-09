/**
 * Autoprueba del reparto de tareas (ORCHES_SELFTEST=1): abre dos «agentes» falsos (`cat`, que repite lo que recibe),
 * y uno delega una tarea al otro por HTTP, como lo haría Claude Code. Imprime el resultado y cierra.
 */
import { app, type WebContents } from 'electron'
import { join } from 'node:path'
import { newId } from './agents/hub'
import * as pty from './agents/pty'
import { orchestraConfig } from './agents/hub'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const sender = { send: () => undefined, isDestroyed: () => false } as unknown as WebContents

/** ORCHES_SELFTEST=serve: deja el servidor encendido unos segundos e imprime su configuración, para probarlo con un agente real. */
export async function serveForAgents(seconds = 40): Promise<void> {
  const cfg = orchestraConfig('a1')
  console.log('CONFIG ' + JSON.stringify(cfg))
  setTimeout(() => app.quit(), seconds * 1000)
}

/** ORCHES_SELFTEST=opencode: abre un OpenCode real por el mismo camino que la app (sin enviarle mensajes) y espera su conexión. */
async function realAgent(command: string): Promise<void> {
  const id = newId()
  const res = pty.spawn(sender, { id, kind: 'agent', name: command, command, cwd: process.cwd(), cols: 120, rows: 30 })
  console.log(`SPAWN ${command} ok=${res.ok} ${res.error ?? ''}`)
  await sleep(14000)
  console.log('PANTALLA ' + JSON.stringify(pty.screenText(id, 6)).slice(0, 300))
  pty.killAll()
  await sleep(600)
  app.quit()
}

/** ORCHES_SELFTEST=mcp: añade, lista y quita servidores con las CLIs reales de Claude y OpenCode (úsala con HOME y XDG_* temporales). */
async function mcpRoundTrip(): Promise<void> {
  const mcp = await import('./mcp')
  const { mkdirSync } = await import('node:fs')
  const project = join(process.env.HOME!, 'proyecto')
  mkdirSync(project, { recursive: true })
  const check = (name: string, ok: boolean, detail = ''): void => console.log(`${ok ? 'OK ' : 'FALLO'} ${name} ${detail}`)
  const remote = { name: 'api-remota', kind: 'remote' as const, url: 'https://example.com/mcp', headers: { Authorization: 'Bearer secreto' } }
  const local = { name: 'srv-local', kind: 'local' as const, command: 'npx', args: ['-y', '@scope/pkg', '--flag'], env: { CLAVE: 'valor' } }
  for (const agent of ['claude', 'opencode'] as const) {
    for (const scope of ['global', 'project'] as const) {
      const a = await mcp.addServer(agent, { ...remote, name: `${remote.name}-${scope}` }, scope, project)
      const b = await mcp.addServer(agent, { ...local, name: `${local.name}-${scope}` }, scope, project)
      check(`${agent} ${scope}: añadir remoto y local`, a.ok && b.ok, a.ok && b.ok ? '' : `${a.message} | ${b.message}`)
    }
  }
  const listed = mcp.listServers(project).filter((s) => s.name.includes('-global') || s.name.includes('-project'))
  for (const agent of ['claude', 'opencode']) {
    const mine = listed.filter((s) => s.agent === agent)
    check(`${agent}: lista los 4 servidores`, mine.length === 4, mine.map((s) => `${s.name}[${s.scope},${s.kind}]`).join(' '))
    const r = mine.find((s) => s.name === 'api-remota-global')
    check(`${agent}: lee URL y cabecera`, r?.target === remote.url && JSON.stringify(r?.config).includes('secreto'))
    const l = mine.find((s) => s.name === 'srv-local-project')
    check(`${agent}: lee comando local`, !!l && l.target.includes('npx') && l.target.includes('@scope/pkg'), l?.target)
  }
  for (const s of listed) {
    const res = await mcp.removeServer(s, project)
    if (!res.ok) check(`quitar ${s.agent} ${s.name}`, false, res.message)
  }
  const left = mcp.listServers(project).filter((s) => s.name.includes('-global') || s.name.includes('-project'))
  check('todo quitado', left.length === 0, left.map((s) => `${s.agent}:${s.name}`).join(' '))
  app.quit()
}

export async function runSelfTest(): Promise<void> {
  if (process.env.ORCHES_SELFTEST === 'mcp') return mcpRoundTrip()
  if (process.env.ORCHES_SELFTEST === 'serve') return serveForAgents()
  if (process.env.ORCHES_SELFTEST === 'opencode') return realAgent('opencode')
  const log = (name: string, ok: boolean, detail = ''): void => console.log(`${ok ? 'OK ' : 'FALLO'} ${name} ${detail}`)
  const a1 = newId(), a2 = newId()
  for (const [id, name] of [[a1, 'Líder falso'], [a2, 'Trabajador falso']] as const) {
    pty.spawn(sender, { id, kind: 'agent', name, command: 'cat', cwd: process.cwd(), cols: 100, rows: 30 })
  }
  const cfg = orchestraConfig(a1)
  if (!cfg) { log('servidor MCP', false, 'no arrancó'); app.exit(1); return }
  const rpc = async (method: string, params: object, token = cfg.headers.Authorization): Promise<Record<string, any>> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const res = await fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: token }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
    return res.status === 200 ? ((await res.json()) as Record<string, any>) : { status: res.status }   // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  const call = async (name: string, args: object): Promise<{ isError: boolean; body: any }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await rpc('tools/call', { name, arguments: args })
    const t = r.result.content[0].text as string
    let body: unknown = t
    try { body = JSON.parse(t) } catch { /* texto plano */ }
    return { isError: r.result.isError, body }
  }

  log('rechaza sin token', (await rpc('initialize', {}, 'Bearer mal')).status === 401)
  const init = await rpc('initialize', { protocolVersion: '2025-03-26' })
  log('initialize', init.result?.serverInfo?.name === 'orches')
  const tools = await rpc('tools/list', {})
  log('4 herramientas', tools.result.tools.length === 4)
  const list = await call('list_agents', {})
  log('list_agents', list.body.open_agents.length === 2 && list.body.lead === a1, JSON.stringify(list.body.open_agents.map((a: { id: string; role: string }) => `${a.id}:${a.role}`)))

  await sleep(400)
  const task = 'Revisa el archivo README y dime que falta'
  const d = await call('delegate_task', { agent: a2, task })
  log('delegate_task a un agente abierto', !d.isError && d.body.agent_id === a2, JSON.stringify(d.body))
  const w = await call('wait_agent', { agent_id: a2, quiet_seconds: 2, timeout_seconds: 15 })
  log('wait_agent recibe la tarea', w.body.finished === true && w.body.text.includes('Revisa el archivo README'), JSON.stringify(w.body.text).slice(0, 90))
  log('no puede delegarse a sí mismo', (await call('delegate_task', { agent: a1, task })).isError)
  log('agente desconocido', (await call('delegate_task', { agent: 'no-existe', task })).isError)
  log('read_agent_output inexistente', (await call('read_agent_output', { agent_id: 'zz' })).isError)
  const outsider = await rpc('tools/call', { name: 'delegate_task', arguments: { agent: a2, task } })
  void outsider
  pty.killAll()
  await sleep(600)                    // deja que node-pty entregue los avisos de salida antes de cerrar
  app.quit()
}
