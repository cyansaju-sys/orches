from flet import Container, Icons, Row, Column, CrossAxisAlignment, Stack, Alignment, FontWeight
from flet import Text, Padding
from pathlib import Path
from orches.core import settings
from orches.ui.views.agents import AgentsView
from orches.ui.views.files import FilesView
from orches.core.db.oracle import SINGULAR
from orches.ui.views.database import DatabaseView
from orches.ui.views.db_object import ObjectViewer
from orches.ui.file_icons import icon_for
from orches.ui.views.file_viewer import FileViewer
from orches.ui.views.mcp import McpView
from orches.ui.views.usage import UsageView
from orches.ui.views.git import GitView
from orches.ui.components.modal import set_typing
from orches.ui.components.clickable import IconAction
from orches.ui.components.resize import resize_handle
from orches.ui.theme import ACCENT, ACCENT_BG, border_all, border_right

options = [
  {"icon": Icons.FOLDER, "view": "files"},
  {"icon": Icons.SMART_TOY, "view": "agents"},
  {"icon": Icons.CALL_SPLIT, "view": "git"},
  {"icon": Icons.STORAGE, "view": "db"},
  {"icon": Icons.EXTENSION, "view": "mcp"},
  {"icon": Icons.AUTO_AWESOME, "view": "ai"},
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

  def open_object(session, owner, obj):
    """Abre el código o los detalles de un objeto de la base en un panel del área de trabajo."""
    if on_document:
      on_document(f"{obj.name} · {SINGULAR.get(obj.type, obj.type.title())}", Icons.STORAGE,
                  lambda: ObjectViewer(page, session, owner, obj), key=f"db:{owner}.{obj.type}.{obj.name}",
                  crumbs=[session.profile.name if session.profile else "Base de datos", owner, SINGULAR.get(obj.type, obj.type.title()), obj.name])

  def open_file(path):
    """Abre el contenido de un archivo en un panel del área de trabajo."""
    if on_document:
      on_document(path.name, icon_for(path), lambda: FileViewer(page, path), key=f"file:{path}", path=path)   # su ícono de Material Icon Theme

  views = {
    "files": FilesView(page, open_file),
    "agents": AgentsView(page, on_agent),
    "git": GitView(page, on_git_count),
    "db": DatabaseView(page, open_object),
    "mcp": McpView(page),
    "ai": UsageView(page, resume),
  }
  body = Container(content=views["files"], padding=Padding(left=4, top=6), expand=True)

  def select(view):
    set_typing(False)   # un campo de texto oculto no avisa de que perdió el foco
    body.content = views[view]
    body.update()
    on_enter = getattr(views[view], "on_enter", None)
    if on_enter:
      on_enter()

  def tab_button(option):
    button = IconAction(
      option["icon"],
      lambda e, view=option["view"]: select(view),
      size=24, color=ACCENT, hover_bg=ACCENT_BG, width=40, height=40, radius=20,
    )
    if option["view"] == "git":
      return Stack(width=40, height=40, controls=[button, git_badge])
    return button

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
            controls=[tab_button(option) for option in options],
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

  row.files_key = files_key
  row.files_blur = views["files"].blur
  row.select_tab = select_tab
  row.toggle_sidebar = toggle_sidebar
  return row
