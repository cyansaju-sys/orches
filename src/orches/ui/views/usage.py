import asyncio
from pathlib import Path
from datetime import datetime, timedelta, timezone
from flet import (
  Container, Column, Row, Text, Icon, Icons, ProgressBar, Padding, ScrollMode, TextField,
  TextButton, AlertDialog, SnackBar, RoundedRectangleBorder, TextStyle,
  TextOverflow, FontWeight, MainAxisAlignment, CrossAxisAlignment,
)
from orches.core import settings
from orches.core.agents import detect_agents
from orches.ui.components.clickable import Clickable, IconAction
from orches.ui.components.modal import show_modal
from orches.ui.theme import ACCENT, ACCENT_BG, ACCENT_DIM, BORDER_COLOR, border_all
from orches.core.usage import collect, delete_session, fmt_delta, fmt_tokens, rename_session, WINDOW_HOURS

MUTED = "#6B7088"
TEXT = "#E6E8EF"
REFRESH = 30   # segundos entre lecturas


def _ago(dt, now):
  delta = now - dt
  if delta.total_seconds() < 90:
    return "ahora"
  return "hace " + fmt_delta(delta)


def _row(label, value, color=TEXT):
  return Row(
    alignment=MainAxisAlignment.SPACE_BETWEEN,
    controls=[Text(label, size=11, color=MUTED), Text(value, size=11, color=color)],
  )


def _severity(percent):
  return "#FF6B81" if percent >= 85 else "#E2C08D" if percent >= 60 else ACCENT


def _limit(limit, now, extra=""):
  """Barra de uso con porcentaje y reinicio, como el panel de uso de Claude."""
  detail = f"Se reinicia en {fmt_delta(limit.resets_at - now)}"
  if extra:
    detail += f" · {extra}"
  return Column(spacing=3, controls=[
    Row(alignment=MainAxisAlignment.SPACE_BETWEEN, controls=[
      Text(limit.label, size=12, color=TEXT),
      Text(f"{limit.percent:.0f}%", size=12, color=TEXT),
    ]),
    ProgressBar(value=min(1, max(0, limit.percent / 100)), color=_severity(limit.percent),
                bgcolor="#1B2030", bar_height=5, border_radius=3),
    Text(detail, size=10, color=MUTED),
  ])


def _card(usage, now):
  controls = [
    Row(spacing=8, controls=[Icon(Icons.SMART_TOY, size=16, color=ACCENT),
                             Text(usage.name, size=13, weight=FontWeight.W_600, color=TEXT)]),
  ]
  w = usage.window
  if usage.limits:
    for i, limit in enumerate(usage.limits):
      tokens = f"{fmt_tokens(w.tokens.total)} tokens" if i == 0 and w else ""
      controls.append(_limit(limit, now, tokens))
    if usage.limits_age > 600:   # dato viejo (p. ej. tras un 429): se avisa de su antigüedad
      controls.append(Text(f"Actualizado hace {fmt_delta(timedelta(seconds=usage.limits_age))}",
                           size=10, color=MUTED))
  elif w:
    # sin porcentaje real: se muestra lo que se sabe en local
    elapsed = (now - w.start).total_seconds() / (WINDOW_HOURS * 3600)
    controls += [
      Text(f"{fmt_tokens(w.tokens.total)} tokens", size=20, weight=FontWeight.W_600, color=ACCENT),
      Text("en la sesión actual", size=11, color=MUTED),
      ProgressBar(value=min(1, max(0, elapsed)), color=ACCENT, bgcolor="#1B2030", bar_height=5),
      Text(f"Se reinicia en {fmt_delta(w.end - now)} · {w.end.astimezone().strftime('%H:%M')} (estimado)",
           size=11, color=TEXT),
    ]
  elif usage.note:
    controls.append(Text(usage.note, size=11, color=MUTED))
  else:
    controls.append(Text("Sin sesión activa. La ventana de 5 h empieza con tu próximo mensaje.",
                         size=11, color=MUTED))
  if usage.limits_error and not usage.limits:
    controls.append(Text(usage.limits_error, size=10, color=MUTED))
  if usage.total or usage.sessions:
    controls += [
      Container(height=1, bgcolor=BORDER_COLOR),
      _row("Hoy", fmt_tokens(usage.today)),
      _row("7 días", fmt_tokens(usage.week)),
      _row("Total", fmt_tokens(usage.total)),
    ]
    if usage.note and (w or usage.limits):
      controls.append(Text(usage.note, size=10, color=MUTED))
  return Container(
    padding=10, border_radius=8, border=border_all(), bgcolor="#0D0F16",
    content=Column(spacing=8, controls=controls),
  )


def _in_project(session, project):
  """¿La sesión se ejecutó en el proyecto (o en una de sus subcarpetas)?"""
  try:
    return Path(session.cwd).resolve().is_relative_to(Path(project).resolve())
  except (OSError, ValueError):
    return False


def _history(sessions, now, on_resume, on_menu, project):
  items = []
  if not project:
    items.append(Text("Abre un proyecto para ver su historial", size=11, color=MUTED))
  elif not sessions:
    items.append(Text("Sin sesiones en este proyecto", size=11, color=MUTED))
  for s in sessions[:12]:
    resumable = s.resume_args is not None
    text = Column(spacing=1, expand=True, controls=[
      Text(s.display_title, size=12, color=TEXT, no_wrap=True, overflow=TextOverflow.ELLIPSIS),
      Text(f"{s.agent} · {s.project} · {_ago(s.end, now)} · {fmt_tokens(s.tokens)}",
           size=10, color=MUTED, no_wrap=True, overflow=TextOverflow.ELLIPSIS),
    ])
    items.append(Clickable(
      Row(spacing=2, vertical_alignment=CrossAxisAlignment.CENTER, controls=[
        text,
        IconAction(Icons.MORE_HORIZ, lambda e, s=s: on_menu(s), size=16, color=MUTED,
                   hover_color=TEXT, hover_bg="#2A2F3D", width=26, height=26),
      ]),
      (lambda e, s=s: on_resume(s)) if resumable else (lambda e: None),
      hover_bg=ACCENT_BG if resumable else None,
      padding=Padding(left=6, right=2, top=3, bottom=3),
      border_radius=6,
    ))
  return Column(spacing=2, controls=items)


def _section(title, key, collapsed, on_toggle, content, detail=""):
  """Sección que se puede minimizar con un clic en su cabecera."""
  header = Clickable(
    Row(spacing=4, vertical_alignment=CrossAxisAlignment.CENTER, controls=[
      Icon(Icons.KEYBOARD_ARROW_RIGHT if collapsed else Icons.KEYBOARD_ARROW_DOWN, size=16, color=MUTED),
      Text(title, size=11, weight=FontWeight.W_600, color=MUTED, style=TextStyle(letter_spacing=1.2)),
      Text(detail, size=10, color=MUTED, no_wrap=True, overflow=TextOverflow.ELLIPSIS, expand=True),
    ]),
    lambda e: on_toggle(key),
    hover_bg=ACCENT_BG,
    padding=Padding(left=2, right=6, top=4, bottom=4),
    border_radius=6,
  )
  return Column(spacing=8, controls=[header] if collapsed else [header, *content])


def UsageView(page, on_resume):
  """Consumo de tokens, reinicio e historial de cada agente instalado (los de cada persona varían)."""
  body = Column(spacing=10, scroll=ScrollMode.AUTO, expand=True,
                horizontal_alignment=CrossAxisAlignment.STRETCH)
  body.controls = [Text("Leyendo consumo…", size=11, color=MUTED)]
  state = {"mounted": False}

  def build(results):
    now = datetime.now(timezone.utc)
    if not results:
      body.controls = [Text("No hay agentes instalados", size=12, color=MUTED)]
      return
    project = settings.get("project")
    sessions = sorted(
      (s for r in results for s in r.sessions if project and _in_project(s, project)),
      key=lambda s: s.end, reverse=True,
    )
    folded = settings.get("collapsed") or {}
    name = Path(project).name if project else ""
    body.controls = [
      _section("USO", "usage", folded.get("usage", False), toggle, [_card(r, now) for r in results]),
      _section("HISTORIAL", "history", folded.get("history", False), toggle,
               [_history(sessions, now, on_resume, menu, project)], detail=name),
    ]

  state = {"results": [], "project": None}

  async def reload(fetch=False):
    state["results"] = await asyncio.to_thread(lambda: collect(detect_agents(), fetch))
    show()

  def toast(message):
    page.show_dialog(SnackBar(Text(message)))

  def dialog(title, content, actions):
    return AlertDialog(
      modal=False, bgcolor="#11141D", shape=RoundedRectangleBorder(radius=10),
      title=Text(title, size=14, no_wrap=True, overflow=TextOverflow.ELLIPSIS),
      content=content, actions=actions,
    )

  def menu(session):
    """Los tres puntos: cambiar nombre o borrar."""
    def option(icon, label, color, action):
      return Clickable(
        Row(spacing=10, controls=[Icon(icon, size=16, color=color), Text(label, size=13, color=color)]),
        lambda e: (close(), action(session)),
        hover_bg=ACCENT_BG, padding=Padding(left=10, right=10, top=9, bottom=9), border_radius=6,
      )
    close = show_modal(page, dialog(
      session.display_title,
      Container(width=260, content=Column(tight=True, spacing=2, controls=[
        option(Icons.EDIT, "Cambiar nombre", TEXT, ask_rename),
        option(Icons.DELETE_OUTLINE, "Borrar", "#FF6B81", ask_delete),
      ])),
      [],
    ))

  def ask_rename(session):
    field = TextField(value=session.display_title, autofocus=True, dense=True, text_size=13,
                      cursor_color=ACCENT, focused_border_color=ACCENT, border_color=BORDER_COLOR)

    def save(e=None):
      rename_session(session, field.value or "")   # vacío = nombre original
      close()
      page.run_task(reload)

    field.on_submit = save
    close = show_modal(page, dialog(
      "Cambiar nombre", Container(width=320, content=field),
      [TextButton("Cancelar", on_click=lambda e: close()), TextButton("Guardar", on_click=save)],
    ))

  def ask_delete(session):
    async def confirm(e):
      close()
      ok, message = await asyncio.to_thread(delete_session, session)
      toast("Sesión borrada" if ok else f"No se pudo borrar: {message}")
      await reload()

    close = show_modal(page, dialog(
      "¿Borrar esta sesión?",
      Text(f"«{session.display_title}» se eliminará de {session.agent}. No se puede deshacer.", size=12, color=MUTED),
      [TextButton("Cancelar", on_click=lambda e: close()), TextButton("Borrar", on_click=confirm)],
    ))

  def toggle(key):
    folded = dict(settings.get("collapsed") or {})
    folded[key] = not folded.get(key, False)
    settings.set("collapsed", folded)     # se recuerda al reiniciar
    show()

  def show():
    build(state["results"])
    try:
      body.update()
    except RuntimeError:
      pass   # la pestaña no está visible todavía; se mostrará en la próxima lectura

  async def loop():
    waited = REFRESH
    while True:
      project = settings.get("project")
      if waited >= REFRESH:
        state["results"] = await asyncio.to_thread(lambda: collect(detect_agents()))
        waited = 0
        state["project"] = project
        show()
      elif project != state["project"]:   # cambiaste de proyecto: se refiltra sin releer
        state["project"] = project
        show()
      await asyncio.sleep(2)
      waited += 2

  def on_enter():
    """Al abrir la pestaña IA: única vez que se consulta a Anthropic."""
    async def entered():
      await reload(fetch=True)

    page.run_task(entered)

  body.on_enter = on_enter
  page.run_task(loop)
  return body
