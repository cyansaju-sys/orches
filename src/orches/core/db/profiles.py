"""Perfiles de conexión a bases de datos. La contraseña NO se guarda aquí (ver core/secrets.py)."""
import uuid
from dataclasses import asdict, dataclass, field

from orches.core import secrets, settings

KEY = "db_profiles"


@dataclass
class Profile:
  name: str
  host: str
  service: str                  # nombre de servicio (o SID) de Oracle
  user: str
  port: int = 1521
  save_password: bool = False   # ¿hay una contraseña guardada en el llavero?
  use_sid: bool = False         # `service` es un SID (bases antiguas) en vez de un nombre de servicio
  kind: str = "oracle"
  id: str = field(default_factory=lambda: uuid.uuid4().hex[:10])

  @property
  def secret_key(self):
    return f"db:{self.id}"

  @property
  def dsn(self):
    if self.use_sid:
      return (f"(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST={self.host})(PORT={self.port}))"
              f"(CONNECT_DATA=(SID={self.service})))")
    return f"{self.host}:{self.port}/{self.service}"

  @property
  def summary(self):
    return f"{self.user}@{self.host}:{self.port}/{self.service}" + (" (SID)" if self.use_sid else "")


def load():
  profiles = []
  for item in settings.get(KEY) or []:
    try:
      profiles.append(Profile(**item))
    except TypeError:
      continue        # entrada de una versión anterior o dañada
  return profiles


def _store(profiles):
  settings.set(KEY, [asdict(p) for p in profiles])


def save(profile, password=None):
  """Guarda (o actualiza) el perfil. Con `password` y `save_password` la deja en el llavero.

  Devuelve un aviso si no se pudo guardar la contraseña (el perfil sí queda guardado).
  """
  warning = ""
  if profile.save_password and password:
    try:
      secrets.save(profile.secret_key, password)
    except secrets.SecretsError as e:
      profile.save_password = False
      warning = str(e)
  elif not profile.save_password:
    secrets.delete(profile.secret_key)
  profiles = [p for p in load() if p.id != profile.id] + [profile]
  _store(sorted(profiles, key=lambda p: p.name.lower()))
  return warning


def delete(profile):
  secrets.delete(profile.secret_key)
  _store([p for p in load() if p.id != profile.id])


def password(profile):
  """Contraseña guardada en el llavero, o None."""
  return secrets.get(profile.secret_key) if profile.save_password else None
