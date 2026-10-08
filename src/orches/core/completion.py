"""Sugerencias de autocompletado para cualquier lenguaje (sin servidores de lenguaje).

Combina las palabras que ya aparecen en el archivo con las palabras clave del lenguaje. Es el mismo
enfoque «por palabras» que usan los editores cuando no tienen un servidor de lenguaje: sirve igual para
Python, SQL, JavaScript, YAML o texto.
"""
import re
from collections import Counter
from dataclasses import dataclass

WORD = re.compile(r"[A-Za-z_À-ÿ][A-Za-z0-9_$#À-ÿ]*")
IDENT_CHARS = re.compile(r"[A-Za-z0-9_$#À-ÿ]")
MIN_LENGTH = 3          # palabras más cortas no se ofrecen (ruido)


@dataclass(frozen=True)
class Suggestion:
  label: str
  kind: str            # "keyword" | "type" | "word" | "module"
  start: int = -1      # dónde empieza el texto que reemplaza (-1: la palabra bajo el cursor); lo fijan las extensiones
  detail: str = ""     # etiqueta a la derecha (si no, se muestra el nombre del tipo)


def prefix_at(text, cursor):
  """(inicio, palabra escrita) justo antes del cursor; ('', cursor) si no hay una palabra."""
  cursor = max(0, min(cursor, len(text)))
  start = cursor
  while start > 0 and IDENT_CHARS.match(text[start - 1]):
    start -= 1
  word = text[start:cursor]
  if word and word[0].isdigit():       # un número no es un identificador
    return cursor, ""
  return start, word


def _score(label, prefix):
  """Menor es mejor; None si no coincide. Prefijo > prefijo sin mayúsculas > iniciales (CamelCase) > subsecuencia."""
  if label == prefix:
    return None
  if label.startswith(prefix):
    return 0
  low, lp = label.lower(), prefix.lower()
  if low.startswith(lp):
    return 1
  caps = "".join(c for i, c in enumerate(label) if c.isupper() or (i > 0 and label[i - 1] == "_" and c.isalpha()) or i == 0).lower()
  if caps.startswith(lp):
    return 2                                    # «Clk» → Clickable, «btn_c» → button_count
  pos = 0
  for ch in lp:                                 # subsecuencia: «clkbl» → Clickable
    pos = low.find(ch, pos) + 1
    if pos == 0:
      return None
  return 3


def suggestions(text, cursor, keywords=(), types=(), limit=8, force=False, case_insensitive=False):
  """Hasta `limit` sugerencias para la palabra que se está escribiendo en `cursor`.

  `force` (Ctrl+Espacio) permite sugerir con 1 letra o incluso sin escribir nada.
  """
  start, prefix = prefix_at(text, cursor)
  minimum = 0 if force else 2
  if len(prefix) < minimum:
    return []
  counts = Counter(w for w in WORD.findall(text[:start] + " " + text[cursor:]) if len(w) >= MIN_LENGTH)
  candidates = {}
  for word, n in counts.items():
    candidates[word] = ("word", n)
  for word in types:
    candidates.setdefault(word, ("type", 0))
  for word in keywords:
    candidates[word] = ("keyword", candidates.get(word, ("", 0))[1])
  ranked = []
  for label, (kind, freq) in candidates.items():
    shown = label.upper() if case_insensitive and kind in ("keyword", "type") and prefix.isupper() else label
    score = _score(shown, prefix) if prefix else 4
    if score is not None:
      ranked.append((score, 0 if kind == "word" else 1, -freq, len(label), shown.lower(), Suggestion(shown, kind)))
  ranked.sort(key=lambda r: r[:5])
  seen, result = set(), []
  for *_, s in ranked:
    if s.label not in seen:
      seen.add(s.label)
      result.append(s)
    if len(result) >= limit:
      break
  return result


def apply(text, cursor, suggestion):
  """(texto nuevo, cursor nuevo) tras aceptar `suggestion` en lugar de la palabra que se escribía."""
  start = suggestion.start if suggestion.start >= 0 else prefix_at(text, cursor)[0]
  new = text[:start] + suggestion.label + text[cursor:]
  return new, start + len(suggestion.label)
