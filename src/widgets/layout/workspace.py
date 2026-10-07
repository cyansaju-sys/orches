import asyncio
import math
import time
from pathlib import Path
from types import SimpleNamespace
from flet import (
  Container, Column, Row, Text, Icon, Icons, Padding, Clipboard, TextField,
  KeyboardListener, NoInputBorder,
  CrossAxisAlignment, MainAxisAlignment, Border, BorderSide, ClipBehavior,
)
from utils import settings
from utils.pty_session import default_shell
from utils.resize import resize_handle_height
from utils.theme import ACCENT, ACCENT_BG, ACCENT_DIM, BORDER_COLOR, border_all
from widgets.others.agent_picker import AgentPicker
from widgets.others.clickable import IconAction, Clickable
from widgets.others.terminal import TerminalView, FONT, FONT_FILE

SHELL_HEIGHT = 260
SHELL_MIN = 80
MUTED = "#6B7088"
TEXT = "#E6E8EF"
ACTIVE_BG = ACCENT_BG


def Workspace(page):
  """Panel principal: los agentes se reparten el ancho; una terminal opcional va debajo."""
  page.fonts = {**(page.fonts or {}), FONT: FONT_FILE}
  panes = []            # paneles de agentes, uno al lado del otro
  shell = {"pane": None}  # terminal inferior (o None)
  state = {
    "active": None, "picker": None, "mods": (False, False, False),
    "text": "", "field_focus": False, "text_at": 0.0,
  }
  clipboard = Clipboard()
  page.services.append(clipboard)

  grid = Column(expand=True, spacing=0, horizontal_alignment=CrossAxisAlignment.STRETCH)
  agents_area = Container(
    expand=True,
    bgcolor="#0D0F16",
    border_radius=8,
    border=border_all(),
    clip_behavior=ClipBehavior.HARD_EDGE,
  )
  empty = Column(
    expand=True,
    alignment=MainAxisAlignment.CENTER,
    horizontal_alignment=CrossAxisAlignment.CENTER,
    controls=[
      Icon(Icons.SMART_TOY, size=40, color=MUTED),
      Text("Elige un agente para abrirlo aquí", size=12, color=MUTED),
      Clickable(
        Row(
          spacing=8,
          alignment=MainAxisAlignment.CENTER,
          controls=[
            Icon(Icons.SEARCH, size=16, color=ACCENT),
            Text("Elegir agente", size=13, color=ACCENT),
          ],
        ),
        lambda e: choose_agent(),
        hover_bg=ACCENT_BG,
        width=180,
        padding=Padding(left=12, right=12, top=9, bottom=9),
        border_radius=8,
        border=border_all(color=ACCENT_DIM),
      ),
    ],
  )
  agents_area.content = empty
  # la terminal es una tarjeta aparte, con el mismo estilo que la barra lateral
  shell_area = Container(
    height=SHELL_HEIGHT,          # alto ajustable arrastrando el borde superior
    visible=False,
    bgcolor="#11141D",
    border_radius=8,
    border=border_all(),
    clip_behavior=ClipBehavior.HARD_EDGE,
  )

  def max_shell_height():
    # deja siempre algo de espacio para los agentes
    return max(SHELL_MIN, (page.window.height or 800) - 200)

  shell_handle = resize_handle_height(shell_area, SHELL_MIN, max_shell_height)
  shell_handle.visible = False

  def all_panes():
    return panes + ([shell["pane"]] if shell["pane"] else [])

  def refresh():
    for p in all_panes():
      active = p is state["active"]
      p["view"].set_focus(active)
      p["header"].bgcolor = ACTIVE_BG if active else "transparent"
      p["header"].border = Border(bottom=BorderSide(2 if active else 1, ACCENT if active else BORDER_COLOR))
      p["label"].color = TEXT if active else MUTED
    # cuadrícula: 1-2 paneles en una fila, 3-4 en 2x2, 5-9 en 3 columnas, etc.
    cols = math.ceil(math.sqrt(len(panes))) if len(panes) > 2 else len(panes)
    rows = [panes[i:i + cols] for i in range(0, len(panes), cols)] if panes else []
    for r, line in enumerate(rows):
      for c, p in enumerate(line):  # solo líneas divisorias entre paneles, sin marcos dobles
        p["box"].border = Border(
          right=BorderSide(1, BORDER_COLOR) if c < len(line) - 1 else None,
          bottom=BorderSide(1, BORDER_COLOR) if r < len(rows) - 1 else None,
        )
    grid.controls = [
      Row([p["box"] for p in line], expand=1, spacing=0, vertical_alignment=CrossAxisAlignment.STRETCH)
      for line in rows
    ]
    agents_area.content = grid if panes else empty
    shell_area.visible = shell_handle.visible = shell["pane"] is not None
    shell_area.content = shell["pane"]["box"] if shell["pane"] else None
    page.update()

  def select(pane):
    refocus()
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

  def choose_agent():
    picker = AgentPicker(page, open_agent)
    picker.on_closed = lambda: (state.update(picker=None), refocus())
    state["picker"] = picker
    picker.open()

  # --- entrada de texto -------------------------------------------------------
  # El texto lo escribe un campo oculto con el foco: así llegan bien AltGr (@, |, €), las teclas
  # muertas (á, ñ) y los métodos de entrada. Las teclas especiales y Ctrl/Alt van por eventos.
  def on_text(e):
    new = e.control.value or ""
    old = state["text"]
    state["text"] = new
    # lo insertado = lo que cambió entre el texto anterior y el nuevo
    p = 0
    while p < min(len(old), len(new)) and old[p] == new[p]:
      p += 1
    q = 0
    while q < min(len(old), len(new)) - p and old[len(old) - 1 - q] == new[len(new) - 1 - q]:
      q += 1
    inserted = new[p:len(new) - q]
    if inserted:
      state["text_at"] = time.monotonic()
      pane = state["active"]
      if pane and not state["picker"]:
        pane["view"].write_text(inserted)
    if len(new) > 64:          # el campo es solo un buffer: se vacía para que no crezca
      e.control.value = ""
      state["text"] = ""
      e.control.update()

  input_field = TextField(
    value="", width=20, height=20, opacity=0, text_size=1, border=NoInputBorder(),
    content_padding=0, autocorrect=False, enable_suggestions=False, autofocus=True,
    on_change=on_text,
    on_focus=lambda e: state.update(field_focus=True),
    on_blur=lambda e: state.update(field_focus=False),
  )

  def refocus():
    page.run_task(input_field.focus)

  def goes_through_field(e):
    """¿Esta tecla la escribirá el campo oculto (y no hay que enviarla por evento)?"""
    return state["field_focus"] and len(e.key) == 1 and not (e.ctrl and not e.alt)

  async def on_key(e):
    if state["picker"]:        # con la paleta abierta, las teclas no van a la terminal
      state["picker"].handle_key(e)
      return
    state["mods"] = (e.shift, e.ctrl, e.alt)   # para las repeticiones de esta tecla
    pane = state["active"]
    if not pane:
      return
    if e.ctrl and e.shift and e.key == "V":
      text = await clipboard.get()
      if text:
        pane["view"].paste(text)
      return
    if goes_through_field(e):
      if e.alt and not e.ctrl:
        # Alt+letra = Meta, salvo que sea AltGr y el campo reciba un carácter: se espera un instante
        t0 = time.monotonic()
        await asyncio.sleep(0.05)
        if state["text_at"] < t0:
          pane["view"].send_key(e)
      return
    pane["view"].send_key(e)

  page.on_keyboard_event = on_key

  def on_key_repeat(e):
    """Tecla mantenida pulsada: se reenvía a la terminal activa (p. ej. borrar con Retroceso)."""
    shift, ctrl, alt = state["mods"]
    key = SimpleNamespace(key=e.key, shift=shift, ctrl=ctrl, alt=alt)
    if goes_through_field(key) and not state["picker"]:
      return                  # las repeticiones de texto también las recibe el campo
    if state["picker"]:
      state["picker"].handle_key(key)
    elif state["active"]:
      state["active"]["view"].send_key(key)

  control = Column(
    expand=True,
    spacing=0,
    horizontal_alignment=CrossAxisAlignment.STRETCH,
    controls=[agents_area, shell_handle, shell_area],
  )
  control.open_agent = open_agent
  control.toggle_terminal = toggle_terminal
  control.choose_agent = choose_agent
  control.on_key_repeat = on_key_repeat
  # fuera de la pantalla (-60,-60): recibe el foco del teclado sin tapar nada
  control.input_widget = Container(
    left=-60, top=-60, width=20, height=20,
    content=KeyboardListener(autofocus=True, on_key_repeat=on_key_repeat, content=input_field),
  )
  return control
