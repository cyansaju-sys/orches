from flet import Container, Icons, Icon, Row, Column, Text, Padding, SnackBar
from orches.core import settings
from orches.core.agents import detect_agents
from orches.ui.theme import ACCENT, ACCENT_BG
from orches.ui.components.clickable import Clickable

MUTED = "#6B7088"
TEXT = "#E6E8EF"


def AgentsView(page, on_open):
  """Lista de agentes instalados. Al pulsar uno llama a `on_open(agent, project)`."""

  def launch(agent):
    project = settings.get("project")
    if not project:
      page.show_dialog(SnackBar(Text("Abre un proyecto primero (pestaña Archivos)")))
      return
    on_open(agent, project)

  agents = detect_agents()
  if not agents:
    return Column(controls=[Text("Sin agentes instalados", size=12, color=MUTED)])

  return Column(
    spacing=4,
    controls=[
      Clickable(
        Row(
          spacing=8,
          controls=[
            Icon(Icons.SMART_TOY, size=14, color=ACCENT),
            Text(agent["name"], size=12, color=TEXT, no_wrap=True),
          ],
        ),
        lambda e, agent=agent: launch(agent),
        hover_bg=ACCENT_BG,
        tooltip=f"Ejecutar en el proyecto · {agent['path']}",
        padding=Padding(left=8, right=8, top=6, bottom=6),
        border_radius=6,
      )
      for agent in agents
    ],
  )
