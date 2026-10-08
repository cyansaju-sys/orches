"""Pruebas de la lógica sin interfaz: modelos, git, consumo, orquestación y emulación de terminal."""
import json
import subprocess
import urllib.request
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from orches.core import git, usage
from orches.core.files import list_dir
from orches.core.models import tier
from orches.core.orchestra import Orchestra
from orches.ui.file_icons import icon_for
from orches.ui.terminal.view import ScrollScreen, TermStream, UNSUPPORTED, key_to_text, theme_bg


# --- modelos ----------------------------------------------------------------------------------
@pytest.mark.parametrize("model,expected", [
  ("claude-haiku-4-5", ("basic", True)),
  ("claude-sonnet-5-5", ("standard", True)),
  ("claude-opus-5-5", ("advanced", True)),
  ("gpt-5-mini", ("basic", True)),
  ("big-pickle", ("standard", False)),
  (None, ("standard", False)),
])
def test_tier(model, expected):
  assert tier(model) == expected


# --- formato de consumo -----------------------------------------------------------------------
def test_formato_de_tokens_y_tiempo():
  assert usage.fmt_tokens(950) == "950"
  assert usage.fmt_tokens(12_300) == "12.3 k"
  assert usage.fmt_tokens(2_500_000) == "2.5 M"
  assert usage.fmt_delta(timedelta(minutes=75)) == "1 h 15 min"
  assert usage.fmt_delta(timedelta(days=2, hours=3)) == "2 d"


# --- archivos e íconos --------------------------------------------------------------------------
def test_list_dir_ordena_carpetas_primero_y_oculta(tmp_path):
  (tmp_path / "b.txt").write_text("")
  (tmp_path / "a_dir").mkdir()
  (tmp_path / ".oculto").write_text("")
  (tmp_path / ".git").mkdir()
  assert [p.name for p in list_dir(tmp_path)] == ["a_dir", "b.txt"]
  assert [p.name for p in list_dir(tmp_path, show_hidden=True, ignore={".git"})] == ["a_dir", ".oculto", "b.txt"]


def test_icono_por_extension_y_carpeta(tmp_path):
  assert icon_for(tmp_path / "x.py").endswith("python.svg")
  assert icon_for(tmp_path / "src", is_dir=True).endswith("folder-src.svg")


# --- git (en repositorios temporales, nunca en el del proyecto) ------------------------------------
def run(cwd, *args):
  subprocess.run(["git", "-C", str(cwd), *args], check=True, capture_output=True)


@pytest.fixture
def repo(tmp_path):
  root = tmp_path / "repo"
  root.mkdir()
  run(root, "init", "-q")
  run(root, "config", "user.email", "t@t")
  run(root, "config", "user.name", "t")
  (root / "a.txt").write_text("a")
  run(root, "add", ".")
  run(root, "commit", "-qm", "init")
  return root


def test_stage_unstage_y_commit(repo):
  (repo / "a.txt").write_text("cambio")
  (repo / "nuevo.txt").write_text("n")
  estado = {e.path: (e.staged, e.unstaged) for e in git.status_entries(repo)}
  assert estado == {"a.txt": ("", "M"), "nuevo.txt": ("", "U")}

  assert git.stage(repo, ["a.txt", "nuevo.txt"])[0]
  estado = {e.path: (e.staged, e.unstaged) for e in git.status_entries(repo)}
  assert estado == {"a.txt": ("M", ""), "nuevo.txt": ("A", "")}

  assert git.unstage(repo, ["nuevo.txt"])[0]
  assert git.commit(repo, "mensaje")[0]
  assert [(e.path, e.unstaged) for e in git.status_entries(repo)] == [("nuevo.txt", "U")]
  assert not git.commit(repo, "nada preparado")[0]


def test_push_publica_la_rama_y_cuenta_commits(repo, tmp_path):
  remote = tmp_path / "remote.git"
  subprocess.run(["git", "init", "-q", "--bare", str(remote)], check=True)
  assert git.push(repo) == (False, "Este repositorio no tiene remoto: agrega uno con git remote add")
  run(repo, "remote", "add", "origin", str(remote))
  assert git.sync_info(repo)[2:] == (False, True)        # sin upstream, con remoto
  assert git.push(repo)[0]                                # publica la rama
  (repo / "b.txt").write_text("b")
  run(repo, "add", ".")
  run(repo, "commit", "-qm", "dos")
  assert git.sync_info(repo)[1] == 1                      # un commit por subir
  assert git.push(repo)[0] and git.sync_info(repo)[1] == 0


def test_mapa_de_estado_incluye_carpetas(repo):
  (repo / "sub").mkdir()
  (repo / "sub" / "c.txt").write_text("c")
  assert git.status_map(repo) == {"sub/c.txt": "U", "sub": "U"}


# --- emulación de terminal ---------------------------------------------------------------------------
def tecla(key, shift=False, ctrl=False, alt=False):
  return SimpleNamespace(key=key, shift=shift, ctrl=ctrl, alt=alt)


@pytest.mark.parametrize("e,expected", [
  (tecla("A"), "a"),
  (tecla("A", shift=True), "A"),
  (tecla("C", ctrl=True), "\x03"),
  (tecla("B", alt=True), "\x1bb"),                # Alt+letra = Meta
  (tecla("@", alt=True), "@"),                    # AltGr: símbolo tal cual
  (tecla("@", ctrl=True, alt=True), "@"),         # AltGr en Windows (Ctrl+Alt)
  (tecla("Enter"), "\r"),
  (tecla("Arrow Up"), "\x1b[A"),
  (tecla("Tab", shift=True), "\x1b[Z"),
])
def test_teclas(e, expected):
  assert key_to_text(e) == expected


def test_secuencias_no_soportadas_se_filtran():
  assert UNSUPPORTED.sub(b"", b"a\x1b[<ub\x1b[>4;2mc\x1b[?1049hd") == b"abc\x1b[?1049hd"


def test_fondos_neutros_se_adaptan_al_tema():
  assert theme_bg("#0a0a0a") is None
  assert theme_bg("#1e1e1e") != "#1e1e1e"
  assert theme_bg("#5c9cf5") == "#5c9cf5"


def test_scroll_su_sd_y_historial():
  screen = ScrollScreen(10, 5)
  stream = TermStream(screen)
  for i, texto in enumerate(["AAAA", "BBBB", "CCCC", "DDDD", "EEEE"], start=1):
    stream.feed(f"\x1b[{i};1H{texto}".encode())
  fila = lambda y: "".join(screen.buffer[y][x].data for x in range(4))
  stream.feed(b"\x1b[2S")                         # SU: sube 2 líneas
  assert [fila(y) for y in range(5)] == ["CCCC", "DDDD", "EEEE", "    ", "    "]
  stream.feed(b"\x1b[1T")                         # SD: baja 1
  assert fila(0) == "    " and fila(1) == "CCCC"
  stream.feed(b"\x1b[5;1H\n\n")                   # dos saltos al final: pasan al historial
  assert len(screen.scrollback) == 2


# --- orquestación (servidor MCP) -------------------------------------------------------------------------
@pytest.fixture
def servidor():
  llamadas = []
  host = SimpleNamespace(
    list_agents=lambda caller: {"you_are": caller, "open_agents": [], "installed_agents": []},
    delegate=lambda c, t, task, n: (llamadas.append((c, t, task, n)) or (True, {"agent_id": "a2"})),
    output=lambda i, l: {"agent_id": i, "busy": False, "idle_seconds": 9.0, "text": "hola"} if i == "a2" else None,
  )
  orquesta = Orchestra(host).start()
  yield orquesta, llamadas
  orquesta.stop()


def rpc(orquesta, metodo, params=None, token=None):
  req = urllib.request.Request(
    f"http://127.0.0.1:{orquesta.port}/mcp/a1",
    data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": metodo, "params": params or {}}).encode(),
    headers={"Content-Type": "application/json", "Authorization": f"Bearer {token or orquesta.token}"},
  )
  with urllib.request.urlopen(req, timeout=5) as r:
    return json.loads(r.read())


def test_servidor_exige_token(servidor):
  orquesta, _ = servidor
  with pytest.raises(urllib.error.HTTPError) as e:
    rpc(orquesta, "ping", token="malo")
  assert e.value.code == 401


def test_servidor_lista_herramientas_y_delega(servidor):
  orquesta, llamadas = servidor
  nombres = [t["name"] for t in rpc(orquesta, "tools/list")["result"]["tools"]]
  assert nombres == ["list_agents", "delegate_task", "wait_agent", "read_agent_output"]

  res = rpc(orquesta, "tools/call", {"name": "delegate_task", "arguments": {"agent": "opencode", "task": "haz x"}})
  assert not res["result"]["isError"]
  assert llamadas == [("a1", "opencode", "haz x", False)]

  esperado = rpc(orquesta, "tools/call", {"name": "wait_agent", "arguments": {"agent_id": "a2", "quiet_seconds": 2}})
  assert json.loads(esperado["result"]["content"][0]["text"])["finished"] is True

  falta = rpc(orquesta, "tools/call", {"name": "read_agent_output", "arguments": {"agent_id": "zz"}})
  assert falta["result"]["isError"]


# --- ramas ------------------------------------------------------------------------------------------------
def test_ramas_cambiar_y_crear(repo, tmp_path):
  remote = tmp_path / "remote.git"
  subprocess.run(["git", "init", "-q", "--bare", str(remote)], check=True)
  run(repo, "remote", "add", "origin", str(remote))
  rama = git.branch(repo)
  assert git.push(repo)[0]
  run(repo, "fetch", "-q")

  lista = git.branches(repo)
  assert [(b.name, b.remote, b.current) for b in lista] == [(rama, False, True), (f"origin/{rama}", True, False)]
  assert lista[0].has_upstream and lista[0].ahead == 0

  assert git.create_branch(repo, "dev")[0] and git.branch(repo) == "dev"
  assert not git.create_branch(repo, "dev")[0]                 # ya existe
  assert git.checkout(repo, rama)[0] and git.branch(repo) == rama
  assert git.create_branch(repo, "otra", rama)[0]              # a partir de otra rama
  run(repo, "push", "-q", "origin", "otra:solo_remota")
  run(repo, "fetch", "-q")
  assert git.checkout(repo, "origin/solo_remota", remote=True)[0]
  assert git.branch(repo) == "solo_remota"                      # la remota pasa a ser local y la sigue


# --- servidores MCP (con un HOME temporal: nunca tocan tu configuración) ---------------------------------
import shutil

from orches.core import mcp


@pytest.fixture
def entorno_mcp(tmp_path, monkeypatch):
  casa = tmp_path / "home"
  proyecto = tmp_path / "proyecto"
  casa.mkdir()
  proyecto.mkdir()
  monkeypatch.setenv("HOME", str(casa))
  monkeypatch.setenv("XDG_CONFIG_HOME", str(casa / ".config"))
  return proyecto


REMOTO = {"name": "remoto", "kind": "remote", "url": "https://example.com/mcp", "headers": {"Authorization": "Bearer x"}}
LOCAL = {"name": "local-x", "kind": "local", "command": "npx", "args": ["-y", "@scope/server"], "env": {"API_KEY": "k"}}


def test_mcp_valida_antes_de_ejecutar(entorno_mcp):
  assert "nombre" in mcp.add_server("claude", {**REMOTO, "name": "mal nombre"}, mcp.GLOBAL, entorno_mcp)[1]
  assert "URL" in mcp.add_server("claude", {**REMOTO, "url": "ftp://x"}, mcp.GLOBAL, entorno_mcp)[1]
  assert "comando" in mcp.add_server("claude", {**LOCAL, "command": ""}, mcp.GLOBAL, entorno_mcp)[1]


@pytest.mark.parametrize("agente", ["claude", "opencode"])
@pytest.mark.skipif(not (shutil.which("claude") and shutil.which("opencode")), reason="faltan los CLI de los agentes")
def test_mcp_anadir_listar_y_quitar(agente, entorno_mcp):
  for alcance in (mcp.PROJECT, mcp.GLOBAL):
    assert mcp.add_server(agente, {**REMOTO, "name": f"r-{alcance}"}, alcance, entorno_mcp)[0]
    assert mcp.add_server(agente, {**LOCAL, "name": f"l-{alcance}"}, alcance, entorno_mcp)[0]
  servidores = {(s.name, s.scope, s.kind) for s in mcp.list_servers(entorno_mcp) if s.agent == agente}
  assert servidores == {("r-project", "project", "remote"), ("l-project", "project", "local"),
                        ("r-global", "global", "remote"), ("l-global", "global", "local")}
  for s in mcp.list_servers(entorno_mcp):
    assert mcp.remove_server(s, entorno_mcp)[0]
  assert mcp.list_servers(entorno_mcp) == []


@pytest.mark.skipif(not (shutil.which("claude") and shutil.which("opencode")), reason="faltan los CLI de los agentes")
def test_mcp_copiar_servidor_a_otro_agente(entorno_mcp):
  assert mcp.add_server("claude", LOCAL, mcp.PROJECT, entorno_mcp)[0]
  servidores = mcp.list_servers(entorno_mcp)
  origen = next(s for s in servidores if s.agent == "claude")
  assert mcp.agents_missing(origen, servidores) == ["opencode"]

  assert mcp.add_server("opencode", mcp.spec_from_server(origen), origen.scope, entorno_mcp)[0]
  servidores = mcp.list_servers(entorno_mcp)
  copia = next(s for s in servidores if s.agent == "opencode")
  assert (copia.name, copia.kind, copia.target) == (origen.name, origen.kind, origen.target)
  assert mcp.agents_missing(origen, servidores) == []


# --- visor de archivos -------------------------------------------------------------------------------------
def test_leer_archivos_texto_binario_e_imagen(tmp_path):
  from orches.ui.views.file_viewer import MAX_BYTES, read_file
  (tmp_path / "a.py").write_text("def f():\n\treturn 1\n", encoding="utf-8")
  datos = read_file(tmp_path / "a.py")
  assert (datos.kind, datos.text) == ("text", "def f():\n\treturn 1\n")        # el texto conserva los tabuladores
  assert datos.display == "def f():\n    return 1\n" and datos.editable          # solo se muestran como 4 espacios
  (tmp_path / "b.bin").write_bytes(b"\x00\x01\x02binario")
  assert read_file(tmp_path / "b.bin").kind == "binary" and not read_file(tmp_path / "b.bin").editable
  (tmp_path / "c.png").write_bytes(b"\x89PNG")
  assert read_file(tmp_path / "c.png").kind == "image"
  (tmp_path / "grande.txt").write_text("x" * (MAX_BYTES + 10))
  grande = read_file(tmp_path / "grande.txt")
  assert grande.truncated and len(grande.text) == MAX_BYTES and grande.size == MAX_BYTES + 10 and not grande.editable
  (tmp_path / "latin.txt").write_bytes("canción".encode("latin-1"))                # no UTF-8: se ve, pero no se edita
  latin = read_file(tmp_path / "latin.txt")
  assert latin.kind == "text" and not latin.utf8 and not latin.editable


def test_guardar_archivo_conserva_fines_de_linea_y_permisos(tmp_path):
  import os
  from orches.ui.views.file_viewer import read_file, write_file
  ruta = tmp_path / "x.txt"
  ruta.write_bytes(b"uno\r\ndos\r\n")
  os.chmod(ruta, 0o750)
  datos = read_file(ruta)
  assert datos.crlf and datos.text == "uno\ndos\n"                      # internamente siempre \n
  mtime = write_file(ruta, "uno\ndos\ntres\n", datos.crlf)
  assert ruta.read_bytes() == b"uno\r\ndos\r\ntres\r\n"             # se vuelve a escribir con \r\n
  assert os.stat(ruta).st_mode & 0o777 == 0o750 and mtime == ruta.stat().st_mtime_ns
  assert [p.name for p in tmp_path.iterdir()] == ["x.txt"]               # no quedan temporales
  write_file(ruta, "ñandú ✓\n")
  assert ruta.read_text(encoding="utf-8") == "ñandú ✓\n"


def test_lenguaje_segun_el_archivo():
  from orches.ui.syntax import language_for
  assert [language_for(n) for n in ("a.py", "b.tsx", "c.sql", "d.json", "e.yaml", ".gitignore", "README", "x.rs")] == \
    ["python", "javascript", "sql", "json", "hash", "hash", "plain", "clike"]


# --- autocompletado ---------------------------------------------------------------------------------------
from orches.core import completion


def test_sugerencias_con_palabras_del_archivo_y_del_lenguaje():
  codigo = "from x import IconAction, Clickable\n\ndef boton():\n  return Cli"
  s = completion.suggestions(codigo, len(codigo), keywords=["class", "return"])
  assert s[0] == completion.Suggestion("Clickable", "word")
  assert completion.suggestions("x = 1\nret", 9, keywords=["return", "retry"])[0].kind == "keyword"


def test_sugerencias_por_iniciales_y_subsecuencia():
  base = "class Clickable: pass\nuse Clk"
  assert "Clickable" in [s.label for s in completion.suggestions(base, len(base))]
  base = "def calcular_total(): pass\nct_"
  assert completion.suggestions("def calcular_total(): pass\nclt", 29) == [completion.Suggestion("calcular_total", "word")]


def test_no_sugiere_con_una_letra_salvo_que_se_pida_ni_la_palabra_completa():
  texto = "alfa beta alfabeto\nal"
  assert completion.suggestions(texto, len(texto)) != []
  assert completion.suggestions("alfa\na", 6) == [] and completion.suggestions("alfa\na", 6, force=True) != []
  assert completion.suggestions("alfa\nalfa", 9) == []                       # ya está escrita completa


def test_aceptar_una_sugerencia_reemplaza_la_palabra_y_conserva_el_resto():
  texto = "x = Cli(1)"
  nuevo, cursor = completion.apply(texto, 7, completion.Suggestion("Clickable", "word"))
  assert nuevo == "x = Clickable(1)" and cursor == 13
  assert completion.prefix_at("123abc", 3) == (3, "")                           # un número no es una palabra


def test_sql_sugiere_en_mayusculas_si_escribes_en_mayusculas():
  s = completion.suggestions("SEL", 3, keywords=["SELECT", "SET"], case_insensitive=True)
  assert [x.label for x in s][0] == "SELECT"
