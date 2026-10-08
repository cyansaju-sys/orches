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
