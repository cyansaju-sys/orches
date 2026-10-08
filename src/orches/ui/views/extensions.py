from pathlib import Path
from flet import (
  Container, Column, Row, Text, Icon, Icons, Image, Padding, ScrollMode, FontWeight, SnackBar, TextOverflow,
  CrossAxisAlignment, MainAxisAlignment,
)
from orches.core import extensions, settings
from orches.ui.components.clickable import Clickable, IconAction
from orches.ui.dialogs.file_picker import open_file_picker
from orches.ui.theme import ACCENT, ACCENT_BG, BORDER_COLOR, border_all

MUTED = "#6B7088"
TEXT = "#E6E8EF"
ERROR = "#FF6B81"
WARN = "#E2C08D"


def ExtensionsView(page):
  """Extensiones instaladas, con botón para añadir las tuyas (.zip) y quitarlas."""
  state = {"changed": False, "loaded": {e.id for e in extensions.REGISTRY.extensions}}
  listing = Column(spacing=6, scroll=ScrollMode.AUTO, expand=True)

  def toast(message):
    page.show_dialog(SnackBar(Text(message)))

  def installed():
    root = extensions.root()
    found = []
    for folder in sorted(root.iterdir()) if root.is_dir() else []:
      if folder.is_dir() and not folder.name.startswith("."):
        try:
          found.append(extensions.read_manifest(folder))
        except extensions.ExtensionError:
          pass
    return found

  def card(ext):
    errors = dict(extensions.REGISTRY.errors)
    problem = errors.get(ext.dir.name)
    glyph = Image(src=ext.icon.read_bytes(), width=24, height=24) if ext.icon else Icon(Icons.EXTENSION, size=22, color=ACCENT)
    status = (Text(problem, size=10, color=ERROR) if problem else
              Text("Instalada: reinicia para activarla", size=10, color=WARN) if ext.id not in state["loaded"] else None)
    return Container(
      padding=Padding(left=10, right=6, top=8, bottom=8), border=border_all(color=BORDER_COLOR), border_radius=8,
      content=Row(vertical_alignment=CrossAxisAlignment.START, spacing=10, controls=[
        glyph,
        Column(spacing=2, expand=True, controls=[
          Row(spacing=6, controls=[Text(ext.name, size=12, weight=FontWeight.W_600, color=TEXT, no_wrap=True,
                                        overflow=TextOverflow.ELLIPSIS, expand=True),
                                   Text(f"v{ext.version}", size=10, color=MUTED)]),
          *([Text(ext.description, size=10, color=MUTED)] if ext.description else []),
          *([status] if status else [])]),
        IconAction(Icons.DELETE_OUTLINE, lambda e, x=ext: remove(x), size=16, color=MUTED, hover_color=ERROR,
                   hover_bg=ACCENT_BG, width=28, height=28, tooltip="Quitar extensión")]))

  def render(update=True):
    found = installed()
    listing.controls = [card(x) for x in found] or [Text("No hay extensiones instaladas", size=11, color=MUTED)]
    for name, message in extensions.REGISTRY.errors:
      if not any(x.dir.name == name for x in found):
        listing.controls.append(Text(f"{name}: {message}", size=10, color=ERROR))
    if state["changed"]:
      listing.controls.insert(0, Text("Reinicia la app para aplicar los cambios", size=10, color=WARN))
    if update:
      listing.update()

  def add(path):
    try:
      ext = extensions.install_zip(path)
    except extensions.ExtensionError as e:
      toast(f"No se pudo instalar: {e}")
      return
    state["changed"] = True
    settings.set("extensions_removed", [i for i in settings.get("extensions_removed", []) if i != ext.id])
    toast(f"«{ext.name}» instalada. Reinicia la app para activarla")
    render()

  def remove(ext):
    extensions.uninstall(ext.id)
    state["changed"] = True
    render()

  def browse(e):
    downloads = Path.home() / "Downloads"
    open_file_picker(page, add, [".zip"], title="Añadir extensión (.zip)", start=downloads if downloads.is_dir() else None)

  render(update=False)
  return Column(expand=True, spacing=8, controls=[
    Container(padding=Padding(left=8), content=Text("Extensiones", size=12, weight=FontWeight.W_600, color=TEXT)),
    Clickable(
      Row(spacing=8, controls=[Icon(Icons.ADD, size=16, color=ACCENT), Text("Añadir extensión (.zip)", size=12, color=ACCENT)]),
      browse, hover_bg=ACCENT_BG, padding=Padding(left=10, right=10, top=8, bottom=8), border_radius=6),
    Container(content=listing, expand=True, padding=Padding(right=6)),
  ])
