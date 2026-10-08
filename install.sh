#!/usr/bin/env bash
# Instala Orches en Linux (sin permisos de administrador): descarga el código, prepara su entorno con uv y crea
# el comando `orches` y la entrada del menú de aplicaciones.
#
#   curl -fsSL https://raw.githubusercontent.com/cyansaju-sys/orches/master/install.sh | bash
#   ./install.sh                  instala o actualiza a la última versión publicada (el mismo comando sirve para ambas)
#   ./install.sh --ref master     instala una rama o un tag concreto (v0.1.0)
#   ./install.sh --source         fuerza instalar desde el código (git + uv) en vez del binario
#   ./install.sh --uninstall      lo quita (tus ajustes en ~/.config/orches se conservan)
#   ./install.sh --yes            no pregunta antes de instalar uv
#
# Si la release trae el binario de Linux (x86_64) se usa: no hace falta Python, uv ni git. Si no, se instala desde el
# código con uv (descarga Python y las dependencias la primera vez).
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
SOURCE=0

say()  { printf '\033[1;35m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --uninstall) UNINSTALL=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    --source) SOURCE=1 ;;
    --ref) shift; [ $# -gt 0 ] || fail "--ref necesita un valor"; REF="$1" ;;
    -h|--help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fail "opción desconocida: $1 (usa --help)" ;;
  esac
  shift
done

# Se borra y se reescribe $DIR: solo si está vacía o ya es una instalación de Orches (nunca una carpeta ajena).
guard_dir() {
  if [ -e "$DIR" ] && [ -n "$(ls -A "$DIR" 2>/dev/null)" ] && [ ! -f "$DIR/VERSION" ] && [ ! -d "$DIR/.git" ]; then
    fail "$DIR existe y no parece una instalación de Orches; elige otra con ORCHES_HOME"
  fi
}

if [ "$UNINSTALL" = 1 ]; then
  guard_dir
  rm -rf "$DIR" "$BIN/orches" "$DESKTOP"
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$(dirname "$DESKTOP")" 2>/dev/null || true
  say "Orches quitado. Tus ajustes siguen en ~/.config/orches (bórralos a mano si quieres)."
  exit 0
fi

guard_dir

# --- binario: sin Python, uv ni git ------------------------------------------------------------------------------
SLUG="$(printf '%s' "$REPO" | sed -E 's#^(https?://github\.com/|git@github\.com:)##; s#\.git$##')"
BASE="${ORCHES_DOWNLOAD_BASE:-https://github.com/$SLUG/releases/download}"   # ORCHES_DOWNLOAD_BASE: solo para pruebas

install_binary() {
  [ "$SOURCE" = 0 ] && [ "$(uname -m)" = "x86_64" ] && command -v curl >/dev/null 2>&1 && command -v tar >/dev/null 2>&1 || return 1
  local tag="$REF"
  if [ -z "$tag" ]; then
    tag="$(curl -fsSL "https://api.github.com/repos/$SLUG/releases/latest" 2>/dev/null | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1)"
    [ -n "$tag" ] || return 1
  fi
  local url="$BASE/$tag/Orches-$tag-linux-x86_64.tar.gz" tmp
  tmp="$(mktemp -d)"
  if ! curl -fsSL "$url" -o "$tmp/orches.tar.gz" 2>/dev/null; then rm -rf "$tmp"; return 1; fi
  say "Instalando el binario de Orches $tag…"
  mkdir -p "$tmp/app" && tar -xzf "$tmp/orches.tar.gz" -C "$tmp/app"
  local exe
  exe="$(find "$tmp/app" -maxdepth 1 -type f -perm -u+x -iname 'orches' | head -n 1)"
  if [ -z "$exe" ]; then rm -rf "$tmp"; say "El binario descargado no trae el ejecutable; se usa el código."; return 1; fi
  rm -rf "$DIR" && mkdir -p "$DIR" "$BIN" "$(dirname "$DESKTOP")"
  mv "$tmp/app" "$DIR/app" && rm -rf "$tmp"
  printf '%s\n' "$tag" > "$DIR/VERSION"
  local icon="$DIR/app/data/flutter_assets/assets/icon.png"
  [ -f "$icon" ] || icon="$(find "$DIR/app" -name 'icon.png' | head -n 1)"
  cat > "$BIN/orches" <<LAUNCHER
#!/usr/bin/env bash
exec "$DIR/app/$(basename "$exe")" "\$@"
LAUNCHER
  chmod +x "$BIN/orches"
  write_desktop "${icon:-}"
  finish
}

write_desktop() {
  cat > "$DESKTOP" <<ENTRY
[Desktop Entry]
Type=Application
Name=Orches
Comment=Panel de agentes de programación
Exec=$BIN/orches
Icon=${1:-utilities-terminal}
Terminal=false
Categories=Development;
ENTRY
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$(dirname "$DESKTOP")" 2>/dev/null || true
}

finish() {
  say "Listo. Ejecuta «orches» o búscalo en el menú de aplicaciones."
  case ":$PATH:" in *":$BIN:"*) ;; *) say "Ojo: $BIN no está en tu PATH; añádelo a tu ~/.bashrc o ~/.zshrc." ;; esac
  exit 0
}

[ "$(uname -s)" = "Linux" ] || fail "este instalador es solo para Linux"
install_binary || { [ "$SOURCE" = 1 ] || say "No hay binario para esta versión: se instala desde el código."; }

# --- desde el código: git + uv -----------------------------------------------------------------------------------
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
printf '%s\n' "$REF" > "$DIR/VERSION"
write_desktop "$DIR/src/assets/icon.png"
finish
