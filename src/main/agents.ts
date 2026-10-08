import type { AgentInfo } from '../shared/types'
import { which } from './shellpath'

// nombre visible -> ejecutable
const KNOWN: Array<[string, string]> = [
  ['Claude Code', 'claude'], ['OpenCode', 'opencode'], ['Codex', 'codex'], ['Gemini CLI', 'gemini'], ['Aider', 'aider'],
  ['Cursor Agent', 'cursor-agent'], ['Goose', 'goose'], ['Amp', 'amp'], ['Qwen Code', 'qwen'], ['Copilot CLI', 'copilot']
]

export function detectAgents(): AgentInfo[] {
  const found: AgentInfo[] = []
  for (const [name, command] of KNOWN) {
    const path = which(command)
    if (path) found.push({ name, command, path })
  }
  return found
}

/** Shell del usuario: $SHELL en Linux/macOS, PowerShell o cmd en Windows. */
export function defaultShell(): string {
  if (process.platform === 'win32') return which('pwsh') ?? which('powershell') ?? process.env.COMSPEC ?? 'cmd'
  return process.env.SHELL || which('bash') || 'sh'
}
