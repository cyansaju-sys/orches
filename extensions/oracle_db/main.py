"""Extensión Oracle: pestaña de base de datos en la barra lateral y botón ▶ en los archivos .sql."""
from flet import Icons
from .database import DatabaseView
from .db_object import ObjectViewer
from .oracle import SINGULAR
from .sql_runner import SqlToolbar


def activate(api):
  def open_object(session, owner, obj):
    """Abre el código o los detalles de un objeto de la base en una pestaña del editor."""
    kind = SINGULAR.get(obj.type, obj.type.title())
    api.open_document(f"{obj.name} · {kind}", Icons.STORAGE, lambda: ObjectViewer(api.page, session, owner, obj),
                      key=f"db:{owner}.{obj.type}.{obj.name}",
                      crumbs=[session.profile.name if session.profile else "Base de datos", owner, kind, obj.name])

  api.add_sidebar_view(lambda page: DatabaseView(page, open_object), title="Base de datos")
  api.add_editor_toolbar([".sql"], lambda page, doc: SqlToolbar(page, doc.get_text))
