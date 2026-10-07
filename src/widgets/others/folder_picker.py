from pathlib import Path
from flet import (
  AlertDialog, Container, Text, Icon, Icons, IconButton, Row, Column, TextButton,
  ScrollMode, TextOverflow, Padding, ButtonStyle,
)
from utils.files import list_dir, list_roots
from widgets.others.modal import show_modal
from utils.theme import ACCENT

MUTED = "#6B7088"
TEXT = "#E6E8EF"


def open_folder_picker(page, on_select, start=None):
  """Navegador de carpetas propio; funciona igual en Windows, Linux y macOS."""
  start = Path(start) if start else Path.home()
  state = {"path": start if start.is_dir() else Path.home(), "shown": False}

  current = Text("", size=12, color=TEXT, no_wrap=True, overflow=TextOverflow.ELLIPSIS, expand=True)
  listing = Column(spacing=0, scroll=ScrollMode.AUTO, expand=True)

  def go(path):
    state["path"] = Path(path)
    refresh()

  def row(icon, name, on_click, color=ACCENT):
    return Container(
      padding=Padding(left=8, right=8, top=5, bottom=5),
      border_radius=4,
      ink=True,
      on_click=on_click,
      content=Row(
        spacing=8,
        controls=[
          Icon(icon, size=16, color=color),
          Text(name, size=12, color=TEXT, no_wrap=True, overflow=TextOverflow.ELLIPSIS, expand=True),
        ],
      ),
    )

  def refresh():
    path = state["path"]
    current.value = str(path)
    folders = [p for p in list_dir(path) if p.is_dir()]
    listing.controls = [
      row(Icons.FOLDER, p.name, lambda e, p=p: go(p)) for p in folders
    ] or [Text("Sin subcarpetas", size=11, color=MUTED)]
    if state["shown"]:
      current.update()
      listing.update()

  def up(e):
    parent = state["path"].parent
    if parent != state["path"]:
      go(parent)

  def choose(e):
    close()
    on_select(state["path"])

  shortcuts = Row(
    spacing=0,
    scroll=ScrollMode.AUTO,
    controls=[
      TextButton("Inicio", icon=Icons.HOME, on_click=lambda e: go(Path.home()),
                 style=ButtonStyle(color=ACCENT)),
      *[
        TextButton(str(r), icon=Icons.STORAGE, on_click=lambda e, r=r: go(r),
                   style=ButtonStyle(color=ACCENT))
        for r in list_roots()
      ],
    ],
  )

  refresh()
  state["shown"] = True
  close = show_modal(
    page,
    AlertDialog(
      title=Text("Abrir proyecto"),
      content=Container(
        width=420,
        height=380,
        content=Column(
          spacing=4,
          controls=[
            shortcuts,
            Row(controls=[IconButton(Icons.ARROW_UPWARD, icon_size=18, on_click=up), current]),
            Container(content=listing, expand=True),
          ],
        ),
      ),
      actions=[
        TextButton("Cancelar", on_click=lambda e: close()),
        TextButton("Seleccionar esta carpeta", on_click=choose),
      ],
    )
  )
