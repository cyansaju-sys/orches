import re
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


def changed_files(root):
  """[(ruta relativa a `root` con /, código)] de los archivos cambiados; vacío si no es un repo."""
  if not shutil.which("git"):
    return []
  top = _git(root, "rev-parse", "--show-toplevel")
  if top is None:
    return []
  out = _git(root, "status", "--porcelain=v1", "-z", "-uall")
  if not out:
    return []
  from pathlib import Path
  top = Path(top.strip()).resolve()
  prefix = Path(root).resolve().relative_to(top).as_posix()
  prefix = "" if prefix == "." else prefix + "/"

  result = []
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
    if code and path.startswith(prefix):
      result.append((path[len(prefix):], code))
  return result


def branch(root):
  """Nombre de la rama actual (o None)."""
  name = _git(root, "rev-parse", "--abbrev-ref", "HEAD") if shutil.which("git") else None
  return name.strip() if name else None


def status_map(root):
  """{ruta relativa a `root` (con /): código} de los archivos cambiados y de sus carpetas."""
  from pathlib import PurePosixPath
  result = {}
  for path, code in changed_files(root):
    rel = PurePosixPath(path)
    result[str(rel)] = code
    for parent in rel.parents:        # carpetas que contienen cambios
      if str(parent) == ".":
        break
      key = str(parent)
      if _PRIORITY[code] > _PRIORITY.get(result.get(key), 0):
        result[key] = code
  return result


from dataclasses import dataclass


@dataclass(frozen=True)
class Entry:
  path: str                # relativa a la carpeta del proyecto, con /
  staged: str = ""         # estado en el índice (preparado para commit): M, A, D, R...
  unstaged: str = ""       # estado en el árbol de trabajo: M, D, U (sin seguimiento)
  conflict: bool = False


def status_entries(root):
  """Estado detallado por archivo, separando lo preparado (add) de lo que no."""
  if not shutil.which("git"):
    return []
  top = _git(root, "rev-parse", "--show-toplevel")
  out = _git(root, "status", "--porcelain=v1", "-z", "-uall") if top is not None else None
  if not out:
    return []
  from pathlib import Path
  prefix = Path(root).resolve().relative_to(Path(top.strip()).resolve()).as_posix()
  prefix = "" if prefix == "." else prefix + "/"

  result = []
  fields = out.split("\0")
  i = 0
  while i < len(fields):
    entry = fields[i]
    i += 1
    if len(entry) < 4:
      continue
    xy, path = entry[:2], entry[3:]
    if "R" in xy or "C" in xy[:1]:
      i += 1
    if not path.startswith(prefix):
      continue
    path = path[len(prefix):]
    if xy == "??":
      result.append(Entry(path, unstaged="U"))
    elif "U" in xy or xy in ("AA", "DD"):
      result.append(Entry(path, conflict=True))
    else:
      staged = xy[0] if xy[0] in "MADRCT" else ""
      unstaged = xy[1] if xy[1] in "MDT" else ""
      result.append(Entry(path, staged="M" if staged == "T" else staged, unstaged="M" if unstaged == "T" else unstaged))
  return result


def _run(root, *args):
  out = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True,
                       timeout=30, creationflags=_FLAGS)
  return out.returncode == 0, (out.stderr or out.stdout).strip()


def stage(root, paths):
  """git add de esos archivos (también registra los borrados). Devuelve (ok, mensaje)."""
  try:
    return _run(root, "add", "--", *paths)
  except (OSError, subprocess.SubprocessError) as e:
    return False, str(e)


def unstage(root, paths):
  """Saca archivos del índice sin tocar su contenido (git reset). Devuelve (ok, mensaje)."""
  try:
    return _run(root, "reset", "-q", "--", *paths)
  except (OSError, subprocess.SubprocessError) as e:
    return False, str(e)


def commit(root, message):
  """git commit de lo que está preparado. Devuelve (ok, mensaje de git)."""
  try:
    out = subprocess.run(["git", "-C", str(root), "commit", "-m", message], capture_output=True,
                         text=True, timeout=120, creationflags=_FLAGS)   # los hooks pueden tardar
  except (OSError, subprocess.SubprocessError) as e:
    return False, str(e)
  text = (out.stdout if out.returncode == 0 else out.stderr or out.stdout).strip()
  return out.returncode == 0, text


def sync_info(root):
  """(rama, commits por subir, tiene upstream, hay remoto) de la rama actual."""
  name = branch(root)
  if not name:
    return None, 0, False, False
  upstream = _git(root, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
  remotes = _git(root, "remote")
  ahead = 0
  if upstream:
    count = _git(root, "rev-list", "--count", "@{u}..HEAD")
    ahead = int(count.strip()) if count and count.strip().isdigit() else 0
  return name, ahead, bool(upstream), bool(remotes and remotes.strip())


def push(root):
  """git push de la rama actual (publica la rama si aún no tiene upstream). Devuelve (ok, mensaje).

  Nunca se queda esperando una contraseña: sin terminal, las credenciales se piden por los
  medios de git (llavero, agente SSH) o falla con un mensaje.
  """
  name, _, has_upstream, has_remote = sync_info(root)
  if not name:
    return False, "No hay rama"
  if not has_remote:
    return False, "Este repositorio no tiene remoto: agrega uno con git remote add"
  env = dict(os.environ, GIT_TERMINAL_PROMPT="0")
  env.setdefault("GIT_SSH_COMMAND", "ssh -o BatchMode=yes")
  args = ["push"] if has_upstream else ["push", "-u", "origin", name]
  try:
    out = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True, timeout=120,
                         stdin=subprocess.DEVNULL, env=env, creationflags=_FLAGS)
  except (OSError, subprocess.SubprocessError) as e:
    return False, str(e)
  text = (out.stderr or out.stdout).strip()   # git escribe el progreso de push en stderr
  return out.returncode == 0, text


@dataclass(frozen=True)
class Branch:
  name: str              # "master" o "origin/master"
  remote: bool
  current: bool
  commit: str            # hash corto del último commit
  author: str
  subject: str
  timestamp: int         # fecha del último commit (segundos)
  ahead: int = 0         # solo la rama actual: commits por subir / por bajar
  behind: int = 0
  has_upstream: bool = False


def branches(root):
  """Ramas locales y remotas con su último commit, la actual primero."""
  fmt = "%1f".join(["%(HEAD)", "%(refname)", "%(objectname:short)", "%(authorname)", "%(committerdate:unix)", "%(subject)"])
  out = _git(root, "for-each-ref", "--sort=-committerdate", f"--format={fmt}%1e", "refs/heads", "refs/remotes")
  if not out:
    return []
  result = []
  for record in out.split("\x1e"):
    fields = record.strip("\n").split("\x1f")
    if len(fields) < 6:
      continue
    head, ref, commit, author, ts, subject = fields[:6]
    remote = ref.startswith("refs/remotes/")
    name = ref.split("refs/remotes/", 1)[1] if remote else ref.split("refs/heads/", 1)[1]
    if name.endswith("/HEAD"):
      continue
    current = head.strip() == "*"
    ahead = behind = 0
    upstream = False
    if current:
      counts = _git(root, "rev-list", "--left-right", "--count", "@{u}...HEAD")
      if counts and len(counts.split()) == 2:
        behind, ahead = (int(n) for n in counts.split())
        upstream = True
    result.append(Branch(name, remote, current, commit, author, subject, int(ts or 0), ahead, behind, upstream))
  result.sort(key=lambda b: (not b.current, b.remote, -b.timestamp))
  return result


def checkout(root, name, remote=False):
  """Cambia de rama. Una remota (origin/x) se convierte en rama local que la sigue."""
  if not remote:
    return _run(root, "checkout", name)
  local = name.split("/", 1)[1] if "/" in name else name
  exists = _run(root, "rev-parse", "--verify", "--quiet", f"refs/heads/{local}")[0]
  return _run(root, "checkout", local) if exists else _run(root, "checkout", "--track", name)


def create_branch(root, name, start=None):
  """Crea una rama y cambia a ella (opcionalmente a partir de otra)."""
  return _run(root, "checkout", "-b", name, *([start] if start else []))


def diff_marks(path):
  """Marcas del margen para un archivo: ({línea: 'added'|'modified'|'deleted'}, ¿archivo nuevo sin seguimiento?).

  Compara el archivo con el último commit (HEAD). Las líneas son 1-based, en el archivo actual.
  Un `deleted` va en la línea siguiente a la que se borró.
  """
  from pathlib import Path
  path = Path(path)
  if not shutil.which("git") or not path.is_file():
    return {}, False
  root = path.parent
  tracked = _git(root, "ls-files", "--error-unmatch", "--", path.name)
  if tracked is None:
    inside = _git(root, "rev-parse", "--is-inside-work-tree")
    return {}, bool(inside and inside.strip() == "true")       # sin seguimiento (nuevo): todo cuenta como añadido
  out = _git(root, "diff", "-U0", "--no-color", "--no-ext-diff", "HEAD", "--", path.name)
  if out is None:                                                  # repositorio sin commits todavía
    out = _git(root, "diff", "-U0", "--no-color", "--no-ext-diff", "--", path.name) or ""
  marks = {}
  for header in re.findall(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", out, flags=re.M):
    old_count = int(header[1]) if header[1] != "" else 1
    new_start = int(header[2])
    new_count = int(header[3]) if header[3] != "" else 1
    if new_count == 0:
      marks[new_start + 1] = "deleted"
    else:
      for i in range(new_count):
        marks[new_start + i] = "modified" if i < old_count else "added"
  return marks, False
