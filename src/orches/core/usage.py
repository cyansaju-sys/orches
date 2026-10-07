"""Consumo de tokens e historial de los agentes, leído de sus archivos locales.

- Claude Code: ~/.claude/projects/*/*.jsonl (un archivo por sesión; cada respuesta trae su `usage`).
- OpenCode: ~/.local/share/opencode/opencode.db (SQLite, tabla session_v2).

Solo se lee: nunca se modifica nada de los agentes.
"""
import glob
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

from utils import settings

WINDOW_HOURS = 5   # Claude reinicia el límite de sesión en ventanas de 5 horas


@dataclass
class Tokens:
  input: int = 0
  output: int = 0
  cache_write: int = 0
  cache_read: int = 0

  @property
  def total(self):
    """Tokens procesados de verdad; la lectura de caché se cuenta aparte (es barata)."""
    return self.input + self.output + self.cache_write

  def add(self, other):
    self.input += other.input
    self.output += other.output
    self.cache_write += other.cache_write
    self.cache_read += other.cache_read


@dataclass
class Session:
  agent: str
  title: str
  project: str
  tokens: int
  start: datetime
  end: datetime
  id: str = ""
  cwd: str = ""        # carpeta donde se ejecutó (hay que retomarla desde ahí)
  command: str = ""    # ejecutable del agente

  @property
  def key(self):
    return f"{self.command}:{self.id}"

  @property
  def display_title(self):
    """Nombre propio de esta app si lo cambiaste; si no, el del agente."""
    return (settings.get("session_names") or {}).get(self.key) or self.title

  @property
  def resume_args(self):
    """Argumentos para retomar esta sesión, o None si el agente no lo permite."""
    make = RESUME_ARGS.get(self.command)
    return make(self.id) if make and self.id else None


@dataclass
class Window:
  start: datetime
  end: datetime          # cuándo se reinicia
  tokens: Tokens = field(default_factory=Tokens)


@dataclass
class Limit:
  label: str
  percent: float
  resets_at: datetime


@dataclass
class AgentUsage:
  name: str
  window: Window | None = None
  today: int = 0
  week: int = 0
  total: int = 0
  sessions: list = field(default_factory=list)
  note: str = ""
  limits: list = field(default_factory=list)   # Limit: % usado y reinicio reales, si el agente los da
  limits_error: str = ""
  limits_age: float = 0.0                       # segundos desde que se obtuvieron


def _utc(ts):
  return datetime.fromisoformat(ts.replace("Z", "+00:00"))


# --- Límites de Claude (consulta a Anthropic) ---------------------------------------------------
LIMITS_URL = "https://api.anthropic.com/api/oauth/usage"
LIMITS_TTL = 60       # mínimo entre consultas reales (el endpoint limita las peticiones frecuentes)
LIMITS_BACKOFF = 120  # espera mínima tras un 429
_limits = {"next_try": 0.0, "error": "", "good": None}   # good = (momento, [Limit])
_LIMIT_LABELS = (
  ("five_hour", "Sesión (5 h)"),
  ("seven_day", "Semanal (7 días)"),
  ("seven_day_opus", "Semanal Opus"),
  ("seven_day_sonnet", "Semanal Sonnet"),
)


def _load_good():
  """Último dato bueno guardado, para mostrar algo tras reiniciar o durante una espera."""
  saved = settings.get("limits_cache") or {}
  try:
    items = [Limit(i["label"], float(i["percent"]), datetime.fromisoformat(i["resets_at"]))
             for i in saved.get("limits", [])]
    return (float(saved["at"]), items) if items else None
  except (KeyError, ValueError, TypeError):
    return None


def _save_good(at, limits):
  settings.set("limits_cache", {
    "at": at,
    "limits": [{"label": l.label, "percent": l.percent, "resets_at": l.resets_at.isoformat()} for l in limits],
  })


def _claude_credentials():
  """Credenciales OAuth de Claude Code: archivo en Linux/Windows, Llavero en macOS."""
  raw = None
  path = os.path.expanduser("~/.claude/.credentials.json")
  try:
    raw = Path(path).read_text(encoding="utf-8")
  except OSError:
    if sys.platform == "darwin":
      try:
        raw = subprocess.run(["security", "find-generic-password", "-s", "Claude Code-credentials", "-w"],
                             capture_output=True, text=True, timeout=5).stdout
      except (OSError, subprocess.SubprocessError):
        raw = None
  try:
    return (json.loads(raw) or {}).get("claudeAiOauth") if raw else None
  except ValueError:
    return None


def _fetch_limits(creds):
  req = urllib.request.Request(LIMITS_URL, headers={
    "Authorization": f"Bearer {creds['accessToken']}",
    "anthropic-beta": "oauth-2025-04-20",
    "User-Agent": "orches",
    "Accept": "application/json",
  })
  with urllib.request.urlopen(req, timeout=10) as response:
    data = json.load(response)
  limits = []
  for key, label in _LIMIT_LABELS:
    item = data.get(key)
    if item and item.get("utilization") is not None and item.get("resets_at"):
      limits.append(Limit(label, float(item["utilization"]), datetime.fromisoformat(item["resets_at"])))
  return limits


def claude_limits(fetch=False):
  """(lista de Limit, error, antigüedad en s). Pregunta a Anthropic con la sesión de Claude Code.

  Solo consulta a Anthropic si `fetch` es True (al entrar en la pestaña IA); si no, devuelve el
  último dato guardado. El token solo se envía a api.anthropic.com y nunca se guarda ni se muestra. No se renueva: si
  caducó, basta con abrir Claude Code una vez. Ante un 429 se espera y se sigue mostrando el
  último dato bueno (los límites que ya se reiniciaron se descartan).
  """
  now = time.time()
  if _limits["good"] is None:
    _limits["good"] = _load_good()
  if fetch and now >= _limits["next_try"]:
    creds = _claude_credentials()
    if not creds or not creds.get("accessToken"):
      _limits.update(next_try=now + 60, error="Inicia sesión en Claude Code para ver el porcentaje")
    elif creds.get("expiresAt", 0) / 1000 < now:
      _limits.update(next_try=now + 60, error="La sesión de Claude caducó: abre Claude Code para renovarla")
    else:
      try:
        limits = _fetch_limits(creds)
        if limits:
          _limits.update(good=(now, limits), error="", next_try=now + LIMITS_TTL)
          _save_good(now, limits)
        else:
          _limits.update(error="Anthropic no devolvió límites", next_try=now + LIMITS_TTL)
      except urllib.error.HTTPError as e:
        wait = LIMITS_BACKOFF
        if e.code == 429:
          try:
            wait = max(wait, int(e.headers.get("Retry-After", 0)))
          except (TypeError, ValueError):
            pass
        _limits.update(next_try=now + wait, error=f"Anthropic respondió {e.code}")
      except (OSError, ValueError):
        _limits.update(next_try=now + 60, error="Sin conexión con Anthropic")

  good = _limits["good"]
  if good:
    at, limits = good
    current = [l for l in limits if l.resets_at.timestamp() > now]   # lo ya reiniciado no vale
    if current:
      return current, "", now - at
  return [], _limits["error"], 0


# --- Claude Code ------------------------------------------------------------------------------
_claude_cache = {}   # ruta -> ((mtime, size), datos)


def _parse_claude_file(path):
  msgs, title, last_prompt, cwd = {}, None, None, None
  with open(path, encoding="utf-8", errors="replace") as f:
    for line in f:
      try:
        d = json.loads(line)
      except ValueError:
        continue
      kind = d.get("type")
      cwd = cwd or d.get("cwd")      # carpeta inicial de la sesión
      if kind == "ai-title":
        title = d.get("aiTitle") or title
      elif kind == "last-prompt":
        last_prompt = d.get("lastPrompt") or last_prompt
      elif kind == "assistant":
        m = d.get("message") or {}
        u = m.get("usage")
        if not u or not d.get("timestamp"):
          continue
        key = (m.get("id"), d.get("requestId"))
        t = Tokens(u.get("input_tokens", 0), u.get("output_tokens", 0),
                   u.get("cache_creation_input_tokens", 0), u.get("cache_read_input_tokens", 0))
        msgs[key] = (_utc(d["timestamp"]), t)   # las respuestas parciales se sobrescriben con la final
  return {"msgs": msgs, "title": title or last_prompt or "(sin título)", "cwd": cwd}


def _claude_files():
  return glob.glob(os.path.expanduser("~/.claude/projects/*/*.jsonl"))


def claude_usage(now, fetch=False):
  data = {}
  for path in _claude_files():
    try:
      st = os.stat(path)
    except OSError:
      continue
    stamp = (st.st_mtime, st.st_size)
    cached = _claude_cache.get(path)
    if not cached or cached[0] != stamp:
      try:
        cached = (stamp, _parse_claude_file(path))
      except OSError:
        continue
      _claude_cache[path] = cached
    data[path] = cached[1]

  usage = AgentUsage("Claude Code")
  seen, entries = set(), []   # entradas únicas entre archivos (las sesiones reanudadas repiten mensajes)
  for path, d in data.items():
    total, times = Tokens(), []
    for key, (ts, t) in d["msgs"].items():
      if key in seen:
        continue
      seen.add(key)
      entries.append((ts, t))
      total.add(t)
      times.append(ts)
    if times:
      project = Path(d["cwd"]).name if d["cwd"] else Path(path).parent.name
      usage.sessions.append(Session(
        "Claude Code", d["title"], project, total.total, min(times), max(times),
        id=Path(path).stem, cwd=d["cwd"] or "", command="claude",
      ))

  entries.sort(key=lambda e: e[0])
  today = now.astimezone().date()
  week_start = now - timedelta(days=7)
  block = None
  for ts, t in entries:
    usage.total += t.total
    if ts.astimezone().date() == today:
      usage.today += t.total
    if ts >= week_start:
      usage.week += t.total
    # ventana nueva si el mensaje cae fuera de la anterior (inicio redondeado a la hora)
    if block is None or ts >= block.end:
      start = ts.replace(minute=0, second=0, microsecond=0)
      block = Window(start, start + timedelta(hours=WINDOW_HOURS))
    block.tokens.add(t)
  if block and now < block.end:
    usage.window = block
  usage.sessions.sort(key=lambda s: s.end, reverse=True)
  usage.limits, usage.limits_error, usage.limits_age = claude_limits(fetch)
  return usage


# --- OpenCode ---------------------------------------------------------------------------------
def opencode_usage(now, fetch=False):
  path = os.path.expanduser("~/.local/share/opencode/opencode.db")
  if not os.path.exists(path):
    return None
  usage = AgentUsage("OpenCode", note="Sin límite propio: el reinicio depende del proveedor y del modelo.")
  try:
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=2)
    rows = con.execute(
      "select title, directory, time_created, time_updated, tokens_input, tokens_output, "
      "tokens_reasoning, tokens_cache_write, id from session_v2 where time_archived is null"
    ).fetchall()
    con.close()
  except sqlite3.Error:
    return usage
  today = now.astimezone().date()
  week_start = now - timedelta(days=7)
  for title, directory, created, updated, t_in, t_out, t_reason, t_cw, sid in rows:
    tokens = (t_in or 0) + (t_out or 0) + (t_reason or 0) + (t_cw or 0)
    start = datetime.fromtimestamp(created / 1000, timezone.utc)
    end = datetime.fromtimestamp(updated / 1000, timezone.utc)
    usage.total += tokens
    if end.astimezone().date() == today:
      usage.today += tokens
    if end >= week_start:
      usage.week += tokens
    usage.sessions.append(Session(
      "OpenCode", title or "(sin título)", Path(directory or "").name, tokens, start, end,
      id=sid, cwd=directory or "", command="opencode",
    ))
  usage.sessions.sort(key=lambda s: s.end, reverse=True)
  return usage


# cómo retomar una sesión por id, según el agente
RESUME_ARGS = {
  "claude": lambda sid: ["--resume", sid],
  "opencode": lambda sid: ["--session", sid],
}

# ejecutable del agente -> función que lee su consumo. Para dar soporte a otro agente basta
# con escribir su lector (devuelve AgentUsage) y registrarlo aquí.
PROVIDERS = {"claude": claude_usage, "opencode": opencode_usage}


def collect(agents, fetch=False):
  """Consumo de los agentes instalados en este equipo (`agents` = salida de detect_agents).

  `fetch=True` permite las consultas a la red (límites reales de Claude).
  """
  now = datetime.now(timezone.utc)
  result = []
  for agent in agents:
    reader = PROVIDERS.get(agent["command"])
    usage = reader(now, fetch) if reader else None
    if usage is None:
      usage = AgentUsage(agent["name"], note="Todavía no se puede leer el consumo de este agente.")
    usage.name = agent["name"]
    result.append(usage)
  return result


# --- formato -------------------------------------------------------------------------------------
def fmt_tokens(n):
  if n >= 1_000_000:
    return f"{n / 1_000_000:.1f} M"
  if n >= 1_000:
    return f"{n / 1_000:.1f} k"
  return str(n)


def fmt_delta(delta):
  minutes = max(0, int(delta.total_seconds() // 60))
  if minutes >= 24 * 60:
    return f"{minutes // (24 * 60)} d"
  if minutes >= 60:
    return f"{minutes // 60} h {minutes % 60:02d} min"
  return f"{minutes} min"


# --- acciones sobre una sesión ----------------------------------------------------------------
def rename_session(session, name):
  """Guarda un nombre propio (vacío = volver al original). No toca los archivos del agente."""
  names = dict(settings.get("session_names") or {})
  name = name.strip()
  if name:
    names[session.key] = name
  else:
    names.pop(session.key, None)
  settings.set("session_names", names)


def delete_session(session):
  """Borra la sesión del agente. Devuelve (ok, mensaje)."""
  names = dict(settings.get("session_names") or {})
  if session.command == "claude":
    removed = False
    for path in glob.glob(os.path.expanduser(f"~/.claude/projects/*/{session.id}.jsonl")):
      os.remove(path)
      _claude_cache.pop(path, None)
      shutil.rmtree(Path(path).with_suffix(""), ignore_errors=True)   # carpeta auxiliar de la sesión
      removed = True
    ok, message = removed, "" if removed else "No se encontró el archivo de la sesión"
  elif session.command == "opencode":
    try:
      run = subprocess.run(["opencode", "session", "delete", session.id], cwd=session.cwd or None,
                           capture_output=True, text=True, timeout=30)
      ok, message = run.returncode == 0, run.stderr.strip() or run.stdout.strip()
    except (OSError, subprocess.SubprocessError) as e:
      ok, message = False, str(e)
  else:
    ok, message = False, "Este agente no permite borrar sesiones desde aquí"
  if ok and names.pop(session.key, None) is not None:
    settings.set("session_names", names)
  return ok, message
