import asyncio
from pathlib import Path
from flet import (
  Container, Text, Image, Icon, Icons, Row, Column, Padding, ScrollMode,
  TextOverflow, ButtonStyle, TextButton, FontWeight,
)
from widgets.others.clickable import Clickable
from utils import settings
from utils.file_icons import icon_for
from utils.files import list_dir
from utils.git import ignored_paths, status_map
from widgets.others.folder_picker import open_folder_picker
from utils.theme import ACCENT, ACCENT_BG, GIT_COLORS

IGNORED = {".git"}
DIM_OPACITY = 0.4  # archivos que git ignora
MUTED = "#6B7088"
TEXT = "#E6E8EF"
HOVER = ACCENT_BG


def FilesView(page):
  state = {"root": None, "expanded": set(), "status": {}}
  tree = Column(spacing=0, scroll=ScrollMode.AUTO, expand=True)
  title = Text("Ningún proyecto", size=11, color=MUTED, no_wrap=True, overflow=TextOverflow.ELLIPSIS)

  def toggle(path):
    if path in state["expanded"]:
      state["expanded"].discard(path)
    else:
      state["expanded"].add(path)
    render()

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
      (lambda e, p=path: toggle(p)) if is_dir else (lambda e: None),
      hover_bg=HOVER,
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
      if child.is_dir() and child in state["expanded"]:
        build(child, depth + 1, out)

  def render(update=True):
    root = state["root"]
    controls = []
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

  return Column(
    expand=True,
    spacing=4,
    controls=[
      open_button,
      Container(content=title, padding=Padding(left=8)),
      tree,
    ],
  )
