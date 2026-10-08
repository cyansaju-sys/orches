"""Pruebas del explorador de Oracle con una conexión simulada (no hace falta tener una base)."""
import pytest

from orches.core import secrets, settings
from orches.core.db import profiles
from orches.core.db.oracle import DbError, OracleSession, column_type


class Cursor:
  def __init__(self, conn):
    self.conn = conn
    self.rows = []

  def __enter__(self):
    return self

  def __exit__(self, *a):
    return False

  def execute(self, sql, params=None):
    self.conn.log.append((sql, params))
    for needle, rows in self.conn.answers:
      if needle in sql:
        if isinstance(rows, Exception):
          raise rows
        self.rows = rows
        return
    self.rows = []

  def fetchall(self):
    return self.rows


class FakeConn:
  def __init__(self, answers):
    self.answers, self.log, self.closed = answers, [], False

  def cursor(self):
    return Cursor(self)

  def close(self):
    self.closed = True


def sesion(*answers):
  return OracleSession(FakeConn(list(answers)))


def test_tipos_de_columna():
  assert column_type("VARCHAR2", 120, None, None, 30) == "VARCHAR2(30)"
  assert column_type("NUMBER", 22, 10, 2) == "NUMBER(10,2)"
  assert column_type("NUMBER", 22, 10, 0) == "NUMBER(10)"
  assert column_type("NUMBER", 22, None, None) == "NUMBER"
  assert column_type("DATE", 7, None, None) == "DATE"


def test_objetos_unen_cuerpo_y_especificacion_y_marcan_invalidos():
  s = sesion(("FROM all_objects", [
    ("PKG_INV", "PACKAGE", "VALID", "2026-01-01 10:00"),
    ("PKG_INV", "PACKAGE BODY", "INVALID", "2026-01-02 10:00"),
    ("SP_ALTA", "PROCEDURE", "VALID", ""),
    ("T_ART", "TABLE", "VALID", None),
  ]))
  objetos = {(o.type, o.name): o for o in s.objects("INV")}
  assert set(objetos) == {("PACKAGE", "PKG_INV"), ("PROCEDURE", "SP_ALTA"), ("TABLE", "T_ART")}
  assert not objetos[("PACKAGE", "PKG_INV")].valid          # el cuerpo falla -> el paquete falla
  assert s.conn.log[0][1]["owner"] == "INV"                   # el esquema va como parámetro, no pegado al SQL


def test_codigo_de_paquete_arma_especificacion_y_cuerpo():
  s = sesion(("FROM all_source", [
    ("PACKAGE", "PACKAGE pkg_inv IS\n"), ("PACKAGE", "  PROCEDURE x;\n"), ("PACKAGE", "END pkg_inv;\n"),
    ("PACKAGE BODY", "PACKAGE BODY pkg_inv IS\n"), ("PACKAGE BODY", "  PROCEDURE x IS BEGIN NULL; END;\n"),
    ("PACKAGE BODY", "END pkg_inv;\n"),
  ]))
  codigo = s.source("INV", "PKG_INV", "PACKAGE")
  assert codigo.startswith("CREATE OR REPLACE PACKAGE pkg_inv IS")
  assert "CREATE OR REPLACE PACKAGE BODY pkg_inv IS" in codigo
  assert codigo.count("\n/\n") == 2


def test_vista_y_sinonimo_y_secuencia():
  assert sesion(("FROM all_views", [("SELECT 1 FROM dual\n",)])).source("U", "V1", "VIEW") == \
    "CREATE OR REPLACE VIEW U.V1 AS\nSELECT 1 FROM dual"
  assert sesion(("FROM all_synonyms", [("OTRO", "T", None)])).source("U", "S", "SYNONYM") == \
    "CREATE OR REPLACE SYNONYM U.S FOR OTRO.T;"
  assert "INCREMENT BY 1" in sesion(("FROM all_sequences", [(1, 999, 1, "N", 20, 57)])).source("U", "SEQ", "SEQUENCE")


def test_ddl_de_tabla_usa_metadata_y_si_falla_arma_el_ddl():
  class Lob:
    def read(self):
      return "  CREATE TABLE U.T (A NUMBER)  "
  assert sesion(("DBMS_METADATA", [(Lob(),)])).table_ddl("U", "T") == "CREATE TABLE U.T (A NUMBER)"
  # sin permiso sobre DBMS_METADATA: se construye con las columnas
  fallback = sesion(("DBMS_METADATA", Exception("ORA-31603: sin privilegios")),
                    ("FROM all_tab_columns", [("ID", "NUMBER", 22, 10, 0, "N", None, 0), ("NOMBRE", "VARCHAR2", 100, None, None, "Y", "'x'", 25)]))
  ddl = fallback.table_ddl("U", "T")
  assert "ID NUMBER(10) NOT NULL" in ddl and "NOMBRE VARCHAR2(25) DEFAULT 'x'" in ddl


def test_detalles_de_tabla():
  s = sesion(
    ("all_tab_comments", [("Artículos",)]),
    ("all_col_comments", [("ID", "Clave")]),
    ("FROM all_tab_columns", [("ID", "NUMBER", 22, 10, 0, "N", None, 0)]),
    ("all_cons_columns", [("PK_T", "ID")]),
    ("FROM all_constraints", [("PK_T", "P", None, None, None)]),
    ("all_ind_columns", [("PK_T", "ID")]),
    ("FROM all_indexes", [("PK_T", "UNIQUE")]),
  )
  info = s.table_details("U", "T")
  assert info.comment == "Artículos"
  assert [(c.name, c.type, c.nullable, c.comment) for c in info.columns] == [("ID", "NUMBER(10)", False, "Clave")]
  assert info.constraints == [("PK_T", "Clave primaria", "ID", "")]
  assert info.indexes == [("PK_T", True, "ID")]


def test_errores_de_conexion_son_legibles():
  s = sesion(("SELECT USER", Exception("ORA-01017: invalid username/password; logon denied")))
  with pytest.raises(DbError, match="Usuario o contraseña incorrectos"):
    s.current_user()


# --- perfiles y contraseñas ----------------------------------------------------------------------------
@pytest.fixture
def ajustes(monkeypatch):
  guardado = {}
  monkeypatch.setattr(settings, "get", lambda k, d=None: guardado.get(k, d))
  monkeypatch.setattr(settings, "set", lambda k, v: guardado.__setitem__(k, v))
  llavero = {}
  monkeypatch.setattr(secrets, "save", lambda k, p: llavero.__setitem__(k, p))
  monkeypatch.setattr(secrets, "get", lambda k: llavero.get(k))
  monkeypatch.setattr(secrets, "delete", lambda k: llavero.pop(k, None))
  return guardado, llavero


def test_la_contrasena_solo_va_al_llavero_y_solo_si_se_pide(ajustes):
  guardado, llavero = ajustes
  p = profiles.Profile("Producción", "db.local", "ORCL", "inv", save_password=True)
  assert profiles.save(p, "secreto") == ""
  assert llavero == {p.secret_key: "secreto"}
  assert "secreto" not in str(guardado)                       # jamás en la configuración
  assert profiles.password(profiles.load()[0]) == "secreto"

  q = profiles.Profile("Pruebas", "db2.local", "XE", "u", save_password=False)
  profiles.save(q, "otra")
  assert q.secret_key not in llavero and profiles.password(q) is None
  assert [x.name for x in profiles.load()] == ["Producción", "Pruebas"]


def test_quitar_el_guardado_borra_la_contrasena_y_borrar_el_perfil_tambien(ajustes):
  _, llavero = ajustes
  p = profiles.Profile("A", "h", "S", "u", save_password=True)
  profiles.save(p, "x")
  p.save_password = False
  profiles.save(p)
  assert llavero == {}
  p.save_password = True
  profiles.save(p, "y")
  profiles.delete(p)
  assert llavero == {} and profiles.load() == []


def test_si_no_hay_llavero_el_perfil_se_guarda_sin_contrasena(ajustes, monkeypatch):
  def sin_llavero(k, p):
    raise secrets.SecretsError("No hay un llavero disponible")
  monkeypatch.setattr(secrets, "save", sin_llavero)
  p = profiles.Profile("A", "h", "S", "u", save_password=True)
  assert "llavero" in profiles.save(p, "x")
  assert profiles.load()[0].save_password is False


# --- resaltado de sintaxis -------------------------------------------------------------------------------------
def test_resaltado_de_plsql():
  from orches.ui.syntax import highlight
  codigo = "BEGIN /* a\n b */ x := 'it''s'; -- fin\nEND;"
  lineas = highlight(codigo)
  assert lineas[0][0] == ("BEGIN", "keyword") and lineas[0][-1][1] == "comment"
  assert lineas[1][0] == (" b */", "comment")                      # el comentario de bloque sigue en la línea siguiente
  tipos = {kind for _, kind in lineas[1]}
  assert {"string", "comment"} <= tipos
  assert ("it''s", "string") not in lineas[1] and ("'it''s'", "string") in lineas[1]


def test_sid_arma_el_descriptor_y_los_errores_no_traen_ruido():
  from orches.core.db.oracle import _friendly
  servicio = profiles.Profile("A", "h", "ORCL", "u")
  assert servicio.dsn == "h:1521/ORCL"
  sid = profiles.Profile("A", "h", "ORCL", "u", use_sid=True)
  assert "(SID=ORCL)" in sid.dsn and "(HOST=h)" in sid.dsn and sid.summary.endswith("(SID)")
  assert "CONNECTION_ID" not in _friendly(Exception("DPY-6005: cannot connect to database (CONNECTION_ID=abc==)."))
  assert "SID" in _friendly(Exception("DPY-6001: Service ORCL is not registered with the listener"))
