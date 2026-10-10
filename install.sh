#!/usr/bin/env bash
# Instala Tutti en Linux (sin permisos de administrador): descarga el AppImage de la última release y crea el comando
# `tutti` y la entrada del menú de aplicaciones. Después la app se actualiza sola: avisa con un botón «Actualizar».
#
#   curl -fsSL https://github.com/cyansaju-sys/orches/releases/latest/download/install.sh | bash
#   ./install.sh                  instala (o reinstala) la última versión
#   ./install.sh --version 0.2.0  una versión concreta
#   ./install.sh --uninstall      lo quita (tus ajustes en ~/.config/tutti se conservan)
#
# Variables: TUTTI_HOME (dónde se guarda el AppImage), TUTTI_REPO (usuario/repositorio).
set -euo pipefail

REPO="${TUTTI_REPO:-cyansaju-sys/orches}"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
DIR="${TUTTI_HOME:-$DATA/tutti}"
BIN="$HOME/.local/bin"
DESKTOP="$DATA/applications/tutti.desktop"
VERSION=""
UNINSTALL=0

say()  { printf '\033[1;35m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --uninstall) UNINSTALL=1 ;;
    --version) shift; [ $# -gt 0 ] || fail "--version necesita un valor"; VERSION="${1#v}" ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fail "opción desconocida: $1 (usa --help)" ;;
  esac
  shift
done

# Se borra y se reescribe $DIR: solo si está vacía o ya es una instalación de Tutti (la actual o la antigua en Python).
guard_dir() {
  if [ -e "$DIR" ] && [ -n "$(ls -A "$DIR" 2>/dev/null)" ] && [ ! -f "$DIR/VERSION" ] && [ ! -d "$DIR/.git" ] && [ ! -f "$DIR/Tutti.AppImage" ] && [ ! -f "$DIR/Orches.AppImage" ]; then
    fail "$DIR existe y no parece una instalación de Tutti; elige otra con TUTTI_HOME"
  fi
}
update_desktop_db() { command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$(dirname "$DESKTOP")" 2>/dev/null || true; }

guard_dir
# La app se llamaba Orches: se quita su instalación antigua (los ajustes se migran solos al abrir Tutti)
OLD_DIR="$DATA/orches"
remove_legacy() { [ "$DIR" != "$OLD_DIR" ] && [ -f "$OLD_DIR/Orches.AppImage" ] && rm -rf "$OLD_DIR" "$BIN/orches" "$DATA/applications/orches.desktop"; true; }
if [ "$UNINSTALL" = 1 ]; then
  rm -rf "$DIR" "$BIN/tutti" "$DESKTOP"; remove_legacy; update_desktop_db
  say "Tutti quitado. Tus ajustes siguen en ~/.config/tutti (bórralos a mano si quieres)."
  exit 0
fi

[ "$(uname -s)" = "Linux" ] || fail "este instalador es solo para Linux"
[ "$(uname -m)" = "x86_64" ] || fail "por ahora solo hay AppImage para x86_64"
command -v curl >/dev/null 2>&1 || fail "falta curl"

# --- qué descargar -----------------------------------------------------------------------------------------------------
if [ -n "${TUTTI_ASSET_URL:-}" ]; then            # solo para pruebas del instalador
  URL="$TUTTI_ASSET_URL"; TAG="${VERSION:-prueba}"; ICON_URL="${TUTTI_ICON_URL:-}"
else
  API="https://api.github.com/repos/$REPO/releases/latest"
  [ -n "$VERSION" ] && API="https://api.github.com/repos/$REPO/releases/tags/v$VERSION"
  JSON="$(curl -fsSL -H 'Accept: application/vnd.github+json' "$API")" || fail "no se encontró esa release en GitHub (${VERSION:-la última})"
  TAG="$(printf '%s' "$JSON" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1)"
  URL="$(printf '%s' "$JSON" | sed -n 's/.*"browser_download_url": *"\([^"]*\.AppImage\)".*/\1/p' | head -n 1)"
  [ -n "$URL" ] || fail "la release $TAG no trae un AppImage"
  ICON_URL="https://raw.githubusercontent.com/$REPO/$TAG/resources/icon.png"
fi

say "Descargando Tutti $TAG…"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
curl -fL --progress-bar "$URL" -o "$TMP/Tutti.AppImage" || fail "no se pudo descargar $URL"
chmod +x "$TMP/Tutti.AppImage"

rm -rf "$DIR"; mkdir -p "$DIR" "$BIN" "$(dirname "$DESKTOP")"
mv "$TMP/Tutti.AppImage" "$DIR/Tutti.AppImage"; remove_legacy       # la app se actualiza reemplazando este mismo archivo
printf '%s\n' "$TAG" > "$DIR/VERSION"
ICON="utilities-terminal"
if [ -n "$ICON_URL" ] && curl -fsSL "$ICON_URL" -o "$DIR/icon.png" 2>/dev/null; then ICON="$DIR/icon.png"; fi

# Un AppImage necesita FUSE 2 para montarse; sin él se ejecuta extrayéndose a una carpeta temporal.
RUN="exec \"$DIR/Tutti.AppImage\" \"\$@\""
LIBS="$(ldconfig -p 2>/dev/null || true)"           # (sin `| grep -q`: con pipefail, grep cierra la tubería y daría un falso «no»)
case "$LIBS" in
  *libfuse.so.2*) ;;
  *) say "No encuentro FUSE 2 (libfuse2 / fuse2): Tutti arrancará un poco más lento. Instálalo para que abra al instante."
     RUN="export APPIMAGE_EXTRACT_AND_RUN=1; $RUN" ;;
esac
printf '#!/usr/bin/env bash\n%s\n' "$RUN" > "$BIN/tutti"; chmod +x "$BIN/tutti"

cat > "$DESKTOP" <<ENTRY
[Desktop Entry]
Type=Application
Name=Tutti
Comment=Panel para trabajar con varios agentes de programación
Exec=$BIN/tutti
Icon=$ICON
Terminal=false
Categories=Development;
StartupWMClass=Tutti
Actions=new-window;

[Desktop Action new-window]
Name=Nueva ventana vacía
Exec=$BIN/tutti --new-window
ENTRY
update_desktop_db

say "Listo. Ejecuta «tutti» o búscalo en el menú de aplicaciones."
case ":$PATH:" in *":$BIN:"*) ;; *) say "Ojo: $BIN no está en tu PATH; añádelo a tu ~/.bashrc o ~/.zshrc." ;; esac
