import asyncio
from flet import (
  Container, Column, Row, Text, Icon, Icons, ListView, TextSpan, TextStyle, Padding, FontWeight,
  CrossAxisAlignment, MainAxisAlignment, ScrollMode, ProgressRing, SnackBar,
)
from .oracle import SINGULAR, DbError
from orches.ui.components.clickable import Clickable
from orches.ui.components.clipboard import copy_text
from orches.ui.components.code_view import code_view
from orches.ui.syntax import COLORS, highlight, spans
from orches.ui.terminal.view import FONT
from orches.ui.theme import ACCENT, ACCENT_BG, BORDER_COLOR, border_all

MUTED = "#6B7088"
TEXT = "#E6E8EF"
ERROR = "#FF6B81"
OK = "#7CCB8B"
FONT_SIZE = 12


def _chip(text, color=ACCENT):
  return Container(content=Text(text, size=10, color=color), padding=Padding(left=8, right=8, top=3, bottom=3),
                   border_radius=10, border=border_all(color=BORDER_COLOR))


def _section(title, controls):
  return Column(spacing=6, controls=[
    Text(title, size=10, weight=FontWeight.W_600, color=MUTED), *controls])


def table_view(info, ddl):
  """Columnas, restricciones, índices y DDL de una tabla."""
  columns = []
  for c in info.columns:
    columns.append(Container(padding=Padding(left=8, right=8, top=5, bottom=5), border_radius=6, border=border_all(),
      content=Column(spacing=2, controls=[
        Row(spacing=8, wrap=True, controls=[
          Text(c.name, size=12, weight=FontWeight.W_600, color=TEXT),
          Text(c.type, size=11, color=COLORS["type"]),
          Text("NOT NULL" if not c.nullable else "", size=10, color=ERROR),
        ]),
        *([Text(f"DEFAULT {c.default}", size=10, color=MUTED)] if c.default else []),
        *([Text(c.comment, size=10, color=MUTED)] if c.comment else []),
      ])))
  extra = []
  if info.constraints:
    extra.append(_section("RESTRICCIONES", [
      Text(f"{kind}: {name}  ({cols})" + (f"  {detail}" if detail else ""), size=11, color=TEXT)
      for name, kind, cols, detail in info.constraints]))
  if info.indexes:
    extra.append(_section("ÍNDICES", [
      Text(f"{name}{'  (único)' if uniq else ''}  ({cols})", size=11, color=TEXT) for name, uniq, cols in info.indexes]))
  sections = [
    *([Text(info.comment, size=12, color=MUTED)] if info.comment else []),
    _section(f"COLUMNAS · {len(info.columns)}", columns),
    *extra,
    _section("DDL", [Container(content=code_view(ddl), height=min(520, 22 + 18 * (ddl.count("\n") + 1)),
                               border=border_all(), border_radius=6)]),
  ]
  return Column(spacing=16, scroll=ScrollMode.AUTO, expand=True,
                controls=[Container(padding=Padding(left=12, right=12, top=8, bottom=16),
                                    content=Column(spacing=16, controls=sections))])


def ObjectViewer(page, session, owner, obj):
  """Contenido de un panel que muestra un objeto de la base: código fuente o detalle de tabla."""
  holder = Container(expand=True, content=Column(expand=True, alignment=MainAxisAlignment.CENTER,
                                                  horizontal_alignment=CrossAxisAlignment.CENTER, controls=[
    ProgressRing(width=22, height=22, stroke_width=2, color=ACCENT),
    Text(f"Cargando {obj.name}…", size=11, color=MUTED)]))
  state = {"text": ""}

  def toast(message):
    page.show_dialog(SnackBar(Text(message)))

  def toolbar(extra=None):
    return Container(padding=Padding(left=10, right=6, top=6, bottom=6), border=None, content=Row(
      wrap=True, run_spacing=4, alignment=MainAxisAlignment.SPACE_BETWEEN, vertical_alignment=CrossAxisAlignment.CENTER, controls=[
        Row(spacing=6, controls=[
          _chip(SINGULAR.get(obj.type, obj.type.title())),
          _chip("INVÁLIDO" if not obj.valid else "VÁLIDO", ERROR if not obj.valid else OK),
          *([Text(f"modificado {obj.modified}", size=10, color=MUTED)] if obj.modified else []),
          *(extra or []),
        ]),
        Row(spacing=0, controls=[
          Clickable(Row(spacing=4, controls=[Icon(Icons.CONTENT_COPY, size=14, color=MUTED), Text("Copiar", size=11, color=MUTED)]),
                    lambda e: page.run_task(copy), hover_bg=ACCENT_BG, padding=Padding(left=8, right=8, top=4, bottom=4),
                    border_radius=6),
          Clickable(Row(spacing=4, controls=[Icon(Icons.REFRESH, size=14, color=MUTED), Text("Recargar", size=11, color=MUTED)]),
                    lambda e: page.run_task(load), hover_bg=ACCENT_BG, padding=Padding(left=8, right=8, top=4, bottom=4),
                    border_radius=6),
        ]),
      ]))

  async def copy():
    await copy_text(page, state["text"])
    toast("Copiado")

  def read():
    """Todo lo que hay que pedir a la base (en un hilo, no en la interfaz)."""
    text = session.source(owner, obj.name, obj.type)
    info = session.table_details(owner, obj.name) if obj.type == "TABLE" else None
    errors = session.errors(owner, obj.name, obj.type) if not obj.valid else []
    return text, info, errors

  async def load():
    try:
      text, info, errors = await asyncio.to_thread(read)
    except DbError as e:
      holder.content = Column(expand=True, alignment=MainAxisAlignment.CENTER, horizontal_alignment=CrossAxisAlignment.CENTER,
                              controls=[Icon(Icons.ERROR_OUTLINE, size=28, color=ERROR), Text(str(e), size=12, color=ERROR)])
      holder.update()
      return
    state["text"] = text
    body = table_view(info, text) if info else code_view(text or "-- sin contenido")
    banner = [Container(margin=Padding(left=10, right=10, bottom=6), padding=10, border_radius=6, bgcolor="#2A1A22",
                        content=Column(spacing=2, controls=[
                          Text("Errores de compilación", size=11, weight=FontWeight.W_600, color=ERROR),
                          *[Text(f"línea {line}:{pos}  {message}", size=11, color=ERROR) for line, pos, message in errors[:8]],
                        ]))] if errors else []
    holder.content = Column(expand=True, spacing=0, controls=[toolbar(), *banner, body])
    try:
      holder.update()
    except RuntimeError:
      pass

  page.run_task(load)
  return holder
