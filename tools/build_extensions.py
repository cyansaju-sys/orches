"""Empaqueta cada carpeta de extensions/ en un .zip.

Las que tienen "bundled": true en su extension.json van a src/assets/extensions/ (la app las instala al arrancar);
las demás van a dist/extensions/ y se añaden a mano desde la pestaña Extensiones.
"""
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUNDLED = ROOT / "src" / "assets" / "extensions"
OPTIONAL = ROOT / "dist" / "extensions"


def build():
  for folder in sorted((ROOT / "extensions").iterdir()):
    if not (folder / "extension.json").is_file():
      continue
    bundled = json.loads((folder / "extension.json").read_text(encoding="utf-8")).get("bundled", False)
    out = BUNDLED if bundled else OPTIONAL
    out.mkdir(parents=True, exist_ok=True)
    target = out / f"{folder.name}.zip"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
      for file in sorted(folder.rglob("*")):
        if file.is_file() and "__pycache__" not in file.parts and file.suffix != ".pyc":
          archive.write(file, file.relative_to(folder).as_posix())
    print(f"{target.relative_to(ROOT)}")


if __name__ == "__main__":
  build()
