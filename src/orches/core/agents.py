from orches.core.shellpath import which

# nombre visible -> ejecutables posibles
KNOWN_AGENTS = {
  "Claude Code": ["claude"],
  "OpenCode": ["opencode"],
  "Codex": ["codex"],
  "Gemini CLI": ["gemini"],
  "Aider": ["aider"],
  "Cursor Agent": ["cursor-agent"],
  "Goose": ["goose"],
  "Amp": ["amp"],
  "Qwen Code": ["qwen"],
  "Copilot CLI": ["copilot"],
}


def detect_agents():
  """Devuelve [{"name", "command", "path"}] de los agentes instalados (PATH, shell de login y carpetas habituales)."""
  found = []
  for name, commands in KNOWN_AGENTS.items():
    for command in commands:
      path = which(command)
      if path:
        found.append({"name": name, "command": command, "path": path})
        break
  return found
