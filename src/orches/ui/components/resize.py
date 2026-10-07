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


def resize_handle_height(panel, min_height=80, max_height=lambda: 800, grows_up=True):
  """Manejador horizontal que cambia el alto de `panel` al arrastrarlo.

  Con `grows_up=True` (panel inferior) arrastrar hacia arriba lo agranda.
  `max_height` es una función para poder depender del tamaño actual de la ventana.
  """

  def on_drag(e):
    delta = -e.primary_delta if grows_up else e.primary_delta
    panel.height = max(min_height, min(max_height(), panel.height + delta))
    panel.update()

  return GestureDetector(
    mouse_cursor=MouseCursor.RESIZE_ROW,
    on_vertical_drag_update=on_drag,
    content=Container(height=HANDLE_WIDTH, bgcolor="transparent"),
  )
