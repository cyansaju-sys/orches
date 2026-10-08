"""Pruebas del sistema de extensiones (.zip): instalación, carga y límites de seguridad."""
import json
import zipfile

import pytest

from orches.core import extensions, settings

MAIN = '''
def activate(api):
  api.add_sidebar_view(lambda page: "vista", title="Mi vista")
  api.add_editor_toolbar(["txt"], lambda page, doc: "barra")
'''


@pytest.fixture(autouse=True)
def config(tmp_path, monkeypatch):
  monkeypatch.setattr(settings, "FILE", tmp_path / "settings.json")
  monkeypatch.setattr(extensions, "BUNDLED", tmp_path / "bundled")
  yield tmp_path


def make_zip(path, manifest=None, main=MAIN, extra=()):
  manifest = manifest or {"id": "demo", "name": "Demo", "version": "1.0", "shortcut": "m"}
  with zipfile.ZipFile(path, "w") as z:
    z.writestr("extension.json", json.dumps(manifest))
    z.writestr("main.py", main)
    for name, data in extra:
      z.writestr(name, data)
  return path


def test_install_and_load(config):
  ext = extensions.install_zip(make_zip(config / "demo.zip"))
  assert ext.id == "demo" and ext.shortcut == "M"
  registry = extensions.load_all(page=None, host={})
  assert [e.id for e in registry.extensions] == ["demo"] and not registry.errors
  assert registry.sidebar_views[0].title == "Mi vista"
  assert registry.toolbars_for("a/b.TXT")[0].build(None, None) == "barra"
  assert registry.toolbars_for("a.py") == []


def test_rejects_path_traversal(config):
  bad = make_zip(config / "bad.zip", extra=[("../evil.py", "x")])
  with pytest.raises(extensions.ExtensionError):
    extensions.install_zip(bad)
  assert not (config / "evil.py").exists()


def test_rejects_missing_manifest_and_bad_id(config):
  with zipfile.ZipFile(config / "no.zip", "w") as z:
    z.writestr("main.py", MAIN)
  with pytest.raises(extensions.ExtensionError):
    extensions.install_zip(config / "no.zip")
  with pytest.raises(extensions.ExtensionError):
    extensions.install_zip(make_zip(config / "id.zip", manifest={"id": "../x"}))


def test_broken_extension_does_not_stop_others(config):
  extensions.install_zip(make_zip(config / "ok.zip"))
  extensions.install_zip(make_zip(config / "bad.zip", manifest={"id": "broken"}, main="raise RuntimeError('boom')"))
  registry = extensions.load_all(page=None, host={})
  assert [e.id for e in registry.extensions] == ["demo"]
  assert registry.errors and "boom" in registry.errors[0][1]


def test_bundled_installs_once_and_respects_uninstall(config):
  (config / "bundled").mkdir()
  make_zip(config / "bundled" / "demo.zip")
  assert [e.id for e in extensions.load_all(None, {}).extensions] == ["demo"]
  extensions.uninstall("demo")
  assert extensions.load_all(None, {}).extensions == []


def test_oracle_extension_bundle_loads(config):
  from pathlib import Path
  bundle = Path(__file__).resolve().parents[1] / "src" / "assets" / "extensions" / "oracle_db.zip"
  extensions.install_zip(bundle)
  ext = extensions.read_manifest(extensions.root() / "oracle_db")
  assert ext.icon and ext.icon.is_file() and ext.shortcut == "D"


def test_js_syntax_extension_highlights(config):
  from pathlib import Path
  from orches.ui.syntax import highlight, language_for
  src = Path(__file__).resolve().parents[1] / "extensions" / "js_syntax"
  zip_path = config / "js.zip"
  with zipfile.ZipFile(zip_path, "w") as z:
    for f in src.iterdir():
      z.write(f, f.name)
  extensions.install_zip(zip_path)
  assert not extensions.load_all(None, {}).errors
  assert language_for("App.tsx") == "ext_tsx" and language_for("a.ts") == "ext_ts"
  kinds = {t: k for t, k in highlight("const App = () => <Foo/>; go(i<n)", "ext_tsx")[0]}
  assert kinds["<Foo/>"] == "tag" and kinds["go"] == "function" and kinds["App"] == "type"
  assert "<n" not in kinds or kinds.get("<n") != "tag"


def test_catalog_lists_only_https_zips_and_installs(config, monkeypatch):
  listing = json.dumps([
    {"name": "a.zip", "type": "file", "download_url": "https://x/a.zip", "size": 10},
    {"name": "b.zip", "type": "file", "download_url": "http://x/b.zip"},
    {"name": "c.txt", "type": "file", "download_url": "https://x/c.txt"},
    {"name": "d", "type": "dir"}]).encode()
  zip_path = make_zip(config / "a.zip")
  monkeypatch.setattr(extensions, "_get", lambda url, limit: listing if "api.github" in url else zip_path.read_bytes())
  items = extensions.fetch_catalog()
  assert [i["id"] for i in items] == ["a"]
  assert extensions.install_from_catalog(items[0]).id == "demo"


def test_node_import_suggestions(tmp_path):
  import sys
  from pathlib import Path
  sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "extensions"))
  from js_syntax.node_imports import provide
  (tmp_path / "package.json").write_text('{"dependencies": {"node-forge": "1"}, "devDependencies": {"vitest": "1"}}')
  file = tmp_path / "src" / "a.js"
  file.parent.mkdir()
  text = "import forge from 'node-"
  labels = [s.label for s in provide(text, len(text), file)]
  assert labels == ["node-forge"]                    # no mezcla 'node:' ni 'node-' de los módulos de Node
  text = "const fs = require('f"
  found = provide(text, len(text), file)
  assert [s.label for s in found][:2] == ["fs", "fs/promises"] and found[0].start == len(text) - 1
  assert provide("import x from './a", 18, file) == []           # rutas relativas: nada
  assert provide("const a = 'fs'", 13, file) == []               # una cadena cualquiera: nada
  text = "import { readFile } from 'node:fs/p"
  assert [s.label for s in provide(text, len(text), file)] == ["node:fs/promises"]
  assert any(s.label == "vitest" for s in provide("import '", 8, file))


def test_outdated_compares_catalog_hash(config, monkeypatch):
  zip_path = make_zip(config / "demo.zip")
  catalog = [{"name": "demo.zip", "id": "demo", "url": "https://x/demo.zip", "size": 1, "sha": "aaa"}]
  monkeypatch.setattr(extensions, "_get", lambda url, limit: zip_path.read_bytes())
  assert extensions.outdated(catalog) == []                       # no está instalada
  extensions.install_from_catalog(catalog[0])
  assert extensions.outdated(catalog) == []                       # misma versión que el repositorio
  assert extensions.outdated([{**catalog[0], "sha": "bbb"}]) == ["demo"]   # el repositorio cambió
  extensions.uninstall("demo")
  assert extensions.outdated(catalog) == []
