import asyncio
from pathlib import Path, PurePosixPath
from flet import (
  Container, Column, Row, Text, Icon, Icons, Image, Padding, ScrollMode, TextOverflow,
  FontWeight, CrossAxisAlignment, MainAxisAlignment, SnackBar, TextField, TextStyle, Alignment,
)
from orches.core import settings
from orches.ui.file_icons import icon_for
from orches.core.git import commit, push, stage, status_entries, sync_info, unstage
from orches.ui.theme import ACCENT, ACCENT_BG, BORDER_COLOR, GIT_COLORS
from orches.ui.components.clickable import Clickable, IconAction
from orches.ui.components.modal import set_typing
from orches.ui.dialogs.branch_picker import BranchPicker

MUTED = "#6B7088"
TEXT = "#E6E8EF"
REFRESH = 3   # segundos entre revisiones de git

# (clave, título, acción): "+" prepara (git add), "−" saca del índice
GROUPS = (
  ("changes", "Cambios", "add"),
  ("staged", "Cambios staged", "remove"),
)


def _classify(entries):
  """Dos grupos: lo que falta preparar (modificados, nuevos, borrados, conflictos) y lo ya preparado.

  Un archivo con cambios a medias aparece en los dos.
  """
  groups = {key: [] for key, _, _ in GROUPS}
  for e in entries:
    if e.conflict:
      groups["changes"].append((e.path, "C"))
      continue
    if e.staged:
      groups["staged"].append((e.path, e.staged))
    if e.unstaged:
      groups["changes"].append((e.path, e.unstaged))
  for items in groups.values():
    items.sort(key=lambda f: f[0].lower())
  return groups


def _row(path, code, action, on_action):
  p = PurePosixPath(path)
  folder = str(p.parent) if str(p.parent) != "." else ""
  color = GIT_COLORS.get(code, TEXT)
  add = action == "add"
  return Clickable(
    Row(spacing=6, vertical_alignment=CrossAxisAlignment.CENTER, controls=[
      Image(src=icon_for(Path(p.name)), width=16, height=16),
      Text(p.name, size=12, color=color, no_wrap=True, overflow=TextOverflow.ELLIPSIS),
      Text(folder, size=10, color=MUTED, no_wrap=True, overflow=TextOverflow.ELLIPSIS, expand=True),
      IconAction(Icons.ADD if add else Icons.REMOVE, lambda e: on_action(action, [path]),
                 size=16, color=MUTED, hover_color=ACCENT, hover_bg="#1B2030", width=24, height=24),
      Text(code, size=11, color=color, weight=FontWeight.W_600),
    ]),
    lambda e: None,
    hover_bg=ACCENT_BG,
    padding=Padding(left=6, right=4, top=2, bottom=2),
    border_radius=4,
  )


def GitView(page, on_count=None):
  """Archivos modificados del proyecto abierto, con + para prepararlos (git add) y − para quitarlos."""
  body = Column(spacing=2, scroll=ScrollMode.AUTO, expand=True,
                horizontal_alignment=CrossAxisAlignment.STRETCH)
  body.controls = [Text("Leyendo cambios…", size=11, color=MUTED)]
  state = {"key": None, "staged": 0, "typing": False, "sync": (None, 0, False, False), "pushing": False, "last": None}

  def toast(message):
    page.show_dialog(SnackBar(Text(message)))

  # --- caja de commit (se crea una vez: así no pierde el texto al repintar la lista) ---
  def typing(active):
    set_typing(active)                  # con el campo enfocado, sus teclas no van a la terminal

  message = TextField(
    hint_text="Mensaje de commit", dense=True,
    # crece al escribir (hasta 6 líneas); Shift+Enter = nueva línea
    multiline=True, min_lines=1, max_lines=6, shift_enter=True,
    text_size=11, hint_style=TextStyle(size=11, color=MUTED), cursor_color=ACCENT,
    border_color=BORDER_COLOR, focused_border_color=ACCENT, border_radius=6,
    content_padding=Padding(left=10, right=10, top=8, bottom=8),
    on_focus=lambda e: typing(True), on_blur=lambda e: typing(False),
    on_change=lambda e: update_button(), on_submit=lambda e: do_commit(),
  )
  def action_button(icon, label, on_click):
    text = Text(label, size=12, weight=FontWeight.W_600)
    glyph = Icon(icon, size=14, color=MUTED)
    button = Clickable(
      Row(alignment=MainAxisAlignment.CENTER, spacing=6, controls=[glyph, text]),
      on_click, hover_bg=ACCENT_BG, padding=Padding(left=8, right=8, top=7, bottom=7),
      border_radius=6, expand=True, alignment=Alignment.CENTER,
    )
    return button, glyph, text

  commit_button, commit_icon, commit_label = action_button(Icons.CHECK, "Commit", lambda e: do_commit())
  push_button, push_icon, push_label = action_button(Icons.ARROW_UPWARD, "Push", lambda e: do_push())

  def paint(button, glyph, label, ready):
    label.color = glyph.color = ACCENT if ready else MUTED
    button.content.bgcolor = ACCENT_BG if ready else "#151925"
    try:
      button.content.update()
    except RuntimeError:
      pass   # aún no está en pantalla

  def update_button():
    ready = state["staged"] > 0 and bool((message.value or "").strip())
    commit_label.value = f"Commit ({state['staged']})" if state["staged"] else "Commit"
    paint(commit_button, commit_icon, commit_label, ready)
    _, ahead, has_upstream, has_remote = state["sync"]
    can_push = not state["pushing"] and has_remote and (ahead > 0 or not has_upstream)
    push_label.value = ("Subiendo…" if state["pushing"] else f"Push ({ahead})" if ahead
                        else "Publicar" if has_remote and not has_upstream else "Push")
    paint(push_button, push_icon, push_label, can_push)

  async def run_commit(project, text):
    ok, output = await asyncio.to_thread(commit, project, text)
    if ok:
      message.value = ""
      message.update()
      toast("Commit hecho")
    else:
      toast("git: " + (output.splitlines()[0] if output else "no se pudo hacer el commit"))
    await refresh()

  async def run_push(project):
    state["pushing"] = True
    update_button()
    ok, output = await asyncio.to_thread(push, project)
    state["pushing"] = False
    if ok:
      toast("Push hecho")
    else:
      lines = [l for l in output.splitlines() if l.strip()]
      toast("git: " + (lines[-1] if lines else "no se pudo hacer el push"))
    await refresh()

  def do_push():
    project = settings.get("project")
    _, ahead, has_upstream, has_remote = state["sync"]
    if not project:
      toast("Abre un proyecto primero")
    elif state["pushing"]:
      return
    elif not has_remote:
      toast("Este repositorio no tiene remoto")
    elif not ahead and has_upstream:
      toast("No hay commits por subir")
    else:
      page.run_task(run_push, project)

  def do_commit():
    text = (message.value or "").strip()
    project = settings.get("project")
    if not project:
      toast("Abre un proyecto primero")
    elif not state["staged"]:
      toast("No hay nada preparado: usa + en los archivos")
    elif not text:
      toast("Escribe el mensaje del commit")
    else:
      page.run_task(run_commit, project, text)

  def toggle_group(key):
    folded = dict(settings.get("collapsed") or {})
    folded[f"git_{key}"] = not folded.get(f"git_{key}", False)
    settings.set("collapsed", folded)     # se recuerda al reiniciar
    if state["last"]:
      build(*state["last"])
      body.update()

  def open_branches(project):
    BranchPicker(page, project, lambda: page.run_task(refresh))

  def build(project, name, entries):
    state["last"] = (project, name, entries)
    state["staged"] = sum(1 for e in entries if e.staged)
    update_button()
    if not project:
      body.controls = [Text("Abre un proyecto para ver sus cambios", size=11, color=MUTED)]
      return
    if name is None:
      body.controls = [Text("Esta carpeta no es un repositorio git", size=11, color=MUTED)]
      return
    total = len(entries)
    header = Row(alignment=MainAxisAlignment.SPACE_BETWEEN, controls=[
      # la rama es pulsable: abre el selector para cambiar de rama o crear una
      Clickable(
        Row(spacing=6, controls=[Icon(Icons.CALL_SPLIT, size=14, color=ACCENT),
                                 Text(name, size=12, weight=FontWeight.W_600, color=TEXT),
                                 Icon(Icons.KEYBOARD_ARROW_DOWN, size=14, color=MUTED)]),
        lambda e, p=project: open_branches(p),
        hover_bg=ACCENT_BG, padding=Padding(left=4, right=6, top=3, bottom=3), border_radius=6,
        tooltip="Cambiar de rama",
      ),
      Text(f"{total} cambio{'s' if total != 1 else ''}", size=11, color=MUTED),
    ])
    controls = [Container(content=header, padding=Padding(left=6, right=6, top=2, bottom=6))]
    if not entries:
      controls.append(Text("Sin cambios", size=11, color=MUTED))
    groups = _classify(entries)
    for key, title, action in GROUPS:
      items = groups[key]
      if not items:
        continue
      paths = [path for path, _ in items]
      folded = (settings.get("collapsed") or {}).get(f"git_{key}", False)
      controls.append(Row(spacing=0, vertical_alignment=CrossAxisAlignment.CENTER, controls=[
        # cabecera pulsable: encoge o expande el grupo
        Clickable(
          Row(spacing=4, vertical_alignment=CrossAxisAlignment.CENTER, controls=[
            Icon(Icons.KEYBOARD_ARROW_RIGHT if folded else Icons.KEYBOARD_ARROW_DOWN, size=16, color=MUTED),
            Text(f"{title.upper()} · {len(items)}", size=10, weight=FontWeight.W_600, color=MUTED),
          ]),
          lambda e, k=key: toggle_group(k),
          hover_bg=ACCENT_BG, expand=True, padding=Padding(left=2, right=6, top=5, bottom=5), border_radius=6,
        ),
        # un solo botón para todo el grupo
        IconAction(Icons.ADD if action == "add" else Icons.REMOVE,
                   lambda e, a=action, p=paths: on_action(a, p),
                   size=16, color=MUTED, hover_color=ACCENT, hover_bg="#1B2030", width=24, height=24,
                   tooltip="Preparar todos" if action == "add" else "Quitar todos"),
      ]))
      if folded:
        continue
      controls += [_row(path, code, action, on_action) for path, code in items]
    body.controls = controls

  def read():
    project = settings.get("project")
    if not project or not Path(project).is_dir():
      return project, None, [], (None, 0, False, False)
    sync = sync_info(project)
    return project, sync[0], status_entries(project), sync

  async def refresh():
    project, name, entries, sync = await asyncio.to_thread(read)
    if on_count:
      on_count(len(entries))             # para el globo con el número en el ícono de Git
    key = (project, name, tuple(entries), sync)
    if key != state["key"]:              # solo se repinta si cambió algo
      state["key"] = key
      state["sync"] = sync
      build(project, name, entries)
      try:
        body.update()
      except RuntimeError:
        state["key"] = None              # la pestaña no está visible: se reintenta al abrirla

  async def run_action(action, paths):
    project = settings.get("project")
    ok, message = await asyncio.to_thread((stage if action == "add" else unstage), project, paths)
    if not ok:
      toast(f"git: {message or 'no se pudo completar'}")
    await refresh()                      # se ve el cambio al instante, sin esperar al ciclo

  def on_action(action, paths):
    page.run_task(run_action, action, paths)

  async def loop():
    while True:
      await refresh()
      await asyncio.sleep(REFRESH)

  page.run_task(loop)
  return Column(expand=True, spacing=8, controls=[
    Container(padding=Padding(left=2, right=2), content=Column(spacing=6, controls=[message, Row(spacing=6, controls=[commit_button, push_button])])),
    body,
  ])
