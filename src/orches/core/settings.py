import json
import os
import sys
from pathlib import Path


def _config_dir():
  if os.name == "nt":
    base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
  elif sys.platform == "darwin":
    base = Path.home() / "Library" / "Application Support"
  else:
    base = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
  return base / "orches"


FILE = _config_dir() / "settings.json"


def load():
  try:
    return json.loads(FILE.read_text(encoding="utf-8"))
  except (OSError, ValueError):
    return {}


def get(key, default=None):
  return load().get(key, default)


def set(key, value):
  data = load()
  data[key] = value
  try:
    FILE.parent.mkdir(parents=True, exist_ok=True)
    FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
  except OSError:
    pass
