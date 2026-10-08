/**
 * PATH completo del usuario, para encontrar los agentes aunque la app no se haya lanzado desde una terminal.
 * Junta el PATH del proceso, el de la shell de login (nvm, asdf...) y las carpetas habituales.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync, accessSync, constants } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

const MARK = '__orches_path__'
let cache: string | null = null

function commonDirs(): string[] {
  const home = homedir()
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA ?? join(home, 'AppData', 'Roaming')
    const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
    return [
      join(home, '.local', 'bin'), join(home, '.claude', 'local'), join(appdata, 'npm'), join(home, '.bun', 'bin'),
      join(home, '.cargo', 'bin'), join(home, 'scoop', 'shims'), join(local, 'Microsoft', 'WinGet', 'Links'),
      join(local, 'pnpm'), join(process.env.ProgramFiles ?? 'C:\\Program Files', 'nodejs')
    ]
  }
  const nvm = join(home, '.nvm', 'versions', 'node')
  const nvmBins = existsSync(nvm) ? readdirSync(nvm).sort().reverse().map((v) => join(nvm, v, 'bin')) : []
  return [
    join(home, '.local', 'bin'), join(home, '.claude', 'local'), join(home, '.npm-global', 'bin'), join(home, '.bun', 'bin'),
    join(home, '.cargo', 'bin'), join(home, 'go', 'bin'), join(home, '.volta', 'bin'), join(home, '.opencode', 'bin'),
    join(home, '.local', 'share', 'pnpm'), ...nvmBins, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/snap/bin'
  ]
}

function loginShellPath(): string {
  if (process.platform === 'win32') return ''
  const shell = process.env.SHELL || '/bin/bash'
  try {
    const out = execFileSync(shell, ['-ilc', `printf "${MARK}%s${MARK}" "$PATH"`], {
      encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore']
    })
    const parts = out.split(MARK)
    return parts.length >= 3 ? parts[1] : ''
  } catch {
    return ''
  }
}

const isDir = (p: string): boolean => { try { return statSync(p).isDirectory() } catch { return false } }

export function extendedPath(): string {
  if (cache === null) {
    const all = [...(process.env.PATH ?? '').split(delimiter), ...loginShellPath().split(delimiter), ...commonDirs()]
    const seen = new Set<string>()
    cache = all.filter((d) => d && !seen.has(d) && seen.add(d) && isDir(d)).join(delimiter)
  }
  return cache
}

/** Como `which`, pero con el PATH ampliado. */
export function which(command: string): string | null {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : ['']
  for (const dir of extendedPath().split(delimiter)) {
    for (const ext of exts) {
      const candidate = join(dir, command + ext.toLowerCase())
      try {
        if (!statSync(candidate).isFile()) continue
        if (process.platform !== 'win32') accessSync(candidate, constants.X_OK)
        return candidate
      } catch { /* siguiente */ }
    }
  }
  return null
}
