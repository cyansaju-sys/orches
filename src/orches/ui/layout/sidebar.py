from flet import Container, Icons, Row, Column, CrossAxisAlignment, Stack, Alignment, FontWeight
from flet import Text, Padding, Image
from pathlib import Path
from orches.core import extensions, settings
from orches.ui.views.agents import AgentsView
from orches.ui.views.files import FilesView
from orches.ui.file_icons import icon_for
from orches.ui.views.file_viewer import FileViewer
from orches.ui.views.mcp import McpView
from orches.ui.views.usage import UsageView
from orches.ui.views.git import GitView
from orches.ui.views.extensions import ExtensionsView
from orches.ui.components.modal import set_typing
from orches.ui.components.clickable import Clickable, IconAction
from orches.ui.components.resize import resize_handle
from orches.ui.theme import ACCENT, ACCENT_BG, border_all, border_right

options = [
  {"icon": "icons/sidebar/files.svg", "view": "files", "title": "Archivos"},
  {"icon": "icons/sidebar/agents.svg", "view": "agents", "title": "Agentes"},
  {"icon": "icons/sidebar/git.svg", "view": "git", "title": "Git"},
  {"icon": "icons/sidebar/mcp.svg", "view": "mcp", "title": "Servidores MCP"},
  {"icon": "icons/sidebar/ai.svg", "view": "ai", "title": "Consumo e historial de IA"},
  {"icon": "icons/sidebar/extensions.svg", "view": "extensions", "title": "Extensiones"},
]

def placeholder(text):
  return Column(controls=[Text(text, size=12, color="#6B7088")])

def Sidebar(page, on_agent, on_document=None):
  def resume(session):
    """Retoma una sesión del historial en la carpeta donde se creó."""
    cwd = session.cwd if session.cwd and Path(session.cwd).is_dir() else settings.get("project")
    if not cwd:
      return
    agent = {"name": session.agent, "command": session.command}
    on_agent(agent, cwd, args=session.resume_args, title=f"{session.agent} · {session.display_title}")

  # globo con la cantidad de archivos con cambios, sobre el ícono de Git
  git_count = Text("", size=9, weight=FontWeight.W_700, color="#07080C")
  git_badge = Container(
    content=git_count, bgcolor=ACCENT, border_radius=8, height=16, right=0, top=0,
    padding=Padding(left=5, right=5), alignment=Alignment.CENTER, visible=False,
  )

  def on_git_count(n):
    git_count.value = "99+" if n > 99 else str(n)
    git_badge.visible = n > 0
    try:
      git_badge.update()
    except RuntimeError:
      pass   # aún no está en pantalla; se verá en el próximo ciclo

  def open_file(path):
    """Abre el contenido de un archivo en un panel del área de trabajo."""
    if on_document:
      on_document(path.name, icon_for(path), lambda: FileViewer(page, path), key=f"file:{path}", path=path)   # su ícono de Material Icon Theme

  # globo en la pestaña de extensiones cuando el catálogo trae versiones nuevas
  ext_count = Text("", size=9, weight=FontWeight.W_700, color="#07080C")
  ext_badge = Container(content=ext_count, bgcolor="#E2C08D", border_radius=8, height=16, right=0, top=0,
                        padding=Padding(left=5, right=5), alignment=Alignment.CENTER, visible=False)

  def on_ext_updates(n):
    ext_count.value = str(n)
    ext_badge.visible = n > 0
    try:
      ext_badge.update()
    except RuntimeError:
      pass

  views = {
    "files": FilesView(page, open_file),
    "agents": AgentsView(page, on_agent),
    "git": GitView(page, on_git_count),
    "mcp": McpView(page),
    "ai": UsageView(page, resume),
    "extensions": ExtensionsView(page, lambda n: on_ext_updates(n)),
  }

  # --- extensiones: cada una puede traer una pestaña propia (ícono del .zip) ---------------------------------
  registry = extensions.load_all(page, {"open_document": on_document})
  builders = {}        # id de la pestaña -> función que crea su contenido la primera vez que se abre
  ext_tabs = {}        # letra del atajo Ctrl+Shift+<letra> -> id de la pestaña
  for entry in registry.sidebar_views:
    ext = entry.extension
    builders[f"ext:{ext.id}"] = entry.build
    if ext.shortcut:
      ext_tabs.setdefault(ext.shortcut, f"ext:{ext.id}")

  page.run_task(views["extensions"].check)
  body = Container(content=views["files"], padding=Padding(left=4, top=6), expand=True)

  def select(view):
    set_typing(False)   # un campo de texto oculto no avisa de que perdió el foco
    if view not in views and view in builders:
      try:
        views[view] = builders[view](page)
      except Exception as e:        # una extensión rota no debe tumbar la barra lateral
        views[view] = Column(controls=[Text(f"La extensión falló: {type(e).__name__}: {e}", size=12, color="#FF6B81")])
    body.content = views[view]
    body.update()
    on_enter = getattr(views[view], "on_enter", None)
    if on_enter:
      on_enter()

  def tab_button(option):
    button = Clickable(
      Image(src=option["icon"], width=24, height=24),
      lambda e, view=option["view"]: select(view),
      hover_bg=ACCENT_BG, tooltip=option.get("title"), width=40, height=40, border_radius=20, alignment=Alignment.CENTER,
    )
    if option["view"] == "git":
      return Stack(width=40, height=40, controls=[button, git_badge])
    if option["view"] == "extensions":
      return Stack(width=40, height=40, controls=[button, ext_badge])
    return button

  def extension_button(entry):
    ext = entry.extension
    glyph = Image(src=ext.icon.read_bytes(), width=24, height=24) if ext.icon else Icons.EXTENSION
    if ext.icon is None:
      return IconAction(glyph, lambda e, v=f"ext:{ext.id}": select(v), size=24, color=ACCENT, hover_bg=ACCENT_BG,
                        width=40, height=40, radius=20, tooltip=entry.title)
    return Clickable(glyph, lambda e, v=f"ext:{ext.id}": select(v), hover_bg=ACCENT_BG, tooltip=entry.title,
                     width=40, height=40, border_radius=20, alignment=Alignment.CENTER)

  panel = Container(
    border=border_all(),
    width=300,
    bgcolor="#11141D",
    border_radius=8,
    content=Row(
      expand=True,
      spacing=2,
      controls=[
        Container(
          content=Column(
            controls=[*[tab_button(option) for option in options], *[extension_button(v) for v in registry.sidebar_views]],
          ),
          padding=2,
          border=border_right(),
        ),
        body,
      ]
    ),
  )

  row = Row(
    spacing=0,
    vertical_alignment=CrossAxisAlignment.STRETCH,
    controls=[panel, resize_handle(panel)],
  )

  def select_tab(view):
    """Atajo de teclado: muestra la barra lateral (si estaba oculta) y abre esa pestaña."""
    if not row.visible:
      row.visible = True
      row.update()
    select(view)

  def toggle_sidebar():
    row.visible = not row.visible
    row.update()

  def files_key(e):
    """Flechas del teclado sobre el árbol de archivos (solo si está en pantalla y con el foco)."""
    files = views["files"]
    return row.visible and body.content is files and files.handle_key(e)

  row.extension_tabs = lambda: ext_tabs      # atajos Ctrl+Shift+<letra> de las extensiones
  row.files_key = files_key
  row.files_blur = views["files"].blur
  row.select_tab = select_tab
  row.toggle_sidebar = toggle_sidebar
  return row
