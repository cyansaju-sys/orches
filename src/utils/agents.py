import shutil

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
  """Devuelve [{"name", "command", "path"}] de los agentes instalados en el PATH."""
  found = []
  for name, commands in KNOWN_AGENTS.items():
    for command in commands:
      path = shutil.which(command)
      if path:
        found.append({"name": name, "command": command, "path": path})
        break
  return found
