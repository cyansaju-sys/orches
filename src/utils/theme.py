from flet import Border, BorderSide

BORDER_COLOR = "#2A2F3D"
ACCENT = "#8B7CFF"


def border_all(width=1, color=BORDER_COLOR):
  side = BorderSide(width=width, color=color)
  return Border(top=side, right=side, bottom=side, left=side)


def border_right(width=1, color=BORDER_COLOR):
  return Border(right=BorderSide(width=width, color=color))
