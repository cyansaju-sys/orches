import asyncio
from flet import (
  AlertDialog, Container, Column, Row, Text, Icon, Icons, TextField, TextButton, Checkbox, Padding,
  RoundedRectangleBorder, ScrollMode, FontWeight, MainAxisAlignment, CrossAxisAlignment, ProgressRing, TextOverflow,
)
from orches.core import secrets
from orches.core.db import profiles
from orches.core.db.oracle import DbError, OracleSession
from orches.ui.components.clickable import Clickable
from orches.ui.components.clipboard import copy_text
from orches.ui.components.modal import set_typing, show_modal
from orches.ui.theme import ACCENT, ACCENT_BG, BORDER_COLOR

MUTED = "#6B7088"
TEXT = "#E6E8EF"
ERROR = "#FF6B81"
OK = "#7EE0A1"
CARD = "#11141D"

_sessions = {}      # perfil.id -> sesión abierta; se reutiliza entre archivos .sql
_chosen = {"id": None}   # última conexión elegida


def _dialog(title, content, actions):
  return AlertDialog(modal=True, title=Text(title, size=14, weight=FontWeight.W_600), content=content, actions=actions,
                     shape=RoundedRectangleBorder(radius=10), bgcolor=CARD)


def SqlToolbar(page, get_text):
  """Franja de un archivo .sql: conexión elegida y botón ▶ que ejecuta/compila el script en ella."""
  label = Text("Sin conexión", size=11, color=MUTED, no_wrap=True, overflow=TextOverflow.ELLIPSIS)
  spinner = ProgressRing(width=14, height=14, stroke_width=2, color=ACCENT, visible=False)
  state = {"busy": False}

  def toast(message):
    from flet import SnackBar
    page.show_dialog(SnackBar(Text(message)))

  def current():
    return next((p for p in profiles.load() if p.id == _chosen["id"]), None)

  def refresh_label():
    p = current()
    label.value = f"{p.name} · {p.user}" if p else "Sin conexión"
    label.color = TEXT if p else MUTED
    try:
      label.update()
    except RuntimeError:
      pass

  async def session_for(profile):
    session = _sessions.get(profile.id)
    if session is not None:
      try:
        await asyncio.to_thread(session.query, "SELECT 1 FROM dual")
        return session
      except DbError:
        _sessions.pop(profile.id, None)
    password = await asyncio.to_thread(profiles.password, profile)
    if password is None:
      password = await ask_password(profile)
      if password is None:
        return None
    session = await asyncio.to_thread(OracleSession.connect, profile, password)
    await asyncio.to_thread(session.current_user)
    _sessions[profile.id] = session
    return session

  def ask_password(profile):
    future = asyncio.get_running_loop().create_future()
    password = TextField(label="Contraseña", password=True, can_reveal_password=True, autofocus=True, dense=True,
                         on_focus=lambda e: set_typing(True), on_blur=lambda e: set_typing(False))
    ok, _ = secrets.available()
    remember = Checkbox(label="Guardar la contraseña en el llavero del sistema", value=False, disabled=not ok)

    def finish(value):
      set_typing(False)
      close()
      if not future.done():
        future.set_result(value)

    async def accept_async():
      if remember.value:
        profile.save_password = True
        await asyncio.to_thread(profiles.save, profile, password.value)
      finish(password.value)

    def accept(e=None):
      if password.value:
        page.run_task(accept_async)

    password.on_submit = accept
    close = show_modal(page, _dialog(
      f"Conectar a {profile.name}",
      Container(width=340, content=Column(tight=True, spacing=8, controls=[
        Text(profile.summary, size=11, color=MUTED), password, remember])),
      [TextButton("Cancelar", on_click=lambda e: finish(None)), TextButton("Conectar", on_click=accept)]))
    return future

  async def run(profile):
    if state["busy"]:
      return
    state["busy"] = True
    spinner.visible = True
    spinner.update()
    try:
      session = await session_for(profile)
      if session is None:
        return
      done, failed, problems = await asyncio.to_thread(session.run_script, get_text())
      show_result(profile, done, failed, problems)
    except DbError as e:
      show_result(profile, 0, [("Conexión", str(e))], [])
    finally:
      state["busy"] = False
      spinner.visible = False
      try:
        spinner.update()
      except RuntimeError:
        pass

  def show_result(profile, done, failed, problems):
    lines = []
    if not failed and not problems:
      lines.append(Row(spacing=6, controls=[Icon(Icons.CHECK_CIRCLE, size=16, color=OK),
                                            Text(f"{done} sentencia(s) ejecutadas en {profile.name}", size=12, color=TEXT)]))
    for stmt, msg in failed:
      lines.append(Text(f"✗ {stmt}\n   {msg}", size=11, color=ERROR, selectable=True))
    for name, line, col, msg in problems:
      lines.append(Text(f"✗ {name} [{line}:{col}] {msg}", size=11, color=ERROR, selectable=True))
    report = "\n".join([f"{stmt}\n  {msg}" for stmt, msg in failed]
                       + [f"{name} [{line}:{col}] {msg}" for name, line, col, msg in problems])

    async def copy():
      await copy_text(page, report)
      toast("Errores copiados")

    copy_button = TextButton("Copiar errores", icon=Icons.CONTENT_COPY, on_click=lambda e: page.run_task(copy))
    close = show_modal(page, _dialog(
      "Resultado" if not (failed or problems) else "Terminó con errores",
      Container(width=520, content=Column(tight=True, spacing=6, scroll=ScrollMode.AUTO, controls=lines)),
      [*([copy_button] if report else []), TextButton("Cerrar", on_click=lambda e: close())]))

  def choose(profile):
    _chosen["id"] = profile.id
    refresh_label()
    page.run_task(run, profile)

  def pick(e=None):
    """Lista de conexiones guardadas; al elegir una se ejecuta el script en ella."""
    saved = profiles.load()
    if not saved:
      toast("No hay conexiones: crea una en la pestaña de Base de datos")
      return
    rows = [
      Clickable(
        Row(spacing=8, controls=[
          Icon(Icons.STORAGE, size=16, color=ACCENT),
          Column(spacing=0, expand=True, controls=[
            Text(p.name, size=12, color=TEXT, weight=FontWeight.W_600), Text(p.summary, size=10, color=MUTED)]),
          *([Icon(Icons.CHECK, size=14, color=ACCENT)] if p.id == _chosen["id"] else [])]),
        lambda e, p=p: (close(), choose(p)), hover_bg=ACCENT_BG,
        padding=Padding(left=8, right=8, top=6, bottom=6), border_radius=6)
      for p in saved]
    close = show_modal(page, _dialog(
      "Ejecutar en…", Container(width=340, content=Column(tight=True, spacing=2, scroll=ScrollMode.AUTO, controls=rows)),
      [TextButton("Cancelar", on_click=lambda e: close())]))

  def play(e):
    profile = current()
    if profile:
      page.run_task(run, profile)
    else:
      pick()

  refresh_label()
  return Container(
    padding=Padding(left=12, right=8, top=3, bottom=3), bgcolor="#151925",
    border=None,
    content=Row(alignment=MainAxisAlignment.END, vertical_alignment=CrossAxisAlignment.CENTER, spacing=6, controls=[
      Clickable(Row(spacing=4, controls=[Icon(Icons.STORAGE, size=13, color=MUTED), label,
                                         Icon(Icons.ARROW_DROP_DOWN, size=16, color=MUTED)]),
                pick, hover_bg=ACCENT_BG, tooltip="Elegir conexión",
                padding=Padding(left=6, right=2, top=3, bottom=3), border_radius=4),
      spinner,
      Clickable(Icon(Icons.PLAY_ARROW, size=18, color=OK), play, hover_bg=ACCENT_BG,
                tooltip="Ejecutar / compilar en la conexión elegida",
                padding=Padding(left=6, right=6, top=3, bottom=3), border_radius=4),
    ]),
  )
