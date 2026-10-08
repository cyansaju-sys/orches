"""Contraseñas en el llavero del sistema (Windows, macOS Keychain, Linux SecretService/KWallet).

Nunca se escriben en archivos de configuración. Si no hay llavero disponible, simplemente no se
puede guardar y la app pide la contraseña cada vez.
"""
SERVICE = "orches"


class SecretsError(Exception):
  pass


def _keyring():
  try:
    import keyring
    from keyring.backends import fail
  except ImportError:
    raise SecretsError("Falta instalar keyring: uv add keyring")
  if isinstance(keyring.get_keyring(), fail.Keyring):
    raise SecretsError("No hay un llavero disponible en este sistema")
  return keyring


def available():
  """(¿se pueden guardar contraseñas?, motivo si no)."""
  try:
    _keyring()
    return True, ""
  except SecretsError as e:
    return False, str(e)


def save(key, password):
  try:
    _keyring().set_password(SERVICE, key, password)
  except SecretsError:
    raise
  except Exception as e:      # el llavero puede estar bloqueado o rechazar el acceso
    raise SecretsError(f"No se pudo guardar en el llavero: {e}")


def get(key):
  try:
    return _keyring().get_password(SERVICE, key)
  except SecretsError:
    return None
  except Exception:
    return None


def delete(key):
  try:
    _keyring().delete_password(SERVICE, key)
  except Exception:
    pass          # no existía o el llavero no está disponible: da igual
