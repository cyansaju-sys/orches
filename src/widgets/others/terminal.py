import asyncio
import os
import re
import threading
from collections import deque

import pyte
from flet import (
  Container, Column, Text, TextSpan, TextStyle, TextDecoration, FontWeight,
  ClipBehavior, CrossAxisAlignment, GestureDetector, Stack,
)
from utils.pty_session import PtySession
from utils.theme import ACCENT, ACCENT_DIM

FONT = "TermMono"  # DejaVu Sans Mono incluida en assets: métricas iguales en todos los sistemas
FONT_FILE = "fonts/DejaVuSansMono.ttf"
FONT_SIZE = 13
LINE_HEIGHT = 1.3
CELL_W = FONT_SIZE * 0.602          # ancho aproximado de un carácter monoespaciado
CELL_H = FONT_SIZE * LINE_HEIGHT
PAD = 8
FPS = 1 / 30
HISTORY = 5000   # líneas de historial
WHEEL_LINES = 3  # líneas por paso de la rueda
BLINK = 0.53  # segundos entre parpadeos del cursor
CURSOR_BG = ACCENT
CURSOR_IDLE_BG = ACCENT_DIM  # cursor del panel sin foco

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
  if os.environ.get("ORCHES_KEYLOG"):   # depuración: ORCHES_KEYLOG=1 muestra las teclas recibidas
    print(f"tecla={key!r} shift={e.shift} ctrl={e.ctrl} alt={e.alt}", flush=True)
  if key == "Tab" and e.shift:
    return "\x1b[Z"
  if key in KEYS:
    return KEYS[key]
  if len(key) == 1:
    if e.ctrl and e.alt:           # AltGr en Windows llega como Ctrl+Alt: es texto normal (@, |, €...)
      return key
    ch = key if (e.shift or not key.isalpha()) else key.lower()
    if e.ctrl and key.isalpha() and key.isascii():
      return chr(ord(key.upper()) - 64)
    if e.alt and key.isalnum() and key.isascii():   # Alt+letra = Meta (ESC delante)
      return "\x1b" + ch
    return ch                      # símbolos como @ # | ~ { } se envían tal cual, aunque lleguen con Alt/AltGr
  return ""


class ScrollScreen(pyte.Screen):
  """Pantalla de pyte que guarda las líneas que salen por arriba (historial)."""

  def __init__(self, columns, lines, history=HISTORY):
    self.scrollback = deque(maxlen=history)
    super().__init__(columns, lines)

  def index(self):
    top, bottom = self.margins or (0, self.lines - 1)
    if self.cursor.y == bottom and top == 0:
      line = self.buffer[0]
      self.scrollback.append([line[x] for x in range(self.columns)])
    super().index()


BLANK = pyte.screens.Char(" ")


class TerminalView:
  """Terminal embebida: pty + emulación con pyte, dibujada con controles de Flet."""

  def __init__(self, page, command, cwd, on_exit=None):
    self.page = page
    self.on_exit = on_exit
    self.rows, self.cols = 24, 80
    self.screen = ScrollScreen(self.cols, self.rows)
    self.offset = 0          # líneas desplazadas hacia atrás (0 = en vivo)
    self._full = False       # repintar todas las filas (tras desplazarse)
    self._height = 0
    self.stream = pyte.ByteStream(self.screen)
    self.session = PtySession(command, cwd, self.rows, self.cols)
    # respuestas a consultas del programa (posición del cursor, atributos del terminal...)
    self.screen.write_process_input = self.session.write
    self._cursor_row = 0
    self._lock = threading.Lock()
    self._dirty = False
    self.focused = True
    self._blink_on = True
    self._blink_t = 0.0
    self._lines = []
    self._mounted = False
    self._started = False

    self.column = Column(spacing=0, controls=[], horizontal_alignment=CrossAxisAlignment.STRETCH)
    self.container = Container(
      expand=True,
      padding=PAD,
      clip_behavior=ClipBehavior.HARD_EDGE,
      on_size_change=self._on_size,
      content=self.column,
    )
    self.thumb = Container(
      width=4, right=2, top=0, height=30, border_radius=2, bgcolor=ACCENT_DIM, visible=False,
    )
    self.control = GestureDetector(
      expand=True,
      on_scroll=self._on_wheel,
      content=Stack(expand=True, controls=[self.container, self.thumb]),
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
    self._height = e.height
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
      before = len(self.screen.scrollback)
      self.stream.feed(UNSUPPORTED.sub(b"", data))
      if self.offset:   # si estás leyendo el historial, la vista no se mueve
        self.offset = min(self.offset + len(self.screen.scrollback) - before, len(self.screen.scrollback))
        self._full = True
      self._dirty = True

  def _exited(self):
    self._on_data(b"\r\n\x1b[90m[proceso terminado]\x1b[0m")
    if self.on_exit:
      self.on_exit(self)

  async def _loop(self):
    """Redibuja ~30 veces por segundo, desde el bucle de eventos de Flet."""
    while self._mounted:
      await asyncio.sleep(FPS)
      if self.focused:
        self._blink_t += FPS
        if self._blink_t >= BLINK:
          self._blink_t = 0.0
          self._blink_on = not self._blink_on
          self._dirty = True
      if self._dirty:
        with self._lock:
          self._dirty = False
          self._render(update=False)
        self.control.update()

  # --- dibujo --------------------------------------------------------------
  def _row_chars(self, y):
    """Celdas de la fila visible `y`, del historial o de la pantalla según el desplazamiento."""
    history = self.screen.scrollback
    idx = len(history) - self.offset + y
    if idx < len(history):
      line = history[idx]
      return [line[x] if x < len(line) else BLANK for x in range(self.cols)]
    buf = self.screen.buffer[idx - len(history)]
    return [buf[x] for x in range(self.cols)]

  def _line_spans(self, y):
    chars = self._row_chars(y)
    cur = self.screen.cursor
    show_cursor = (y == cur.y) and not cur.hidden and self.offset == 0
    spans, run, key = [], [], None
    for x in range(self.cols):
      ch = chars[x]
      fg = _color(ch.fg, DEFAULT_FG)
      bg = theme_bg(_color(ch.bg, DEFAULT_BG))
      if ch.reverse:
        fg, bg = (bg or "#0D0F16"), fg
      glyph = ch.data or " "
      if show_cursor and x == cur.x:
        blank = glyph.strip() == ""
        if not self.focused:
          color = CURSOR_IDLE_BG          # sin foco: cursor tenue y fijo
        elif self._blink_on:
          color = CURSOR_BG
        else:
          color = None                    # fase apagada del parpadeo
        if color:
          if blank:
            glyph, fg, bg = "█", color, None   # el fondo de un espacio no siempre se pinta
          else:
            fg, bg = "#0D0F16", color
      k = (fg, bg, ch.bold, ch.italics, ch.underscore)
      if k != key and run:
        spans.append(self._span("".join(run), key))
        run = []
      key = k
      run.append(glyph)
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
    if self._full or self.offset:
      dirty = set(range(self.rows))
      self._full = False
    self._cursor_row = self.screen.cursor.y
    for y in dirty:
      if 0 <= y < len(self._lines):
        self._lines[y].spans = self._line_spans(y)
    self._update_thumb()
    if update and self._mounted:
      self.control.update()

  def _mouse_reporting(self):
    modes = self.screen.mode
    return any((m << 5) in modes for m in (1000, 1002, 1003))

  def _update_thumb(self):
    """Barra de desplazamiento: solo si hay historial y la app no maneja el mouse ella misma."""
    total = len(self.screen.scrollback)
    height = self._height
    if not total or not height or self._mouse_reporting():
      self.thumb.visible = False
      return
    size = max(24, height * self.rows / (total + self.rows))
    self.thumb.height = size
    self.thumb.top = (height - size) * (1 - self.offset / total)
    self.thumb.visible = True

  # --- rueda del mouse -------------------------------------------------------
  def _on_wheel(self, e):
    dy = e.scroll_delta.y
    if not dy:
      return
    up = dy < 0
    if self._mouse_reporting():
      # la app (Claude Code, OpenCode...) pide eventos de mouse: se le envía la rueda
      col = min(self.cols, max(1, int((e.local_position.x - PAD) / CELL_W) + 1))
      row = min(self.rows, max(1, int((e.local_position.y - PAD) / CELL_H) + 1))
      button = 64 if up else 65
      if (1006 << 5) in self.screen.mode:
        self.session.write(f"\x1b[<{button};{col};{row}M")
      else:
        self.session.write("\x1b[M" + chr(32 + button) + chr(32 + col) + chr(32 + row))
      return
    top = len(self.screen.scrollback)
    new = self.offset + (WHEEL_LINES if up else -WHEEL_LINES)
    new = max(0, min(top, new))
    if new != self.offset:
      self.offset = new
      self._full = True
      self._dirty = True

  # --- entrada / ciclo de vida ---------------------------------------------
  def set_focus(self, focused):
    self.focused = focused
    self._blink_on = True
    self._blink_t = 0.0
    self._dirty = True

  def send_key(self, e):
    text = key_to_text(e)
    if text:
      self._to_live()
      self._blink_on = True   # el cursor se queda fijo mientras escribes
      self._blink_t = 0.0
      self.session.write(text)

  def write_text(self, text):
    """Texto ya compuesto (AltGr, teclas muertas, métodos de entrada)."""
    self._to_live()
    self._blink_on = True
    self._blink_t = 0.0
    self.session.write(text)

  def _to_live(self):
    if self.offset:
      self.offset = 0
      self._full = True
      self._dirty = True

  def paste(self, text):
    self._to_live()
    self.session.write(text)

  def close(self):
    self._mounted = False
    self.session.kill()
