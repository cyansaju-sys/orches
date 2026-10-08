import asyncio
from pathlib import Path
from flet import (
  Container, Text, Image, Icon, Icons, Row, Column, Padding, ScrollMode,
  TextOverflow, ButtonStyle, TextButton, FontWeight, MainAxisAlignment, CrossAxisAlignment,
)
from orches.ui.components.clickable import Clickable, IconAction
from orches.core import settings
from orches.ui.file_icons import icon_for
from orches.core.files import list_dir
from orches.core.git import ignored_paths, status_map
from orches.ui.dialogs.folder_picker import open_folder_picker
from orches.ui.theme import ACCENT, ACCENT_BG, GIT_COLORS

IGNORED = {".git"}
DIM_OPACITY = 0.4  # archivos que git ignora
MUTED = "#6B7088"
TEXT = "#E6E8EF"
HOVER = ACCENT_BG


def FilesView(page, open_file=None):
  state = {"root": None, "expanded": set(), "status": {}, "cursor": None, "focused": False, "rows": []}
  tree = Column(spacing=0, scroll=ScrollMode.AUTO, expand=True)
  title = Text("Ningún proyecto", size=11, color=MUTED, no_wrap=True, overflow=TextOverflow.ELLIPSIS)

  def toggle(path):
    if path in state["expanded"]:
      state["expanded"].discard(path)
    else:
      state["expanded"].add(path)
    render()

  def click(path):
    """Clic en una fila: queda seleccionada y las flechas del teclado pasan a moverse por el árbol."""
    state["cursor"] = path
    if path.is_dir():
      toggle(path)
    else:
      render()
      if open_file:
        open_file(path)
    state["focused"] = True   # después de abrir: abrir un archivo enfoca el editor y quita el foco al árbol

  def git_code(path):
    """Estado de git del archivo o carpeta (M, A, U, R, D, C) o None."""
    try:
      return state["status"].get(path.relative_to(state["root"]).as_posix())
    except ValueError:
      return None

  def item(path, depth, ignored=False):
    is_dir = path.is_dir()
    icon = icon_for(path, is_dir, path in state["expanded"])
    code = git_code(path)
    color = GIT_COLORS.get(code, TEXT)
    badge = []
    if code:  # carpetas: un punto; archivos: la letra del estado
      badge = [Text("●" if is_dir else code, size=9 if is_dir else 11, color=color, weight=FontWeight.W_600)]
    return Clickable(
      Row(
        spacing=6,
        controls=[
          Image(src=icon, width=16, height=16),
          Text(path.name, size=12, color=color, no_wrap=True, overflow=TextOverflow.ELLIPSIS, expand=True),
          *badge,
        ],
      ),
      lambda e, p=path: click(p),
      hover_bg=HOVER,
      bgcolor=ACCENT_BG if path == state["cursor"] and state["focused"] else None,
      tooltip=str(path),
      opacity=DIM_OPACITY if ignored else 1,
      padding=Padding(left=6 + depth * 12, right=4, top=3, bottom=3),
      border_radius=4,
    )

  def build(path, depth, out):
    children = list_dir(path, show_hidden=True, ignore=IGNORED)
    ignored = ignored_paths(state["root"], children)
    for child in children:
      out.append(item(child, depth, child in ignored))
      state["rows"].append(child)
      if child.is_dir() and child in state["expanded"]:
        build(child, depth + 1, out)

  def render(update=True):
    root = state["root"]
    controls = []
    state["rows"] = []
    if root is None:
      controls.append(Text("Abre un proyecto para ver su contenido", size=11, color=MUTED))
    else:
      state["status"] = status_map(root)
      build(root, 0, controls)
      if not controls:
        controls.append(Text("Carpeta vacía", size=11, color=MUTED))
    tree.controls = controls
    if update:
      tree.update()

  def handle_key(e):
    """Flechas sobre el árbol: ↑↓ mueven la selección, → abre la carpeta, ← la cierra o sube, Enter abre."""
    if not state["focused"] or state["root"] is None:
      return False
    rows, cur = state["rows"], state["cursor"]
    if e.ctrl or e.alt or e.key not in ("Arrow Up", "Arrow Down", "Arrow Left", "Arrow Right", "Enter", "Escape"):
      return False
    if e.key == "Escape":
      blur()
      return True
    if not rows:
      return True
    i = rows.index(cur) if cur in rows else -1
    if e.key == "Arrow Down":
      state["cursor"] = rows[min(i + 1, len(rows) - 1)]
    elif e.key == "Arrow Up":
      state["cursor"] = rows[max(i - 1, 0)]
    elif cur is None:
      state["cursor"] = rows[0]
    elif e.key == "Arrow Right":
      if cur.is_dir() and cur not in state["expanded"]:
        state["expanded"].add(cur)
      elif cur.is_dir() and i + 1 < len(rows) and rows[i + 1].parent == cur:
        state["cursor"] = rows[i + 1]
    elif e.key == "Arrow Left":
      if cur.is_dir() and cur in state["expanded"]:
        state["expanded"].discard(cur)
      elif cur.parent in rows:
        state["cursor"] = cur.parent
    elif e.key == "Enter":
      if cur.is_dir():
        toggle(cur)
      elif open_file:
        open_file(cur)
        state["focused"] = True
        render()
      return True
    render()
    return True

  def blur():
    if state["focused"]:
      state["focused"] = False
      try:
        render()
      except RuntimeError:
        pass  # la vista no está en pantalla

  async def watch_git():
    """Cada pocos segundos revisa git y repinta el árbol si cambió algo."""
    while True:
      await asyncio.sleep(3)
      root = state["root"]
      if root is None:
        continue
      status = await asyncio.to_thread(status_map, root)
      if status != state["status"]:
        try:
          render()
        except RuntimeError:
          pass  # la vista no está en pantalla (otra pestaña activa)

  page.run_task(watch_git)

  open_button = Clickable(
    Row(
      spacing=8,
      controls=[
        Icon(Icons.FOLDER_OPEN, size=16, color=ACCENT),
        Text("Abrir proyecto", size=12, color=ACCENT),
      ],
    ),
    lambda e: choose(e),
    hover_bg=HOVER,
    padding=Padding(left=10, right=10, top=8, bottom=8),
    border_radius=6,
  )

  def open_project(path):
    show_project(path)
    settings.set("project", str(path))
    title.update()
    open_button.update()
    render()

  def show_project(path):
    state["root"] = Path(path)
    state["expanded"] = set()
    title.value = state["root"].name or str(state["root"])
    title.tooltip = str(state["root"])
    open_button.visible = False

  def choose(e):
    open_folder_picker(page, open_project, start=state["root"])

  saved = settings.get("project")
  if saved and Path(saved).is_dir():
    show_project(saved)
  render(update=False)

  # el nombre del proyecto va con un botón para abrir otro cuando quieras (antes solo se podía al inicio)
  change_button = IconAction(Icons.FOLDER_OPEN, choose, size=16, color=MUTED, hover_color=ACCENT, hover_bg=ACCENT_BG,
                             width=26, height=26, tooltip="Abrir otro proyecto")
  view = Column(
    expand=True,
    spacing=4,
    controls=[
      open_button,
      Row(alignment=MainAxisAlignment.SPACE_BETWEEN, vertical_alignment=CrossAxisAlignment.CENTER, controls=[
        Container(content=title, padding=Padding(left=8), expand=True), change_button]),
      tree,
    ],
  )
  view.handle_key = handle_key
  view.blur = blur
  view.is_focused = lambda: state["focused"]
  return view
