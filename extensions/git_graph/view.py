import asyncio
from pathlib import Path
import flet.canvas as cv
from flet import (
  AlertDialog, Border, ClipBehavior, RoundedRectangleBorder, TextButton, TextField, Container, Column, Row, Text, Icon, Icons, Padding, Paint, PaintingStyle, ScrollMode, FontWeight, TextOverflow,
  CrossAxisAlignment, MainAxisAlignment, StrokeCap,
)
from orches.core import settings
from orches.ui.components.clickable import Clickable, IconAction
from orches.ui.components.clipboard import copy_text
from orches.ui.components.modal import set_typing, show_modal
from orches.ui.terminal.view import FONT
from orches.ui.theme import ACCENT, ACCENT_BG, BORDER_COLOR
from . import graph
from orches.ui.components.toast import toast as show_toast

MUTED = "#6B7088"
TEXT = "#E6E8EF"
ERROR = "#FF6B81"
CARD = "#11141D"
SELECT_BG = ACCENT_BG      # el mismo morado de selección que el resto de la interfaz
PALETTE = ["#A78BFA", "#38BDF8", "#F0B67F", "#7CCB8B", "#F07178", "#82AAFF", "#FFCB6B", "#4CC9B0"]
REF_COLORS = {"head": "#E2C08D", "branch": "#7CCB8B", "remote": "#82AAFF", "tag": "#FFCB6B"}
LANE_W = 16
ROW_H = 28
MERGE_TEXT = "#7B8099"      # el mensaje de un merge se atenúa: importa menos que los commits reales
PAGE = 300           # commits que se cargan cada vez
MAX_LANES = 8        # más carriles de estos no caben en la barra lateral


def _color(lane):
  return PALETTE[lane % len(PALETTE)]


def GitGraphView(page, open_document):
  """Historial del proyecto como grafo de ramas: cada fila es un commit; al pulsarla se abren sus detalles."""
  state = {"attached": False, "gone": False, "root": None, "commits": [], "carry": [], "selected": None, "signature": None, "more": False, "error": "", "busy": False}
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

  def chip(name, kind, lane):
    """Etiqueta de rama, remoto o tag: recuadro del color del carril con un ícono a la izquierda."""
    color = REF_COLORS["head"] if kind == "head" else _color(lane)
    icon = {"branch": Icons.CALL_SPLIT, "remote": Icons.CLOUD_OUTLINED, "tag": Icons.LABEL, "head": Icons.MY_LOCATION}[kind]
    return Container(
      border=Border.all(1, color), border_radius=5, bgcolor="#151925", clip_behavior=ClipBehavior.HARD_EDGE,
      content=Row(spacing=0, controls=[
        Container(content=Icon(icon, size=11, color="#07080C"), bgcolor=color, padding=Padding(left=3, right=3, top=2, bottom=2)),
        Container(content=Text(name, size=11, color=TEXT, no_wrap=True), padding=Padding(left=5, right=6))]))

  def cell(text, width, color=MUTED, mono=False):
    return Container(width=width, content=Text(text, size=11, color=color, no_wrap=True, overflow=TextOverflow.ELLIPSIS,
                                               font_family=FONT if mono else None))

  def row(c, width):
    merge = len(c.parents) > 1
    refs = [chip(n, k, c.lane) for n, k in c.refs if n != "HEAD" or not any(r[1] == "branch" for r in c.refs)]
    return Clickable(
      Row(spacing=6, vertical_alignment=CrossAxisAlignment.CENTER, controls=[
        drawing(c, width),
        Row(spacing=6, expand=True, vertical_alignment=CrossAxisAlignment.CENTER, controls=[
          *refs[:3],
          Text(c.subject, size=12, color=MERGE_TEXT if merge else TEXT, no_wrap=True, overflow=TextOverflow.ELLIPSIS,
               expand=True)]),
        cell(c.date, 84), cell(c.author, 120), cell(c.hash[:8], 62, mono=True)]),
      lambda e, c=c: show(c), on_secondary_tap=lambda e, c=c: menu(c), hover_bg=SELECT_BG,
      bgcolor=SELECT_BG if c.hash == state["selected"] else None,
      tooltip=f"{c.subject}\n{c.hash}\n{c.author} · {c.when}", height=ROW_H,
      padding=Padding(right=8), border_radius=4)

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
        state["head"] = state["signature"][1].strip() if state["signature"] else None
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

  # --- menú del clic derecho: operaciones de git sobre un commit ----------------------------------------------
  def dialog(heading, content, actions):
    return AlertDialog(modal=True, title=Text(heading, size=14, weight=FontWeight.W_600), content=content, actions=actions,
                       shape=RoundedRectangleBorder(radius=10), bgcolor=CARD)

  def toast(message):
    show_toast(page, message)

  def option(icon, label, on_click, color=TEXT):
    return Clickable(Row(spacing=10, controls=[Icon(icon, size=16, color=color if color != TEXT else MUTED),
                                               Text(label, size=12, color=color, expand=True)]),
                     on_click, hover_bg=SELECT_BG, padding=Padding(left=10, right=10, top=8, bottom=8), border_radius=6)

  def report(heading, text):
    """Resultado de un comando que falló (o que dejó un conflicto), con la salida de git para poder copiarla."""
    async def copy():
      await copy_text(page, text)
      toast("Copiado")
    close = show_modal(page, dialog(heading, Container(width=480, content=Column(
      tight=True, scroll=ScrollMode.AUTO, height=min(300, 40 + 16 * len(text.splitlines())),
      controls=[Text(text or "Sin detalles", size=11, color=ERROR, font_family=FONT, selectable=True)])),
      [TextButton("Copiar", icon=Icons.CONTENT_COPY, on_click=lambda e: page.run_task(copy)),
       TextButton("Cerrar", on_click=lambda e: close())]))

  def confirm(heading, message, accept_label, on_accept):
    close = show_modal(page, dialog(heading, Container(width=380, content=Text(message, size=12, color=MUTED)),
                                    [TextButton("Cancelar", on_click=lambda e: close()),
                                     TextButton(accept_label, on_click=lambda e: (close(), on_accept()))]))

  def ask_name(heading, label, on_accept):
    name = TextField(label=label, dense=True, autofocus=True, text_size=12, cursor_color=ACCENT,
                     on_focus=lambda e: set_typing(True), on_blur=lambda e: set_typing(False))

    def accept(e=None):
      if name.value and name.value.strip():
        set_typing(False)
        close()
        on_accept(name.value.strip())

    name.on_submit = accept
    close = show_modal(page, dialog(heading, Container(width=340, content=name),
                                    [TextButton("Cancelar", on_click=lambda e: (set_typing(False), close())),
                                     TextButton("Crear", on_click=accept)]))

  async def execute(heading, *args):
    ok, output = await asyncio.to_thread(graph.run, state["root"], *args)
    await load()
    if ok:
      toast(heading)
    else:
      report(f"{heading}: falló" if "CONFLICT" not in output else f"{heading}: hay conflictos", output)

  def do(heading, *args):
    page.run_task(execute, heading, *args)

  def reset_menu(c, current):
    close = show_modal(page, dialog(f"Reset de «{current}» a {c.hash[:7]}", Container(width=380, content=Column(tight=True, spacing=2, controls=[
      option(Icons.UNDO, "Soft: mueve la rama y conserva todos los cambios preparados", lambda e: (close(), do("Reset soft", "reset", "--soft", c.hash))),
      option(Icons.UNDO, "Mixed: conserva los cambios pero sin preparar", lambda e: (close(), do("Reset mixed", "reset", "--mixed", c.hash))),
      option(Icons.DELETE_FOREVER, "Hard: descarta los cambios sin guardar", lambda e: (close(), confirm(
        "Reset hard", f"Se perderán los cambios sin commit y «{current}» volverá a {c.hash[:7]}. No se puede deshacer.",
        "Descartar y resetear", lambda: do("Reset hard", "reset", "--hard", c.hash))), color=ERROR)])),
      [TextButton("Cancelar", on_click=lambda e: close())]))

  def menu(c):
    """Clic derecho sobre un commit: cambiar de rama, merge, cherry-pick, revert, reset, ramas y etiquetas."""
    select(c)
    root_dir = state["root"]
    current = graph.current_branch(root_dir)
    operation = graph.in_progress(root_dir)
    branches = [n for n, k in c.refs if k == "branch"]
    short = c.hash[:7]
    items = []

    def add(icon, label, fn, color=TEXT):
      items.append(option(icon, label, lambda e, fn=fn: (close(), fn()), color))

    if operation:
      add(Icons.CANCEL, f"Abortar {operation} en curso", lambda: do(f"{operation} abortado", operation, "--abort"), ERROR)
    add(Icons.CONTENT_COPY, "Copiar hash", lambda: page.run_task(copy_hash, c.hash))
    for b in branches:
      if b != current:
        add(Icons.CALL_SPLIT, f"Cambiar a la rama «{b}»", lambda b=b: do(f"Ahora en «{b}»", "checkout", b))
        if current:
          add(Icons.CALL_MERGE, f"Merge «{b}» en «{current}»", lambda b=b: confirm(
            "Merge", f"Se hará merge de «{b}» en «{current}».", "Merge", lambda: do(f"Merge de «{b}» hecho", "merge", "--no-edit", b)))
    if c.hash != state.get("head"):
      add(Icons.COMMIT, f"Cambiar a este commit ({short}, HEAD suelto)", lambda: do(f"Ahora en {short}", "checkout", c.hash))
    add(Icons.ACCOUNT_TREE, "Crear rama aquí…", lambda: ask_name(
      f"Rama nueva en {short}", "Nombre de la rama", lambda n: do(f"Rama «{n}» creada", "checkout", "-b", n, c.hash)))
    add(Icons.LABEL, "Crear etiqueta aquí…", lambda: ask_name(
      f"Etiqueta nueva en {short}", "Nombre de la etiqueta", lambda n: do(f"Etiqueta «{n}» creada", "tag", n, c.hash)))
    if current and c.hash != state.get("head"):
      if not branches or all(b == current for b in branches):
        add(Icons.CALL_MERGE, f"Merge este commit en «{current}»", lambda: confirm(
          "Merge", f"Se hará merge de {short} en «{current}».", "Merge", lambda: do(f"Merge de {short} hecho", "merge", "--no-edit", c.hash)))
      add(Icons.CONTENT_PASTE, f"Cherry-pick de {short} en «{current}»", lambda: confirm(
        "Cherry-pick", f"Se copiará {short} como un commit nuevo en «{current}».", "Cherry-pick",
        lambda: do("Cherry-pick hecho", "cherry-pick", c.hash)))
      add(Icons.REPLAY, f"Revert de {short}", lambda: confirm(
        "Revert", f"Se creará un commit que deshace {short} en «{current}».", "Revert",
        lambda: do("Revert hecho", "revert", "--no-edit", c.hash)))
      add(Icons.HISTORY, f"Reset de «{current}» a este commit…", lambda: reset_menu(c, current), ERROR)
    close = show_modal(page, dialog(f"{short} · {c.subject[:36]}", Container(width=340, content=Column(
      tight=True, spacing=0, controls=items)), [TextButton("Cerrar", on_click=lambda e: close())]))

  async def copy_hash(value):
    await copy_text(page, value)
    toast("Hash copiado")

  def select(c):
    """Deja resaltada (en morado) la fila sobre la que se hizo clic."""
    state["selected"] = c.hash
    render()

  def show(c):
    select(c)
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
