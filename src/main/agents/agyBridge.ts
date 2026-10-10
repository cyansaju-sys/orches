/**
 * Antigravity (`agy`) no admite configuración MCP por proceso: solo lee ~/.gemini/config/mcp_config.json y no expande variables en
 * las URL ni en las cabeceras. Pero los servidores stdio heredan el entorno del propio `agy`, así que Tutti registra UN servidor
 * estable («tutti») que lanza un pequeño puente, y a cada panel le pasa por entorno la URL y la clave de esa sesión.
 * Fuera de Tutti no hay esas variables y el puente responde con una lista de herramientas vacía.
 */
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tm } from '../i18n'
import { agyGlobalConfig } from '../mcp'

/** Puente stdio -> HTTP: cada línea JSON-RPC que llega por stdin se envía al servidor de tareas y la respuesta sale por stdout. */
export const BRIDGE_SOURCE = `// Generado por Tutti: puente entre Antigravity (stdio) y el servidor de reparto de tareas (HTTP).
import { createInterface } from 'node:readline'
const url = process.env.TUTTI_MCP_URL
const auth = process.env.TUTTI_MCP_AUTH
const out = (m) => process.stdout.write(JSON.stringify(m) + '\\n')
const pending = new Set()
const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => { const p = handle(line); pending.add(p); p.finally(() => pending.delete(p)) })
rl.on('close', async () => { await Promise.allSettled([...pending]); process.exit(0) })
async function handle(line) {
  let msg
  try { msg = JSON.parse(line) } catch { return }
  const id = msg.id
  if (!url) {            // abierto fuera de Tutti: sin herramientas
    if (id === undefined || id === null) return
    if (msg.method === 'initialize') return out({ jsonrpc: '2.0', id, result: { protocolVersion: msg.params?.protocolVersion ?? '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'tutti', version: '0.2' } } })
    if (msg.method === 'tools/list') return out({ jsonrpc: '2.0', id, result: { tools: [] } })
    if (msg.method === 'ping') return out({ jsonrpc: '2.0', id, result: {} })
    return out({ jsonrpc: '2.0', id, error: { code: -32601, message: 'método desconocido: ' + msg.method } })
  }
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: auth }, body: line })
    const text = await res.text()
    if (res.status === 202 || !text) return
    out(JSON.parse(text))
  } catch (e) {
    if (id !== undefined && id !== null) out({ jsonrpc: '2.0', id, error: { code: -32000, message: String(e && e.message || e) } })
  }
}
`

type Json = Record<string, unknown>
export const isTuttiEntry = (entry: unknown): boolean => !!entry && typeof entry === 'object' && (entry as Json).command !== undefined

/** El `mcp_config.json` con el servidor «tutti» al día; null si ya estaba bien. Respeta que el usuario lo haya desactivado. */
export function withBridge(config: Json, exe: string, bridge: string): Json | null {
  const servers = (config.mcpServers && typeof config.mcpServers === 'object' ? config.mcpServers : {}) as Record<string, Json>
  const old = servers.tutti
  const entry: Json = { command: exe, args: [bridge], env: { ELECTRON_RUN_AS_NODE: '1' }, disabled: old?.disabled === true }
  if (old && JSON.stringify(old, Object.keys(old).sort()) === JSON.stringify(entry, Object.keys(entry).sort())) return null
  return { ...config, mcpServers: { ...servers, tutti: entry } }
}

/** Deja listo el puente y su registro en Antigravity (se llama al abrir un agente `agy` desde Tutti). */
export function ensureAgyBridge(): void {
  try {
    const bridge = join(app.getPath('appData'), 'tutti', 'mcp-bridge.mjs')
    mkdirSync(dirname(bridge), { recursive: true })
    let current = ''
    try { current = readFileSync(bridge, 'utf8') } catch { /* primera vez */ }
    if (current !== BRIDGE_SOURCE) writeFileSync(bridge, BRIDGE_SOURCE, 'utf8')
    const file = agyGlobalConfig()
    let config: Json = {}
    try { config = JSON.parse(readFileSync(file, 'utf8')) as Json } catch { /* no existe o no se puede leer: se crea */ }
    const next = withBridge(config, process.env.APPIMAGE || process.execPath, bridge)
    if (!next) return
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(next, null, 2) + '\n', 'utf8')
  } catch { /* sin permisos: Antigravity abre igual, solo sin el reparto de tareas */ }
}

/** ¿El servidor «tutti» registrado en Antigravity apunta a un ejecutable y a un puente que existen? */
export function agyBridgeStatus(): { ok: boolean; problem?: string } {
  let config: Json = {}
  try { config = JSON.parse(readFileSync(agyGlobalConfig(), 'utf8')) as Json } catch { /* sin archivo */ }
  const entry = (config.mcpServers as Record<string, Json> | undefined)?.tutti
  if (!entry) return { ok: false, problem: tm('m.agy.notRegistered') }
  if (entry.disabled === true) return { ok: false, problem: tm('m.agy.disabled') }
  const files = [String(entry.command ?? ''), ...((entry.args as unknown[]) ?? []).map(String)]
  const missing = files.find((f) => f.startsWith('/') && !existsSync(f))
  return missing ? { ok: false, problem: tm('m.agy.missing', { path: missing }) } : { ok: true }
}
