"""Explorador de Oracle (solo lectura salvo `run_script`, que ejecuta el .sql que el usuario pide): esquemas, objetos y su código fuente.

Solo ejecuta SELECT sobre las vistas del diccionario (ALL_OBJECTS, ALL_SOURCE...) y
DBMS_METADATA.GET_DDL; nunca modifica nada. Usa `oracledb` en modo "thin" (Python puro, sin
Oracle Instant Client) y se importa solo al conectar.
"""
import re
import threading
from dataclasses import dataclass, field


class DbError(Exception):
  """Error legible para mostrar al usuario."""


# tipo de Oracle -> (título del grupo, ícono lógico); el orden es el de la interfaz
TYPES = (
  ("TABLE", "Tablas"),
  ("VIEW", "Vistas"),
  ("MATERIALIZED VIEW", "Vistas materializadas"),
  ("FUNCTION", "Funciones"),
  ("PROCEDURE", "Procedimientos (SPR)"),
  ("PACKAGE", "Paquetes"),
  ("TRIGGER", "Triggers"),
  ("SEQUENCE", "Secuencias"),
  ("TYPE", "Tipos"),
  ("SYNONYM", "Sinónimos"),
)
SINGULAR = {   # nombre de cada tipo en singular, para títulos y etiquetas
  "TABLE": "Tabla", "VIEW": "Vista", "MATERIALIZED VIEW": "Vista materializada", "FUNCTION": "Función",
  "PROCEDURE": "Procedimiento", "PACKAGE": "Paquete", "TRIGGER": "Trigger", "SEQUENCE": "Secuencia",
  "TYPE": "Tipo", "SYNONYM": "Sinónimo",
}
BODIES = {"PACKAGE BODY": "PACKAGE", "TYPE BODY": "TYPE"}   # se muestran junto a su especificación
CODE_TYPES = {"FUNCTION", "PROCEDURE", "PACKAGE", "TRIGGER", "TYPE"}   # se leen de ALL_SOURCE


@dataclass(frozen=True)
class DbObject:
  name: str
  type: str
  status: str = "VALID"
  modified: str = ""

  @property
  def valid(self):
    return self.status == "VALID"


@dataclass
class Column:
  name: str
  type: str
  nullable: bool
  default: str = ""
  comment: str = ""


@dataclass
class TableInfo:
  comment: str = ""
  columns: list = field(default_factory=list)
  constraints: list = field(default_factory=list)   # (nombre, tipo, columnas, detalle)
  indexes: list = field(default_factory=list)       # (nombre, único, columnas)


CONSTRAINT_TYPES = {"P": "Clave primaria", "U": "Único", "R": "Clave foránea", "C": "Check", "V": "Vista", "O": "Solo lectura"}


def _text(value):
  """Texto de una celda: los LOB y LONG llegan como objeto con .read() o como str."""
  if value is None:
    return ""
  return value.read() if hasattr(value, "read") else str(value)


def column_type(data_type, length, precision, scale, char_length=None):
  """VARCHAR2(30), NUMBER(10,2), DATE..."""
  t = data_type or ""
  if t in ("VARCHAR2", "NVARCHAR2", "CHAR", "NCHAR", "RAW"):
    return f"{t}({char_length or length})" if (char_length or length) else t
  if t == "NUMBER":
    if precision is not None:
      return f"NUMBER({int(precision)},{int(scale)})" if scale else f"NUMBER({int(precision)})"
    return "NUMBER"
  return t


CALL_TIMEOUT_MS = 90_000      # tiempo máximo por consulta


CREATE_RE = re.compile(
  r"\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:NON)?EDITIONABLE\s+)?(FUNCTION|PROCEDURE|PACKAGE(?:\s+BODY)?|TRIGGER|TYPE(?:\s+BODY)?)"
  r"\s+([\w$#.\"]+)", re.IGNORECASE)
PLSQL_RE = re.compile(r"\s*(DECLARE|BEGIN|CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:NON)?EDITIONABLE\s+)?"
                      r"(FUNCTION|PROCEDURE|PACKAGE|TRIGGER|TYPE))\b", re.IGNORECASE)


LEADING_COMMENTS_RE = re.compile(r"\A(?:\s+|--[^\n]*|/\*.*?\*/)+", re.DOTALL)


def _code(text):
  """El texto sin los comentarios y espacios del principio (para saber con qué empieza la sentencia)."""
  return LEADING_COMMENTS_RE.sub("", text, count=1)


def split_script(text):
  """Separa un script en sentencias: bloques PL/SQL hasta una línea «/», el resto hasta «;»."""
  out, buf = [], []

  def flush():
    stmt = "\n".join(buf).strip()
    buf.clear()
    if stmt:
      out.append(stmt)

  for line in text.splitlines():
    stripped = line.strip()
    block = bool(buf) and bool(PLSQL_RE.match(_code("\n".join(buf))))
    if stripped == "/":
      flush()
    elif not block and stripped.endswith(";") and not stripped.startswith("--"):
      buf.append(stripped[:-1])
      flush()
    elif stripped or buf:
      buf.append(line.rstrip())
  flush()
  return out


class OracleSession:
  """Una conexión abierta. Todas las consultas pasan por un candado: la conexión no admite hilos."""

  def __init__(self, conn, profile=None):
    self.conn = conn
    self.profile = profile
    self.user = ""
    self._lock = threading.Lock()

  @classmethod
  def connect(cls, profile, password):
    try:
      import oracledb
    except ImportError:
      raise DbError("Falta instalar oracledb: uv add oracledb")
    try:
      conn = oracledb.connect(user=profile.user, password=password, dsn=profile.dsn, tcp_connect_timeout=10)
    except oracledb.Error as e:
      raise DbError(_friendly(e))
    except OSError as e:
      raise DbError(f"No se pudo llegar al servidor: {e}")
    try:
      conn.call_timeout = CALL_TIMEOUT_MS      # ninguna consulta debe dejar la app esperando para siempre
    except Exception:
      pass
    return cls(conn, profile)

  def cancel(self):
    """Interrumpe la consulta en curso (se llama desde otro hilo)."""
    try:
      self.conn.cancel()
    except Exception:
      pass

  def close(self):
    try:
      with self._lock:
        self.conn.close()
    except Exception:
      pass

  def query(self, sql, **params):
    with self._lock:
      try:
        with self.conn.cursor() as cur:
          cur.execute(sql, params)
          return cur.fetchall()
      except Exception as e:
        raise DbError(_friendly(e))

  def run_script(self, text):
    """Ejecuta un script .sql (sentencias con «;» o bloques PL/SQL cerrados con «/»).

    Devuelve (ejecutadas, errores, compilación): errores = [(sentencia, mensaje)] y compilación =
    [(objeto, línea, columna, texto)] con los errores de compilación de los objetos creados.
    """
    done, failed, created = 0, [], []
    with self._lock:
      with self.conn.cursor() as cur:
        for stmt in split_script(text):
          try:
            cur.execute(stmt)
            done += 1
            m = CREATE_RE.match(_code(stmt))
            if m:
              created.append((m.group(2).upper(), m.group(1).upper().split()[0]))
          except Exception as e:
            failed.append((stmt.strip().splitlines()[0][:80], _friendly(e)))
      try:
        self.conn.commit()
      except Exception:
        pass
    problems = []
    for name, kind in dict.fromkeys(created):
      name = name.split(".")[-1].strip('"')
      for line, col, msg in self.errors(self.user or self.current_user(), name, kind):
        problems.append((name, line, col, msg))
    return done, failed, problems

  # --- esquemas y objetos -----------------------------------------------------------------
  def current_user(self):
    rows = self.query("SELECT USER FROM dual")
    self.user = rows[0][0] if rows else ""
    return self.user

  def owners(self):
    """Esquemas de la base. Se lee ALL_USERS (rápido); ALL_OBJECTS es enorme en un ERP."""
    rows = self.query("SELECT username FROM all_users ORDER BY username")
    return [r[0] for r in rows]

  def objects(self, owner):
    kinds = [t for t, _ in TYPES] + list(BODIES)
    marks = ", ".join(f":t{i}" for i in range(len(kinds)))
    mine = bool(self.user) and owner == self.user         # los objetos propios se leen de USER_OBJECTS: mucho más rápido
    source = "user_objects WHERE 1 = 1" if mine else "all_objects WHERE owner = :owner"
    params = {f"t{i}": k for i, k in enumerate(kinds)}
    if not mine:
      params["owner"] = owner
    rows = self.query(
      f"SELECT object_name, object_type, status, TO_CHAR(last_ddl_time, 'YYYY-MM-DD HH24:MI') "
      f"FROM {source} AND object_type IN ({marks}) "
      f"AND object_name NOT LIKE 'BIN$%' AND generated = 'N' ORDER BY object_type, object_name", **params)
    merged = {}
    for name, kind, status, modified in rows:
      kind = BODIES.get(kind, kind)
      current = merged.get((kind, name))
      if current and current.status != "VALID":
        status = current.status         # si la especificación o el cuerpo fallan, el objeto falla
      merged[(kind, name)] = DbObject(name, kind, status or "VALID", modified or "")
    return list(merged.values())

  # --- código fuente -------------------------------------------------------------------------
  def source(self, owner, name, kind):
    """DDL o código del objeto, listo para mostrar."""
    if kind in CODE_TYPES:
      parts = ("PACKAGE", "PACKAGE BODY") if kind == "PACKAGE" else ("TYPE", "TYPE BODY") if kind == "TYPE" else (kind,)
      rows = self.query(
        "SELECT type, text FROM all_source WHERE owner = :owner AND name = :name "
        "AND type IN (" + ", ".join(f":p{i}" for i in range(len(parts))) + ") ORDER BY type, line",
        owner=owner, name=name, **{f"p{i}": p for i, p in enumerate(parts)})
      blocks = {}
      for part, text in rows:
        blocks.setdefault(part, []).append(_text(text))
      out = []
      for part in parts:
        if part in blocks:
          out.append("CREATE OR REPLACE " + "".join(blocks[part]).lstrip().rstrip() + "\n/\n")
      return "\n".join(out) or f"-- {owner}.{name}: no hay código visible (puede estar cifrado o sin permisos)"
    if kind == "VIEW":
      rows = self.query("SELECT text FROM all_views WHERE owner = :owner AND view_name = :name", owner=owner, name=name)
      return f"CREATE OR REPLACE VIEW {owner}.{name} AS\n{_text(rows[0][0]).strip()}" if rows else ""
    if kind == "MATERIALIZED VIEW":
      rows = self.query("SELECT query FROM all_mviews WHERE owner = :owner AND mview_name = :name", owner=owner, name=name)
      return f"CREATE MATERIALIZED VIEW {owner}.{name} AS\n{_text(rows[0][0]).strip()}" if rows else ""
    if kind == "SEQUENCE":
      rows = self.query("SELECT min_value, max_value, increment_by, cycle_flag, cache_size, last_number "
                        "FROM all_sequences WHERE sequence_owner = :owner AND sequence_name = :name", owner=owner, name=name)
      if not rows:
        return ""
      lo, hi, step, cycle, cache, last = rows[0]
      return (f"CREATE SEQUENCE {owner}.{name}\n  MINVALUE {lo}\n  MAXVALUE {hi}\n  INCREMENT BY {step}\n"
              f"  {'CYCLE' if cycle == 'Y' else 'NOCYCLE'}\n  CACHE {cache}\n  -- último valor: {last}")
    if kind == "SYNONYM":
      rows = self.query("SELECT table_owner, table_name, db_link FROM all_synonyms WHERE owner = :owner AND synonym_name = :name",
                        owner=owner, name=name)
      if not rows:
        return ""
      t_owner, t_name, link = rows[0]
      return f"CREATE OR REPLACE SYNONYM {owner}.{name} FOR {t_owner + '.' if t_owner else ''}{t_name}{'@' + link if link else ''};"
    if kind == "TABLE":
      return self.table_ddl(owner, name)
    return ""

  def table_ddl(self, owner, name):
    """DDL de la tabla con DBMS_METADATA; si no hay permiso, se arma con las columnas."""
    try:
      rows = self.query("SELECT DBMS_METADATA.GET_DDL('TABLE', :name, :owner) FROM dual", name=name, owner=owner)
      if rows and rows[0][0]:
        return _text(rows[0][0]).strip()
    except DbError:
      pass
    info = self.table_details(owner, name)
    cols = ",\n".join(f"  {c.name} {c.type}{'' if c.nullable else ' NOT NULL'}" + (f" DEFAULT {c.default}" if c.default else "")
                      for c in info.columns)
    return f"CREATE TABLE {owner}.{name} (\n{cols}\n);"

  def errors(self, owner, name, kind):
    """Errores de compilación de un objeto inválido: [(línea, columna, texto)]."""
    kinds = [kind, *[b for b, base in BODIES.items() if base == kind]]
    rows = self.query(
      "SELECT line, position, text FROM all_errors WHERE owner = :owner AND name = :name AND type IN ("
      + ", ".join(f":k{i}" for i in range(len(kinds))) + ") AND attribute = 'ERROR' ORDER BY type, sequence",
      owner=owner, name=name, **{f"k{i}": k for i, k in enumerate(kinds)})
    return [(r[0], r[1], _text(r[2]).strip()) for r in rows]

  # --- tablas -----------------------------------------------------------------------------------
  def table_details(self, owner, name):
    info = TableInfo()
    rows = self.query("SELECT comments FROM all_tab_comments WHERE owner = :owner AND table_name = :name", owner=owner, name=name)
    info.comment = _text(rows[0][0]) if rows else ""
    comments = {r[0]: _text(r[1]) for r in self.query(
      "SELECT column_name, comments FROM all_col_comments WHERE owner = :owner AND table_name = :name", owner=owner, name=name)}
    for col, dtype, length, prec, scale, nullable, default, char_len in self.query(
        "SELECT column_name, data_type, data_length, data_precision, data_scale, nullable, data_default, char_length "
        "FROM all_tab_columns WHERE owner = :owner AND table_name = :name ORDER BY column_id", owner=owner, name=name):
      info.columns.append(Column(col, column_type(dtype, length, prec, scale, char_len), nullable == "Y",
                                 _text(default).strip(), comments.get(col, "")))
    cols_of = {}
    for cname, col in self.query(
        "SELECT constraint_name, column_name FROM all_cons_columns WHERE owner = :owner AND table_name = :name "
        "ORDER BY constraint_name, position", owner=owner, name=name):
      cols_of.setdefault(cname, []).append(col)
    for cname, ctype, search, r_owner, r_name in self.query(
        "SELECT constraint_name, constraint_type, search_condition, r_owner, r_constraint_name FROM all_constraints "
        "WHERE owner = :owner AND table_name = :name AND (constraint_type <> 'C' OR constraint_name NOT LIKE 'SYS_C%') "
        "ORDER BY constraint_type, constraint_name",
        owner=owner, name=name):
      detail = _text(search).strip() if ctype == "C" else (f"→ {r_owner}.{r_name}" if ctype == "R" else "")
      info.constraints.append((cname, CONSTRAINT_TYPES.get(ctype, ctype), ", ".join(cols_of.get(cname, [])), detail))
    idx_cols = {}
    for iname, col in self.query(
        "SELECT index_name, column_name FROM all_ind_columns WHERE table_owner = :owner AND table_name = :name "
        "ORDER BY index_name, column_position", owner=owner, name=name):
      idx_cols.setdefault(iname, []).append(col)
    for iname, uniq in self.query(
        "SELECT index_name, uniqueness FROM all_indexes WHERE table_owner = :owner AND table_name = :name ORDER BY index_name",
        owner=owner, name=name):
      info.indexes.append((iname, uniq == "UNIQUE", ", ".join(idx_cols.get(iname, []))))
    return info


def _friendly(error):
  """Mensaje corto y útil a partir de un error de oracledb."""
  text = str(error).strip().splitlines()[0] if str(error).strip() else type(error).__name__
  text = re.sub(r"\s*\(CONNECTION_ID=[^)]*\)\.?", "", text)       # identificador interno: no ayuda al usuario
  if "DPY-3010" in text or "DPY-3015" in text:
    text += " (esta versión de Oracle es muy antigua para el modo thin; haría falta Oracle Instant Client)"
  if "DPY-4024" in text or "ORA-03156" in text or "timeout" in text.lower() and "DPY" in text:
    text = "La consulta tardó demasiado y se canceló (la base está lenta o el esquema es enorme)"
  elif "DPY-4011" in text or "DPY-1001" in text:
    text = "Se perdió la conexión con la base"
  elif "ORA-01017" in text:
    text = "Usuario o contraseña incorrectos"
  elif "DPY-6005" in text or "ORA-12541" in text:
    text = "No se pudo conectar con el servidor: revisa host y puerto (o que la red/VPN permita llegar a él)"
  elif "DPY-6001" in text or "ORA-12514" in text or "ORA-12505" in text:
    text += " (revisa el servicio; si tu base usa SID, cambia a «SID» en el formulario)"
  return text
