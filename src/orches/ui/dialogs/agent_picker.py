from pathlib import Path
from flet import (
  AlertDialog, Container, Column, Row, Text, Icon, Icons, TextField, Padding,
  RoundedRectangleBorder, ScrollMode, TextOverflow, MainAxisAlignment, CrossAxisAlignment,
)
from orches.core import settings
from orches.core.agents import detect_agents
from orches.ui.theme import ACCENT, ACCENT_BG, BORDER_COLOR
from orches.ui.components.clickable import Clickable

MUTED = "#6B7088"
TEXT = "#E6E8EF"
CARD = "#11141D"


class AgentPicker:
  """Selector de agentes estilo paleta de comandos: buscador arriba y lista filtrable."""

  def __init__(self, page, on_pick):
    self.page = page
    self.on_pick = on_pick
    self.agents = detect_agents()
    self.matches = list(self.agents)
    self.index = 0
    self.project = settings.get("project")

    self.search = TextField(
      hint_text="Buscar",
      autofocus=True,
      dense=True,
      text_size=13,
      cursor_color=ACCENT,
      border_color=BORDER_COLOR,
      focused_border_color=ACCENT,
      border_radius=6,
      content_padding=Padding(left=12, right=12, top=10, bottom=10),
      on_change=self._filter,
      on_submit=lambda e: self.pick(),
    )
    self.list = Column(spacing=2, scroll=ScrollMode.AUTO, tight=True)
    self.dialog = AlertDialog(
      modal=False,
      bgcolor=CARD,
      shape=RoundedRectangleBorder(radius=10),
      inset_padding=Padding(left=20, right=20, top=40, bottom=40),
      content_padding=Padding(left=10, right=10, top=10, bottom=10),
      content=Container(
        width=520,
        content=Column(
          tight=True, spacing=8, horizontal_alignment=CrossAxisAlignment.STRETCH,
          controls=[self.search, self.list],
        ),
      ),
      on_dismiss=lambda e: self._closed(),
    )
    self._render(update=False)

  # --- lista ----------------------------------------------------------------
  def _row(self, i, agent):
    selected = i == self.index
    return Clickable(
      Row(
        alignment=MainAxisAlignment.SPACE_BETWEEN,
        vertical_alignment=CrossAxisAlignment.CENTER,
        controls=[
          Row(
            spacing=10,
            controls=[
              Icon(Icons.SMART_TOY, size=16, color=ACCENT),
              Text(agent["name"], size=13, color=TEXT),
            ],
          ),
          Container(
            content=Text(agent["command"], size=11, color=MUTED),
            padding=Padding(left=8, right=8, top=2, bottom=2),
            border=None,
            border_radius=4,
            bgcolor="#1B2030",
          ),
        ],
      ),
      lambda e, a=agent: self.pick(a),
      hover_bg=ACCENT_BG,
      bgcolor=ACCENT_BG if selected else None,
      padding=Padding(left=10, right=10, top=9, bottom=9),
      border_radius=6,
    )

  def _render(self, update=True):
    if not self.project:
      self.list.controls = [Text("Abre un proyecto primero (pestaña Archivos)", size=12, color=MUTED)]
    elif not self.agents:
      self.list.controls = [Text("Sin agentes instalados", size=12, color=MUTED)]
    elif not self.matches:
      self.list.controls = [Text("Ningún agente coincide", size=12, color=MUTED)]
    else:
      self.list.controls = [self._row(i, a) for i, a in enumerate(self.matches)]
    if update:
      self.list.update()

  def _filter(self, e):
    query = (self.search.value or "").strip().lower()
    self.matches = [a for a in self.agents if query in a["name"].lower() or query in a["command"].lower()]
    self.index = 0
    self._render()

  # --- acciones -------------------------------------------------------------
  def pick(self, agent=None):
    agent = agent or (self.matches[self.index] if self.matches else None)
    if not agent or not self.project:
      return
    self.close()
    self.on_pick(agent, self.project)

  def move(self, delta):
    if self.matches:
      self.index = (self.index + delta) % len(self.matches)
      self._render()

  def handle_key(self, e):
    """Teclas de navegación; el texto lo maneja el campo de búsqueda."""
    if e.key == "Arrow Down":
      self.move(1)
    elif e.key == "Arrow Up":
      self.move(-1)

  def open(self):
    self.page.show_dialog(self.dialog)

  def close(self):
    self.page.pop_dialog()
    self._closed()

  def _closed(self):
    if self.on_closed:
      self.on_closed()

  on_closed = None
