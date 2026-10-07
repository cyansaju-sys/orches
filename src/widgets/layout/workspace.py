from pathlib import Path
from flet import (
  Container, Column, Row, Text, Icon, Icons, Padding, Clipboard,
  CrossAxisAlignment, MainAxisAlignment, Border, BorderSide, ClipBehavior,
)
from utils import settings
from utils.pty_session import default_shell
from utils.theme import ACCENT, BORDER_COLOR, border_all, border_right
from widgets.others.clickable import IconAction
from widgets.others.terminal import TerminalView, FONT, FONT_FILE

MUTED = "#6B7088"
TEXT = "#E6E8EF"
ACTIVE_BG = "#1C1836"


def Workspace(page):
  """Panel principal: los agentes se reparten el ancho; una terminal opcional va debajo."""
  page.fonts = {**(page.fonts or {}), FONT: FONT_FILE}
  panes = []            # paneles de agentes, uno al lado del otro
  shell = {"pane": None}  # terminal inferior (o None)
  state = {"active": None}
  clipboard = Clipboard()
  page.services.append(clipboard)

  row = Row(expand=True, spacing=0, vertical_alignment=CrossAxisAlignment.STRETCH)
  agents_area = Container(expand=3)
  empty = Column(
    expand=True,
    alignment=MainAxisAlignment.CENTER,
    horizontal_alignment=CrossAxisAlignment.CENTER,
    controls=[
      Icon(Icons.SMART_TOY, size=40, color=MUTED),
      Text("Elige un agente en la barra lateral para abrirlo aquí", size=12, color=MUTED),
    ],
  )
  agents_area.content = empty
  shell_area = Container(expand=2, visible=False, border=Border(top=BorderSide(1, BORDER_COLOR)))

  def all_panes():
    return panes + ([shell["pane"]] if shell["pane"] else [])

  def refresh():
    for p in all_panes():
      active = p is state["active"]
      p["header"].bgcolor = ACTIVE_BG if active else "transparent"
      p["header"].border = Border(bottom=BorderSide(2 if active else 1, ACCENT if active else BORDER_COLOR))
      p["label"].color = TEXT if active else MUTED
    for i, p in enumerate(panes):  # una sola línea divisoria entre paneles
      p["box"].border = border_right() if i < len(panes) - 1 else None
    row.controls = [p["box"] for p in panes]
    agents_area.content = row if panes else empty
    shell_area.visible = shell["pane"] is not None
    shell_area.content = shell["pane"]["box"] if shell["pane"] else None
    page.update()

  def select(pane):
    if state["active"] is not pane:
      state["active"] = pane
      refresh()

  def make_pane(title, icon, view, on_close, expand=None):
    label = Text(title, size=12, no_wrap=True, expand=True)
    pane = {"view": view, "label": label}
    pane["header"] = Container(
      padding=Padding(left=10, right=2, top=4, bottom=4),
      content=Row(
        spacing=6,
        controls=[
          Icon(icon, size=14, color=ACCENT),
          label,
          IconAction(Icons.CLOSE, lambda e, p=pane: on_close(p), size=14, color=MUTED,
                     hover_color=TEXT, hover_bg="#2A2F3D", width=24, height=24),
        ],
      ),
    )
    pane["box"] = Container(
      expand=expand,
      on_click=lambda e, p=pane: select(p),
      content=Column(
        expand=True,
        spacing=0,
        horizontal_alignment=CrossAxisAlignment.STRETCH,
        controls=[pane["header"], view.control],
      ),
    )
    return pane

  def close_agent(pane):
    pane["view"].close()
    idx = panes.index(pane)
    panes.remove(pane)
    if state["active"] is pane:
      state["active"] = panes[min(idx, len(panes) - 1)] if panes else shell["pane"]
    refresh()

  def open_agent(agent, project):
    view = TerminalView(page, agent["command"], project)
    # expand=1: todos los agentes reparten el ancho por igual
    pane = make_pane(f"{agent['name']} · {Path(project).name}", Icons.SMART_TOY, view, close_agent, expand=1)
    panes.append(pane)
    state["active"] = pane
    refresh()

  def close_shell(pane):
    pane["view"].close()
    shell["pane"] = None
    if state["active"] is pane:
      state["active"] = panes[-1] if panes else None
    refresh()

  def toggle_terminal():
    """Abre una shell en el proyecto debajo de los agentes, o la cierra si ya está abierta."""
    if shell["pane"]:
      close_shell(shell["pane"])
      return
    project = settings.get("project")
    cwd = project if project and Path(project).is_dir() else str(Path.home())
    view = TerminalView(page, default_shell(), cwd)
    shell["pane"] = make_pane(f"Terminal · {Path(cwd).name or cwd}", Icons.TERMINAL, view, close_shell, expand=True)
    state["active"] = shell["pane"]
    refresh()

  async def on_key(e):
    pane = state["active"]
    if not pane:
      return
    if e.ctrl and e.shift and e.key == "V":
      text = await clipboard.get()
      if text:
        pane["view"].paste(text)
      return
    pane["view"].send_key(e)

  page.on_keyboard_event = on_key

  control = Container(
    expand=True,
    bgcolor="#0D0F16",
    border_radius=8,
    border=border_all(),
    clip_behavior=ClipBehavior.HARD_EDGE,
    content=Column(
      expand=True,
      spacing=0,
      horizontal_alignment=CrossAxisAlignment.STRETCH,
      controls=[agents_area, shell_area],
    ),
  )
  control.open_agent = open_agent
  control.toggle_terminal = toggle_terminal
  return control
