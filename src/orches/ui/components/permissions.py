"""Permiso global para editar archivos: activado, los archivos de texto se abren ya editables.

Se guarda en la configuración del usuario y avisa a quien lo esté mirando (visores abiertos, botón
de la barra de título) cuando cambia.
"""
from orches.core import settings

KEY = "edit_files"
_listeners = []


def edit_enabled():
  return bool(settings.get(KEY, True))


def set_edit_enabled(value):
  settings.set(KEY, bool(value))
  for callback in list(_listeners):
    try:
      callback(bool(value))
    except Exception:       # un visor ya cerrado no debe impedir avisar a los demás
      pass


def toggle_edit():
  set_edit_enabled(not edit_enabled())
  return edit_enabled()


def subscribe(callback):
  _listeners.append(callback)
  return lambda: _listeners.remove(callback) if callback in _listeners else None
