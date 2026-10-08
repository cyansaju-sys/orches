"""Extensión de ejemplo: un botón en la barra de título y una franja sobre los archivos .txt."""
from flet import Container, Padding, Text


def activate(api):
  api.add_titlebar_button("Hola", lambda: api.toast("¡Hola desde una extensión!", kind="ok"))

  def banner(page, doc):
    return Container(padding=Padding(left=12, right=12, top=4, bottom=4), bgcolor="#151925",
                     content=Text(f"Archivo de texto: {doc.path.name}", size=11, color="#6B7088"))

  api.add_editor_toolbar(["txt"], banner)
