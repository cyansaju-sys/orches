"""Servidores MCP de cada agente: leerlos, añadirlos y quitarlos.

Se añaden y quitan con el propio comando de cada agente (`claude mcp ...`, `opencode mcp ...`)
para respetar su formato; la lectura es directa de sus archivos de configuración.
"""
import json
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

# agentes con soporte: ejecutable -> nombre visible
SUPPORTED = {"claude": "Claude Code", "opencode": "OpenCode"}
GLOBAL, PROJECT, SHARED = "global", "project", "shared"
SCOPE_LABELS = {GLOBAL: "Todos los proyectos", PROJECT: "Este proyecto", SHARED: "Compartido (.mcp.json)"}
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
_FLAGS = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0


@dataclass(frozen=True)
class McpServer:
  name: str
  agent: str        # ejecutable: "claude" | "opencode"
  scope: str        # GLOBAL | PROJECT | SHARED
  kind: str         # "remote" | "local"
  target: str       # URL o comando completo
  raw: str = ""     # entrada original de la configuración, en JSON (hashable, para los detalles)
  source: str = ""  # archivo donde está guardada

  @property
  def config(self):
    try:
      return json.loads(self.raw)
    except ValueError:
      return {}

  @property
  def agent_name(self):
    return SUPPORTED.get(self.agent, self.agent)


def _read_json(path):
  try:
    return json.loads(Path(path).read_text(encoding="utf-8"))
  except (OSError, ValueError):
    return {}


def _describe(entry):
  """('remote'|'local', URL o comando) de una entrada de configuración."""
  command = entry.get("command")
  if isinstance(command, list):
    command = " ".join(str(c) for c in command)
  elif command:
    command = " ".join([str(command), *[str(a) for a in entry.get("args") or []]])
  if entry.get("url") or entry.get("type") in ("http", "sse", "remote"):
    return "remote", entry.get("url", "")
  return "local", command or ""


def _opencode_global_config():
  base = os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config")
  return Path(base) / "opencode" / "opencode.json"


def list_servers(project):
  """Servidores configurados (globales y del proyecto) de todos los agentes soportados."""
  servers = []

  claude_file = os.path.expanduser("~/.claude.json")
  claude = _read_json(claude_file)
  scopes = [(GLOBAL, claude.get("mcpServers") or {}, claude_file)]
  if project:
    for key, data in (claude.get("projects") or {}).items():
      try:
        same = Path(key).resolve() == Path(project).resolve()
      except OSError:
        same = key == str(project)
      if same:
        scopes.append((PROJECT, (data or {}).get("mcpServers") or {}, claude_file))
    shared = Path(project) / ".mcp.json"
    scopes.append((SHARED, _read_json(shared).get("mcpServers") or {}, str(shared)))
  for scope, entries, source in scopes:
    for name, entry in entries.items():
      entry = entry or {}
      servers.append(McpServer(name, "claude", scope, *_describe(entry),
                               raw=json.dumps(entry, sort_keys=True), source=source))

  files = [(GLOBAL, _opencode_global_config())]
  if project:
    files.append((PROJECT, Path(project) / "opencode.json"))
  for scope, path in files:
    for name, entry in ((_read_json(path).get("mcp") or {}).get("servers") or {}).items():
      entry = entry or {}
      servers.append(McpServer(name, "opencode", scope, *_describe(entry),
                               raw=json.dumps(entry, sort_keys=True), source=str(path)))
  return servers


def installed_agents(detected):
  """Agentes instalados que saben de MCP: [{"name","command"}]."""
  return [a for a in detected if a["command"] in SUPPORTED]


def _run(argv, cwd):
  try:
    out = subprocess.run(argv, capture_output=True, text=True, timeout=60, cwd=cwd or None,
                         stdin=subprocess.DEVNULL, creationflags=_FLAGS)
  except (OSError, subprocess.SubprocessError) as e:
    return False, str(e)
  text = (out.stdout if out.returncode == 0 else out.stderr or out.stdout).strip()
  return out.returncode == 0, text


def validate(spec):
  """Mensaje de error si `spec` no es válido; None si está bien."""
  if not NAME_RE.match(spec.get("name", "")):
    return "El nombre solo puede tener letras, números, - y _"
  if spec["kind"] == "remote":
    if not re.match(r"^https?://\S+$", spec.get("url", "")):
      return "La URL debe empezar por http:// o https://"
  elif not (spec.get("command") or "").strip():
    return "Escribe el comando que arranca el servidor"
  return None


def add_server(agent, spec, scope, project):
  """Añade un servidor al agente con su CLI. `spec`: name, kind, url, headers, command, args, env."""
  error = validate(spec)
  if error:
    return False, error
  name, headers, env = spec["name"], spec.get("headers") or {}, spec.get("env") or {}
  remote = spec["kind"] == "remote"
  if agent == "claude":
    cli_scope = "user" if scope == GLOBAL else "local"
    argv = ["claude", "mcp", "add", name]            # el nombre va antes: -H y -e aceptan varios valores
    if remote:
      argv += [spec["url"], "--transport", "http", "-s", cli_scope]
      for key, value in headers.items():
        argv += ["-H", f"{key}: {value}"]
    else:
      argv += ["-s", cli_scope]
      for key, value in env.items():
        argv += ["-e", f"{key}={value}"]
      argv += ["--", spec["command"], *spec.get("args", [])]
  elif agent == "opencode":
    argv = ["opencode", "mcp", "add"]
    if scope == GLOBAL:
      argv.append("--global")
    if remote:
      argv += ["--url", spec["url"]]
      for key, value in headers.items():
        argv += ["--header", f"{key}={value}"]
      argv.append(name)
    else:
      for key, value in env.items():
        argv += ["--env", f"{key}={value}"]
      argv += [name, "--", spec["command"], *spec.get("args", [])]
  else:
    return False, f"No sé añadir MCP a {agent}"
  return _run(argv, project)


def remove_server(server, project):
  """Quita un servidor de la configuración del agente. Devuelve (ok, mensaje)."""
  if server.agent == "claude":
    cli_scope = {GLOBAL: "user", PROJECT: "local", SHARED: "project"}[server.scope]
    return _run(["claude", "mcp", "remove", server.name, "-s", cli_scope], project)
  if server.agent == "opencode":    # OpenCode no trae `mcp remove`: se edita su archivo
    path = _opencode_global_config() if server.scope == GLOBAL else Path(project) / "opencode.json"
    try:
      data = json.loads(path.read_text(encoding="utf-8"))
      del data["mcp"]["servers"][server.name]
      path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
      return True, "Quitado"
    except (OSError, ValueError, KeyError) as e:
      return False, f"No se pudo editar {path}: {e}"
  return False, f"No sé quitar MCP de {server.agent}"


def spec_from_server(server):
  """Convierte un servidor ya configurado en el `spec` de add_server, para copiarlo a otro agente."""
  cfg = server.config
  spec = {"name": server.name, "kind": server.kind, "headers": dict(cfg.get("headers") or {}),
          "env": dict(cfg.get("env") or cfg.get("environment") or {})}
  if server.kind == "remote":
    spec["url"] = cfg.get("url", "")
  else:
    command = cfg.get("command")
    parts = [*command] if isinstance(command, list) else [command or "", *(cfg.get("args") or [])]
    spec["command"], spec["args"] = str(parts[0]), [str(p) for p in parts[1:]]
  return spec


def agents_missing(server, servers):
  """Agentes soportados que todavía no tienen este servidor (mismo nombre y alcance)."""
  have = {(s.agent, s.name, PROJECT if s.scope == SHARED else s.scope) for s in servers}
  scope = PROJECT if server.scope == SHARED else server.scope
  return [a for a in SUPPORTED if a != server.agent and (a, server.name, scope) not in have]
