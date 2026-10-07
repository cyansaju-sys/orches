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
