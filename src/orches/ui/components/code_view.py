from flet import Container, Row, Text, TextSpan, TextStyle, ListView, Padding, ScrollMode, CrossAxisAlignment
from orches.ui.syntax import COLORS, highlight, spans
from orches.ui.terminal.view import FONT

MUTED = "#6B7088"
FONT_SIZE = 12
LINE_HEIGHT = FONT_SIZE * 1.35          # alto de cada línea (px)
CHAR_WIDTH = FONT_SIZE * 0.602          # ancho de un carácter monoespaciado (px)
TOP_PAD, LEFT_PAD = 6, 10

# marcas del margen de git, como en VS Code
MARK_COLORS = {"added": "#73C991", "modified": "#4FA3E0", "deleted": "#E4676B"}
MARK_GLYPHS = {"added": "▎", "modified": "▎", "deleted": "▾"}


def gutter_chars(line_count):
  """Caracteres que ocupa el margen (marca + números + separación)."""
  return 1 + len(str(line_count)) + 2


def code_view(text, language="sql", marks=None, all_added=False, on_scroll=None):
  """Código con números de línea, marcas de git y colores (una sola línea de texto por fila: aguanta miles de líneas)."""
  lines = highlight(text, language)
  width = len(str(len(lines)))
  muted = TextStyle(color=MUTED)
  marks = marks or {}
  rows = []
  for n, tokens in enumerate(lines, start=1):
    kind = "added" if all_added else marks.get(n)
    gutter = TextSpan(MARK_GLYPHS[kind] if kind else " ", style=TextStyle(color=MARK_COLORS[kind])) if kind else TextSpan(" ")
    rows.append(Text(spans=[gutter, TextSpan(f"{n:>{width}}  ", style=muted), *spans(tokens)], font_family=FONT,
                     size=FONT_SIZE, no_wrap=True, color=COLORS["plain"], style=TextStyle(height=1.35, letter_spacing=0)))
  longest = max((len(l) for l in text.splitlines()), default=0) + gutter_chars(len(lines)) + 2
  wide = max(400, int(longest * CHAR_WIDTH) + 24)          # ancho de la línea más larga: scroll horizontal
  return Row(scroll=ScrollMode.AUTO, expand=True, vertical_alignment=CrossAxisAlignment.STRETCH, controls=[
    Container(width=wide, content=ListView(controls=rows, expand=True, spacing=0, on_scroll=on_scroll,
                                          padding=Padding(left=LEFT_PAD, right=10, top=TOP_PAD, bottom=10)))])
