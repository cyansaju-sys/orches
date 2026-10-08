"""Saca las capturas de docs/img/ con la propia app.

    uv run python tools/capture_docs.py

Abre la ventana unos segundos y recorre las pantallas. Usa una configuración aislada (carpeta temporal) y este
mismo repositorio como proyecto de ejemplo, así que no toca ni muestra tus ajustes, tus proyectos ni tu historial.
Las extensiones de dist/extensions/ se instalan solo en esa carpeta temporal.
"""
import asyncio
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "img"
os.environ["XDG_CONFIG_HOME"] = tempfile.mkdtemp(prefix="orches-docs-")   # antes de importar orches: fija dónde se guardan los ajustes
os.environ["APPDATA"] = os.environ["XDG_CONFIG_HOME"]
sys.path.insert(0, str(ROOT / "src"))

import flet as ft                                   # noqa: E402
import main as app                                  # noqa: E402
from orches.core import extensions, settings        # noqa: E402
from orches.ui.file_icons import icon_for           # noqa: E402
from orches.ui.views.file_viewer import FileViewer  # noqa: E402

PIXEL_RATIO = 1.5


def prepare():
  extensions.fetch_catalog = lambda: []        # sin red: no se consulta GitHub (ni sale el globo de actualizaciones)
  settings.set("project", str(ROOT))
  for archive in sorted((ROOT / "dist" / "extensions").glob("*.zip")):
    extensions.install_zip(archive)


TAKEN = {}      # nombre -> PNG; se escriben al final para que los archivos nuevos no salgan como «cambios» en la captura de Git


async def snap(name, wait=1.2):
  await asyncio.sleep(wait)
  TAKEN[name] = await app.APP["shot"].capture(pixel_ratio=PIXEL_RATIO)
  print("capturada", name)


def open_file(relative):
  path = ROOT / relative
  page = app.APP["page"]
  app.APP["workspace"].open_document(path.name, icon_for(path), lambda: FileViewer(page, path), key=f"file:{path}", path=path)


async def scenes(page):
  sidebar, workspace = app.APP["sidebar"], app.APP["workspace"]
  await asyncio.sleep(2)
  open_file("src/orches/core/completion.py")
  sidebar.select_tab("files")
  await snap("01-archivos-y-editor", 2)

  open_file("docs/demo/Contador.tsx")
  await snap("02-sintaxis-tsx", 1.5)

  open_file("docs/demo/ejemplo.sql")
  await snap("03-sql-con-boton-play", 1.5)

  sidebar.select_tab("git")
  await snap("04-git", 2)

  sidebar.select_tab("agents")
  await snap("05-agentes", 1)

  sidebar.select_tab("extensions")
  await asyncio.sleep(0.5)
  await snap("06-extensiones", 1)

  for item in extensions.REGISTRY.titlebar:           # el botón «Graph» de la extensión Git Graph
    item.on_click()
  await snap("07-git-graph", 3)

  OUT.mkdir(parents=True, exist_ok=True)
  for name, data in TAKEN.items():
    (OUT / f"{name}.png").write_bytes(data)
  await page.window.close()


def demo(page: ft.Page):
  prepare()
  page.window.width, page.window.height = 1360, 860
  app.main(page)
  page.run_task(scenes, page)


if __name__ == "__main__":
  ft.run(demo, assets_dir=str(ROOT / "src" / "assets"))
