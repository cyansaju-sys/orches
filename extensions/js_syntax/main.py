"""Resaltado de sintaxis para JavaScript, JSX, TypeScript y TSX. Solo comportamiento: no tiene ícono ni pestaña."""

JS_KEYWORDS = """
async await break case catch class const continue debugger default delete do else export extends finally for from
function get if import in instanceof let new of return set static super switch this throw try typeof var void while
with yield true false null undefined NaN Infinity
"""
TS_KEYWORDS = JS_KEYWORDS + """
abstract as asserts declare enum implements infer interface is keyof module namespace override private protected
public readonly satisfies type unique
"""
TS_TYPES = "string number boolean any unknown never object symbol bigint void"

NOT_CALLS = "if|for|while|switch|catch|function|return|typeof|await|new|import|super|void|delete|with|else|do"
FUNCTION = rf"\b(?!(?:{NOT_CALLS})\b)[A-Za-z_$][\w$]*(?=\s*\()"          # nombre(  -> llamada o declaración
TYPE = r"\b[A-Z][A-Za-z0-9_$]*\b"                                          # Clases, componentes, interfaces
HEX = r"\b0[xXbBoO][0-9a-fA-F_]+n?\b"
DECORATOR = r"@[A-Za-z_$][\w$]*"
TAG = r"(?<![\w)\]$])</?[A-Za-z][\w.:-]*(?=[\s/>])|(?<![\w)\]$])</?>|/>"   # <Div  </Div  <>  />
COLORS = {"tag": "#F07178", "function": "#82AAFF", "decorator": "#FFCB6B"}


def activate(api):
  common = dict(line_comments=("//",), block=("/*", "*/"), quotes="'\"`", colors=COLORS)
  base = [("decorator", DECORATOR), ("function", FUNCTION), ("type", TYPE), ("number", HEX)]
  jsx = [("tag", TAG)] + base
  api.add_language("ext_js", [".js", ".jsx", ".mjs", ".cjs"], keywords=JS_KEYWORDS, rules=jsx,
                   title="JavaScript / JSX", **common)
  api.add_language("ext_ts", [".ts", ".mts", ".cts"], keywords=TS_KEYWORDS, types=TS_TYPES, rules=base,
                   title="TypeScript", **common)
  api.add_language("ext_tsx", [".tsx"], keywords=TS_KEYWORDS, types=TS_TYPES, rules=jsx,
                   title="TypeScript / TSX", **common)
