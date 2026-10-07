from flet import (
  Text, Icon, Icons, Container, Row, Padding, MainAxisAlignment,
  CrossAxisAlignment, WindowDragArea,
)
from utils.theme import ACCENT, ACCENT_BG
from widgets.others.clickable import IconAction, Clickable

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
            ],
          ),
          Row(
            spacing=2,
            controls=[
              _button(Icons.REMOVE, minimize),
              _button(Icons.CROP_SQUARE, toggle_maximize),
              _button(Icons.CLOSE, close, hover_bg="#3A1620", hover_color="#FF6B81"),
            ],
          ),
        ],
      ),
    ),
  )
