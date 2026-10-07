import asyncio
import re
import threading

import pyte
from flet import (
  Container, Column, Text, TextSpan, TextStyle, TextDecoration, FontWeight,
  ClipBehavior, CrossAxisAlignment,
)
from utils.pty_session import PtySession

FONT = "TermMono"  # DejaVu Sans Mono incluida en assets: métricas iguales en todos los sistemas
FONT_FILE = "fonts/DejaVuSansMono.ttf"
FONT_SIZE = 13
LINE_HEIGHT = 1.3
CELL_W = FONT_SIZE * 0.602          # ancho aproximado de un carácter monoespaciado
CELL_H = FONT_SIZE * LINE_HEIGHT
PAD = 8
FPS = 1 / 30

DEFAULT_FG = "#E6E8EF"
DEFAULT_BG = None  # transparente: se ve el fondo del panel

COLORS = {
  "black": "#1B1E28", "red": "#FF6B81", "green": "#7CCB8B", "brown": "#E5C07B",
  "blue": "#61AFEF", "magenta": "#B07CFF", "cyan": "#4CC9B0", "white": "#C8CCD8",
  "brightblack": "#6B7088", "brightred": "#FF8FA0", "brightgreen": "#9BE0A8",
  "brightbrown": "#F0D58E", "brightblue": "#82C0FF", "brightmagenta": "#C9A6FF",
  "brightcyan": "#7FE3CF", "brightwhite": "#FFFFFF",
}

# Secuencias que pyte no entiende y escribiría como texto o como atributos (kitty keyboard,
# modifyOtherKeys, XTVERSION, DECRQM...)
UNSUPPORTED = re.compile(rb"\x1b\[(?:[<>=][0-9;]*[A-Za-z]|\?[0-9;]*u|\??[0-9;]*\$p)")

KEYS = {
  "Enter": "\r", "Backspace": "\x7f", "Tab": "\t", "Escape": "\x1b", "Space": " ",
  "Arrow Up": "\x1b[A", "Arrow Down": "\x1b[B", "Arrow Right": "\x1b[C",
  "Arrow Left": "\x1b[D", "Home": "\x1b[H", "End": "\x1b[F", "Delete": "\x1b[3~",
  "Page Up": "\x1b[5~", "Page Down": "\x1b[6~", "Insert": "\x1b[2~",
}


def _color(name, default):
  if name == "default":
    return default
  if name in COLORS:
    return COLORS[name]
  if len(name) == 6:
    return "#" + name
  return default


PANEL_RGB = (0x0D, 0x0F, 0x16)  # fondo del panel de la app


def theme_bg(color):
  """Adapta fondos grises neutros de la TUI al tema: el casi negro pasa a transparente.

  OpenCode y similares pintan toda la pantalla con #0a0a0a, lo que tapa el fondo de la app.
  Los grises más claros (paneles, selección) se conservan pero teñidos con el tono del panel.
  """
  if not color or len(color) != 7:
    return color
  r, g, b = (int(color[i:i + 2], 16) for i in (1, 3, 5))
  if max(r, g, b) - min(r, g, b) > 12:   # tiene color propio: se respeta
    return color
  lum = (r + g + b) // 3
  if lum <= 0x10:
    return None
  if lum < 0x60:
    delta = (lum - 0x0A) // 2
    return "#%02X%02X%02X" % tuple(min(255, c + delta) for c in PANEL_RGB)
  return color


def key_to_text(e):
  """Convierte un evento de teclado de Flet en los bytes que espera una terminal."""
  key = e.key
  if key == "Tab" and e.shift:
    return "\x1b[Z"
  if key in KEYS:
    return KEYS[key]
  if len(key) == 1:
    ch = key if (e.shift or not key.isalpha()) else key.lower()
    if e.ctrl and key.isalpha():
      return chr(ord(key.upper()) - 64)
    if e.alt:
      return "\x1b" + ch
    return ch
  return ""


class TerminalView:
  """Terminal embebida: pty + emulación con pyte, dibujada con controles de Flet."""

  def __init__(self, page, command, cwd, on_exit=None):
    self.page = page
    self.on_exit = on_exit
    self.rows, self.cols = 24, 80
    self.screen = pyte.Screen(self.cols, self.rows)
    self.stream = pyte.ByteStream(self.screen)
    self.session = PtySession(command, cwd, self.rows, self.cols)
    # respuestas a consultas del programa (posición del cursor, atributos del terminal...)
    self.screen.write_process_input = self.session.write
    self._cursor_row = 0
    self._lock = threading.Lock()
    self._dirty = False
    self._lines = []
    self._mounted = False
    self._started = False

    self.column = Column(spacing=0, controls=[], horizontal_alignment=CrossAxisAlignment.STRETCH)
    self.control = Container(
      expand=True,
      padding=PAD,
      clip_behavior=ClipBehavior.HARD_EDGE,
      on_size_change=self._on_size,
      content=self.column,
    )
    self._build_lines()

  # --- tamaño -------------------------------------------------------------
  def _build_lines(self):
    self._lines = [
      Text(no_wrap=True, font_family=FONT, size=FONT_SIZE, color=DEFAULT_FG,
           style=TextStyle(height=LINE_HEIGHT))
      for _ in range(self.rows)
    ]
    self.column.controls = self._lines
    self.screen.dirty.update(range(self.rows))

  def _on_size(self, e):
    self._mounted = True
    cols = max(20, int((e.width - 2 * PAD) / CELL_W))
    rows = max(5, int((e.height - 2 * PAD) / CELL_H))
    if not self._started:
      self.rows, self.cols = rows, cols
      self.screen.resize(rows, cols)
      self._build_lines()
      self._started = True
      self.session.rows, self.session.cols = rows, cols
      self.session.start(self._on_data, self._exited)
      self._render(update=True)
      self.page.run_task(self._loop)
    elif (rows, cols) != (self.rows, self.cols):
      self.rows, self.cols = rows, cols
      self.screen.resize(rows, cols)
      self.session.resize(rows, cols)
      self._build_lines()
      self._render(update=True)

  # --- datos del proceso (hilo lector) ------------------------------------
  def _on_data(self, data):
    with self._lock:
      self.stream.feed(UNSUPPORTED.sub(b"", data))
      self._dirty = True

  def _exited(self):
    self._on_data(b"\r\n\x1b[90m[proceso terminado]\x1b[0m")
    if self.on_exit:
      self.on_exit(self)

  async def _loop(self):
    """Redibuja ~30 veces por segundo, desde el bucle de eventos de Flet."""
    while self._mounted:
      await asyncio.sleep(FPS)
      if self._dirty:
        with self._lock:
          self._dirty = False
          self._render(update=False)
        self.control.update()

  # --- dibujo --------------------------------------------------------------
  def _line_spans(self, y):
    buf = self.screen.buffer[y]
    cur = self.screen.cursor
    show_cursor = (y == cur.y) and not cur.hidden
    spans, run, key = [], [], None
    for x in range(self.cols):
      ch = buf[x]
      fg = _color(ch.fg, DEFAULT_FG)
      bg = theme_bg(_color(ch.bg, DEFAULT_BG))
      if ch.reverse:
        fg, bg = (bg or "#0D0F16"), fg
      if show_cursor and x == cur.x:
        fg, bg = "#0D0F16", "#8B7CFF"
      k = (fg, bg, ch.bold, ch.italics, ch.underscore)
      if k != key and run:
        spans.append(self._span("".join(run), key))
        run = []
      key = k
      run.append(ch.data or " ")
    if run:
      spans.append(self._span("".join(run), key))
    return spans

  @staticmethod
  def _span(text, key):
    fg, bg, bold, italic, underline = key
    return TextSpan(
      text,
      style=TextStyle(
        color=fg, bgcolor=bg,
        weight=FontWeight.BOLD if bold else None,
        italic=italic or None,
        decoration=TextDecoration.UNDERLINE if underline else None,
      ),
    )

  def _render(self, update):
    dirty = set(self.screen.dirty)
    dirty.add(self._cursor_row)
    dirty.add(self.screen.cursor.y)
    self.screen.dirty.clear()
    self._cursor_row = self.screen.cursor.y
    for y in dirty:
      if 0 <= y < len(self._lines):
        self._lines[y].spans = self._line_spans(y)
    if update and self._mounted:
      self.control.update()

  # --- entrada / ciclo de vida ---------------------------------------------
  def send_key(self, e):
    text = key_to_text(e)
    if text:
      self.session.write(text)

  def paste(self, text):
    self.session.write(text)

  def close(self):
    self._mounted = False
    self.session.kill()
