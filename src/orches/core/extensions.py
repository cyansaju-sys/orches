"""Sistema de extensiones: paquetes .zip que añaden pestañas a la barra lateral y modifican el editor.

Una extensión es un .zip con, en su raíz:

  extension.json   {"id": "mi_ext", "name": "Mi extensión", "version": "1.0.0", "description": "...",
                    "icon": "icon.svg", "main": "main.py", "shortcut": "M"}
  main.py          define `activate(api)` (se llama una vez al arrancar la app)
  icon.svg / .png  ícono de su pestaña en la barra lateral

Al instalarse se descomprime en <config>/extensions/<id>/. Las extensiones empaquetadas con la app
(src/assets/extensions/*.zip) se instalan solas la primera vez o cuando traen una versión distinta.
El código de una extensión se ejecuta con los mismos permisos que la app: instala solo las que conozcas.

API que recibe `activate(api)`:

  api.page, api.id, api.dir                    ventana, id y carpeta de la extensión
  api.add_sidebar_view(build, title=None)      pestaña en la barra lateral; build(page) -> control
  api.add_editor_toolbar(suffixes, build)      franja sobre los archivos con esas extensiones;
                                               build(page, doc) -> control, con doc.path y doc.get_text()
  api.open_document(title, icon, make, key=None, crumbs=None, path=None)   abre una pestaña del editor
  api.add_language(name, suffixes, keywords="", types="", line_comments=(), block=(), quotes="'\"",
                   rules=(), colors=None, title=None)       resaltado de sintaxis para esos tipos de archivo
                                               (rules: [(tipo, regex)]; colors: {tipo: "#RRGGBB"} de los tipos nuevos)
"""
import importlib.util
import json
import shutil
import sys
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

from orches.core import settings

BUNDLED = Path(__file__).resolve().parents[2] / "assets" / "extensions"
MANIFEST = "extension.json"
MAX_UNPACKED = 50_000_000     # un .zip que descomprima más que esto se rechaza


class ExtensionError(Exception):
  """Error legible al instalar o cargar una extensión."""


def root():
  return settings.FILE.parent / "extensions"


@dataclass
class Extension:
  id: str
  name: str
  version: str
  description: str
  dir: Path
  icon: Path | None
  shortcut: str
  main: str


@dataclass
class SidebarView:
  extension: Extension
  title: str
  build: object


@dataclass
class Toolbar:
  extension: Extension
  suffixes: tuple
  build: object


@dataclass
class Registry:
  extensions: list = field(default_factory=list)
  sidebar_views: list = field(default_factory=list)
  toolbars: list = field(default_factory=list)
  errors: list = field(default_factory=list)      # [(id, mensaje)] de las que no pudieron cargarse

  def toolbars_for(self, path):
    suffix = Path(path).suffix.lower()
    return [t for t in self.toolbars if suffix in t.suffixes]


REGISTRY = Registry()


def read_manifest(folder):
  try:
    data = json.loads((Path(folder) / MANIFEST).read_text(encoding="utf-8"))
  except (OSError, ValueError) as e:
    raise ExtensionError(f"{MANIFEST} ilegible: {e}")
  ext_id = str(data.get("id", "")).strip()
  if not ext_id.isidentifier():
    raise ExtensionError("El id de la extensión debe ser un nombre válido (letras, números y _)")
  icon = data.get("icon")
  return Extension(
    id=ext_id, name=data.get("name") or ext_id, version=str(data.get("version", "0")),
    description=data.get("description", ""), dir=Path(folder),
    icon=(Path(folder) / icon) if icon and (Path(folder) / icon).is_file() else None,
    shortcut=str(data.get("shortcut", "")).upper()[:1], main=data.get("main", "main.py"))


def install_zip(zip_path):
  """Descomprime un .zip en la carpeta de extensiones y devuelve la `Extension` instalada."""
  try:
    archive = zipfile.ZipFile(zip_path)
  except (OSError, zipfile.BadZipFile) as e:
    raise ExtensionError(f"No es un .zip válido: {e}")
  with archive:
    names = archive.namelist()
    for name in names:
      parts = Path(name).parts
      if Path(name).is_absolute() or ".." in parts:
        raise ExtensionError(f"El .zip trae una ruta peligrosa: {name}")
    if sum(i.file_size for i in archive.infolist()) > MAX_UNPACKED:
      raise ExtensionError("El .zip es demasiado grande")
    if MANIFEST not in names:
      raise ExtensionError(f"Falta {MANIFEST} en la raíz del .zip")
    ext_id = json.loads(archive.read(MANIFEST).decode("utf-8")).get("id", "")
    if not str(ext_id).isidentifier():
      raise ExtensionError("El id de la extensión no es válido")
    target = root() / ext_id
    staging = root() / f".{ext_id}.new"
    shutil.rmtree(staging, ignore_errors=True)
    archive.extractall(staging)
  shutil.rmtree(target, ignore_errors=True)
  staging.rename(target)
  return read_manifest(target)


def uninstall(ext_id):
  """Borra una extensión; si venía con la app no se vuelve a instalar sola."""
  shutil.rmtree(root() / ext_id, ignore_errors=True)
  removed = set(settings.get("extensions_removed", []))
  removed.add(ext_id)
  settings.set("extensions_removed", sorted(removed))


def install_bundled():
  """Instala (o actualiza) las extensiones que vienen con la app, salvo las que el usuario quitó."""
  removed = set(settings.get("extensions_removed", []))
  for zip_path in sorted(BUNDLED.glob("*.zip")) if BUNDLED.is_dir() else []:
    try:
      with zipfile.ZipFile(zip_path) as archive:
        manifest = json.loads(archive.read(MANIFEST).decode("utf-8"))
      ext_id = manifest.get("id", "")
      if ext_id in removed:
        continue
      try:
        current = read_manifest(root() / ext_id).version
      except ExtensionError:
        current = None
      if current != str(manifest.get("version", "0")):
        install_zip(zip_path)
    except (OSError, ValueError, zipfile.BadZipFile, ExtensionError) as e:
      REGISTRY.errors.append((zip_path.stem, str(e)))


class Api:
  """Lo que una extensión puede usar desde `activate(api)`."""

  def __init__(self, extension, page, host):
    self.extension = extension
    self.id = extension.id
    self.dir = extension.dir
    self.page = page
    self._host = host

  def add_sidebar_view(self, build, title=None):
    REGISTRY.sidebar_views.append(SidebarView(self.extension, title or self.extension.name, build))

  def add_editor_toolbar(self, suffixes, build):
    suffixes = tuple(s.lower() if s.startswith(".") else f".{s.lower()}" for s in suffixes)
    REGISTRY.toolbars.append(Toolbar(self.extension, suffixes, build))

  def add_language(self, name, suffixes, keywords="", types="", line_comments=(), block=(), quotes="'\"",
                   ignore_case=False, rules=(), colors=None, title=None):
    from orches.ui import syntax      # se importa aquí: el núcleo no depende de la interfaz hasta que una extensión la usa
    lang = syntax.Lang(frozenset(keywords.split()), frozenset(types.split()), tuple(line_comments), tuple(block),
                       quotes, ignore_case, tuple(rules))
    syntax.register_language(name, lang, suffixes, colors, title)

  def open_document(self, title, icon, make, key=None, crumbs=None, path=None):
    if self._host.get("open_document"):
      self._host["open_document"](title, icon, make, key=key, crumbs=crumbs, path=path)


def _import(extension):
  entry = extension.dir / extension.main
  name = f"orches_ext_{extension.id}"
  spec = importlib.util.spec_from_file_location(name, entry, submodule_search_locations=[str(extension.dir)])
  if spec is None or spec.loader is None:
    raise ExtensionError(f"No se pudo cargar {extension.main}")
  module = importlib.util.module_from_spec(spec)
  sys.modules[name] = module        # así sus importaciones relativas (from . import x) funcionan
  try:
    spec.loader.exec_module(module)
  except BaseException:
    sys.modules.pop(name, None)
    raise
  return module


def load_all(page, host):
  """Instala las empaquetadas, carga todas las extensiones y llama a su `activate`. Un fallo no tumba la app."""
  REGISTRY.extensions.clear()
  REGISTRY.sidebar_views.clear()
  REGISTRY.toolbars.clear()
  REGISTRY.errors.clear()
  install_bundled()
  folders = sorted(p for p in root().iterdir() if p.is_dir() and not p.name.startswith(".")) if root().is_dir() else []
  for folder in folders:
    try:
      extension = read_manifest(folder)
      module = _import(extension)
      activate = getattr(module, "activate", None)
      if activate is None:
        raise ExtensionError("main.py no define activate(api)")
      REGISTRY.extensions.append(extension)
      activate(Api(extension, page, host))
    except Exception as e:        # el código de una extensión puede fallar de cualquier forma
      REGISTRY.errors.append((folder.name, f"{type(e).__name__}: {e}"))
      REGISTRY.extensions = [x for x in REGISTRY.extensions if x.dir != folder]
  return REGISTRY
