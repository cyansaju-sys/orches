import os
import shutil
import threading

IS_WINDOWS = os.name == "nt"

if IS_WINDOWS:
  from winpty import PtyProcess  # paquete pywinpty
else:
  import fcntl
  import pty
  import signal
  import struct
  import termios
  import warnings


# Variables de sesión de Claude Code: si la app se lanza desde dentro de Claude Code, un
# agente hijo las heredaría y se comportaría como sesión anidada.
SESSION_VARS = (
  "CLAUDECODE", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SESSION_ATTENDED", "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_EMIT_STARTUP_TIMING", "CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING",
  "CLAUDE_AGENT_SDK_VERSION", "CLAUDE_PID",
)


def _system_temp():
  if os.name == "nt":
    return os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "Temp")
  return "/tmp"


def child_env():
  """Entorno del agente: sin variables de sesión ajenas y sin el directorio temporal de Flet.

  Flet apunta TMPDIR a `.flet/storage/temp`, dentro del proyecto. Agentes como Claude Code
  (Bun) extraen ahí archivos al arrancar, y `flet run -r` interpreta eso como un cambio de
  código y reinicia la app, matando al agente.
  """
  env = {}
  for k, v in os.environ.items():
    if k in SESSION_VARS or k.startswith("FLET_"):
      continue
    env[k] = v
  for k in ("TMPDIR", "TMP", "TEMP"):
    if ".flet" in env.get(k, ""):
      env[k] = _system_temp()
  env.update(TERM="xterm-256color", COLORTERM="truecolor")
  return env


def default_shell():
  """Shell del usuario: $SHELL en Linux/macOS, PowerShell o cmd en Windows."""
  if os.name == "nt":
    return shutil.which("pwsh") or shutil.which("powershell") or os.environ.get("COMSPEC", "cmd")
  return os.environ.get("SHELL") or shutil.which("bash") or "sh"


class SpawnError(Exception):
  """El proceso no se pudo iniciar: el mensaje es legible para mostrarlo al usuario."""


def exit_message(name, code):
  """(texto, tipo de aviso) para cuando un proceso termina; tipo: "info" o "error"."""
  if code == 0:
    return f"«{name}» terminó", "info"
  if code == 127:
    return f"No se pudo iniciar «{name}»: comando no encontrado", "error"
  if code is not None and code < 0:
    return f"«{name}» se cerró por una señal ({-code})", "error"
  return f"«{name}» terminó con código {code}" if code is not None else f"«{name}» terminó", "error"


class PtySession:
  """Proceso conectado a un pseudo-terminal (pty en Linux/macOS, ConPTY en Windows)."""

  def __init__(self, command, cwd, rows=24, cols=80, args=(), env=None):
    self.command = command
    self.args = list(args)
    self.extra_env = dict(env or {})
    self.cwd = str(cwd)
    self.rows = rows
    self.cols = cols
    self.alive = False
    self._pid = None
    self._fd = None
    self._proc = None
    self.killed = False       # lo cerró la app (no es un fallo del proceso)

  def start(self, on_data, on_exit):
    """Lanza el comando. `on_data(bytes)` se llama desde un hilo lector; `on_exit(código)` al terminar.

    Lanza `SpawnError` (con un mensaje legible) si el comando o la carpeta no existen o no se pudo abrir.
    """
    exe = shutil.which(self.command)
    if exe is None:
      if os.sep in self.command or (os.altsep and os.altsep in self.command):
        exe = self.command if os.path.isfile(self.command) else None
      if exe is None:
        raise SpawnError(f"No se encontró «{self.command}»: instálalo o revisa que esté en el PATH")
    if not os.path.isdir(self.cwd):
      raise SpawnError(f"La carpeta «{self.cwd}» no existe")
    if IS_WINDOWS:
      argv = ["cmd", "/c", exe, *self.args] if exe.lower().endswith((".cmd", ".bat")) else [exe, *self.args]
      try:
        self._proc = PtyProcess.spawn(argv, cwd=self.cwd, env={**child_env(), **self.extra_env}, dimensions=(self.rows, self.cols))
      except Exception as e:
        raise SpawnError(f"No se pudo iniciar «{self.command}»: {e}")
      reader = self._read_windows
    else:
      env = {**child_env(), **self.extra_env}
      try:
        with warnings.catch_warnings():
          warnings.simplefilter("ignore", DeprecationWarning)
          pid, fd = pty.fork()
      except OSError as e:
        raise SpawnError(f"No se pudo crear el terminal: {e}")
      if pid == 0:
        try:
          os.chdir(self.cwd)
          os.execvpe(exe, [exe, *self.args], env)
        finally:
          os._exit(127)
      self._pid, self._fd = pid, fd
      self.resize(self.rows, self.cols)
      reader = self._read_unix
    self.alive = True
    threading.Thread(target=reader, args=(on_data, on_exit), daemon=True).start()

  def _read_unix(self, on_data, on_exit):
    while True:
      try:
        data = os.read(self._fd, 65536)
      except OSError:
        break
      if not data:
        break
      on_data(data)
    self.alive = False
    code = None
    try:
      code = os.waitstatus_to_exitcode(os.waitpid(self._pid, 0)[1])
    except (OSError, ChildProcessError):
      pass
    on_exit(code)

  def _read_windows(self, on_data, on_exit):
    while True:
      try:
        data = self._proc.read(65536)
      except EOFError:
        break
      if data:
        on_data(data.encode("utf-8", "replace"))
    self.alive = False
    on_exit(getattr(self._proc, "exitstatus", None))

  def write(self, text):
    if not self.alive:
      return
    try:
      if IS_WINDOWS:
        self._proc.write(text)
      else:
        os.write(self._fd, text.encode("utf-8"))
    except OSError:
      pass

  def resize(self, rows, cols):
    self.rows, self.cols = rows, cols
    try:
      if IS_WINDOWS:
        if self._proc:
          self._proc.setwinsize(rows, cols)
      elif self._fd is not None:
        fcntl.ioctl(self._fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    except OSError:
      pass

  def kill(self):
    if not self.alive:
      return
    self.alive = False
    self.killed = True
    try:
      if IS_WINDOWS:
        self._proc.terminate(force=True)
      else:
        os.kill(self._pid, signal.SIGHUP)
    except OSError:
      pass
