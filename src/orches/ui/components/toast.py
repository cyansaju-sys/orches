import asyncio
from flet import (
  Border, BorderSide, Column, Container, CrossAxisAlignment, Icon, Icons, Padding, Row, Text, TextOverflow,
)
from orches.ui.theme import ACCENT, BORDER_COLOR

OK = "#7EE0A1"
ERROR = "#FF6B81"
WARN = "#E2C08D"
SECONDS = 3.5
MAX_VISIBLE = 4
ERROR_WORDS = ("no se pudo", "falló", "fallo", "error", "no es un", "no hay", "no se encontr")

_hosts = {}      # id(page) -> columna donde se apilan los avisos de esa ventana


def _kind(message):
  low = message.lower()
  if any(w in low for w in ERROR_WORDS):
    return "error"
  if any(w in low for w in ("copiad", "instalad", "creada", "creado", "hecho", "guardad", "ahora en")):
    return "ok"
  return "info"


def _host(page):
  host = _hosts.get(id(page))
  if host is None:
    host = _hosts[id(page)] = Column(spacing=8, tight=True, horizontal_alignment=CrossAxisAlignment.END)
    page.overlay.append(Container(content=host, right=16, bottom=16))
    page.update()
  return host


def toast(page, message, kind=None, seconds=SECONDS):
  """Aviso breve abajo a la derecha: se apila, se cierra solo a los pocos segundos o al pulsarlo."""
  message = str(message)
  kind = kind or _kind(message)
  color, icon = {"ok": (OK, Icons.CHECK_CIRCLE), "error": (ERROR, Icons.ERROR_OUTLINE)}.get(kind, (ACCENT, Icons.INFO_OUTLINE))
  host = _host(page)

  def dismiss(e=None):
    if item in host.controls:
      host.controls.remove(item)
      try:
        host.update()
      except RuntimeError:
        pass

  item = Container(
    width=340, bgcolor="#151925", border_radius=8, padding=Padding(left=12, right=12, top=10, bottom=10), on_click=dismiss,
    content=Row(spacing=10, vertical_alignment=CrossAxisAlignment.START, controls=[
      Icon(icon, size=16, color=color),
      Text(message, size=12, color="#E6E8EF", expand=True, max_lines=4, overflow=TextOverflow.ELLIPSIS, selectable=False)]))
  item.border = Border(left=BorderSide(3, color), top=BorderSide(1, BORDER_COLOR), right=BorderSide(1, BORDER_COLOR),
                       bottom=BorderSide(1, BORDER_COLOR))
  host.controls.append(item)
  del host.controls[:-MAX_VISIBLE]            # solo se ven los últimos avisos

  async def expire():
    await asyncio.sleep(seconds + (2 if kind == "error" else 0))
    dismiss()

  try:
    host.update()
  except RuntimeError:
    page.update()
  page.run_task(expire)
