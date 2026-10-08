"""PATH completo del usuario, para encontrar los agentes aunque la app no se haya lanzado desde una terminal.

Una app abierta desde el menú de aplicaciones, el escritorio o el Explorador no hereda el PATH que arma la shell
(`~/.bashrc`, `~/.zshrc`, nvm...). Ahí `claude` o `opencode` suelen estar en `~/.local/bin` o en la carpeta global de
npm, y `shutil.which` no los ve. Aquí se junta el PATH del proceso, el de la shell de login y las carpetas habituales.
"""
import glob
import os
import shutil
import subprocess
import threading

MARK = "__orches_path__"
_cache = {"value": None}
_lock = threading.Lock()


def _common_dirs():
  home = os.path.expanduser("~")
  if os.name == "nt":
    appdata = os.environ.get("APPDATA", os.path.join(home, "AppData", "Roaming"))
    local = os.environ.get("LOCALAPPDATA", os.path.join(home, "AppData", "Local"))
    return [
      os.path.join(home, ".local", "bin"), os.path.join(home, ".claude", "local"), os.path.join(appdata, "npm"),
      os.path.join(home, ".bun", "bin"), os.path.join(home, ".cargo", "bin"), os.path.join(home, "scoop", "shims"),
      os.path.join(local, "Microsoft", "WinGet", "Links"), os.path.join(local, "Programs", "claude"),
      os.path.join(local, "pnpm"), os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "nodejs"),
    ]
  return [
    os.path.join(home, ".local", "bin"), os.path.join(home, ".claude", "local"), os.path.join(home, ".npm-global", "bin"),
    os.path.join(home, ".bun", "bin"), os.path.join(home, ".cargo", "bin"), os.path.join(home, "go", "bin"),
    os.path.join(home, ".volta", "bin"), os.path.join(home, ".local", "share", "pnpm"),
    *sorted(glob.glob(os.path.join(home, ".nvm", "versions", "node", "*", "bin")), reverse=True),
    "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/snap/bin",
  ]


def _login_shell_path():
  """PATH que ve una shell interactiva de login (donde están nvm, asdf, mise...). Vacío si no se puede leer."""
  if os.name == "nt":
    return ""
  shell = os.environ.get("SHELL") or shutil.which("bash")
  if not shell:
    return ""
  try:
    result = subprocess.run([shell, "-ilc", f'printf "{MARK}%s{MARK}" "$PATH"'], capture_output=True, text=True,
                            timeout=4, stdin=subprocess.DEVNULL)
  except (OSError, subprocess.SubprocessError):
    return ""
  parts = result.stdout.split(MARK)
  return parts[1] if len(parts) >= 3 else ""


def extended_path():
  """PATH del proceso + el de la shell de login + carpetas habituales, sin repetidos y solo las que existen."""
  with _lock:
    if _cache["value"] is None:
      candidates = [*os.environ.get("PATH", "").split(os.pathsep), *_login_shell_path().split(os.pathsep), *_common_dirs()]
      seen, kept = set(), []
      for folder in candidates:
        if folder and folder not in seen and os.path.isdir(folder):
          seen.add(folder)
          kept.append(folder)
      _cache["value"] = os.pathsep.join(kept)
    return _cache["value"]


def which(command):
  """Como `shutil.which`, pero con el PATH ampliado."""
  return shutil.which(command, path=extended_path())


def reset():
  _cache["value"] = None
