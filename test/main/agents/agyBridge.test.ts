import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
import { BRIDGE_SOURCE, withBridge } from '../../../src/main/agents/agyBridge'

describe('registro del puente en Antigravity', () => {
  it('añade el servidor «tutti» sin tocar los demás y no reescribe si ya está al día', () => {
    const base = { mcpServers: { otro: { command: 'x', disabled: false } } }
    const next = withBridge(base, '/usr/bin/tutti', '/cfg/mcp-bridge.mjs')!
    expect(Object.keys(next.mcpServers as object)).toEqual(['otro', 'tutti'])
    expect((next.mcpServers as Record<string, unknown>).tutti).toEqual({ command: '/usr/bin/tutti', args: ['/cfg/mcp-bridge.mjs'], env: { ELECTRON_RUN_AS_NODE: '1' }, disabled: false })
    expect(withBridge(next, '/usr/bin/tutti', '/cfg/mcp-bridge.mjs')).toBeNull()
    expect(withBridge(next, '/otra/ruta', '/cfg/mcp-bridge.mjs')).not.toBeNull()
  })
  it('respeta que el usuario lo haya desactivado', () => {
    const off = { mcpServers: { tutti: { command: 'viejo', disabled: true } } }
    expect(((withBridge(off, '/x', '/y')!.mcpServers as Record<string, Record<string, unknown>>).tutti).disabled).toBe(true)
  })
})

const talk = (env: Record<string, string>, lines: object[]): Promise<object[]> => new Promise((resolve) => {
  const file = join(mkdtempSync(join(tmpdir(), 'tutti-bridge-')), 'bridge.mjs')
  writeFileSync(file, BRIDGE_SOURCE)
  const child = spawn(process.execPath, [file], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'] })
  let out = ''
  child.stdout.on('data', (d) => { out += String(d) })
  child.on('close', () => resolve(out.split('\n').filter(Boolean).map((l) => JSON.parse(l))))
  for (const l of lines) child.stdin.write(JSON.stringify(l) + '\n')
  child.stdin.end()
})

describe('puente stdio -> HTTP', () => {
  it('fuera de Tutti responde con una lista de herramientas vacía', async () => {
    const replies = await talk({ TUTTI_MCP_URL: '', TUTTI_MCP_AUTH: '' }, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' }
    ])
    expect(replies).toHaveLength(2)
    expect((replies[1] as { result: { tools: unknown[] } }).result.tools).toEqual([])
  })
  it('dentro de Tutti reenvía cada mensaje al servidor con su clave', async () => {
    const seen: string[] = []
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => { seen.push(`${req.url} ${req.headers.authorization} ${body}`); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: 7, result: { ok: true } })) })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    const replies = await talk({ TUTTI_MCP_URL: `http://127.0.0.1:${port}/mcp/a1`, TUTTI_MCP_AUTH: 'Bearer clave' }, [{ jsonrpc: '2.0', id: 7, method: 'tools/list' }])
    server.close()
    expect(replies).toEqual([{ jsonrpc: '2.0', id: 7, result: { ok: true } }])
    expect(seen[0]).toContain('/mcp/a1 Bearer clave')
  })
})
