# Mientras haya un diálogo abierto, las teclas no deben llegar a la terminal activa.
_open = {"count": 0}


def modal_open():
  return _open["count"] > 0


def show_modal(page, dialog):
  """Muestra `dialog` y devuelve la función que lo cierra."""
  done = {"value": False}

  def finish():
    if not done["value"]:
      done["value"] = True
      _open["count"] = max(0, _open["count"] - 1)

  previous = dialog.on_dismiss

  def dismissed(e):
    finish()
    if previous:
      previous(e)

  def close():
    page.pop_dialog()
    finish()

  _open["count"] += 1
  dialog.on_dismiss = dismissed
  page.show_dialog(dialog)
  return close


# Mientras se escribe en un campo de texto de la interfaz (p. ej. el mensaje de commit), las
# teclas tampoco deben llegar a la terminal activa.
_typing = {"on": False}


def set_typing(active):
  _typing["on"] = bool(active)


def typing_open():
  return _typing["on"]
