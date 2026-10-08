"""Modelo que usa cada agente y su nivel de capacidad, para repartir tareas según la dificultad."""
import json
import os
import re
import sqlite3
from pathlib import Path

# palabras que delatan un modelo pequeño o rápido / uno grande y capaz (se compara en minúsculas)
BASIC = ("haiku", "mini", "flash", "lite", "small", "nano", "tiny", "instant", "8b", "7b")
ADVANCED = ("opus", "fable", "ultra", "max", "pro", "large", "reasoner", "o1", "o3", "o4", "gpt-5", "gpt-4.5")
STANDARD = ("sonnet", "gpt-4", "gemini", "codestral", "medium", "plus")


def tier(model):
  """('basic' | 'standard' | 'advanced', ¿se reconoció el modelo?)."""
  m = (model or "").lower()
  if not m:
    return "standard", False
  if any(k in m for k in BASIC):
    return "basic", True
  if any(k in m for k in ADVANCED):
    return "advanced", True
  if any(k in m for k in STANDARD):
    return "standard", True
  return "standard", False     # desconocido: se asume intermedio


def _claude_model(cwd):
  """Último modelo usado en el proyecto, leído del final de su sesión más reciente."""
  folder = Path(os.path.expanduser("~/.claude/projects")) / re.sub(r"[^A-Za-z0-9]", "-", str(cwd))
  try:
    newest = max(folder.glob("*.jsonl"), key=lambda p: p.stat().st_mtime)
    with open(newest, "rb") as f:
      f.seek(0, os.SEEK_END)
      f.seek(max(0, f.tell() - 300_000))
      tail = f.read().decode("utf-8", "replace")
  except (OSError, ValueError):
    return None
  found = re.findall(r'"model":"([^"]+)"', tail)
  return next((m for m in reversed(found) if not m.startswith("<")), None)


def _opencode_model(cwd):
  path = os.path.expanduser("~/.local/share/opencode/opencode.db")
  try:
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=2)
    row = con.execute("select model from session_v2 where directory = ? order by time_updated desc limit 1",
                      (str(cwd),)).fetchone()
    con.close()
    return json.loads(row[0]).get("id") if row and row[0] else None
  except (sqlite3.Error, ValueError, AttributeError):
    return None


READERS = {"claude": _claude_model, "opencode": _opencode_model}


def current_model(command, cwd):
  """Modelo que está usando el agente en esa carpeta, o None si aún no se sabe."""
  reader = READERS.get(command)
  return reader(cwd) if reader else None
