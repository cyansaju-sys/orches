import asyncio
import os
import tempfile
import time
from dataclasses import dataclass
from types import SimpleNamespace
from pathlib import Path
from flet import (
  AlertDialog, Container, Column, Row, Text, Icon, Icons, Image, Markdown, MarkdownExtensionSet, Padding, FontWeight,
  CrossAxisAlignment, MainAxisAlignment, ProgressRing, ScrollMode, BoxFit, TextField, TextButton,
  TextStyle, TextSelection, RoundedRectangleBorder, NoInputBorder, Stack, GestureDetector, MouseCursor, Colors,
  TextSpan,
)
from orches.core import completion, extensions
from orches.core.git import diff_marks
from orches.ui.components.clickable import Clickable
from orches.ui.components.clipboard import copy_text
from orches.ui.components.code_view import (
  CHAR_WIDTH, FONT_SIZE, LINE_HEIGHT, MARK_COLORS, MARK_GLYPHS, code_view, gutter_chars,
)
from orches.ui.components.modal import set_typing, show_modal
from orches.ui.components.permissions import edit_enabled, subscribe
from orches.ui.syntax import COLORS, LANGS, highlight, language_for, spans
from orches.ui.terminal.view import FONT
from orches.ui.theme import ACCENT, ACCENT_BG, BORDER_COLOR, border_all
from orches.ui.components.toast import toast as show_toast

MUTED = "#6B7088"
TEXT = "#E6E8EF"
ERROR = "#FF6B81"
WARN = "#E2C08D"
CARD = "#11141D"
MAX_BYTES = 1_000_000         # más de esto se muestra solo el principio (y no se edita)
MAX_EDIT_BYTES = 500_000      # el editor de texto de la interfaz aguanta archivos medianos, no enormes
MAX_COLOR_BYTES = 150_000     # hasta aquí el editor colorea mientras escribes; más grande: editor simple sin colores
OVERLAY_DY = float(os.environ.get("ORCHES_OVERLAY_DY", "-4"))   # el TextField dibuja el texto ~4 px más abajo que un Text: el coloreado se sube para que coincida
POLL_SECONDS = 2              # cada cuánto se mira si el archivo cambió en el disco
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
  """Contenido de un archivo en una pestaña: se abre ya editable y con colores en las palabras reservadas.

  - Texto editable: editor con colores (el texto coloreado va debajo de un cuadro de texto transparente).
  - Solo lectura (bloqueado, muy grande, no UTF-8...): código con números de línea y marcas de git.
  - Imágenes y binarios: se muestran o se avisa.
  """
  path = Path(path)
  language = language_for(path)
  state = {"data": FileData("text"), "text": "", "dirty": False, "selection": (0, 0), "sugg": [], "sel": 0,
           "start": 0, "ticket": 0, "paint": 0, "marks": {}, "all_added": False, "view_w": 700, "painted_lines": -1}
  holder = Container(expand=True, content=Column(expand=True, alignment=MainAxisAlignment.CENTER,
                                                  horizontal_alignment=CrossAxisAlignment.CENTER, controls=[
    ProgressRing(width=22, height=22, stroke_width=2, color=ACCENT), Text(f"Abriendo {path.name}…", size=11, color=MUTED)]))
  ext_bars = []    # franjas de extensiones: se crean una vez y se reutilizan en cada repintado
  editor = {"field": None, "stack": None, "popup": None, "overlay": None, "gutter": None, "wide": None, "colors": False}

  def toast(message):
    show_toast(page, message)

  def confirm(title, message, accept_label, on_accept):
    close = show_modal(page, AlertDialog(
      modal=False, bgcolor=CARD, shape=RoundedRectangleBorder(radius=10), title=Text(title, size=14),
      content=Text(message, size=12, color=MUTED),
      actions=[TextButton("Cancelar", on_click=lambda e: close()),
               TextButton(accept_label, on_click=lambda e: (close(), on_accept()))]))

  def set_dirty(value):
    state["dirty"] = value
    hook = getattr(holder, "on_dirty", None)
    if hook:
      hook(value)

  def use_editor():
    data = state["data"]
    return data.kind == "text" and data.editable and edit_enabled()

  # --- editor con colores -------------------------------------------------------------------------------
  # El texto coloreado (un Text con fragmentos) se dibuja debajo de un TextField con el texto transparente: se ve el
  # color y se escribe en el TextField. Los dos usan la misma fuente, el mismo alto de línea y el mismo ancho, y el
  # ancho es tan grande como la línea más larga, así que ninguna línea se parte y todo queda alineado.
  FIELD_PAD = Padding(left=8, right=8, top=6, bottom=40)
  TEXT_STYLE = TextStyle(font_family=FONT, size=FONT_SIZE, height=1.35)

  def content_width(text):
    longest = max((len(l) for l in text.split("\n")), default=0)
    return max(state["view_w"] - 80, int((longest + 4) * CHAR_WIDTH) + 60)

  def colored_spans(text):
    out = []
    for i, tokens in enumerate(highlight(text, language)):
      if i:
        out.append(TextSpan("\n"))
      out.extend(spans(tokens, decorate=False))
    return out

  def gutter_spans(text):
    count = text.count("\n") + 1
    width = len(str(count))
    muted = TextStyle(color=MUTED)
    out = []
    for n in range(1, count + 1):
      kind = "added" if state["all_added"] else state["marks"].get(n)
      if n > 1:
        out.append(TextSpan("\n"))
      out.append(TextSpan(MARK_GLYPHS[kind] if kind else " ", style=TextStyle(color=MARK_COLORS[kind]) if kind else None))
      out.append(TextSpan(f"{n:>{width}} ", style=muted))
    return out, gutter_chars(count) - 1

  def make_editor():
    colors = len(state["text"].encode("utf-8")) <= MAX_COLOR_BYTES
    editor["colors"] = colors
    width = content_width(state["text"])
    visible_lines = max(20, int(700 / (FONT_SIZE * 1.35)))
    field = TextField(
      value=state["text"], multiline=True, min_lines=visible_lines, width=width, border=NoInputBorder(),
      cursor_color=ACCENT, content_padding=FIELD_PAD, selection_color=ACCENT_BG,
      text_style=TextStyle(font_family=FONT, size=FONT_SIZE, height=1.35, letter_spacing=0,
                           color=Colors.TRANSPARENT if colors else COLORS["plain"]),
      on_change=on_edit, on_focus=on_editor_focus, on_blur=lambda e: set_typing(False), on_selection_change=on_selection)
    popup = Container(visible=False, bottom=14, right=18, width=300, bgcolor=CARD, border_radius=8,
                      border=border_all(color=ACCENT_BG), padding=Padding(left=4, right=4, top=4, bottom=4))
    editor.update(field=field, popup=popup)
    state["sugg"] = []
    if not colors:                                  # archivo grande: editor simple, ocupa todo
      field.expand, field.width = True, None
      editor.update(stack=Stack(expand=True, controls=[field, popup]), overlay=None, gutter=None, wide=None)
      return field
    overlay = Text(spans=colored_spans(state["text"]), font_family=FONT, size=FONT_SIZE, no_wrap=True, style=TextStyle(height=1.35, letter_spacing=0),
                   color=COLORS["plain"])
    wide = Container(width=width, content=Stack(controls=[
      Container(left=0, top=0, width=width, padding=Padding(left=8, right=8, top=6 + OVERLAY_DY, bottom=0), content=overlay), field]))
    g_spans, g_chars = gutter_spans(state["text"])
    gutter = Text(spans=g_spans, font_family=FONT, size=FONT_SIZE, no_wrap=True, style=TextStyle(height=1.35, letter_spacing=0), color=MUTED)
    gutter_box = Container(width=int((g_chars + 1) * CHAR_WIDTH) + 14, padding=Padding(left=6, top=6 + OVERLAY_DY, bottom=40), content=gutter)
    scroll = Column(scroll=ScrollMode.AUTO, expand=True, controls=[Row(
      spacing=0, vertical_alignment=CrossAxisAlignment.START, controls=[
        gutter_box, Container(expand=True, content=Row(scroll=ScrollMode.AUTO, controls=[wide]))])])
    editor.update(overlay=overlay, gutter=gutter, gutter_box=gutter_box, wide=wide,
                  stack=Container(expand=True, on_size_change=on_viewport,
                                  content=Stack(expand=True, controls=[scroll, popup])))
    state["painted_lines"] = state["text"].count("\n") + 1
    return field

  def on_viewport(e):
    if abs(e.width - state["view_w"]) > 4:
      state["view_w"] = e.width
      if editor["colors"] and editor["field"]:
        fit_width()

  def fit_width():
    """Ajusta el ancho del editor a la línea más larga (o al panel si es más ancho)."""
    field, wide, overlay = editor["field"], editor["wide"], editor["overlay"]
    if not (field and wide):
      return
    width = content_width(state["text"])
    if width != field.width:
      field.width = wide.width = width
      wide.content.controls[0].width = width
      for part in (field, wide):
        try:
          part.update()
        except RuntimeError:
          pass

  async def repaint(ticket):
    """Vuelve a colorear tras escribir (se agrupan las pulsaciones rápidas)."""
    await asyncio.sleep(0.08)
    if ticket != state["paint"] or not editor["colors"] or not editor["overlay"]:
      return
    text = state["text"]
    editor["overlay"].spans = colored_spans(text)
    lines = text.count("\n") + 1
    if lines != state["painted_lines"]:             # cambió el número de líneas: se rehacen los números del margen
      g_spans, g_chars = gutter_spans(text)
      editor["gutter"].spans = g_spans
      editor["gutter_box"].width = int((g_chars + 1) * CHAR_WIDTH) + 14
      state["painted_lines"] = lines
      try:
        editor["gutter_box"].update()
      except RuntimeError:
        pass
    fit_width()
    try:
      editor["overlay"].update()
    except RuntimeError:
      pass

  # --- sugerencias de autocompletado ------------------------------------------------------------------------
  KIND_ICONS = {"keyword": Icons.KEY, "type": Icons.DATA_OBJECT, "word": Icons.TEXT_FIELDS, "module": Icons.INVENTORY_2}
  KIND_NAMES = {"keyword": "palabra clave", "type": "tipo", "word": "en este archivo", "module": "módulo"}

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
          Text(s.detail or KIND_NAMES[s.kind], size=10, color=MUTED)]),
        lambda e, i=i: accept(i), hover_bg=ACCENT_BG, bgcolor=ACCENT_BG if active else None,
        padding=Padding(left=8, right=8, top=4, bottom=4), border_radius=6))
    hint = Text("↑↓ elegir · Enter o Tab aceptar · Esc cerrar", size=9, color=MUTED)
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
    if ticket != state["ticket"] or not editor["field"]:
      return
    text, cursor = state["text"], state["selection"][1]
    lang = LANGS[language]
    found = []
    for entry in extensions.REGISTRY.completions_for(language):     # p. ej. los módulos de Node dentro de un import
      try:
        found = entry.provide(text, cursor, path)
      except Exception:
        found = []
      if found:
        break
    if found:
      state.update(sugg=found, sel=0, start=found[0].start)
    else:
      found = completion.suggestions(text, cursor, lang.keywords, lang.types, force=force, case_insensitive=lang.ignore_case)
      state.update(sugg=found, sel=0, start=completion.prefix_at(text, cursor)[0])
    render_popup()

  def on_selection(e):
    state["selection"] = (e.selection.start, e.selection.end)
    if state["sugg"]:       # si el cursor salió de la palabra que se completaba, el cuadro ya no aplica
      if state["sugg"][0].start >= 0:      # sugerencia de una extensión (p. ej. dentro de comillas)
        typed = state["text"][state["start"]:e.selection.end]
        if e.selection.end < state["start"] or any(c in typed for c in "'\"`\n"):
          hide_suggestions()
        return
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
    field.update()
    state["sugg"] = []
    render_popup()
    changed()
    page.run_task(place_cursor, cursor)

  async def place_cursor(position):
    """Al cambiar el valor el cuadro de texto manda el cursor al final: se vuelve a colocar y se devuelve el foco."""
    await asyncio.sleep(0.05)
    field = editor["field"]
    if not field:
      return
    try:
      field.selection = TextSelection(base_offset=position, extent_offset=position)
      field.update()
      await field.focus()
    except Exception:
      pass

  def handle_suggest_key(e):
    """Teclas con el cuadro abierto. True si la tecla se usó (no debe llegar al editor)."""
    if not state["sugg"]:
      return False
    if e.key in ("Arrow Down", "Arrow Up"):
      state["sel"] = (state["sel"] + (1 if e.key == "Arrow Down" else -1)) % len(state["sugg"])
      render_popup()
    elif (e.key == "Tab" or e.key == "Enter") and not e.shift:
      state["enter_at"] = time.monotonic()
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

  def changed():
    """El texto cambió (escribiendo, aceptando una sugerencia o con Tab): recolorea y marca «sin guardar»."""
    state["paint"] += 1                # contador propio: el de las sugerencias no debe cancelar el repintado
    page.run_task(repaint, state["paint"])
    if not state["dirty"]:
      set_dirty(True)

  def inserted_newline(old, new):
    """¿`new` es `old` con un salto de línea de más? (el Enter que aceptó una sugerencia también llega al cuadro de texto)"""
    if len(new) != len(old) + 1:
      return False
    return any(new[i] == "\n" and new[:i] + new[i + 1:] == old for i in range(len(new)))

  def on_edit(e):
    value = e.control.value or ""
    if inserted_newline(state["text"], value) and (state["sugg"] or time.monotonic() - state.get("enter_at", 0) < 0.5):
      e.control.value = state["text"]      # ese Enter era para elegir la sugerencia, no para escribir una línea nueva
      e.control.update()
      if state["sugg"]:
        state["enter_at"] = time.monotonic()
        accept()
      else:
        page.run_task(place_cursor, state["selection"][1])
      return
    state["text"] = value
    page.run_task(update_suggestions)
    changed()

  # --- contenido ------------------------------------------------------------------------------------------------
  def notice():
    """Franja fina solo cuando el archivo no se puede editar (en un archivo normal no hay ninguna barra)."""
    data = state["data"]
    if data.kind != "text" or use_editor():
      return None
    reason = ("Solo el primer MB · solo lectura" if data.truncated else
              "No es UTF-8 · solo lectura" if not data.utf8 else
              "Muy grande para editar · solo lectura" if not data.editable else
              "Edición bloqueada (Ctrl+Shift+L para permitirla)")
    return Container(padding=Padding(left=12, right=12, top=5, bottom=5), bgcolor="#151925",
                     content=Text(reason, size=10, color=WARN))

  def body():
    data = state["data"]
    if data.kind == "image":
      return Container(expand=True, padding=12, content=Image(src=data.text, fit=BoxFit.CONTAIN))
    if data.kind == "binary":
      return Column(expand=True, alignment=MainAxisAlignment.CENTER, horizontal_alignment=CrossAxisAlignment.CENTER, controls=[
        Icon(Icons.DATA_OBJECT, size=30, color=MUTED),
        Text("Archivo binario: no se puede mostrar como texto", size=12, color=MUTED)])
    if use_editor():
      if not editor["field"]:
        make_editor()
      return editor["stack"]
    editor.update(field=None, stack=None, overlay=None, gutter=None, wide=None, popup=None)
    return code_view(state["text"].replace("\t", "    "), language, state["marks"], state["all_added"])

  def toolbars():
    """Franjas que las extensiones añaden sobre este archivo (p. ej. el ▶ de los .sql)."""
    if state["data"].kind != "text":
      return []
    if not ext_bars:
      doc = SimpleNamespace(path=path, get_text=lambda: state["text"])
      for entry in extensions.REGISTRY.toolbars_for(path):
        try:
          ext_bars.append(entry.build(page, doc))
        except Exception as e:      # una extensión rota no debe impedir abrir el archivo
          ext_bars.append(Container(padding=Padding(left=12, right=12, top=4, bottom=4), bgcolor="#151925",
                                    content=Text(f"{entry.extension.name}: {type(e).__name__}: {e}", size=10, color=ERROR)))
    return ext_bars

  def show():
    column = Column(expand=True, spacing=0, controls=[*toolbars(), *[c for c in (notice(), body()) if c is not None]])
    holder.content = column
    try:
      holder.update()
    except RuntimeError:
      pass

  # --- guardar --------------------------------------------------------------------------------------------------
  async def refresh_marks():
    """Marcas de git del margen (líneas añadidas, modificadas o borradas)."""
    marks, all_added = await asyncio.to_thread(diff_marks, path)
    state["marks"], state["all_added"] = marks, all_added

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
    await refresh_marks()
    if editor["gutter"]:                               # el margen refleja lo recién guardado
      g_spans, _ = gutter_spans(state["text"])
      editor["gutter"].spans = g_spans
      try:
        editor["gutter"].update()
      except RuntimeError:
        pass
    toast(f"Guardado {path.name}")

  def insert_tab(shift=False):
    """Tab dentro del editor: Flutter lo usaría para saltar de campo, así que se inserta aquí."""
    field = editor["field"]
    if not field:
      return
    start, end = sorted(state["selection"])
    text = state["text"]
    if shift:                   # Shift+Tab: quita hasta una sangría al inicio de la línea
      line_start = text.rfind("\n", 0, start) + 1
      chunk = text[line_start:line_start + len(TAB)]
      removed = min(len(chunk) - len(chunk.lstrip(" ")), len(TAB))
      new, cursor = text[:line_start] + text[line_start + removed:], max(line_start, start - removed)
    else:
      new, cursor = text[:start] + TAB + text[end:], start + len(TAB)
    state["text"], state["selection"] = new, (cursor, cursor)
    field.value = new
    field.selection = TextSelection(base_offset=cursor, extent_offset=cursor)
    field.update()
    changed()

    async def back():          # el Tab ya movió el foco a otro control: se devuelve al editor
      try:
        await editor["field"].focus()
      except Exception:
        pass
    page.run_task(back)

  # --- carga y cambios externos ----------------------------------------------------------------------------------
  async def load(silent=False):
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
    state["sugg"] = []
    editor.update(field=None, stack=None, overlay=None, gutter=None, wide=None, popup=None)
    if data.kind == "text":
      await refresh_marks()
    show()

  async def watch_disk():
    """Si otra herramienta cambia el archivo y aquí no hay cambios sin guardar, se recarga solo."""
    while True:
      await asyncio.sleep(POLL_SECONDS)
      if state["dirty"] or state["data"].kind == "image":
        continue
      try:
        mtime = await asyncio.to_thread(lambda: path.stat().st_mtime_ns)
      except OSError:
        continue
      if mtime != state["data"].mtime_ns:
        try:
          await load()
        except RuntimeError:
          return                        # el panel se cerró

  def permission_changed(enabled):
    """Se activó o bloqueó la edición para todos los archivos."""
    if state["data"].kind != "text" or not state["data"].editable:
      return
    if not enabled and state["dirty"]:
      return                            # con cambios sin guardar se sigue editando hasta guardar
    editor.update(field=None, stack=None, overlay=None, gutter=None, wide=None, popup=None)
    show()

  holder.save = lambda: page.run_task(save)        # Ctrl+S (lo llama el área de trabajo)
  holder.save_async = save                         # «Guardar y cerrar»
  holder.insert_tab = insert_tab                   # Tab / Shift+Tab
  holder.is_dirty = lambda: state["dirty"]
  holder.exit_edit = lambda: None                  # el archivo siempre está abierto para editar
  holder.handle_suggest_key = handle_suggest_key   # ↑↓ Tab Esc con el cuadro de sugerencias abierto
  holder.trigger_suggest = lambda: page.run_task(update_suggestions, True)   # Ctrl+Espacio
  holder.discard = lambda: set_dirty(False)
  subscribe(permission_changed)
  page.run_task(load)
  page.run_task(watch_disk)
  return holder
