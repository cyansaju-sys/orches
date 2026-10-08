"""Zona de documentos: pestañas arriba, ruta de navegación y el contenido del archivo (como VS Code)."""
from pathlib import Path
from flet import (
  AlertDialog, Container, Column, Row, Text, Icon, Icons, Image, Padding, TextButton, ScrollMode, Border, BorderSide,
  RoundedRectangleBorder, ClipBehavior, TextOverflow, FontWeight, CrossAxisAlignment, MainAxisAlignment,
)
from orches.core import settings
from orches.ui.components.clickable import Clickable, IconAction
from orches.ui.components.modal import show_modal
from orches.ui.theme import ACCENT, ACCENT_BG, BORDER_COLOR, GIT_COLORS, border_all

MUTED = "#6B7088"
TEXT = "#E6E8EF"
BAR_BG = "#0A0C12"
TAB_ACTIVE_BG = "#0D0F16"
TAB_IDLE_BG = "#11141D"


def EditorArea(page, on_focus, on_empty, on_first):
  """Pestañas de documentos.

  on_focus(): el usuario usó el editor (las teclas dejan de ir a las terminales).
  on_empty(): se cerró la última pestaña.   on_first(): se abrió la primera.
  """
  docs = []
  state = {"active": None}
  tabs = Row(spacing=1, scroll=ScrollMode.AUTO, vertical_alignment=CrossAxisAlignment.END)
  crumbs = Row(spacing=4, scroll=ScrollMode.AUTO)
  body = Container(expand=True)
  frame = Container(
    expand=True, bgcolor=TAB_ACTIVE_BG, border_radius=8, border=border_all(), clip_behavior=ClipBehavior.HARD_EDGE,
    content=Column(expand=True, spacing=0, controls=[
      Container(content=tabs, bgcolor=BAR_BG, padding=Padding(top=4)),
      Container(content=crumbs, padding=Padding(left=12, right=12, top=5, bottom=5),
                border=Border(bottom=BorderSide(1, BORDER_COLOR))),
      body,
    ]))

  def project_root():
    value = settings.get("project")
    return Path(value) if value else None

  # --- pestañas -----------------------------------------------------------------------------------
  def build_tab(doc):
    active = doc is state["active"]
    letter_color = GIT_COLORS.get(doc["letter"], MUTED)
    name_color = GIT_COLORS.get(doc["letter"], TEXT if active else MUTED)
    glyph = Image(src=doc["icon"], width=16, height=16) if isinstance(doc["icon"], str) else Icon(doc["icon"], size=14, color=ACCENT)
    return Clickable(
      Row(spacing=6, vertical_alignment=CrossAxisAlignment.CENTER, controls=[
        glyph,
        Text(doc["title"], size=12, color=name_color, no_wrap=True, overflow=TextOverflow.ELLIPSIS),
        Text(doc["letter"], size=10, color=letter_color, weight=FontWeight.W_600, visible=bool(doc["letter"])),
        Text("●", size=10, color="#E2C08D", visible=doc["dirty"], tooltip="Cambios sin guardar"),
        IconAction(Icons.CLOSE, lambda e, d=doc: close(d), size=12, color=MUTED, hover_color=TEXT, hover_bg="#2A2F3D",
                   width=20, height=20),
      ]),
      lambda e, d=doc: select(d), hover_bg=None if active else "#151925",
      bgcolor=TAB_ACTIVE_BG if active else TAB_IDLE_BG,
      border=Border(top=BorderSide(2, ACCENT if active else TAB_IDLE_BG)),
      padding=Padding(left=10, right=4, top=5, bottom=5), border_radius=0, tooltip=doc.get("tooltip"))

  def draw():
    for doc in docs:
      doc["tab"] = build_tab(doc)
    tabs.controls = [d["tab"] for d in docs]
    doc = state["active"]
    body.content = doc["control"] if doc else None
    crumbs.controls = breadcrumb(doc) if doc else []
    for part in (tabs, crumbs, body):
      try:
        part.update()
      except RuntimeError:
        pass

  def breadcrumb(doc):
    parts = doc.get("crumbs")
    if parts is None and doc.get("path"):
      path, root = Path(doc["path"]), project_root()
      try:
        parts = list(path.relative_to(root).parts) if root else list(path.parts[-4:])
      except ValueError:
        parts = list(path.parts[-4:])
    parts = parts or [doc["title"]]
    controls = []
    for i, part in enumerate(parts):
      last = i == len(parts) - 1
      if i:
        controls.append(Icon(Icons.CHEVRON_RIGHT, size=14, color=MUTED))
      if last:
        glyph = Image(src=doc["icon"], width=14, height=14) if isinstance(doc["icon"], str) else None
        controls.append(Row(spacing=4, controls=[*([glyph] if glyph else []), Text(part, size=11, color=TEXT)]))
      else:
        controls.append(Text(part, size=11, color=MUTED))
    return controls

  # --- abrir, seleccionar y cerrar ------------------------------------------------------------------
  def select(doc):
    state["active"] = doc
    draw()
    on_focus()

  def open_doc(title, icon, make, key=None, crumbs_list=None, path=None):
    """Abre un documento en una pestaña; si `key` ya está abierto solo lo selecciona."""
    if key is not None:
      existing = next((d for d in docs if d["key"] == key), None)
      if existing:
        select(existing)
        return existing
    control = make()
    doc = {"key": key, "title": title, "icon": icon, "control": control, "crumbs": crumbs_list, "path": path,
           "dirty": False, "letter": "", "tab": None, "tooltip": str(path) if path else title}
    control.focus_cb = on_focus
    control.on_dirty = lambda dirty, d=doc: set_dirty(d, dirty)
    first = not docs
    docs.append(doc)
    state["active"] = doc
    if first:
      on_first()
    draw()
    on_focus()
    return doc

  def set_dirty(doc, dirty):
    doc["dirty"] = dirty
    draw()

  def close(doc, force=False):
    if doc["dirty"] and not force:
      async def save_and_close():
        await doc["control"].save_async()
        if not doc["dirty"]:
          close(doc, True)

      stop = show_modal(page, AlertDialog(
        modal=False, bgcolor="#11141D", shape=RoundedRectangleBorder(radius=10),
        title=Text("Cambios sin guardar", size=14),
        content=Text(f"«{doc['title']}» tiene cambios sin guardar.", size=12, color=MUTED),
        actions=[TextButton("Cancelar", on_click=lambda e: stop()),
                 TextButton("Descartar", on_click=lambda e: (stop(), close(doc, True))),
                 TextButton("Guardar y cerrar", on_click=lambda e: (stop(), page.run_task(save_and_close)))]))
      return
    index = docs.index(doc)
    docs.remove(doc)
    if state["active"] is doc:
      state["active"] = docs[min(index, len(docs) - 1)] if docs else None
    draw()
    if not docs:
      on_empty()

  def cycle(step):
    if len(docs) > 1 and state["active"] in docs:
      select(docs[(docs.index(state["active"]) + step) % len(docs)])

  def close_active():
    if state["active"]:
      close(state["active"])

  def update_status(status, root):
    """Letra de git (M, U, A, D...) de cada pestaña que es un archivo del proyecto."""
    changed = False
    for doc in docs:
      letter = ""
      if doc.get("path") and root:
        try:
          letter = status.get(Path(doc["path"]).resolve().relative_to(Path(root).resolve()).as_posix(), "")
        except ValueError:
          pass
      if letter != doc["letter"]:
        doc["letter"], changed = letter, True
    if changed:
      draw()

  def active_control():
    return state["active"]["control"] if state["active"] else None

  frame.open = open_doc
  frame.close_active = close_active
  frame.cycle = cycle
  frame.update_status = update_status
  frame.active_control = active_control
  frame.docs = docs
  return frame
