import asyncio
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from flet import (
  AlertDialog, Container, Column, Row, Text, Icon, Icons, Image, Markdown, MarkdownExtensionSet, Padding, FontWeight,
  CrossAxisAlignment, MainAxisAlignment, ProgressRing, SnackBar, ScrollMode, BoxFit, TextField, TextButton,
  TextStyle, TextSelection, RoundedRectangleBorder, NoInputBorder, Stack,
)
from orches.core import completion
from orches.ui.components.clickable import Clickable
from orches.ui.components.clipboard import copy_text
from orches.ui.components.code_view import code_view
from orches.ui.components.modal import set_typing, show_modal
from orches.ui.components.permissions import edit_enabled, subscribe
from orches.ui.syntax import COLORS, LANGS, language_for
from orches.ui.terminal.view import FONT
from orches.ui.theme import ACCENT, ACCENT_BG, BORDER_COLOR, border_all

MUTED = "#6B7088"
TEXT = "#E6E8EF"
ERROR = "#FF6B81"
WARN = "#E2C08D"
CARD = "#11141D"
MAX_BYTES = 1_000_000         # más de esto se muestra solo el principio (y no se edita)
MAX_EDIT_BYTES = 500_000      # el editor de texto de la interfaz aguanta archivos medianos, no enormes
TAB = "    "                  # lo que inserta la tecla Tab al editar
IMAGES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico"}
MARKDOWN = {".md", ".markdown"}
LANGUAGE_NAMES = {"sql": "SQL", "python": "Python", "javascript": "JavaScript / TypeScript", "clike": "C / Java / Go / Rust",
                  "json": "JSON", "hash": "YAML / TOML / Shell", "css": "CSS", "html": "HTML / XML", "plain": "Texto"}


def human_size(n):
  for unit in ("B", "KB", "MB", "GB"):
    if n < 1024 or unit == "GB":
      return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
    n /= 1024


@dataclass
class FileData:
  kind: str                  # "text" | "image" | "binary"
  text: str = ""             # texto tal cual está en el archivo (con tabuladores; fines de línea como \n)
  size: int = 0
  truncated: bool = False
  utf8: bool = True          # False: se decodificó con reemplazos, no se debe sobrescribir
  mtime_ns: int = 0
  crlf: bool = False         # el archivo usa \r\n: se conserva al guardar

  @property
  def editable(self):
    return self.kind == "text" and self.utf8 and not self.truncated and self.size <= MAX_EDIT_BYTES

  @property
  def display(self):
    return self.text.replace("\t", "    ")


def read_file(path):
  stat = path.stat()
  if path.suffix.lower() in IMAGES:
    return FileData("image", str(path), stat.st_size, mtime_ns=stat.st_mtime_ns)
  with open(path, "rb") as f:
    data = f.read(MAX_BYTES + 1)
  if b"\x00" in data[:8000]:
    return FileData("binary", size=stat.st_size, mtime_ns=stat.st_mtime_ns)
  truncated = len(data) > MAX_BYTES
  data = data[:MAX_BYTES]
  try:
    text, utf8 = data.decode("utf-8"), True
  except UnicodeDecodeError:
    text, utf8 = data.decode("utf-8", errors="replace"), False
  crlf = "\r\n" in text
  return FileData("text", text.replace("\r\n", "\n"), stat.st_size, truncated, utf8, stat.st_mtime_ns, crlf)


def write_file(path, text, crlf=False):
  """Guarda de forma atómica (archivo temporal + reemplazo) y conserva permisos y fines de línea."""
  data = (text.replace("\n", "\r\n") if crlf else text).encode("utf-8")
  fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
  try:
    with os.fdopen(fd, "wb") as f:
      f.write(data)
    try:
      os.chmod(tmp, path.stat().st_mode & 0o7777)
    except OSError:
      pass
    os.replace(tmp, path)
  except BaseException:
    try:
      os.unlink(tmp)
    except OSError:
      pass
    raise
  return path.stat().st_mtime_ns


def _chip(text, color=ACCENT):
  return Container(content=Text(text, size=10, color=color), padding=Padding(left=8, right=8, top=3, bottom=3),
                   border_radius=10, border=border_all(color=BORDER_COLOR))


def FileViewer(page, path):
  """Contenido de un archivo en un panel: código con colores, Markdown, imágenes o aviso si es binario.

  Los archivos de texto se pueden editar (botón Editar) y guardar con Ctrl+S.
  """
  path = Path(path)
  language = language_for(path)
  is_markdown = path.suffix.lower() in MARKDOWN
  state = {"data": FileData("text"), "text": "", "preview": is_markdown, "editing": False, "dirty": False,
           "selection": (0, 0), "sugg": [], "sel": 0, "start": 0, "ticket": 0}
  holder = Container(expand=True, content=Column(expand=True, alignment=MainAxisAlignment.CENTER,
                                                  horizontal_alignment=CrossAxisAlignment.CENTER, controls=[
    ProgressRing(width=22, height=22, stroke_width=2, color=ACCENT), Text(f"Abriendo {path.name}…", size=11, color=MUTED)]))
  editor = {"field": None, "popup": None, "stack": None}
  bar_box = Container()
  body_box = Container(expand=True)
  frame = Column(expand=True, spacing=0, controls=[bar_box, body_box])

  def toast(message):
    page.show_dialog(SnackBar(Text(message)))

  def button(icon, label, on_click, color=MUTED):
    return Clickable(Row(spacing=4, controls=[Icon(icon, size=14, color=color), Text(label, size=11, color=color)]),
                     on_click, hover_bg=ACCENT_BG, padding=Padding(left=8, right=8, top=4, bottom=4), border_radius=6)

  def confirm(title, message, accept_label, on_accept):
    close = show_modal(page, AlertDialog(
      modal=False, bgcolor=CARD, shape=RoundedRectangleBorder(radius=10), title=Text(title, size=14),
      content=Text(message, size=12, color=MUTED),
      actions=[TextButton("Cancelar", on_click=lambda e: close()),
               TextButton(accept_label, on_click=lambda e: (close(), on_accept()))]))

  # --- aviso al panel de que hay cambios sin guardar -----------------------------------------------
  def set_dirty(value):
    state["dirty"] = value
    hook = getattr(holder, "on_dirty", None)
    if hook:
      hook(value)

  async def copy():
    await copy_text(page, state["text"])
    toast("Copiado")

  # --- barra de herramientas -----------------------------------------------------------------------
  def toolbar():
    data = state["data"]
    kind_label = {"image": "Imagen", "binary": "Binario"}.get(data.kind) or LANGUAGE_NAMES.get(language, "Texto")
    chips = [_chip(kind_label), Text(human_size(data.size), size=10, color=MUTED)]
    if state["dirty"]:
      chips.append(_chip("● sin guardar", WARN))
    if data.kind == "text" and data.editable and not edit_enabled() and not state["editing"]:
      chips.append(_chip("Edición bloqueada", MUTED))
    if data.truncated:
      chips.append(_chip("Solo el primer MB · solo lectura", WARN))
    elif data.kind == "text" and not data.utf8:
      chips.append(_chip("No es UTF-8 · solo lectura", WARN))
    elif data.kind == "text" and not data.editable:
      chips.append(_chip("Muy grande para editar · solo lectura", WARN))
    actions = []
    can_edit = data.editable and edit_enabled()
    if data.kind == "text":
      if state["dirty"]:
        actions.append(button(Icons.SAVE, "Guardar", lambda e: page.run_task(save), ACCENT))
      if state["editing"]:
        actions.append(button(Icons.VISIBILITY, "Vista previa" if is_markdown else "Con colores", lambda e: show_read(True)))
      else:
        if can_edit:
          actions.append(button(Icons.EDIT, "Editar", lambda e: start_editing()))
        if is_markdown:
          actions.append(button(Icons.CODE if state["preview"] else Icons.ARTICLE,
                                "Ver código" if state["preview"] else "Vista previa", lambda e: toggle_preview()))
      if state["dirty"]:
        actions.append(button(Icons.UNDO, "Descartar", lambda e: discard()))
      actions.append(button(Icons.CONTENT_COPY, "Copiar", lambda e: page.run_task(copy)))
    if not state["editing"]:
      actions.append(button(Icons.REFRESH, "Recargar", lambda e: page.run_task(load)))
    return Container(padding=Padding(left=10, right=6, top=6, bottom=6), content=Row(
      wrap=True, run_spacing=4, alignment=MainAxisAlignment.SPACE_BETWEEN, vertical_alignment=CrossAxisAlignment.CENTER,
      controls=[Row(spacing=6, controls=chips), Row(spacing=0, controls=actions)]))

  # --- contenido -------------------------------------------------------------------------------------
  def make_editor():
    field = TextField(
      value=state["text"], multiline=True, expand=True, border=NoInputBorder(), cursor_color=ACCENT,
      text_style=TextStyle(font_family=FONT, size=12, height=1.35, color=COLORS["plain"]),
      content_padding=Padding(left=12, right=12, top=8, bottom=12), selection_color=ACCENT_BG,
      on_change=on_edit, on_focus=on_editor_focus, on_blur=lambda e: set_typing(False),
      on_selection_change=on_selection)
    popup = Container(visible=False, bottom=14, right=14, width=300, bgcolor=CARD, border_radius=8,
                      border=border_all(color=ACCENT_BG), padding=Padding(left=4, right=4, top=4, bottom=4))
    editor.update(field=field, popup=popup, stack=Stack(expand=True, controls=[field, popup]))
    state["sugg"] = []
    return field

  # --- sugerencias de autocompletado ---------------------------------------------------------------------
  KIND_ICONS = {"keyword": Icons.KEY, "type": Icons.DATA_OBJECT, "word": Icons.TEXT_FIELDS}
  KIND_NAMES = {"keyword": "palabra clave", "type": "tipo", "word": "en este archivo"}

  def render_popup():
    popup = editor["popup"]
    if not popup:
      return
    rows = []
    for i, s in enumerate(state["sugg"]):
      active = i == state["sel"]
      rows.append(Clickable(
        Row(spacing=8, vertical_alignment=CrossAxisAlignment.CENTER, controls=[
          Icon(KIND_ICONS[s.kind], size=14, color=ACCENT if active else MUTED),
          Text(s.label, size=12, color=TEXT, font_family=FONT, expand=True, no_wrap=True),
          Text(KIND_NAMES[s.kind], size=10, color=MUTED)]),
        lambda e, i=i: accept(i), hover_bg=ACCENT_BG, bgcolor=ACCENT_BG if active else None,
        padding=Padding(left=8, right=8, top=4, bottom=4), border_radius=6))
    hint = Text("↑↓ elegir · Tab aceptar · Esc cerrar", size=9, color=MUTED)
    popup.content = Column(spacing=0, tight=True, controls=[*rows, Container(padding=Padding(left=8, top=4), content=hint)])
    popup.visible = bool(rows)
    field = editor["field"]
    if field:
      field.ignore_up_down_keys = bool(rows)          # con el cuadro abierto, ↑↓ lo mueven a él y no al cursor
    try:
      popup.update()
      if field:
        field.update()
    except RuntimeError:
      pass

  def hide_suggestions():
    if state["sugg"]:
      state["sugg"] = []
      render_popup()

  async def update_suggestions(force=False):
    state["ticket"] += 1
    ticket = state["ticket"]
    await asyncio.sleep(0.06)                     # espera a que llegue la posición del cursor y agrupa pulsaciones rápidas
    if ticket != state["ticket"] or not state["editing"]:
      return
    text, cursor = state["text"], state["selection"][1]
    lang = LANGS[language]
    found = completion.suggestions(text, cursor, lang.keywords, lang.types, force=force, case_insensitive=lang.ignore_case)
    state.update(sugg=found, sel=0, start=completion.prefix_at(text, cursor)[0])
    render_popup()

  def on_selection(e):
    state["selection"] = (e.selection.start, e.selection.end)
    if state["sugg"]:       # si el cursor salió de la palabra que se completaba, el cuadro ya no aplica
      start, word = completion.prefix_at(state["text"], e.selection.end)
      if start != state["start"] or not word:
        hide_suggestions()

  def accept(index=None):
    index = state["sel"] if index is None else index
    field = editor["field"]
    if not (field and 0 <= index < len(state["sugg"])):
      return
    new, cursor = completion.apply(state["text"], state["selection"][1], state["sugg"][index])
    state["text"], state["selection"] = new, (cursor, cursor)
    field.value = new
    field.selection = TextSelection(base_offset=cursor, extent_offset=cursor)
    field.update()
    state["sugg"] = []
    render_popup()
    if not state["dirty"]:
      set_dirty(True)
      refresh_bar()

    async def back():            # el Tab (o el clic) pudo mover el foco: se devuelve al editor
      try:
        await editor["field"].focus()
      except Exception:
        pass
    page.run_task(back)

  def handle_suggest_key(e):
    """Teclas con el cuadro abierto. True si la tecla se usó (no debe llegar al editor)."""
    if not state["sugg"]:
      return False
    if e.key in ("Arrow Down", "Arrow Up"):
      step = 1 if e.key == "Arrow Down" else -1
      state["sel"] = (state["sel"] + step) % len(state["sugg"])
      render_popup()
    elif e.key == "Tab" and not e.shift:
      accept()
    elif e.key == "Escape":
      hide_suggestions()
    else:
      return False
    return True

  def on_editor_focus(e):
    set_typing(True)           # mientras escribes aquí, las teclas no van a ninguna terminal
    hook = getattr(holder, "focus_cb", None)
    if hook:
      hook()

  def on_edit(e):
    state["text"] = e.control.value or ""
    page.run_task(update_suggestions)
    if not state["dirty"]:
      set_dirty(True)
      refresh_bar()             # aparece «● sin guardar» sin tocar el editor (conserva el foco)

  def body():
    data = state["data"]
    if data.kind == "image":
      return Container(expand=True, padding=12, content=Image(src=data.text, fit=BoxFit.CONTAIN))
    if data.kind == "binary":
      return Column(expand=True, alignment=MainAxisAlignment.CENTER, horizontal_alignment=CrossAxisAlignment.CENTER, controls=[
        Icon(Icons.DATA_OBJECT, size=30, color=MUTED),
        Text("Archivo binario: no se puede mostrar como texto", size=12, color=MUTED)])
    if state["editing"]:
      if not editor["field"]:
        make_editor()
      return editor["stack"]
    current = state["text"].replace("\t", "    ")           # lo que hay ahora, también si aún no se guardó
    if is_markdown and state["preview"]:
      return Column(expand=True, scroll=ScrollMode.AUTO, controls=[Container(padding=Padding(left=14, right=14, top=4, bottom=16),
        content=Markdown(current, selectable=True, extension_set=MarkdownExtensionSet.GITHUB_WEB))])
    return code_view(current, language)

  def refresh_bar():
    bar_box.content = toolbar()
    try:
      bar_box.update()
    except RuntimeError:
      pass

  def refresh_body():
    body_box.content = body()
    try:
      body_box.update()
    except RuntimeError:
      pass

  def show():
    if holder.content is not frame:      # primera vez: se reemplaza el «Abriendo…» por barra + cuerpo
      holder.content = frame
      try:
        holder.update()
      except RuntimeError:
        pass
    refresh_bar()
    refresh_body()

  def toggle_preview():
    state["preview"] = not state["preview"]
    show()

  # --- edición -------------------------------------------------------------------------------------------
  def start_editing():
    state["editing"] = True
    make_editor()                            # con el texto actual (puede traer cambios sin guardar)
    show()

  def show_read(preview_markdown=False):
    """Pasa a la vista con colores. Los cambios sin guardar se conservan."""
    state["editing"] = False
    set_typing(False)                 # el editor desaparece: puede que no avise de que perdió el foco
    if is_markdown:
      state["preview"] = preview_markdown
    editor.update(field=None, popup=None, stack=None)
    state["sugg"] = []
    show()

  def discard():
    def revert():
      state["text"] = state["data"].text
      set_dirty(False)
      if state["editing"]:
        make_editor()
      else:
        editor.update(field=None, popup=None, stack=None)
      show()
    confirm("¿Descartar los cambios?", f"Se perderá lo que cambiaste en {path.name} desde el último guardado.",
            "Descartar", revert)

  async def save(overwrite=False):
    if not state["dirty"]:
      return
    try:
      current = await asyncio.to_thread(lambda: path.stat().st_mtime_ns)
    except OSError:
      current = None            # el archivo ya no existe: se vuelve a crear
    if current is not None and current != state["data"].mtime_ns and not overwrite:
      confirm("El archivo cambió en el disco", f"{path.name} se modificó desde otra herramienta después de abrirlo. "
              "¿Sobrescribir con tu versión?", "Sobrescribir", lambda: page.run_task(save, True))
      return
    try:
      mtime = await asyncio.to_thread(write_file, path, state["text"], state["data"].crlf)
    except OSError as e:
      toast(f"No se pudo guardar: {e.strerror or e}")
      return
    state["data"].text = state["text"]
    state["data"].mtime_ns = mtime
    state["data"].size = len(state["text"].encode("utf-8"))
    set_dirty(False)
    refresh_bar()
    toast(f"Guardado {path.name}")

  def insert_tab(shift=False):
    """Tab dentro del editor: Flutter lo usaría para saltar de campo, así que se inserta aquí."""
    field = editor["field"]
    if not (state["editing"] and field):
      return
    start, end = sorted(state["selection"])
    text = state["text"]
    if shift:                   # Shift+Tab: quita hasta una sangría al inicio de la línea
      line_start = text.rfind("\n", 0, start) + 1
      removed = len(text[line_start:line_start + len(TAB)]) - len(text[line_start:line_start + len(TAB)].lstrip(" "))
      removed = min(removed, len(TAB))
      new, cursor = text[:line_start] + text[line_start + removed:], max(line_start, start - removed)
    else:
      new, cursor = text[:start] + TAB + text[end:], start + len(TAB)
    state["text"], state["selection"] = new, (cursor, cursor)
    field.value = new
    field.selection = TextSelection(base_offset=cursor, extent_offset=cursor)
    field.update()
    if not state["dirty"]:
      set_dirty(True)
      refresh_bar()

    async def back():          # el Tab ya movió el foco a otro control: se devuelve al editor
      try:
        await editor["field"].focus()
      except Exception:
        pass
    page.run_task(back)

  # --- carga ------------------------------------------------------------------------------------------------
  async def load():
    if state["dirty"]:
      toast("Hay cambios sin guardar: guarda o descarta antes de recargar")
      return
    try:
      data = await asyncio.to_thread(read_file, path)
    except OSError as e:
      holder.content = Column(expand=True, alignment=MainAxisAlignment.CENTER, horizontal_alignment=CrossAxisAlignment.CENTER,
                              controls=[Icon(Icons.ERROR_OUTLINE, size=28, color=ERROR),
                                        Text(f"No se pudo abrir el archivo: {e.strerror or e}", size=12, color=ERROR)])
      holder.update()
      return
    state["data"] = data
    state["text"] = data.text
    state["editing"] = data.kind == "text" and data.editable and edit_enabled()
    if state["editing"]:
      make_editor()
    else:
      editor.update(field=None, popup=None, stack=None)
    show()

  holder.save = lambda: page.run_task(save)        # Ctrl+S (lo llama el área de trabajo)
  holder.save_async = save                         # «Guardar y cerrar»
  holder.insert_tab = insert_tab                   # Tab / Shift+Tab
  holder.is_dirty = lambda: state["dirty"]
  holder.handle_suggest_key = handle_suggest_key   # ↑↓ Tab Esc con el cuadro de sugerencias abierto
  holder.trigger_suggest = lambda: page.run_task(update_suggestions, True)   # Ctrl+Espacio
  holder.discard = lambda: set_dirty(False)
  def permission_changed(enabled):
    """Se activó o bloqueó la edición para todos los archivos."""
    data = state["data"]
    if data.kind != "text" or not data.editable:
      return
    if not enabled and state["editing"] and not state["dirty"]:
      show_read()
    elif enabled and not state["editing"]:
      start_editing()
    else:
      refresh_bar()

  subscribe(permission_changed)
  page.run_task(load)
  return holder
