"""Empaqueta cada carpeta de extensions/ en src/assets/extensions/<id>.zip (la app las instala al arrancar)."""
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "src" / "assets" / "extensions"


def build():
  OUT.mkdir(parents=True, exist_ok=True)
  for folder in sorted((ROOT / "extensions").iterdir()):
    if not (folder / "extension.json").is_file():
      continue
    target = OUT / f"{folder.name}.zip"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
      for file in sorted(folder.rglob("*")):
        if file.is_file() and "__pycache__" not in file.parts and file.suffix != ".pyc":
          archive.write(file, file.relative_to(folder).as_posix())
    print(f"{target.relative_to(ROOT)}")


if __name__ == "__main__":
  build()
