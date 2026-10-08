import asyncio
import time
from flet import (
  AlertDialog, Container, Column, Row, Text, Icon, Icons, TextField, TextButton, Padding,
  RoundedRectangleBorder, ScrollMode, TextOverflow, FontWeight, MainAxisAlignment,
  CrossAxisAlignment, SnackBar, TextStyle,
)
from orches.core.git import branches, checkout, create_branch
from orches.ui.components.clickable import Clickable
from orches.ui.components.modal import show_modal
from orches.ui.theme import ACCENT, ACCENT_BG, BORDER_COLOR

MUTED = "#6B7088"
TEXT = "#E6E8EF"
CARD = "#11141D"


def ago(timestamp):
  """'Hace 5 min', 'Hace 1 hora', 'Hace 3 días'..."""
  seconds = max(0, time.time() - timestamp)
  for size, one, many in ((86400 * 365, "año", "años"), (86400 * 30, "mes", "meses"), (86400, "día", "días"),
                          (3600, "hora", "horas"), (60, "min", "min")):
    if seconds >= size:
      n = int(seconds // size)
      return f"Hace {n} {one if n == 1 else many}"
  return "Hace un momento"


def BranchPicker(page, project, on_changed):
  """Selector de ramas estilo paleta de comandos: buscar, cambiar de rama o crear una nueva."""
  state = {"branches": [], "query": "", "choosing_base": False, "close": None}

  def toast(message):
    page.show_dialog(SnackBar(Text(message)))

  search = TextField(
    hint_text="Seleccionar una rama o etiqueta para extraer del repositorio", dense=True, text_size=12,
    hint_style=TextStyle(size=12, color=MUTED), autofocus=True, cursor_color=ACCENT,
    border_color=BORDER_COLOR, focused_border_color=ACCENT, border_radius=6,
    content_padding=Padding(left=12, right=12, top=9, bottom=9),
    on_change=lambda e: refilter(), on_submit=lambda e: submit(),
  )
  listing = Column(spacing=1, scroll=ScrollMode.AUTO, tight=True)

  def action(icon, label, on_click):
    return Clickable(
      Row(spacing=10, controls=[Icon(icon, size=16, color=MUTED), Text(label, size=12, color=TEXT)]),
      on_click, hover_bg=ACCENT_BG, padding=Padding(left=10, right=10, top=8, bottom=8), border_radius=6,
    )

  def section(title):
    return Container(padding=Padding(left=10, top=8, bottom=2),
                     content=Text(title, size=10, weight=FontWeight.W_600, color=MUTED))

  def branch_row(b):
    sync = f"  {b.behind}↓ {b.ahead}↑" if b.current and b.has_upstream else ""
    return Clickable(
      Row(spacing=10, vertical_alignment=CrossAxisAlignment.CENTER, controls=[
        Icon(Icons.CLOUD_OUTLINED if b.remote else Icons.CALL_SPLIT, size=16, color=ACCENT if b.current else MUTED),
        Column(spacing=1, expand=True, controls=[
          Row(spacing=0, controls=[
            Text(b.name, size=12, color=TEXT, weight=FontWeight.W_600 if b.current else None),
            Text(sync, size=10, color=MUTED),
          ]),
          Text(f"{b.author} • {b.commit} • {b.subject}", size=10, color=MUTED, no_wrap=True,
               overflow=TextOverflow.ELLIPSIS),
        ]),
        Text(ago(b.timestamp), size=10, color=MUTED),
      ]),
      lambda e, b=b: chosen(b), hover_bg=ACCENT_BG,
      padding=Padding(left=10, right=10, top=6, bottom=6), border_radius=6,
    )

  def render(update=True):
    query = (search.value or "").strip().lower()
    shown = [b for b in state["branches"] if query in b.name.lower()]
    controls = []
    if not state["choosing_base"]:
      controls += [
        action(Icons.ADD, "Crear nueva rama...", lambda e: ask_name(None)),
        action(Icons.ADD, "Crear nueva rama a partir de...", lambda e: start_base()),
      ]
    else:
      controls.append(Container(padding=Padding(left=10, top=4, bottom=4),
                                content=Text("Elige la rama a partir de la cual crear la nueva",
                                             size=11, color=ACCENT)))
    local = [b for b in shown if not b.remote]
    remote = [b for b in shown if b.remote]
    if local:
      controls += [section("ramas"), *[branch_row(b) for b in local]]
    if remote:
      controls += [section("ramas remotas"), *[branch_row(b) for b in remote]]
    if not shown:
      controls.append(Text("Ninguna rama coincide", size=11, color=MUTED))
    listing.controls = controls
    if update:
      listing.update()

  def refilter():
    render()

  def submit():
    """Enter: abre la primera rama que coincide con lo escrito."""
    query = (search.value or "").strip().lower()
    for b in state["branches"]:
      if query and query in b.name.lower():
        return chosen(b)

  # --- acciones ---------------------------------------------------------------------------------
  def start_base():
    state["choosing_base"] = True
    search.value = ""
    search.update()
    render()

  def chosen(b):
    if state["choosing_base"]:
      return ask_name(b.name)
    state["close"]()
    page.run_task(do_checkout, b)

  async def do_checkout(b):
    ok, message = await asyncio.to_thread(checkout, project, b.name, b.remote)
    toast(f"Ahora estás en {b.name.split('/', 1)[-1] if b.remote else b.name}" if ok
          else "git: " + (message.splitlines()[0] if message else "no se pudo cambiar de rama"))
    on_changed()

  def ask_name(base):
    initial = "" if state["choosing_base"] else (search.value or "").strip()
    state["close"]()
    field = TextField(label="Nombre de la nueva rama", value=initial, autofocus=True, dense=True, text_size=12,
                      cursor_color=ACCENT, focused_border_color=ACCENT, border_color=BORDER_COLOR)

    def create(e=None):
      name = (field.value or "").strip().replace(" ", "-")
      if not name:
        field.error = "Escribe un nombre"
        field.update()
        return
      close_name()
      page.run_task(do_create, name, base)

    field.on_submit = create
    close_name = show_modal(page, AlertDialog(
      modal=False, bgcolor=CARD, shape=RoundedRectangleBorder(radius=10),
      title=Text("Crear nueva rama" + (f" desde {base}" if base else ""), size=14),
      content=Container(width=340, content=field),
      actions=[TextButton("Cancelar", on_click=lambda e: close_name()), TextButton("Crear", on_click=create)],
    ))

  async def do_create(name, base):
    ok, message = await asyncio.to_thread(create_branch, project, name, base)
    toast(f"Rama {name} creada" if ok else "git: " + (message.splitlines()[0] if message else "no se pudo crear"))
    on_changed()

  # --- abrir ---------------------------------------------------------------------------------------
  async def load():
    state["branches"] = await asyncio.to_thread(branches, project)
    render(update=False)
    state["close"] = show_modal(page, AlertDialog(
      modal=False, bgcolor=CARD, shape=RoundedRectangleBorder(radius=10),
      inset_padding=Padding(left=20, right=20, top=40, bottom=40),
      content_padding=Padding(left=10, right=10, top=10, bottom=10),
      content=Container(width=560, height=420, content=Column(
        spacing=8, horizontal_alignment=CrossAxisAlignment.STRETCH,
        controls=[search, Container(content=listing, expand=True)],
      )),
    ))

  page.run_task(load)
