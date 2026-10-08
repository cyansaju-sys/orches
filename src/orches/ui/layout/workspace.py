import asyncio
import json
import math
import threading
import time
from pathlib import Path
from types import SimpleNamespace
from flet import (
  Container, Column, Row, Text, Icon, Icons, Image, Padding, Clipboard, TextField,
  KeyboardListener, NoInputBorder,
  CrossAxisAlignment, MainAxisAlignment, Border, BorderSide, ClipBehavior, SnackBar, AlertDialog, TextButton,
  RoundedRectangleBorder,
)
from orches.core import settings
from orches.core.agents import detect_agents
from orches.core.models import current_model, tier
from orches.core.orchestra import Orchestra
from orches.core.pty_session import default_shell
from orches.ui.components.resize import resize_handle_height
from orches.ui.theme import ACCENT, ACCENT_BG, ACCENT_DIM, BORDER_COLOR, border_all
from orches.ui.dialogs.agent_picker import AgentPicker
from orches.ui.components.clickable import IconAction, Clickable
from orches.ui.components.modal import modal_open, set_typing, show_modal, typing_open
from orches.ui.components.permissions import toggle_edit
from orches.ui.dialogs.shortcuts import open_shortcuts
from orches.ui.terminal.view import TerminalView, FONT, FONT_FILE

SHELL_HEIGHT = 260
SHELL_MIN = 80
MUTED = "#6B7088"
TEXT = "#E6E8EF"
ACTIVE_BG = ACCENT_BG

# herramientas del servidor "orches" que Claude Code puede usar sin pedir permiso cada vez
ORCHES_TOOLS = ["mcp__orches__list_agents", "mcp__orches__delegate_task",
                "mcp__orches__wait_agent", "mcp__orches__read_agent_output"]
# cómo arrancar cada agente con una tarea inicial (el resto la recibe escrita cuando ya está listo)
PROMPT_ARGS = {"claude": lambda text: [text], "opencode": lambda text: ["--prompt", text]}
BUSY_SECONDS = 4      # sin salida durante este tiempo = el agente ya no está trabajando


class DocumentView:
  """Contenido que no es una terminal (p. ej. el código de un objeto de la base) dentro de un panel."""

  def __init__(self, control):
    self.control = control
    self.on_focus = None

  def close(self):
    pass

  def set_focus(self, focused):
    pass

  def send_key(self, e):
    pass

  def write_text(self, text):
    pass

  def paste(self, text):
    pass

  def idle_for(self):
    return 999.0


def Workspace(page):
  """Panel principal: los agentes se reparten el ancho; una terminal opcional va debajo."""
  page.fonts = {**(page.fonts or {}), FONT: FONT_FILE}
  panes = []            # paneles de agentes, uno al lado del otro
  orchestra = {"server": None, "next_id": 1}
  if settings.get("orchestration", True):
    try:
      orchestra["server"] = Orchestra(SimpleNamespace(
        list_agents=lambda caller: host_list(caller),
        delegate=lambda caller, target, task, new: host_delegate(caller, target, task, new),
        output=lambda agent_id, lines: host_output(agent_id, lines),
      )).start()
    except OSError:
      pass            # sin servidor local la app funciona igual, solo sin reparto de tareas
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

  def agent_panes():
    return [p for p in panes if "agent" in p]       # los documentos no son agentes

  def all_panes():
    return panes + ([shell["pane"]] if shell["pane"] else [])

  def refresh():
    for p in all_panes():
      active = p is state["active"]
      p["view"].set_focus(active)
      p["header"].bgcolor = ACTIVE_BG if active else "transparent"
      p["header"].border = Border(bottom=BorderSide(2 if active else 1, ACCENT if active else BORDER_COLOR))
      p["label"].color = TEXT if active else MUTED
      if "base_title" in p:
        agents = agent_panes()
        p["label"].value = (("● " if p.get("dirty") else "")
                            + p["base_title"] + (" · líder" if len(agents) > 1 and p is agents[0] else ""))
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

  def activate(pane):
    """Marca el panel como activo sin quitarle el foco al control que lo tiene (p. ej. un editor)."""
    if state["active"] is not pane:
      state["active"] = pane
      refresh()

  def set_dirty(pane, dirty):
    pane["dirty"] = dirty
    pane["label"].value = ("● " if dirty else "") + pane["base_title"]
    try:
      pane["label"].update()
    except RuntimeError:
      pass

  def select(pane):
    set_typing(False)   # clic en una terminal: el teclado vuelve a ser suyo
    refocus()
    if state["active"] is not pane:
      state["active"] = pane
      refresh()

  def make_pane(title, icon, view, on_close, expand=None):
    label = Text(title, size=12, no_wrap=True, expand=True)
    pane = {"view": view, "label": label, "base_title": title}
    view.on_focus = lambda: select(pane)
    pane["header"] = Container(
      padding=Padding(left=10, right=2, top=4, bottom=4),
      content=Row(
        spacing=6,
        controls=[
          # ícono de Material Icon Theme (ruta de un SVG) o ícono de Flet
          Image(src=icon, width=16, height=16) if isinstance(icon, str) else Icon(icon, size=14, color=ACCENT),
          label,
          IconAction(Icons.CLOSE, lambda e, p=pane: on_close(p), size=14, color=MUTED,
                     hover_color=TEXT, hover_bg="#2A2F3D", width=24, height=24),
        ],
      ),
    )
    pane["box"] = Container(
      expand=expand,
      content=Column(
        expand=True,
        spacing=0,
        horizontal_alignment=CrossAxisAlignment.STRETCH,
        controls=[pane["header"], view.control],
      ),
    )
    return pane

  def close_agent(pane):
    if pane.get("dirty"):          # un documento con cambios sin guardar no se cierra en silencio
      control = pane["view"].control

      async def save_and_close():
        await control.save_async()
        if not pane.get("dirty"):
          close_now(pane)

      close = show_modal(page, AlertDialog(
        modal=False, bgcolor="#11141D", shape=RoundedRectangleBorder(radius=10),
        title=Text("Cambios sin guardar", size=14),
        content=Text(f"«{pane['base_title']}» tiene cambios sin guardar.", size=12, color=MUTED),
        actions=[TextButton("Cancelar", on_click=lambda e: close()),
                 TextButton("Descartar", on_click=lambda e: (close(), close_now(pane))),
                 TextButton("Guardar y cerrar", on_click=lambda e: (close(), page.run_task(save_and_close)))]))
      return
    close_now(pane)

  def close_now(pane):
    pane["view"].close()
    idx = panes.index(pane)
    panes.remove(pane)
    if state["active"] is pane:
      state["active"] = panes[min(idx, len(panes) - 1)] if panes else shell["pane"]
    refresh()

  def initial_args(command, prompt):
    """Argumentos para arrancar el agente ya con una tarea (si su comando lo permite)."""
    if not prompt:
      return []
    if command == "claude":
      return [prompt]      # va primero: --mcp-config acepta varios valores y se lo comería
    if command == "opencode":
      return PROMPT_ARGS["opencode"](prompt)
    return []

  def mcp_args(command, pane_id):
    server = orchestra["server"]
    if not server:
      return [], {}
    entry = server.config_for(pane_id)
    if command == "claude":
      return (["--mcp-config", json.dumps({"mcpServers": {"orches": entry}}), "--allowedTools", *ORCHES_TOOLS], {})
    if command == "opencode":
      config = {"mcp": {"servers": {"orches": {"type": "remote", "url": entry["url"], "headers": entry["headers"]}}}}
      return [], {"OPENCODE_CONFIG_CONTENT": json.dumps(config)}
    return [], {}

  def open_agent(agent, project, args=(), title=None, prompt=None):
    """Abre un agente en un panel. `prompt` = tarea inicial (reparto entre agentes)."""
    pane_id = f"a{orchestra['next_id']}"
    orchestra["next_id"] += 1
    command = agent["command"]
    first = initial_args(command, prompt)
    extra, extra_env = mcp_args(command, pane_id)
    view = TerminalView(page, command, project, args=[*first, *args, *extra], env=extra_env)
    # expand=1: todos los agentes reparten el ancho por igual
    pane = make_pane(title or f"{agent['name']} · {Path(project).name}", Icons.SMART_TOY, view, close_agent, expand=1)
    pane.update(id=pane_id, agent=agent, project=str(project))
    panes.append(pane)
    state["active"] = pane
    refresh()
    if prompt and command not in PROMPT_ARGS:
      deliver_later(view, prompt)
    return pane_id

  def deliver_later(view, text):
    """Agentes sin argumento de tarea inicial: se escribe cuando su interfaz ya está lista."""
    def wait_and_send():
      deadline = time.monotonic() + 40
      while time.monotonic() < deadline:
        if view.last_output and view.idle_for() >= 2:
          view.send_prompt(text)
          return
        time.sleep(0.5)
    threading.Thread(target=wait_and_send, daemon=True).start()

  # --- reparto de tareas: lo que el servidor MCP le pide a la app ------------------------------
  def find(agent_id):
    return next((p for p in list(panes) if p.get("id") == agent_id), None)

  def info(p, lead):
    model = current_model(p["agent"]["command"], p["project"])
    level, known = tier(model)
    return {
      "id": p["id"], "agent": p["agent"]["name"], "command": p["agent"]["command"],
      "model": model or "desconocido", "tier": level, "model_recognized": known,
      "role": "líder" if p is lead else "trabajador",
      "status": "ocupado" if p["view"].idle_for() < BUSY_SECONDS else "libre",
      "project": p["project"],
    }

  def host_list(caller):
    snapshot = agent_panes()
    lead = snapshot[0] if snapshot else None
    project = lead["project"] if lead else settings.get("project")
    available = []
    for a in detect_agents():
      model = current_model(a["command"], project) if project else None
      level, known = tier(model)
      available.append({"agent": a["name"], "command": a["command"], "last_model": model or "desconocido", "tier": level})
    return {"open_agents": [info(p, lead) for p in snapshot], "installed_agents": available,
            "you_are": caller, "lead": lead["id"] if lead else None}

  def notify(text):
    async def show():
      page.show_dialog(SnackBar(Text(text)))
    page.run_task(show)

  def host_delegate(caller, target, task, new_instance):
    snapshot = agent_panes()
    lead = snapshot[0] if snapshot else None
    if not lead or lead["id"] != caller:
      return False, "Solo el agente líder puede repartir tareas."
    pane = find(target)
    if pane is lead or target == caller:
      return False, "No puedes delegarte una tarea a ti mismo."
    if pane is None:
      match = next((a for a in detect_agents() if target.lower() in (a["command"].lower(), a["name"].lower())), None)
      if not match:
        return False, f"No conozco el agente '{target}'. Usa list_agents para ver los disponibles."
      if not new_instance:
        pane = next((p for p in snapshot if p is not lead and p["agent"]["command"] == match["command"]
                     and p["view"].idle_for() >= BUSY_SECONDS), None)
      if pane is None:   # no hay uno libre: se abre uno nuevo ya con la tarea
        async def create():
          return open_agent(match, lead["project"], prompt=task)
        try:
          new_id = page.run_task(create).result(timeout=20)
        except Exception as e:
          return False, f"No se pudo abrir {match['name']}: {e}"
        notify(f"{lead['agent']['name']} abrió {match['name']} con una tarea")
        return True, {"agent_id": new_id, "message": f"Abrí {match['name']} con la tarea. Usa wait_agent para esperar su resultado."}
    pane["view"].send_prompt(task)
    notify(f"{lead['agent']['name']} delegó una tarea a {pane['agent']['name']}")
    return True, {"agent_id": pane["id"], "message": "Tarea enviada. Usa wait_agent para esperar su resultado."}

  def host_output(agent_id, lines):
    pane = find(agent_id)
    if not pane:
      return None
    idle = pane["view"].idle_for()
    return {"agent_id": agent_id, "busy": idle < BUSY_SECONDS, "idle_seconds": round(idle, 1),
            "text": pane["view"].screen_text(max(5, min(lines, 400)))}

  def open_document(title, icon, make, key=None):
    """Abre un documento (archivo, objeto de la base...) en un panel. `make()` crea su contenido.

    Con `key`, si ese documento ya está abierto solo se le da el foco en vez de abrirlo otra vez.
    """
    if key is not None:
      existing = next((p for p in panes if p.get("doc_key") == key), None)
      if existing:
        select(existing)
        return
    control = make()
    pane = make_pane(title, icon, DocumentView(control), close_agent, expand=1)
    pane["doc_key"] = key
    control.focus_cb = lambda: activate(pane)                  # el editor se enfocó: este panel pasa a ser el activo
    control.on_dirty = lambda dirty: set_dirty(pane, dirty)
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

  async def focus_input():
    try:
      await input_field.focus()
    except Exception:
      pass          # el campo aún no está montado (p. ej. justo tras recargar): no es grave

  def refocus():
    page.run_task(focus_input)

  def goes_through_field(e):
    """¿Esta tecla la escribirá el campo oculto (y no hay que enviarla por evento)?"""
    return state["field_focus"] and len(e.key) == 1 and not (e.ctrl and not e.alt)

  def active_document():
    """Control del documento activo si es editable (tiene `save`), o None."""
    pane = state["active"]
    control = getattr(pane["view"], "control", None) if pane else None
    return control if pane and "agent" not in pane and hasattr(control, "save") else None

  hooks = {}          # funciones que conecta main (p. ej. cambiar de pestaña de la barra lateral)
  TABS = {"E": "files", "A": "agents", "G": "git", "D": "db", "X": "mcp", "U": "ai"}

  def cycle_panes(step):
    order = list(panes)
    if not order:
      return
    current = state["active"]
    index = order.index(current) if current in order else -1
    select(order[(index + step) % len(order)])

  def close_active():
    pane = state["active"]
    if pane:
      (close_shell if pane is shell["pane"] else close_agent)(pane)

  def run_shortcut(e):
    """Atajos globales. Devuelve True si la tecla era un atajo (y por tanto no va a la terminal)."""
    key = e.key.upper() if len(e.key) == 1 else e.key
    if e.ctrl and e.shift and key in TABS and hooks.get("tab"):
      hooks["tab"](TABS[key])
    elif e.ctrl and e.shift and key == "N":
      choose_agent()
    elif e.ctrl and e.shift and key == "T":
      toggle_terminal()
    elif e.ctrl and e.shift and key == "W":
      close_active()
    elif e.ctrl and e.shift and key == "B" and hooks.get("toggle_sidebar"):
      hooks["toggle_sidebar"]()
    elif e.ctrl and e.shift and key == "L":
      toggle_edit()
    elif e.ctrl and not e.shift and key == "Page Down":
      cycle_panes(1)
    elif e.ctrl and not e.shift and key == "Page Up":
      cycle_panes(-1)
    elif key == "F1":
      open_shortcuts(page)
    else:
      return False
    return True

  async def on_key(e):
    if not modal_open():
      if run_shortcut(e):
        return
      doc = active_document()
      if doc and e.ctrl and not e.shift and e.key.lower() == "w":   # Ctrl+W cierra el archivo abierto
        close_active()
        return
      if doc and e.ctrl and e.key.lower() == "s":      # Ctrl+S guarda el archivo que se está editando
        doc.save()
        return
      if doc and typing_open() and hasattr(doc, "handle_suggest_key") and doc.handle_suggest_key(e):
        return                                          # ↑↓ Tab Esc eligen o cierran las sugerencias
      if doc and typing_open() and e.ctrl and not e.shift and e.key == "Space" and hasattr(doc, "trigger_suggest"):
        doc.trigger_suggest()                           # Ctrl+Espacio: pedir sugerencias
        return
      if doc and e.key == "Tab" and typing_open():     # Tab dentro del editor inserta una sangría
        doc.insert_tab(e.shift)
        return
    if modal_open() or typing_open():   # diálogo o campo de texto abierto: las teclas son suyas
      return
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
    if modal_open() or typing_open():
      return
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
  control.bind = lambda name, fn: hooks.__setitem__(name, fn)
  control.open_document = open_document
  control.toggle_terminal = toggle_terminal
  control.choose_agent = choose_agent
  control.on_key_repeat = on_key_repeat
  # fuera de la pantalla (-60,-60): recibe el foco del teclado sin tapar nada
  control.input_widget = Container(
    left=-60, top=-60, width=20, height=20,
    content=KeyboardListener(autofocus=True, on_key_repeat=on_key_repeat, content=input_field),
  )
  return control
