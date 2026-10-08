from flet import Container, GestureDetector, Icon, MouseCursor, Alignment

# Los botones de Material (IconButton, TextButton, InkWell) toman el foco del teclado, y
# entonces Enter/Espacio los vuelve a pulsar: Enter minimizaba la ventana o reabría un agente.
# GestureDetector no es enfocable, así que el teclado siempre queda para la terminal.


def Clickable(content, on_click, hover_bg=None, tooltip=None, on_secondary_tap=None, **container_args):
  """Área pulsable sin foco de teclado, con color de fondo al pasar el mouse."""
  base_bg = container_args.pop("bgcolor", None)
  visible = container_args.pop("visible", True)   # igual: lo controla el detector
  expand = container_args.pop("expand", None)   # el que debe expandirse es el detector, no el contenedor

  def hover(e):
    box.bgcolor = hover_bg if e.data and hover_bg else base_bg
    box.update()

  box = Container(
    content=content,
    bgcolor=base_bg,
    tooltip=tooltip,
    on_hover=hover if hover_bg else None,
    **container_args,
  )
  return GestureDetector(
    content=box,
    on_tap=on_click,
    on_secondary_tap=on_secondary_tap,       # clic derecho (menú contextual)
    mouse_cursor=MouseCursor.CLICK,
    expand=expand,
    visible=visible,
  )


def IconAction(icon, on_click, size=16, color="#6B7088", hover_color=None,
               hover_bg=None, width=32, height=26, tooltip=None, radius=6):
  """Botón de ícono sin foco; `hover_color` cambia el color del ícono al pasar el mouse."""
  glyph = Icon(icon, size=size, color=color)

  def hover(e):
    glyph.color = hover_color if (e.data and hover_color) else color
    glyph.update()

  action = Clickable(
    glyph,
    on_click,
    hover_bg=hover_bg,
    tooltip=tooltip,
    width=width,
    height=height,
    border_radius=radius,
    alignment=Alignment.CENTER,
  )
  if hover_color:
    inner = action.content
    prev = inner.on_hover

    def both(e):
      if prev:
        prev(e)
      hover(e)

    inner.on_hover = both
  return action
