from flet import (
  AlertDialog, Container, Column, Row, Text, TextButton, Padding, RoundedRectangleBorder, ScrollMode,
  MainAxisAlignment, CrossAxisAlignment,
)
from orches.ui.components.modal import show_modal
from orches.ui.theme import ACCENT, BORDER_COLOR, border_all

MUTED = "#6B7088"
TEXT = "#E6E8EF"

# (atajo, qué hace). Los que llevan Ctrl+Shift no chocan con las teclas que usan los agentes y las shells.
SECTIONS = (
  ("Archivos", (
    ("Ctrl + S", "Guardar el archivo abierto"),
    ("Ctrl + W", "Cerrar la pestaña del archivo"),
    ("Ctrl + Shift + L", "Permitir o bloquear la edición de archivos"),
    ("Tab / Shift + Tab", "Sangría al editar"),
    ("Ctrl + Espacio", "Pedir sugerencias de autocompletado"),
    ("↑ ↓ · Tab · Esc", "Elegir, aceptar o cerrar una sugerencia"),
  )),
  ("Paneles", (
    ("Ctrl + Shift + N", "Abrir un agente"),
    ("Ctrl + Shift + T", "Mostrar u ocultar la terminal"),
    ("Ctrl + Shift + W", "Cerrar el panel activo"),
    ("Ctrl + Av Pág / Re Pág", "Pestaña o panel siguiente / anterior"),
  )),
  ("Barra lateral", (
    ("Ctrl + Shift + B", "Mostrar u ocultar la barra lateral"),
    ("Ctrl + Shift + E", "Archivos"),
    ("Ctrl + Shift + A", "Agentes"),
    ("Ctrl + Shift + G", "Git"),
    ("Ctrl + Shift + X", "Servidores MCP"),
    ("Ctrl + Shift + U", "Consumo e historial de IA"),
    ("Ctrl + Shift + Z", "Extensiones"),
  )),
  ("General", (
    ("Ctrl + Shift + V", "Pegar en la terminal"),
    ("F1", "Esta ayuda"),
  )),
)


def _key(text):
  return Container(content=Text(text, size=10, color=ACCENT), padding=Padding(left=8, right=8, top=3, bottom=3),
                   border_radius=6, border=border_all(color=BORDER_COLOR))


def open_shortcuts(page):
  """Ventana con todos los atajos de teclado."""
  controls = []
  for title, rows in SECTIONS:
    controls.append(Container(padding=Padding(top=8, bottom=2), content=Text(title.upper(), size=10, color=MUTED)))
    for keys, what in rows:
      controls.append(Row(alignment=MainAxisAlignment.SPACE_BETWEEN, vertical_alignment=CrossAxisAlignment.CENTER, controls=[
        Text(what, size=12, color=TEXT), _key(keys)]))
  close = show_modal(page, AlertDialog(
    modal=False, bgcolor="#11141D", shape=RoundedRectangleBorder(radius=10),
    title=Text("Atajos de teclado", size=14),
    content=Container(width=460, height=420, content=Column(spacing=6, scroll=ScrollMode.AUTO, controls=controls)),
    actions=[TextButton("Cerrar", on_click=lambda e: close())]))
