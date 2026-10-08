#!/usr/bin/env bash
# Instala Orches en Linux (sin permisos de administrador): descarga el código, prepara su entorno con uv y crea
# el comando `orches` y la entrada del menú de aplicaciones.
#
#   curl -fsSL https://raw.githubusercontent.com/cyansaju-sys/orches/master/install.sh | bash
#   ./install.sh                  instala o actualiza a la última versión publicada (el mismo comando sirve para ambas)
#   ./install.sh --ref master     instala una rama o un tag concreto (v0.1.0)
#   ./install.sh --uninstall      lo quita (tus ajustes en ~/.config/orches se conservan)
#   ./install.sh --yes            no pregunta antes de instalar uv
#
# Variables: ORCHES_REPO (repositorio), ORCHES_REF (tag o rama; por defecto el último tag), ORCHES_HOME (dónde se instala).
set -euo pipefail

REPO="${ORCHES_REPO:-https://github.com/cyansaju-sys/orches.git}"
REF="${ORCHES_REF:-}"          # vacío = el último tag publicado (v*)
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
DIR="${ORCHES_HOME:-$DATA/orches}"
BIN="$HOME/.local/bin"
DESKTOP="$DATA/applications/orches.desktop"
ASSUME_YES=0
UNINSTALL=0

say()  { printf '\033[1;35m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --uninstall) UNINSTALL=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    --ref) shift; [ $# -gt 0 ] || fail "--ref necesita un valor"; REF="$1" ;;
    -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fail "opción desconocida: $1 (usa --help)" ;;
  esac
  shift
done

if [ "$UNINSTALL" = 1 ]; then
  rm -rf "$DIR" "$BIN/orches" "$DESKTOP"
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$(dirname "$DESKTOP")" 2>/dev/null || true
  say "Orches quitado. Tus ajustes siguen en ~/.config/orches (bórralos a mano si quieres)."
  exit 0
fi

[ "$(uname -s)" = "Linux" ] || fail "este instalador es solo para Linux"
command -v git >/dev/null 2>&1 || fail "falta git: instálalo con el gestor de paquetes de tu distribución"

if ! command -v uv >/dev/null 2>&1; then
  say "Falta uv (gestor de Python, https://docs.astral.sh/uv/)."
  if [ "$ASSUME_YES" = 0 ]; then
    [ -t 0 ] || fail "instala uv primero (curl -LsSf https://astral.sh/uv/install.sh | sh) o ejecuta con --yes"
    read -r -p "¿Instalarlo ahora con el script oficial de astral.sh? [s/N] " answer
    case "$answer" in s|S|si|SI|y|Y) ;; *) fail "sin uv no se puede continuar" ;; esac
  fi
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
  command -v uv >/dev/null 2>&1 || fail "uv se instaló pero no está en el PATH: abre otra terminal y repite"
fi

if [ -z "$REF" ]; then
  REF="$(git ls-remote --tags --refs --sort=-v:refname "$REPO" 'v*' 2>/dev/null | head -n 1 | sed 's|.*refs/tags/||')"
  [ -n "$REF" ] || { say "No hay versiones publicadas: se usa la rama master."; REF=master; }
fi

mkdir -p "$DIR" "$BIN" "$(dirname "$DESKTOP")"
if [ -d "$DIR/.git" ]; then
  say "Actualizando a $REF…"
else
  say "Descargando Orches ($REF)…"
  git -C "$DIR" init -q
  git -C "$DIR" remote add origin "$REPO"
fi
git -C "$DIR" fetch -q --depth 1 origin "$REF" || fail "no existe «$REF» en $REPO"
git -C "$DIR" checkout -q -f FETCH_HEAD

if [ "${ORCHES_SKIP_SYNC:-0}" != 1 ]; then          # solo para pruebas del instalador
  say "Preparando el entorno (la primera vez descarga Python y las dependencias)…"
  (cd "$DIR" && uv sync)
fi

cat > "$BIN/orches" <<LAUNCHER
#!/usr/bin/env bash
cd "$DIR" && exec "$DIR/.venv/bin/flet" run "$DIR/src/main.py" "\$@"
LAUNCHER
chmod +x "$BIN/orches"

cat > "$DESKTOP" <<ENTRY
[Desktop Entry]
Type=Application
Name=Orches
Comment=Panel de agentes de programación
Exec=$BIN/orches
Icon=$DIR/src/assets/icon.png
Terminal=false
Categories=Development;
ENTRY
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$(dirname "$DESKTOP")" 2>/dev/null || true

say "Listo. Ejecuta «orches» o búscalo en el menú de aplicaciones."
case ":$PATH:" in *":$BIN:"*) ;; *) say "Ojo: $BIN no está en tu PATH; añádelo a tu ~/.bashrc o ~/.zshrc." ;; esac
