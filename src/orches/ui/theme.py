from flet import Border, BorderSide

BORDER_COLOR = "#2A2F3D"
ACCENT = "#22D3EE"      # color de acento (cian)
ACCENT_BG = "#2E2447"   # fondo morado: hover y selección en toda la interfaz
ACCENT_DIM = "#2B5663"  # acento apagado


def border_all(width=1, color=BORDER_COLOR):
  side = BorderSide(width=width, color=color)
  return Border(top=side, right=side, bottom=side, left=side)


def border_right(width=1, color=BORDER_COLOR):
  return Border(right=BorderSide(width=width, color=color))

# Colores del estado de git (los mismos tonos que usa VS Code)
GIT_COLORS = {
  "M": "#E2C08D",  # modificado
  "A": "#73C991",  # añadido (en el índice)
  "U": "#73C991",  # nuevo, sin seguir
  "R": "#73C991",  # renombrado
  "D": "#C74E39",  # borrado
  "C": "#E4676B",  # conflicto
}
