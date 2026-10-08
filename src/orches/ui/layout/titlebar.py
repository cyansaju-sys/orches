import asyncio
from pathlib import Path
from flet import (
  Text, Icon, Icons, Container, Row, Padding, MainAxisAlignment,
  CrossAxisAlignment, WindowDragArea,
)
from orches.core import settings
from orches.core.git import branch
from orches.ui.components.permissions import edit_enabled, subscribe, toggle_edit
from orches.ui.dialogs.branch_picker import BranchPicker
from orches.ui.dialogs.shortcuts import open_shortcuts
from orches.ui.theme import ACCENT, ACCENT_BG
from orches.ui.components.clickable import IconAction, Clickable

HEIGHT = 34
IDLE_COLOR = "#6B7088"


def _button(icon, on_click, hover_bg=ACCENT_BG, hover_color=ACCENT):
  return IconAction(
    icon, on_click, size=16, color=IDLE_COLOR,
    hover_color=hover_color, hover_bg=hover_bg, width=32, height=26,
  )


def TitleBar(page, on_terminal=None, title="IA orches"):
  def minimize(e):
    page.window.minimized = True
    page.update()

  def toggle_maximize(e):
    page.window.maximized = not page.window.maximized
    page.update()

  async def close(e):
    await page.window.close()

  # --- rama actual del proyecto: visible en toda la app, pulsable para cambiarla ---------------
  branch_name = Text("", size=12, color=IDLE_COLOR)
  branch_chip = Clickable(
    Row(spacing=6, controls=[Icon(Icons.CALL_SPLIT, size=14, color=ACCENT), branch_name,
                             Icon(Icons.KEYBOARD_ARROW_DOWN, size=14, color=IDLE_COLOR)]),
    lambda e: open_branches(),
    hover_bg=ACCENT_BG, tooltip="Cambiar de rama",
    padding=Padding(left=8, right=6, top=4, bottom=4), border_radius=6, visible=False,
  )
  shown = {"name": None}

  def current_project():
    project = settings.get("project")
    return project if project and Path(project).is_dir() else None

  async def refresh_branch():
    project = current_project()
    name = await asyncio.to_thread(branch, project) if project else None
    if name != shown["name"]:
      shown["name"] = name
      branch_name.value = name or ""
      branch_chip.visible = bool(name)
      try:
        branch_chip.update()
      except RuntimeError:
        shown["name"] = None     # aún no está en pantalla: se reintenta en el siguiente ciclo

  async def watch_branch():
    while True:
      await refresh_branch()
      await asyncio.sleep(3)

  def open_branches():
    project = current_project()
    if project:
      BranchPicker(page, project, lambda: page.run_task(refresh_branch))

  page.run_task(watch_branch)

  # --- permiso global de edición: con «Edición» activada los archivos se abren ya editables ----------
  edit_icon = Icon(Icons.EDIT, size=14, color=ACCENT)
  edit_label = Text("Edición", size=12, color=IDLE_COLOR)

  def paint_edit(enabled):
    edit_icon.name = Icons.EDIT if enabled else Icons.EDIT_OFF
    edit_icon.color = ACCENT if enabled else IDLE_COLOR
    edit_label.value = "Edición" if enabled else "Solo lectura"
    for part in (edit_icon, edit_label):
      try:
        part.update()
      except RuntimeError:
        pass

  edit_chip = Clickable(
    Row(spacing=6, controls=[edit_icon, edit_label]), lambda e: toggle_edit(), hover_bg=ACCENT_BG,
    tooltip="Edición de archivos: activa = se abren editables; bloqueada = solo lectura (Ctrl+Shift+L)",
    padding=Padding(left=8, right=8, top=4, bottom=4), border_radius=6,
  )
  subscribe(paint_edit)
  paint_edit(edit_enabled())

  return WindowDragArea(
    maximizable=True,
    content=Container(
      height=HEIGHT,
      bgcolor="#07080C",
      padding=Padding(left=12, right=4, top=0, bottom=0),
      content=Row(
        alignment=MainAxisAlignment.SPACE_BETWEEN,
        vertical_alignment=CrossAxisAlignment.CENTER,
        controls=[
          Row(
            spacing=12,
            vertical_alignment=CrossAxisAlignment.CENTER,
            controls=[
              Text(title, size=12, color=IDLE_COLOR),
              Clickable(
                Row(
                  spacing=6,
                  controls=[
                    Icon(Icons.TERMINAL, size=14, color=ACCENT),
                    Text("Terminal", size=12, color=IDLE_COLOR),
                  ],
                ),
                lambda e: on_terminal() if on_terminal else None,
                hover_bg=ACCENT_BG,
                tooltip="Abrir o cerrar la terminal",
                padding=Padding(left=8, right=8, top=4, bottom=4),
                border_radius=6,
              ),
              branch_chip,
              edit_chip,
            ],
          ),
          Row(
            spacing=2,
            controls=[
              _button(Icons.KEYBOARD, lambda e: open_shortcuts(page), hover_bg=ACCENT_BG, hover_color=ACCENT),
              _button(Icons.REMOVE, minimize),
              _button(Icons.CROP_SQUARE, toggle_maximize),
              _button(Icons.CLOSE, close, hover_bg="#3A1620", hover_color="#FF6B81"),
            ],
          ),
        ],
      ),
    ),
  )
