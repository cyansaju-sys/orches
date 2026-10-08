from pathlib import Path
from flet import (
  AlertDialog, Container, Text, Icon, Icons, IconButton, Row, Column, TextButton,
  ScrollMode, TextOverflow, Padding, ButtonStyle,
)
from orches.core.files import list_dir, list_roots
from orches.ui.components.modal import show_modal
from orches.ui.theme import ACCENT

MUTED = "#6B7088"
TEXT = "#E6E8EF"


def open_file_picker(page, on_select, suffixes, title="Elegir archivo", start=None):
  """Navegador propio: muestra carpetas y solo los archivos con esas extensiones (p. ej. ".zip")."""
  suffixes = tuple(s.lower() for s in suffixes)
  start = Path(start) if start else Path.home()
  state = {"path": start if start.is_dir() else Path.home(), "shown": False}
  current = Text("", size=12, color=TEXT, no_wrap=True, overflow=TextOverflow.ELLIPSIS, expand=True)
  listing = Column(spacing=0, scroll=ScrollMode.AUTO, expand=True)

  def go(path):
    state["path"] = Path(path)
    refresh()

  def pick(path):
    close()
    on_select(path)

  def row(icon, name, on_click):
    return Container(
      padding=Padding(left=8, right=8, top=5, bottom=5), border_radius=4, ink=True, on_click=on_click,
      content=Row(spacing=8, controls=[
        Icon(icon, size=16, color=ACCENT),
        Text(name, size=12, color=TEXT, no_wrap=True, overflow=TextOverflow.ELLIPSIS, expand=True)]))

  def refresh():
    path = state["path"]
    current.value = str(path)
    items = [p for p in list_dir(path) if p.is_dir() or p.suffix.lower() in suffixes]
    listing.controls = [
      row(Icons.FOLDER, p.name, lambda e, p=p: go(p)) if p.is_dir()
      else row(Icons.FOLDER_ZIP, p.name, lambda e, p=p: pick(p))
      for p in items] or [Text("Sin carpetas ni archivos de este tipo", size=11, color=MUTED)]
    if state["shown"]:
      current.update()
      listing.update()

  def up(e):
    parent = state["path"].parent
    if parent != state["path"]:
      go(parent)

  shortcuts = Row(spacing=0, scroll=ScrollMode.AUTO, controls=[
    TextButton("Inicio", icon=Icons.HOME, on_click=lambda e: go(Path.home()), style=ButtonStyle(color=ACCENT)),
    TextButton("Descargas", icon=Icons.DOWNLOAD, on_click=lambda e: go(Path.home() / "Downloads"),
               style=ButtonStyle(color=ACCENT)),
    *[TextButton(str(r), icon=Icons.STORAGE, on_click=lambda e, r=r: go(r), style=ButtonStyle(color=ACCENT))
      for r in list_roots()],
  ])

  refresh()
  state["shown"] = True
  close = show_modal(page, AlertDialog(
    title=Text(title),
    content=Container(width=440, height=380, content=Column(spacing=4, controls=[
      shortcuts,
      Row(controls=[IconButton(Icons.ARROW_UPWARD, icon_size=18, on_click=up), current]),
      Container(content=listing, expand=True)])),
    actions=[TextButton("Cancelar", on_click=lambda e: close())]))
