"""Historial de git como grafo: lee los commits y reparte cada rama en un carril (sin interfaz, se puede probar sola)."""
import os
import shutil
import subprocess
from dataclasses import dataclass, field

_FLAGS = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
SEP = "\x1f"
FORMAT = SEP.join(["%H", "%P", "%an", "%ar", "%s", "%D"])


@dataclass
class Commit:
  hash: str
  parents: list
  author: str
  when: str
  subject: str
  refs: list = field(default_factory=list)      # [("HEAD", "head"), ("main", "branch"), ("v1", "tag"), ("origin/main", "remote")]
  lane: int = 0
  # trazos de la fila, con carriles como columnas: (x_arriba, x_abajo, carril de color)
  top: list = field(default_factory=list)       # de la parte alta de la fila al círculo
  bottom: list = field(default_factory=list)    # del círculo a la parte baja
  through: list = field(default_factory=list)   # carriles que pasan de largo
  width: int = 1


def _git(root, *args, timeout=15):
  if not shutil.which("git"):
    return None
  try:
    result = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True, timeout=timeout,
                            creationflags=_FLAGS, encoding="utf-8", errors="replace")
  except (OSError, subprocess.SubprocessError):
    return None
  return result.stdout if result.returncode == 0 else None


def parse_refs(text):
  refs = []
  for part in [p.strip() for p in text.split(",") if p.strip()]:
    if part.startswith("HEAD -> "):
      refs += [("HEAD", "head"), (part[8:], "branch")]
    elif part == "HEAD":
      refs.append(("HEAD", "head"))
    elif part.startswith("tag: "):
      refs.append((part[5:], "tag"))
    elif "/" in part:
      refs.append((part, "remote"))
    else:
      refs.append((part, "branch"))
  return refs


def log(root, limit=300, skip=0):
  """Commits de todas las ramas, del más nuevo al más viejo. None si no es un repositorio."""
  out = _git(root, "log", "--all", "--date-order", f"--max-count={limit}", f"--skip={skip}",
             "--decorate=short", f"--format={FORMAT}")
  if out is None:
    return None
  commits = []
  for line in out.splitlines():
    parts = line.split(SEP)
    if len(parts) < 6:
      continue
    h, parents, author, when, subject, refs = parts[:6]
    commits.append(Commit(h, parents.split(), author, when, subject, parse_refs(refs)))
  return commits


def signature(root):
  """Cambia cuando cambia cualquier rama, etiqueta o HEAD (para saber si hay que repintar)."""
  return _git(root, "for-each-ref", "--format=%(objectname) %(refname)") or "", _git(root, "rev-parse", "HEAD") or ""


def layout(commits, carry=None):
  """Asigna carriles y trazos a cada commit. `carry`: carriles pendientes al continuar una lista ya cargada."""
  lanes = list(carry or [])             # lanes[i] = hash del commit que ese carril espera, o None
  for c in commits:
    before = list(lanes)
    mine = [i for i, h in enumerate(lanes) if h == c.hash]
    if mine:
      lane = mine[0]
    else:
      lane = next((i for i, h in enumerate(lanes) if h is None), len(lanes))
      if lane == len(lanes):
        lanes.append(None)
    c.lane = lane
    # todos los carriles que esperaban a este commit llegan al círculo
    c.top = [(i, lane, i) for i in mine]
    for i in mine:
      lanes[i] = None
    # los demás carriles pasan de largo
    c.through = [i for i, h in enumerate(before) if h is not None and i not in mine]
    # hacia los padres: el primero sigue en este carril (o se une al que ya lo espera)
    c.bottom = []
    for n, parent in enumerate(c.parents):
      if parent in lanes:
        c.bottom.append((lane, lanes.index(parent), lanes.index(parent)))
      elif n == 0:
        lanes[lane] = parent
        c.bottom.append((lane, lane, lane))
      else:
        free = next((i for i, h in enumerate(lanes) if h is None and i != lane), None)
        if free is None:
          lanes.append(None)
          free = len(lanes) - 1
        lanes[free] = parent
        c.bottom.append((lane, free, free))
    while lanes and lanes[-1] is None:
      lanes.pop()
    c.width = max(len(before), len(lanes), lane + 1, *(max(a, b) + 1 for a, b, _ in c.top + c.bottom), 1)
  return lanes


def details(root, hash):
  """Mensaje completo y archivos cambiados de un commit."""
  head = _git(root, "show", "-s", f"--format=%H{SEP}%an <%ae>{SEP}%aD{SEP}%B", hash)
  files = _git(root, "show", "--stat", "--format=", "--stat-width=100", hash)
  if head is None:
    return None
  full, author, date, body = (head.split(SEP, 3) + ["", "", "", ""])[:4]
  return {"hash": full, "author": author, "date": date, "message": body.strip(), "files": (files or "").rstrip()}
