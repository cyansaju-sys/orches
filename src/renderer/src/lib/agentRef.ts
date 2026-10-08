/** Agentes que entienden «@ruta» para adjuntar un archivo; los demás reciben la ruta tal cual. */
const AT_REF = new Set(['claude', 'opencode', 'gemini', 'codex', 'agy'])

/** Cómo se escribe una ruta del proyecto en el prompt de un agente. */
export function agentRef(command: string, relPath: string): string {
  const quoted = /\s/.test(relPath) ? `"${relPath}"` : relPath
  return AT_REF.has(command) ? `@${quoted}` : quoted
}
