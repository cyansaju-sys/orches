import os
import shutil
import subprocess

_FLAGS = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0


def ignored_paths(root, paths):
  """Subconjunto de `paths` que git ignora en el repositorio de `root` (vacío si no es un repo)."""
  paths = list(paths)
  if not paths or not shutil.which("git"):
    return set()
  try:
    result = subprocess.run(
      ["git", "-C", str(root), "check-ignore", "-z", "--stdin"],
      input="\0".join(str(p) for p in paths),
      capture_output=True,
      text=True,
      timeout=5,
      creationflags=_FLAGS,
    )
  except (OSError, subprocess.SubprocessError):
    return set()
  # código 1 = ninguno ignorado; 128 = no es un repositorio
  if result.returncode not in (0, 1):
    return set()
  return {p for p in paths if str(p) in set(result.stdout.split("\0"))}


def _git(root, *args):
  try:
    result = subprocess.run(
      ["git", "-C", str(root), *args],
      capture_output=True, text=True, timeout=5, creationflags=_FLAGS,
    )
  except (OSError, subprocess.SubprocessError):
    return None
  return result.stdout if result.returncode == 0 else None


# prioridad al resumir una carpeta: gana el estado "más importante" de lo que contiene
_PRIORITY = {"C": 5, "D": 4, "M": 3, "R": 2, "A": 1, "U": 1}


def _code(xy):
  """Código de una línea de `git status --porcelain`: M, A, D, R, U (nuevo sin seguir) o C (conflicto)."""
  if xy == "??":
    return "U"
  if "U" in xy or xy in ("AA", "DD"):
    return "C"
  for letter in "MDRA":
    if letter in xy:
      return letter
  return None


def status_map(root):
  """{ruta relativa a `root` (con /): código} de los archivos cambiados, y de sus carpetas.

  Vacío si `root` no está en un repositorio o no hay git.
  """
  if not shutil.which("git"):
    return {}
  top = _git(root, "rev-parse", "--show-toplevel")
  if top is None:
    return {}
  out = _git(root, "status", "--porcelain=v1", "-z", "-uall")
  if not out:
    return {}
  from pathlib import Path, PurePosixPath
  top = Path(top.strip()).resolve()
  prefix = Path(root).resolve().relative_to(top).as_posix()
  prefix = "" if prefix == "." else prefix + "/"

  result = {}
  fields = out.split("\0")
  i = 0
  while i < len(fields):
    entry = fields[i]
    i += 1
    if len(entry) < 4:
      continue
    xy, path = entry[:2], entry[3:]
    if "R" in xy or "C" in xy[:1]:
      i += 1  # los renombrados traen también la ruta de origen
    code = _code(xy)
    if not code or not path.startswith(prefix):
      continue
    rel = PurePosixPath(path[len(prefix):])
    result[str(rel)] = code
    for parent in rel.parents:        # carpetas que contienen cambios
      if str(parent) == ".":
        break
      key = str(parent)
      if _PRIORITY[code] > _PRIORITY.get(result.get(key), 0):
        result[key] = code
  return result
