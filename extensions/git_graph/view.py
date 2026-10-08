import asyncio
from pathlib import Path
import flet.canvas as cv
from flet import (
  Container, Column, Row, Text, Icon, Icons, Padding, Paint, PaintingStyle, ScrollMode, FontWeight, TextOverflow,
  CrossAxisAlignment, MainAxisAlignment, StrokeCap,
)
from orches.core import settings
from orches.ui.components.clickable import Clickable, IconAction
from orches.ui.components.clipboard import copy_text
from orches.ui.terminal.view import FONT
from orches.ui.theme import ACCENT, ACCENT_BG, BORDER_COLOR
from . import graph

MUTED = "#6B7088"
TEXT = "#E6E8EF"
ERROR = "#FF6B81"
PALETTE = ["#22D3EE", "#C792EA", "#F0B67F", "#7CCB8B", "#F07178", "#82AAFF", "#FFCB6B", "#4CC9B0"]
REF_COLORS = {"head": "#E2C08D", "branch": "#7CCB8B", "remote": "#82AAFF", "tag": "#FFCB6B"}
LANE_W = 14
ROW_H = 40
PAGE = 300           # commits que se cargan cada vez
MAX_LANES = 8        # más carriles de estos no caben en la barra lateral


def _color(lane):
  return PALETTE[lane % len(PALETTE)]


def GitGraphView(page, open_document):
  """Historial del proyecto como grafo de ramas: cada fila es un commit; al pulsarla se abren sus detalles."""
  state = {"attached": False, "gone": False, "root": None, "commits": [], "carry": [], "signature": None, "more": False, "error": "", "busy": False}
  rows = Column(spacing=0, scroll=ScrollMode.AUTO, expand=True)
  title = Text("Git Graph", size=12, weight=FontWeight.W_600, color=TEXT)

  def root():
    value = settings.get("project")
    return Path(value) if value and Path(value).is_dir() else None

  def lane_x(lane):
    return 6 + min(lane, MAX_LANES - 1) * LANE_W

  def stroke(x1, y1, x2, y2, color):
    return cv.Line(x1, y1, x2, y2, paint=Paint(color=color, stroke_width=2, style=PaintingStyle.STROKE, stroke_cap=StrokeCap.ROUND))

  def drawing(c, width):
    mid = ROW_H / 2
    shapes = []
    for a, b, color in c.top:
      shapes.append(stroke(lane_x(a), 0, lane_x(b), mid, _color(color)))
    for lane in c.through:
      shapes.append(stroke(lane_x(lane), 0, lane_x(lane), ROW_H, _color(lane)))
    for a, b, color in c.bottom:
      shapes.append(stroke(lane_x(a), mid, lane_x(b), ROW_H, _color(color)))
    merge = len(c.parents) > 1
    shapes.append(cv.Circle(lane_x(c.lane), mid, 4.5, Paint(color=_color(c.lane), style=PaintingStyle.FILL)))
    if merge:        # un merge se ve con un centro oscuro
      shapes.append(cv.Circle(lane_x(c.lane), mid, 2, Paint(color="#11141D", style=PaintingStyle.FILL)))
    return cv.Canvas(shapes=shapes, width=width, height=ROW_H)

  def chip(name, kind):
    return Container(content=Text(name, size=9, color="#07080C", weight=FontWeight.W_600, no_wrap=True),
                     bgcolor=REF_COLORS[kind], border_radius=8, padding=Padding(left=6, right=6, top=1, bottom=1))

  def row(c, width):
    refs = [chip(n, k) for n, k in c.refs if n != "HEAD" or not any(r[1] == "branch" for r in c.refs)]
    return Clickable(
      Row(spacing=4, vertical_alignment=CrossAxisAlignment.CENTER, controls=[
        drawing(c, width),
        Column(spacing=1, expand=True, alignment=MainAxisAlignment.CENTER, controls=[
          Row(spacing=4, controls=[*refs[:3], Text(c.subject, size=12, color=TEXT, no_wrap=True,
                                                   overflow=TextOverflow.ELLIPSIS, expand=True)]),
          Text(f"{c.hash[:7]} · {c.author} · {c.when}", size=10, color=MUTED, no_wrap=True,
               overflow=TextOverflow.ELLIPSIS)])]),
      lambda e, c=c: show(c), hover_bg=ACCENT_BG, tooltip=f"{c.subject}\n{c.hash}", height=ROW_H,
      padding=Padding(right=6), border_radius=4)

  def render(update=True):
    commits = state["commits"]
    if state["error"]:
      controls = [Container(padding=Padding(left=8, top=8), content=Text(state["error"], size=11, color=MUTED))]
    else:
      width = min(max((c.width for c in commits), default=1), MAX_LANES) * LANE_W + 4
      controls = [row(c, width) for c in commits]
      if state["more"]:
        controls.append(Clickable(Text("Cargar más commits", size=11, color=ACCENT), lambda e: page.run_task(load, True),
                                  hover_bg=ACCENT_BG, padding=Padding(left=10, top=8, bottom=8), border_radius=4))
    rows.controls = controls
    if update:
      try:
        rows.update()
        state["attached"] = True
      except RuntimeError:
        state["gone"] = state["attached"]       # la pestaña se cerró: el vigilante termina

  async def load(more=False):
    """Lee el historial (en un hilo, para no congelar la ventana). Con `more` añade los siguientes commits."""
    if state["busy"]:
      return
    state["busy"] = True
    try:
      folder = root()
      state["root"] = folder
      if folder is None:
        state.update(commits=[], error="Abre un proyecto para ver su historial", more=False)
      else:
        skip = len(state["commits"]) if more else 0
        found = await asyncio.to_thread(graph.log, folder, PAGE, skip)
        if found is None:
          state.update(commits=[], error="Esta carpeta no es un repositorio git", more=False)
        else:
          carry = state["carry"] if more else []
          state["carry"] = graph.layout(found, carry)
          state["commits"] = (state["commits"] if more else []) + found
          state.update(error="", more=len(found) == PAGE)
        state["signature"] = await asyncio.to_thread(graph.signature, folder) if folder else None
      title.value = f"Git Graph · {folder.name}" if folder else "Git Graph"
      try:
        title.update()
      except RuntimeError:
        pass
      render()
    finally:
      state["busy"] = False

  async def watch():
    """Cada pocos segundos mira si cambió alguna rama y repinta el grafo."""
    while True:
      await asyncio.sleep(4)
      if state["gone"]:
        return
      folder = root()
      if folder is None or state["busy"]:
        continue
      if folder != state["root"] or await asyncio.to_thread(graph.signature, folder) != state["signature"]:
        await load()

  def show(c):
    """Detalles del commit en una pestaña del editor."""
    info = graph.details(state["root"], c.hash)
    if info is None:
      return
    open_document(f"{c.hash[:7]} · {c.subject[:30]}", Icons.COMMIT, lambda: details_view(info),
                  key=f"commit:{state['root']}:{c.hash}", crumbs=["Git Graph", c.hash[:7]], path=None)

  def details_view(info):
    mono = dict(font_family=FONT, size=12, selectable=True)
    async def copy():
      await copy_text(page, info["hash"])
    return Container(expand=True, padding=16, content=Column(expand=True, scroll=ScrollMode.AUTO, spacing=10, controls=[
      Row(controls=[Text(info["message"].splitlines()[0] if info["message"] else "", size=15, weight=FontWeight.W_600,
                         color=TEXT, expand=True, selectable=True),
                    IconAction(Icons.CONTENT_COPY, lambda e: page.run_task(copy), size=14, color=MUTED, hover_color=ACCENT,
                               hover_bg=ACCENT_BG, width=28, height=28, tooltip="Copiar el hash")]),
      Text(f"{info['hash']}\n{info['author']} · {info['date']}", size=11, color=MUTED, selectable=True),
      Text("\n".join(info["message"].splitlines()[1:]).strip(), color=TEXT, **mono),
      Container(height=1, bgcolor=BORDER_COLOR),
      Text(info["files"] or "Sin cambios en archivos", color=TEXT, **mono)]))

  page.run_task(load)
  page.run_task(watch)

  view = Column(expand=True, spacing=4, controls=[
    Row(alignment=MainAxisAlignment.SPACE_BETWEEN, vertical_alignment=CrossAxisAlignment.CENTER, controls=[
      Container(content=title, padding=Padding(left=8), expand=True),
      IconAction(Icons.REFRESH, lambda e: page.run_task(load), size=16, color=MUTED, hover_color=ACCENT, hover_bg=ACCENT_BG,
                 width=28, height=28, tooltip="Actualizar")]),
    rows])
  return view
