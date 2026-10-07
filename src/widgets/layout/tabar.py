from flet import Container, Icons, Row, Column, CrossAxisAlignment
from flet import Text, Padding
from pathlib import Path
from utils import settings
from widgets.others.agents import AgentsView
from widgets.others.files import FilesView
from widgets.others.usage import UsageView
from widgets.others.git import GitView
from widgets.others.modal import set_typing
from widgets.others.clickable import IconAction
from utils.resize import resize_handle
from utils.theme import ACCENT, ACCENT_BG, border_all, border_right

options = [
  {"icon": Icons.FOLDER, "view": "files"},
  {"icon": Icons.SMART_TOY, "view": "agents"},
  {"icon": Icons.CALL_SPLIT, "view": "git"},
  {"icon": Icons.AUTO_AWESOME, "view": "ai"},
]

def placeholder(text):
  return Column(controls=[Text(text, size=12, color="#6B7088")])

def TabBar(page, on_agent):
  def resume(session):
    """Retoma una sesión del historial en la carpeta donde se creó."""
    cwd = session.cwd if session.cwd and Path(session.cwd).is_dir() else settings.get("project")
    if not cwd:
      return
    agent = {"name": session.agent, "command": session.command}
    on_agent(agent, cwd, args=session.resume_args, title=f"{session.agent} · {session.display_title}")

  views = {
    "files": FilesView(page),
    "agents": AgentsView(page, on_agent),
    "git": GitView(page),
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
            controls=[
              IconAction(
                option["icon"],
                lambda e, view=option["view"]: select(view),
                size=24, color=ACCENT, hover_bg=ACCENT_BG, width=40, height=40, radius=20,
              )
              for option in options
            ],
          ),
          padding=2,
          border=border_right(),
        ),
        body,
      ]
    ),
  )

  return Row(
    spacing=0,
    vertical_alignment=CrossAxisAlignment.STRETCH,
    controls=[panel, resize_handle(panel)],
  )
