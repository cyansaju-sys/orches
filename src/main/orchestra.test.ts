import { afterEach, describe, expect, it } from 'vitest'
import { Orchestra, TOOLS, type Host } from './orchestra'

const calls: unknown[][] = []
const host: Host = {
  listAgents: (caller) => ({ you_are: caller, open_agents: [] }),
  delegate: async (caller, target, task, fresh, opts) => { calls.push(opts?.difficulty ? [caller, target, task, fresh, opts] : [caller, target, task, fresh]); return target === 'malo' ? { ok: false, info: 'no existe' } : { ok: true, info: { agent_id: target } } },
  output: (id) => (id === 'a2' ? { agent_id: 'a2', busy: false, idle_seconds: 9, text: 'listo' } : null)
}
let server: Orchestra | null = null
afterEach(() => { server?.stop(); server = null; calls.length = 0 })

async function start(): Promise<{ post: (body: unknown, token?: string) => Promise<Response>; o: Orchestra }> {
  server = await new Orchestra(host).start()
  const o = server
  const cfg = o.configFor('a1')
  return { o, post: (body, token = cfg.headers.Authorization) => fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: token }, body: JSON.stringify(body) }) }
}
const rpc = (method: string, params: object = {}, id = 1): object => ({ jsonrpc: '2.0', id, method, params })

describe('servidor MCP de reparto de tareas', () => {
  it('solo escucha en 127.0.0.1 y exige el token', async () => {
    const { post, o } = await start()
    expect(o.configFor('a1').url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp\/a1$/)
    expect((await post(rpc('initialize'), 'Bearer incorrecto')).status).toBe(401)
    expect((await post(rpc('initialize'))).status).toBe(200)
  })

  it('initialize, ping y la lista de herramientas', async () => {
    const { post } = await start()
    const init = await (await post(rpc('initialize', { protocolVersion: '2025-03-26' }))).json()
    expect(init.result.serverInfo.name).toBe('orches')
    expect(init.result.instructions).toContain('delegate_task')
    expect(await (await post(rpc('ping'))).json()).toMatchObject({ result: {} })
    const tools = await (await post(rpc('tools/list'))).json()
    expect(tools.result.tools.map((t: { name: string }) => t.name)).toEqual(TOOLS.map((t) => t.name))
    expect(tools.result.tools).toHaveLength(4)
  })

  it('las notificaciones no tienen respuesta y un método desconocido da error', async () => {
    const { post } = await start()
    expect((await post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202)
    const bad = await (await post(rpc('no/existe'))).json()
    expect(bad.error.code).toBe(-32601)
  })

  it('delegate_task pasa quién pide, a quién y la tarea; los errores llegan como isError', async () => {
    const { post } = await start()
    const ok = await (await post(rpc('tools/call', { name: 'delegate_task', arguments: { agent: 'a2', task: ' haz algo ', new_instance: true } }))).json()
    expect(ok.result.isError).toBe(false)
    expect(calls[0]).toEqual(['a1', 'a2', 'haz algo', true])
    const bad = await (await post(rpc('tools/call', { name: 'delegate_task', arguments: { agent: 'malo', task: 'x' } }))).json()
    expect(bad.result.isError).toBe(true)
    const missing = await (await post(rpc('tools/call', { name: 'delegate_task', arguments: { agent: 'a2' } }))).json()
    expect(missing.result.isError).toBe(true)
  })

  it('delegate_task con difficulty deja que la app elija; sin agente ni dificultad falla', async () => {
    const { post } = await start()
    const auto = await (await post(rpc('tools/call', { name: 'delegate_task', arguments: { task: 'x', difficulty: 'hard' } }))).json()
    expect(auto.result.isError).toBe(false)
    expect(calls[0]).toEqual(['a1', 'auto', 'x', false, { difficulty: 'hard', force: false }])
    const wrong = await (await post(rpc('tools/call', { name: 'delegate_task', arguments: { task: 'x', difficulty: 'imposible' } }))).json()
    expect(wrong.result.isError).toBe(true)
    const none = await (await post(rpc('tools/call', { name: 'delegate_task', arguments: { task: 'x' } }))).json()
    expect(none.result.isError).toBe(true)
  })

  it('read_agent_output y wait_agent', async () => {
    const { post } = await start()
    const read = await (await post(rpc('tools/call', { name: 'read_agent_output', arguments: { agent_id: 'a2' } }))).json()
    expect(JSON.parse(read.result.content[0].text).text).toBe('listo')
    const waited = await (await post(rpc('tools/call', { name: 'wait_agent', arguments: { agent_id: 'a2', quiet_seconds: 2 } }))).json()
    expect(JSON.parse(waited.result.content[0].text).finished).toBe(true)
    const none = await (await post(rpc('tools/call', { name: 'read_agent_output', arguments: { agent_id: 'zz' } }))).json()
    expect(none.result.isError).toBe(true)
  })

  it('acepta lotes JSON-RPC', async () => {
    const { post } = await start()
    const replies = await (await post([rpc('ping', {}, 1), rpc('ping', {}, 2)])).json()
    expect(replies).toHaveLength(2)
  })
})
