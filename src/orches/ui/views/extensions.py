import asyncio
from pathlib import Path
from flet import (
  Container, Column, Row, Text, Icon, Icons, Image, Padding, ScrollMode, FontWeight, TextOverflow, ProgressRing,
  CrossAxisAlignment, MainAxisAlignment,
)
from orches.core import extensions, settings
from orches.ui.components.clickable import Clickable, IconAction
from orches.ui.dialogs.file_picker import open_file_picker
from orches.ui.theme import ACCENT, ACCENT_BG, BORDER_COLOR, border_all
from orches.ui.components.toast import toast as show_toast

MUTED = "#6B7088"
TEXT = "#E6E8EF"
ERROR = "#FF6B81"
WARN = "#E2C08D"


def ExtensionsView(page, on_updates=None):
  """Extensiones instaladas, con botón para añadir las tuyas (.zip) y quitarlas."""
  state = {"outdated": [], "changed": False}
  listing = Column(spacing=6, scroll=ScrollMode.AUTO, expand=True)

  def toast(message):
    show_toast(page, message)

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
    loaded = {e.id for e in extensions.REGISTRY.extensions}      # se lee al pintar: las extensiones cargan después de crear la vista
    status = (Text(problem, size=10, color=ERROR) if problem else
              Text("Instalada: reinicia para activarla", size=10, color=WARN) if ext.id not in loaded else None)
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

  online = Column(spacing=6)

  def online_card(item):
    have = item["id"] in {x.id for x in installed()}
    stale = item["id"] in state["outdated"]
    action = (Text("Instalada", size=10, color=MUTED) if have and not stale else
              Clickable(Text("Actualizar" if stale else "Instalar", size=11, color=WARN if stale else ACCENT), lambda e, i=item: page.run_task(install_online, i),
                        hover_bg=ACCENT_BG, padding=Padding(left=8, right=8, top=4, bottom=4), border_radius=4))
    return Container(
      padding=Padding(left=10, right=6, top=6, bottom=6), border=border_all(color=BORDER_COLOR), border_radius=8,
      content=Row(spacing=8, controls=[Icon(Icons.CLOUD_DOWNLOAD, size=16, color=MUTED),
                                       Text(item["id"], size=12, color=TEXT, expand=True, no_wrap=True,
                                            overflow=TextOverflow.ELLIPSIS),
                                       Text(f"{item['size'] / 1024:.1f} KB", size=10, color=MUTED), action]))

  def show_online(controls):
    online.controls = controls
    try:
      online.update()
    except RuntimeError:
      pass

  def set_outdated(items):
    state["outdated"] = extensions.outdated(items)
    if on_updates:
      on_updates(len(state["outdated"]))

  async def check(e=None):
    """Revisión silenciosa (al arrancar): si hay actualizaciones, avisa con un globo en el ícono de la pestaña."""
    try:
      items = await asyncio.to_thread(extensions.fetch_catalog)
    except extensions.ExtensionError:
      return                                  # sin red no pasa nada
    state["catalog"] = items
    set_outdated(items)

  async def load_online(e=None):
    show_online([Row(spacing=8, controls=[ProgressRing(width=14, height=14, stroke_width=2, color=ACCENT),
                                           Text("Buscando en GitHub…", size=11, color=MUTED)])])
    try:
      items = await asyncio.to_thread(extensions.fetch_catalog)
    except extensions.ExtensionError as err:
      show_online([Text(str(err), size=10, color=ERROR)])
      return
    state["catalog"] = items
    set_outdated(items)
    show_online([online_card(i) for i in items] or [Text("El catálogo está vacío", size=11, color=MUTED)])

  async def install_online(item):
    try:
      ext = await asyncio.to_thread(extensions.install_from_catalog, item)
    except extensions.ExtensionError as err:
      toast(f"No se pudo instalar: {err}")
      return
    settings.set("extensions_removed", [i for i in settings.get("extensions_removed", []) if i != ext.id])
    state["changed"] = True
    toast(f"«{ext.name}» instalada. Reinicia la app para activarla")
    render()
    set_outdated(state.get("catalog", []))
    show_online([online_card(i) for i in state.get("catalog", [])])

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
  online.controls = [Text("Pulsa ↻ para buscar extensiones en GitHub", size=10, color=MUTED)]
  view = Column(expand=True, spacing=8, controls=[
    Container(padding=Padding(left=8), content=Text("Extensiones", size=12, weight=FontWeight.W_600, color=TEXT)),
    Clickable(
      Row(spacing=8, controls=[Icon(Icons.ADD, size=16, color=ACCENT), Text("Añadir extensión (.zip)", size=12, color=ACCENT)]),
      browse, hover_bg=ACCENT_BG, padding=Padding(left=10, right=10, top=8, bottom=8), border_radius=6),
    Container(content=listing, expand=True, padding=Padding(right=6)),
    Row(alignment=MainAxisAlignment.SPACE_BETWEEN, controls=[
      Container(padding=Padding(left=8), content=Text("Disponibles en línea", size=12, weight=FontWeight.W_600, color=TEXT)),
      IconAction(Icons.REFRESH, lambda e: page.run_task(load_online), size=16, color=MUTED, hover_color=ACCENT,
                 hover_bg=ACCENT_BG, width=28, height=28, tooltip="Buscar en GitHub")]),
    Container(content=online, padding=Padding(right=6, bottom=6)),
  ])
  view.check = check
  view.on_enter = lambda: render()      # al abrir la pestaña se vuelve a leer lo instalado
  return view
