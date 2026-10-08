"""Resaltado de sintaxis para mostrar código: SQL / PL-SQL y los lenguajes más comunes."""
import re
from dataclasses import dataclass, field
from pathlib import PurePath
from flet import TextSpan, TextStyle, FontWeight

COLORS = {
  "keyword": "#C792EA",
  "type": "#4CC9B0",
  "string": "#7CCB8B",
  "number": "#F0B67F",
  "comment": "#6B7088",
  "plain": "#E6E8EF",
}


def _words(text):
  return frozenset(text.split())


@dataclass(frozen=True)
class Lang:
  keywords: frozenset = frozenset()
  types: frozenset = frozenset()
  line_comments: tuple = ()
  block: tuple = ()                 # (inicio, fin) de los comentarios de bloque
  quotes: str = "'\""               # caracteres que abren cadenas
  ignore_case: bool = False         # SQL no distingue mayúsculas
  _compiled: list = field(default_factory=list, compare=False, hash=False)


SQL_KEYWORDS = _words("""
ALL ALTER AND ANY AS ASC AUTHID BEGIN BETWEEN BODY BULK BY CASE CAST CHECK CLOSE COLLECT COMMENT COMMIT
CONNECT CONSTANT CONSTRAINT CONTINUE CREATE CURRENT CURSOR DECLARE DEFAULT DELETE DESC DETERMINISTIC DISTINCT
DROP ELSE ELSIF END ESCAPE EXCEPTION EXECUTE EXISTS EXIT FETCH FOR FOREACH FORALL FOREIGN FROM FUNCTION GOTO
GRANT GROUP HAVING IF IMMEDIATE IN INDEX INNER INSERT INTERSECT INTO IS JOIN KEY LEFT LIKE LIMIT LOCK LOOP
MERGE MINUS NEW NOT NOCOPY NULL OF OFFSET ON OPEN OR ORDER OUT OUTER OVER PACKAGE PARTITION PIPELINED PRAGMA
PRIMARY PRIOR PROCEDURE RAISE RECORD REFERENCES REPLACE RESULT_CACHE RETURN RETURNING REVERSE RIGHT ROLLBACK
ROW ROWS SAVEPOINT SELECT SEQUENCE SET SOME START TABLE THEN TO TRIGGER TYPE UNION UNIQUE UPDATE USING VALUES
VIEW WHEN WHERE WITH
""")
SQL_TYPES = _words("""
BINARY_INTEGER BLOB BOOLEAN CHAR CLOB DATE DECIMAL FLOAT INTEGER LONG NCHAR NCLOB NUMBER NVARCHAR2 PLS_INTEGER
RAW REAL ROWID SIMPLE_INTEGER SMALLINT TIMESTAMP VARCHAR VARCHAR2 XMLTYPE
""")
JS_KEYWORDS = _words("""
as async await break case catch class const continue debugger default delete do else enum export extends
finally for from function get if implements import in instanceof interface let new of return set static super
switch this throw try type typeof var void while with yield
""")
PY_KEYWORDS = _words("""
and as assert async await break class continue def del elif else except finally for from global if import in is
lambda nonlocal not or pass raise return try while with yield match case
""")
C_KEYWORDS = _words("""
abstract break case catch class const continue default do else enum export extends final finally fn for func go
if impl implements import in interface let match mod mut namespace new null package private protected pub public
return static struct super switch this throw trait try type use using var void while
""")
LITERALS = _words("True False None true false null undefined NaN nil")
BUILTIN_TYPES = _words("""
int str float bool list dict set tuple bytes string number boolean any void char double long short unsigned
i8 i16 i32 i64 u8 u16 u32 u64 usize isize f32 f64 Self Option Result Vec
""")

LANGS = {
  "sql": Lang(SQL_KEYWORDS, SQL_TYPES, ("--",), ("/*", "*/"), "'", True),
  "python": Lang(PY_KEYWORDS | LITERALS, BUILTIN_TYPES, ("#",), (), "'\""),
  "javascript": Lang(JS_KEYWORDS | LITERALS, BUILTIN_TYPES, ("//",), ("/*", "*/"), "'\"`"),
  "clike": Lang(C_KEYWORDS | LITERALS, BUILTIN_TYPES, ("//",), ("/*", "*/"), "'\""),
  "json": Lang(LITERALS, frozenset(), (), (), "\""),
  "hash": Lang(LITERALS | _words("if then else fi for do done while case esac function in export local return"),
               frozenset(), ("#",), (), "'\""),
  "css": Lang(frozenset(), frozenset(), (), ("/*", "*/"), "'\""),
  "html": Lang(frozenset(), frozenset(), (), ("<!--", "-->"), "'\""),
  "plain": Lang(),
}

BY_EXTENSION = {
  ".sql": "sql", ".pks": "sql", ".pkb": "sql", ".fnc": "sql", ".prc": "sql", ".trg": "sql", ".plsql": "sql",
  ".py": "python", ".pyw": "python",
  ".js": "javascript", ".jsx": "javascript", ".ts": "javascript", ".tsx": "javascript", ".mjs": "javascript",
  ".cjs": "javascript",
  ".java": "clike", ".c": "clike", ".h": "clike", ".cpp": "clike", ".hpp": "clike", ".cs": "clike", ".go": "clike",
  ".rs": "clike", ".kt": "clike", ".swift": "clike", ".php": "clike", ".dart": "clike",
  ".json": "json", ".jsonc": "json",
  ".yml": "hash", ".yaml": "hash", ".toml": "hash", ".sh": "hash", ".bash": "hash", ".zsh": "hash", ".ini": "hash",
  ".env": "hash", ".gitignore": "hash", ".conf": "hash", ".cfg": "hash", ".dockerfile": "hash",
  ".css": "css", ".scss": "css", ".html": "html", ".htm": "html", ".xml": "html", ".svg": "html", ".vue": "html",
}


def language_for(path):
  """Lenguaje de resaltado según el nombre del archivo."""
  p = PurePath(str(path))
  return BY_EXTENSION.get(p.suffix.lower()) or BY_EXTENSION.get(p.name.lower()) or "plain"


def _pattern(lang):
  parts = []
  if lang.line_comments:
    parts.append("(?P<comment>(?:" + "|".join(re.escape(m) for m in lang.line_comments) + r")[^\n]*)")
  if lang.quotes:
    q = re.escape(lang.quotes)
    parts.append(r"(?P<string>(?P<q>[" + q + r"])(?:\\.|(?!(?P=q)).)*(?P=q)?)")
  parts += [r"(?P<number>\b\d+(?:\.\d+)?\b)", r"(?P<word>[A-Za-z_][A-Za-z0-9_$#]*)", r"(?P<other>.)"]
  return re.compile("|".join(parts), re.DOTALL)


_cache = {}


def _compiled(name):
  if name not in _cache:
    _cache[name] = _pattern(LANGS[name])
  return _cache[name]


def _kind(word, lang):
  key = word.upper() if lang.ignore_case else word
  if key in lang.keywords:
    return "keyword"
  if key in lang.types:
    return "type"
  return "plain"


def _merge(tokens):
  merged = []
  for text, kind in tokens:
    if merged and merged[-1][1] == kind:
      merged[-1] = (merged[-1][0] + text, kind)
    else:
      merged.append((text, kind))
  return merged


def tokenize_line(line, in_block, language="sql"):
  """([(texto, tipo)], sigue_dentro_de_un_comentario_de_bloque)"""
  lang, pattern = LANGS[language], _compiled(language)
  start_mark, end_mark = lang.block or (None, None)
  tokens, pos = [], 0
  if in_block:
    end = line.find(end_mark)
    if end == -1:
      return [(line, "comment")], True
    tokens.append((line[:end + len(end_mark)], "comment"))
    pos, in_block = end + len(end_mark), False
  while pos < len(line):
    start = line.find(start_mark, pos) if start_mark else -1
    segment = line[pos:] if start == -1 else line[pos:start]
    for m in pattern.finditer(segment):
      kind = m.lastgroup if m.lastgroup != "q" else "string"
      text = m.group()
      tokens.append((text, _kind(text, lang) if kind == "word" else "plain" if kind == "other" else kind))
    if start == -1:
      break
    end = line.find(end_mark, start + len(start_mark))
    if end == -1:
      tokens.append((line[start:], "comment"))
      return _merge(tokens), True
    tokens.append((line[start:end + len(end_mark)], "comment"))
    pos = end + len(end_mark)
  return _merge(tokens), in_block


def highlight(text, language="sql"):
  """Líneas resaltadas: [[(texto, tipo), ...], ...]"""
  lines, in_block = [], False
  for line in text.splitlines() or [""]:
    tokens, in_block = tokenize_line(line.rstrip("\r"), in_block, language)
    lines.append(tokens)
  return lines


def spans(tokens, decorate=True):
  """Fragmentos de Flet para una línea ya tokenizada.

  Con `decorate=False` solo se usa el color (sin negritas ni cursiva): así el texto coloreado ocupa
  exactamente lo mismo que el del editor que va encima.
  """
  return [
    TextSpan(text, style=TextStyle(color=COLORS[kind],
                                   italic=(kind == "comment" or None) if decorate else None,
                                   weight=FontWeight.W_600 if decorate and kind == "keyword" else None))
    for text, kind in tokens
  ]
