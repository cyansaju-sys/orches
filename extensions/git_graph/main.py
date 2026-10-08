"""Git Graph: botón en la barra de título que abre el historial del proyecto como grafo de ramas en el editor."""
from flet import Icons
from .view import GitGraphView


def activate(api):
  def open_graph():
    api.open_document("Git Graph", Icons.COMMIT, lambda: GitGraphView(api.page, api.open_document), key="git_graph",
                      crumbs=["Git Graph"])

  api.add_titlebar_button("Graph", open_graph, tooltip="Historial de git como grafo")
