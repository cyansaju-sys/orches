import asyncio
import importlib.util
from flet import (
  AlertDialog, Container, Column, Row, Text, Icon, Icons, TextField, TextButton, Checkbox, Padding,
  RoundedRectangleBorder, ScrollMode, TextOverflow, FontWeight, MainAxisAlignment, CrossAxisAlignment,
  SnackBar, Dropdown, DropdownOption, TextStyle, ProgressRing,
)
from orches.core import secrets, settings
from orches.core.db import profiles
from orches.core.db.oracle import SINGULAR, DbError, OracleSession, TYPES
from orches.ui.components.clickable import Clickable, IconAction
from orches.ui.components.modal import set_typing, show_modal
from orches.ui.theme import ACCENT, ACCENT_BG, BORDER_COLOR

MUTED = "#6B7088"
TEXT = "#E6E8EF"
CARD = "#11141D"
ERROR = "#FF6B81"
LIMIT = 200       # objetos por grupo antes de pedir que se use el buscador

ICONS = {
  "TABLE": Icons.TABLE_CHART, "VIEW": Icons.VISIBILITY, "MATERIALIZED VIEW": Icons.LAYERS,
  "FUNCTION": Icons.FUNCTIONS, "PROCEDURE": Icons.SETTINGS_APPLICATIONS, "PACKAGE": Icons.INVENTORY_2,
  "TRIGGER": Icons.BOLT, "SEQUENCE": Icons.FORMAT_LIST_NUMBERED, "TYPE": Icons.DATA_OBJECT, "SYNONYM": Icons.LINK,
}


def _missing_libs():
  """Paquetes opcionales que faltan, para avisar con el comando exacto."""
  return [name for name in ("oracledb", "keyring") if importlib.util.find_spec(name) is None]


def DatabaseView(page, open_object):
  """Conexión a bases de datos (Oracle) y explorador de objetos: tablas, vistas, funciones, SPR, paquetes..."""
  body = Column(spacing=2, scroll=ScrollMode.AUTO, expand=True, horizontal_alignment=CrossAxisAlignment.STRETCH)
  state = {"session": None, "profile": None, "owners": [], "owner": None, "objects": [], "query": "", "busy": ""}

  def toast(message):
    page.show_dialog(SnackBar(Text(message)))

  def field(label, value="", **kwargs):
    return TextField(label=label, value=value, dense=True, text_size=12, cursor_color=ACCENT,
                     border_color=BORDER_COLOR, focused_border_color=ACCENT, **kwargs)

  def dialog(title, content, actions):
    return AlertDialog(modal=False, bgcolor=CARD, shape=RoundedRectangleBorder(radius=10),
                       title=Text(title, size=14), content=content, actions=actions)

  # --- pantalla: lista de conexiones / explorador ------------------------------------------------
  def render():
    session = state["session"]
    if state["busy"]:
      body.controls = [Row(spacing=10, controls=[ProgressRing(width=16, height=16, stroke_width=2, color=ACCENT),
                                                  Text(state["busy"], size=12, color=MUTED)])]
    elif session:
      body.controls = explorer()
    else:
      body.controls = connections()
    try:
      body.update()
    except RuntimeError:
      pass

  def connections():
    missing = _missing_libs()
    controls = [Container(padding=Padding(left=6, right=2, bottom=4), content=Row(
      alignment=MainAxisAlignment.SPACE_BETWEEN, vertical_alignment=CrossAxisAlignment.CENTER, controls=[
        Text("BASES DE DATOS", size=11, weight=FontWeight.W_600, color=MUTED),
        IconAction(Icons.ADD, lambda e: edit_profile(None), size=18, color=ACCENT, hover_bg=ACCENT_BG, width=28, height=28,
                   tooltip="Nueva conexión"),
      ]))]
    if missing:
      controls.append(Container(padding=10, border_radius=6, bgcolor="#2A2418", content=Column(spacing=4, controls=[
        Row(spacing=6, controls=[Icon(Icons.WARNING_AMBER, size=14, color="#E2C08D"),
                                 Text("Faltan paquetes de Python", size=11, weight=FontWeight.W_600, color="#E2C08D")]),
        Text("uv add " + " ".join(missing), size=11, color=TEXT, selectable=True),
        Text("oracledb conecta con Oracle; keyring guarda la contraseña en el llavero del sistema.", size=10, color=MUTED),
      ])))
    saved = profiles.load()
    if not saved:
      controls.append(Text("Sin conexiones. Pulsa + para añadir una base Oracle.", size=11, color=MUTED))
    for p in saved:
      controls.append(Clickable(
        Row(spacing=8, vertical_alignment=CrossAxisAlignment.CENTER, controls=[
          Icon(Icons.STORAGE, size=16, color=ACCENT),
          Column(spacing=1, expand=True, controls=[
            Text(p.name, size=12, color=TEXT, weight=FontWeight.W_600),
            Text(p.summary, size=10, color=MUTED, no_wrap=True, overflow=TextOverflow.ELLIPSIS),
          ]),
          *([Icon(Icons.LOCK_OUTLINE, size=12, color=MUTED, tooltip="Contraseña guardada")] if p.save_password else []),
          IconAction(Icons.MORE_HORIZ, lambda e, p=p: profile_menu(p), size=16, color=MUTED, hover_color=TEXT,
                     hover_bg="#2A2F3D", width=26, height=26),
        ]),
        lambda e, p=p: start_connect(p), hover_bg=ACCENT_BG, padding=Padding(left=6, right=2, top=4, bottom=4),
        border_radius=6, tooltip="Conectar"))
    return controls

  widgets = {}

  def search_field():
    if "search" not in widgets:
      widgets["search"] = TextField(
        hint_text="Buscar objeto", dense=True, text_size=12, hint_style=TextStyle(size=12, color=MUTED),
        prefix_icon=Icons.SEARCH, cursor_color=ACCENT, border_color=BORDER_COLOR, focused_border_color=ACCENT,
        border_radius=6, content_padding=Padding(left=8, right=8, top=6, bottom=6),
        on_focus=lambda e: set_typing(True), on_blur=lambda e: set_typing(False),
        on_change=lambda e: search_changed(e.control.value))
    widgets["search"].value = state["query"]
    return widgets["search"]

  def owner_dropdown():
    if "owners" not in widgets:
      widgets["owners"] = Dropdown(
        on_select=lambda e: page.run_task(change_owner, e.control.value), dense=True, text_size=12,
        border_color=BORDER_COLOR, enable_search=True, label="Esquema")
    widgets["owners"].options = [DropdownOption(key=o, text=o) for o in state["owners"]]
    widgets["owners"].value = state["owner"]
    return widgets["owners"]

  def explorer():
    profile = state["profile"]
    query = state["query"].strip().lower()
    folded = settings.get("collapsed") or {}
    controls = [
      Row(alignment=MainAxisAlignment.SPACE_BETWEEN, vertical_alignment=CrossAxisAlignment.CENTER, controls=[
        Row(spacing=6, expand=True, controls=[Icon(Icons.CLOUD_DONE, size=14, color="#7CCB8B"),
                                              Text(profile.name, size=12, weight=FontWeight.W_600, color=TEXT, no_wrap=True,
                                                   overflow=TextOverflow.ELLIPSIS)]),
        IconAction(Icons.REFRESH, lambda e: page.run_task(reload_objects), size=16, color=MUTED, hover_color=ACCENT,
                   hover_bg=ACCENT_BG, width=26, height=26, tooltip="Recargar objetos"),
        IconAction(Icons.POWER_SETTINGS_NEW, lambda e: disconnect(), size=16, color=MUTED, hover_color=ERROR,
                   hover_bg="#2A1A22", width=26, height=26, tooltip="Desconectar"),
      ]),
      Container(padding=Padding(top=6, bottom=4), content=owner_dropdown()),
      search_field(),
    ]
    for kind, title in TYPES:
      items = [o for o in state["objects"] if o.type == kind and (not query or query in o.name.lower())]
      if not items:
        continue
      closed = folded.get(f"db_{kind}", False) and not query      # al buscar se despliega todo
      controls.append(Clickable(
        Row(spacing=4, vertical_alignment=CrossAxisAlignment.CENTER, controls=[
          Icon(Icons.KEYBOARD_ARROW_RIGHT if closed else Icons.KEYBOARD_ARROW_DOWN, size=16, color=MUTED),
          Text(f"{title.upper()} · {len(items)}", size=10, weight=FontWeight.W_600, color=MUTED)]),
        lambda e, k=kind: toggle_group(k), hover_bg=ACCENT_BG, padding=Padding(left=2, right=6, top=5, bottom=5),
        border_radius=6))
      if closed:
        continue
      for o in items[:LIMIT]:
        controls.append(Clickable(
          Row(spacing=8, vertical_alignment=CrossAxisAlignment.CENTER, controls=[
            Icon(ICONS.get(kind, Icons.CIRCLE), size=14, color=ACCENT if o.valid else ERROR),
            Text(o.name, size=12, color=TEXT if o.valid else ERROR, no_wrap=True, overflow=TextOverflow.ELLIPSIS, expand=True),
            *([Icon(Icons.ERROR_OUTLINE, size=12, color=ERROR, tooltip="Objeto inválido")] if not o.valid else []),
          ]),
          lambda e, o=o: open_object(state["session"], state["owner"], o), hover_bg=ACCENT_BG,
          padding=Padding(left=18, right=6, top=3, bottom=3), border_radius=4,
          tooltip=SINGULAR.get(o.type, o.type.title()) + (f" · modificado {o.modified}" if o.modified else "")))
      if len(items) > LIMIT:
        controls.append(Text(f"… {len(items) - LIMIT} más: usa el buscador", size=10, color=MUTED))
    if not state["objects"]:
      controls.append(Text("Este esquema no tiene objetos visibles.", size=11, color=MUTED))
    return controls

  def toggle_group(kind):
    folded = dict(settings.get("collapsed") or {})
    folded[f"db_{kind}"] = not folded.get(f"db_{kind}", False)
    settings.set("collapsed", folded)
    render()

  def search_changed(value):
    state["query"] = value or ""
    render()          # se repinta la lista; el campo de búsqueda es el mismo control y conserva el foco

  # --- conexión ---------------------------------------------------------------------------------
  # El llavero puede pedir desbloquear la cartera (KWallet, GNOME...) y tardar: nada de eso va en el
  # hilo de la interfaz, o la app parecería colgada.
  def start_connect(profile):
    page.run_task(start_connect_async, profile)

  async def start_connect_async(profile):
    password = await asyncio.to_thread(profiles.password, profile)
    if password is not None:
      await connect(profile, password)
    else:
      ask_password(profile)

  def ask_password(profile):
    password = field("Contraseña", password=True, can_reveal_password=True, autofocus=True)
    ok, why = secrets.available()
    remember = Checkbox(label="Guardar la contraseña en el llavero del sistema", value=False, disabled=not ok)

    async def accept_async():
      close()
      if remember.value:
        profile.save_password = True
        warning = await asyncio.to_thread(profiles.save, profile, password.value)
        if warning:
          toast(warning)
      await connect(profile, password.value)

    def accept(e=None):
      if not password.value:
        password.error = "Escribe la contraseña"
        password.update()
        return
      page.run_task(accept_async)

    password.on_submit = accept
    close = show_modal(page, dialog(
      f"Conectar a {profile.name}",
      Container(width=340, content=Column(tight=True, spacing=8, controls=[
        Text(profile.summary, size=11, color=MUTED), password, remember,
        *([Text(why, size=10, color=MUTED)] if not ok else [])])),
      [TextButton("Cancelar", on_click=lambda e: close()), TextButton("Conectar", on_click=accept)]))

  async def connect(profile, password):
    state["busy"] = f"Conectando a {profile.name}…"
    render()
    try:
      session = await asyncio.to_thread(OracleSession.connect, profile, password)
      owner = await asyncio.to_thread(session.current_user)
      owners = await asyncio.to_thread(session.owners)
      objects = await asyncio.to_thread(session.objects, owner)
    except DbError as e:
      state["busy"] = ""
      render()
      toast(f"No se pudo conectar: {e}")
      return
    except Exception as e:      # cualquier otra cosa: se avisa, nunca se queda en silencio
      state["busy"] = ""
      render()
      toast(f"Error inesperado al conectar: {e}")
      return
    state.update(session=session, profile=profile, owner=owner, owners=owners or [owner], objects=objects,
                 query="", busy="")
    render()

  def disconnect():
    session = state["session"]
    if session:
      session.close()
    state.update(session=None, profile=None, owners=[], owner=None, objects=[], query="")
    render()

  async def change_owner(owner):
    state["owner"] = owner
    await reload_objects()

  async def reload_objects():
    session = state["session"]
    if not session:
      return
    state["busy"] = "Leyendo objetos…"
    render()
    try:
      state["objects"] = await asyncio.to_thread(session.objects, state["owner"])
    except DbError as e:
      toast(f"No se pudieron leer los objetos: {e}")
    state["busy"] = ""
    render()

  # --- perfiles ---------------------------------------------------------------------------------
  def profile_menu(profile):
    def option(icon, label, color, action):
      return Clickable(Row(spacing=10, controls=[Icon(icon, size=16, color=color), Text(label, size=13, color=color)]),
                       lambda e: (close(), action(profile)), hover_bg=ACCENT_BG,
                       padding=Padding(left=10, right=10, top=9, bottom=9), border_radius=6)
    close = show_modal(page, dialog(profile.name, Container(width=240, content=Column(tight=True, spacing=2, controls=[
      option(Icons.EDIT, "Editar", TEXT, edit_profile),
      option(Icons.DELETE_OUTLINE, "Eliminar", ERROR, ask_delete)])), []))

  def ask_delete(profile):
    async def confirm_async():
      close()
      await asyncio.to_thread(profiles.delete, profile)
      render()
      toast("Conexión eliminada (y su contraseña guardada)")
    close = show_modal(page, dialog(
      "¿Eliminar esta conexión?",
      Text(f"«{profile.name}» se borrará, junto con su contraseña si estaba guardada.", size=12, color=MUTED),
      [TextButton("Cancelar", on_click=lambda e: close()),
       TextButton("Eliminar", on_click=lambda e: page.run_task(confirm_async))]))

  def edit_profile(profile):
    new = profile is None
    profile = profile or profiles.Profile("", "", "", "")
    name = field("Nombre", profile.name, hint_text="p. ej. Producción", autofocus=True)
    host = field("Servidor", profile.host, hint_text="host o IP")
    port = field("Puerto", str(profile.port), width=100)
    service = field("Servicio", profile.service, hint_text="p. ej. ORCL")
    user = field("Usuario", profile.user)
    password = field("Contraseña", password=True, can_reveal_password=True,
                     hint_text="" if new or not profile.save_password else "(guardada; déjalo vacío para conservarla)")
    ok, why = secrets.available()
    remember = Checkbox(label="Guardar la contraseña en el llavero del sistema", value=profile.save_password and ok, disabled=not ok)

    # estado visible arriba del formulario (abajo se perdía de vista)
    ring = ProgressRing(width=14, height=14, stroke_width=2, color=ACCENT, visible=False)
    status = Text("", size=12, color=MUTED, expand=True)
    status_row = Container(visible=False, padding=Padding(left=10, right=10, top=8, bottom=8), border_radius=6,
                           bgcolor="#151925", content=Row(spacing=8, vertical_alignment=CrossAxisAlignment.START,
                                                          controls=[ring, status]))
    kind = {"sid": profile.use_sid}
    chips = []

    def paint_kind():
      service.label = "SID" if kind["sid"] else "Servicio"
      for c in chips:
        active = kind["sid"] == c.data
        c.content.bgcolor = ACCENT_BG if active else None
        c.content.content.color = ACCENT if active else MUTED
      for part in (service, *chips):
        try:
          part.update()
        except RuntimeError:
          pass

    def chip(label, value):
      box = Clickable(Text(label, size=11), lambda e: (kind.update(sid=value), paint_kind()), hover_bg=ACCENT_BG,
                      padding=Padding(left=10, right=10, top=4, bottom=4), border_radius=6)
      box.data = value
      return box

    chips.extend([chip("Nombre de servicio", False), chip("SID", True)])
    for c in chips:
      c.content.content.color = ACCENT if kind["sid"] == c.data else MUTED
      c.content.bgcolor = ACCENT_BG if kind["sid"] == c.data else None
    service.label = "SID" if kind["sid"] else "Servicio"

    def show(text, color=MUTED, busy=False):
      status.value, status.color = text, color
      ring.visible = busy
      status_row.visible = bool(text)
      try:
        status_row.update()
      except RuntimeError:
        pass

    def valid():
      """Valida los campos y los aplica al perfil."""
      if not all((x.value or "").strip() for x in (name, host, service, user)):
        show("Completa nombre, servidor, servicio (o SID) y usuario", ERROR)
        return False
      try:
        number = int(port.value or 1521)
      except ValueError:
        show("El puerto debe ser un número (el de Oracle suele ser 1521)", ERROR)
        return False
      profile.name, profile.host, profile.service, profile.user = (name.value.strip(), host.value.strip(),
                                                                   service.value.strip(), user.value.strip())
      profile.port, profile.use_sid, profile.save_password = number, kind["sid"], bool(remember.value)
      return True

    async def save_async(connect_after=False):
      if not valid():
        return
      show("Guardando…" + (" (el llavero puede pedirte desbloquear la cartera)" if remember.value and password.value else ""),
           busy=True)
      try:
        warning = await asyncio.to_thread(profiles.save, profile, password.value or None)  # sin contraseña nueva se conserva la guardada
      except Exception as e:
        show(f"No se pudo guardar: {e}", ERROR)
        return
      close()
      toast(warning or f"Conexión «{profile.name}» guardada")
      render()
      if connect_after:
        await start_connect_async(profile)

    async def test_async():
      if not valid():
        return
      secret = password.value or await asyncio.to_thread(profiles.password, profile)
      if not secret:
        show("Escribe la contraseña para probar la conexión", ERROR)
        return
      show(f"Probando conexión con {profile.host}:{profile.port}… (hasta 10 s)", busy=True)
      try:
        session = await asyncio.to_thread(OracleSession.connect, profile, secret)
        who = await asyncio.to_thread(session.current_user)
        await asyncio.to_thread(session.close)
        show(f"✓ Conexión correcta como {who}", "#7CCB8B")
      except DbError as exc:
        show(f"✗ {exc}", ERROR)
      except Exception as exc:
        show(f"✗ Error inesperado: {exc}", ERROR)

    close = show_modal(page, dialog(
      "Nueva conexión Oracle" if new else "Editar conexión",
      Container(width=400, content=Column(tight=True, spacing=8, scroll=ScrollMode.AUTO, controls=[
        status_row, name, host, Row(spacing=8, controls=[port, Container(content=service, expand=True)]),
        Row(spacing=6, controls=[Text("Identificar la base por", size=11, color=MUTED), *chips]),
        user, password, remember, *([Text(why, size=10, color=MUTED)] if not ok else [])])),
      [TextButton("Probar", on_click=lambda e: page.run_task(test_async)),
       TextButton("Guardar", on_click=lambda e: page.run_task(save_async)),
       TextButton("Guardar y conectar", on_click=lambda e: page.run_task(save_async, True))]))

  render()
  return body
