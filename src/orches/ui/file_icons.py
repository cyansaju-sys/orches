import json
from pathlib import Path

# Íconos de "Material Icon Theme" (MIT, https://github.com/material-extensions/vscode-material-icon-theme)
ASSETS = Path(__file__).resolve().parents[2] / "assets" / "icons"   # src/assets/icons
ICON_DIR = "icons/material"  # ruta relativa a assets/, como la espera ft.Image

_theme = json.loads((ASSETS / "material.json").read_text(encoding="utf-8"))


def _src(name):
  return f"{ICON_DIR}/{name}.svg"


def icon_for(path, is_dir=False, expanded=False):
  """Ruta (relativa a assets/) del SVG que corresponde a un archivo o carpeta."""
  name = path.name.lower()
  if is_dir:
    if expanded:
      return _src(_theme["folderNamesExpanded"].get(name, _theme["folderExpanded"]))
    return _src(_theme["folderNames"].get(name, _theme["folder"]))

  if name in _theme["fileNames"]:
    return _src(_theme["fileNames"][name])
  # extensiones compuestas primero: "foo.test.ts" -> "test.ts", luego "ts"
  parts = name.split(".")
  for i in range(1, len(parts)):
    ext = ".".join(parts[i:])
    if ext in _theme["fileExtensions"]:
      return _src(_theme["fileExtensions"][ext])
  return _src(_theme["file"])
