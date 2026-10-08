"""Sugerencias de módulos dentro de un import / require: librerías de Node y dependencias del package.json."""
import json
import re
from pathlib import Path

from orches.core.completion import Suggestion

NODE_MODULES = """
assert assert/strict async_hooks buffer child_process cluster console constants crypto dgram diagnostics_channel dns
dns/promises domain events fs fs/promises http http2 https inspector module net os path path/posix path/win32
perf_hooks process punycode querystring readline readline/promises repl stream stream/consumers stream/promises
stream/web string_decoder sys timers timers/promises tls trace_events tty url util util/types v8 vm wasi worker_threads
zlib
""".split()
NODE_ONLY = ["test", "sqlite", "sea"]          # solo existen con el prefijo node:
LIMIT = 8

# comillas abiertas justo después de: from · import · import( · require(
IMPORT = re.compile(r"(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['\"])([^'\"\n]*)$")


def _dependencies(path):
  """Dependencias del package.json más cercano al archivo."""
  for folder in Path(path).resolve().parents:
    manifest = folder / "package.json"
    if manifest.is_file():
      try:
        data = json.loads(manifest.read_text(encoding="utf-8"))
      except (OSError, ValueError):
        return []
      return sorted({*data.get("dependencies", {}), *data.get("devDependencies", {}), *data.get("peerDependencies", {})})
  return []


def provide(text, cursor, path):
  line_start = text.rfind("\n", 0, cursor) + 1
  match = IMPORT.search(text[line_start:cursor])
  if not match or match.group(2).startswith("."):          # './archivo' y '../archivo' no son librerías
    return []
  typed = match.group(2)
  start = cursor - len(typed)
  prefixed = typed.startswith("node:")
  builtin = [f"node:{m}" for m in [*NODE_MODULES, *NODE_ONLY]] if prefixed else NODE_MODULES
  candidates = [(m, "Node") for m in builtin] + [(m, "package.json") for m in _dependencies(path)]
  if not prefixed:                                         # los de dependencias van primero: son los que más se usan
    candidates.sort(key=lambda c: c[1] == "Node")
  exact = [c for c in candidates if c[0].startswith(typed) and c[0] != typed]
  loose = [c for c in candidates if typed in c[0] and not c[0].startswith(typed)]
  return [Suggestion(label, "module", start, detail) for label, detail in (exact + loose)[:LIMIT]]
