from flet import Container, GestureDetector, MouseCursor

MIN_WIDTH = 60
MAX_WIDTH = 500
HANDLE_WIDTH = 3


def resize_handle(panel, min_width=MIN_WIDTH, max_width=MAX_WIDTH):
  """Devuelve un manejador que cambia el ancho de `panel` al arrastrarlo."""

  def on_drag(e):
    panel.width = max(min_width, min(max_width, panel.width + e.primary_delta))
    panel.update()

  return GestureDetector(
    mouse_cursor=MouseCursor.RESIZE_COLUMN,
    on_horizontal_drag_update=on_drag,
    content=Container(width=HANDLE_WIDTH, bgcolor="transparent"),
  )
