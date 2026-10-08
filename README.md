# Orches

Panel de escritorio para trabajar con varios agentes de programación a la vez —Claude Code, OpenCode y otros— en terminales
embebidas, con explorador de archivos, editor, git, servidores MCP, consumo de tokens e historial de sesiones. Si hay más de
un agente, cualquiera puede repartir tareas a los demás, y cada sub-agente se abre en su propio panel.

Hecha con Electron, React, TypeScript y Tailwind.

![Archivos y editor](docs/img/archivos-y-editor.png)

## Instalar (Linux)

```bash
curl -fsSL https://github.com/cyansaju-sys/orches/releases/latest/download/install.sh | bash
```

Descarga el AppImage de la última release en `~/.local/share/orches/`, crea el comando `orches` y la entrada del menú de
aplicaciones. No hace falta ser administrador. Si falta `libfuse2` (Arch: `fuse2`) funciona igual, solo que abre más despacio.
Para quitarla: `install.sh --uninstall` (tus ajustes en `~/.config/orches` se conservan).

**Se actualiza sola.** Cuando sale una release nueva aparece un botón **Actualizar a vX.Y.Z** arriba a la derecha. Al pulsarlo
descarga la versión nueva, verifica su hash, reemplaza el AppImage y la app se reinicia para aplicarla.

![Botón de actualización](docs/img/actualizar.png)

Windows y macOS llegarán más adelante. El código de la versión anterior (Python) sigue en la rama `master` y en los tags `v0.1.x`.

## Qué incluye

**Archivos y editor.** Árbol con los íconos de Material Icon Theme y la letra de git en lo que cambió. Los archivos se abren en
pestañas, ya editables, con colores, marcas de git en el margen (verde añadido, azul modificado, rojo borrado), autocompletado
(Enter o Tab aceptan), `Ctrl+S` para guardar y recarga automática si otra herramienta cambia el archivo. El permiso **Edición** de
la barra de título (o `Ctrl+Shift+L`) los deja en solo lectura. Con el árbol enfocado se navega con las flechas.

![JSX y TypeScript con colores](docs/img/sintaxis.png)

**Agentes y terminal.** `Ctrl+Shift+N` abre un agente de los instalados (se buscan en el `PATH`, en el de tu shell de login y en
las carpetas habituales, así que funciona aunque lances la app desde el menú). `Ctrl+Shift+T` abre una shell en el proyecto como
sección aparte. Si un proceso no arranca o termina, un aviso lo explica.

![Elegir agente](docs/img/elegir-agente.png)

**Reparto de tareas.** La app abre un servidor MCP local (solo `127.0.0.1`, con un token distinto en cada ejecución) y conecta a
cada agente a él con las herramientas `list_agents`, `delegate_task`, `wait_agent` y `read_agent_output`. Un agente puede mandar
una tarea a otro abierto o pedir uno nuevo —incluso del mismo tipo—, que sale en su propio panel marcado «sub de …». Elige según el
modelo de cada uno. Se desactiva con `"orchestration": false` en `~/.config/orches/settings.json`.

OpenCode 2.x atiende a todos sus clientes desde un servicio compartido, así que a cada panel se le lanza con `--standalone`: su
configuración (con el id de ese panel) no se mezcla con la de otros OpenCode.

**Servidores MCP.** Lee, añade y quita los servidores de Claude Code y OpenCode (globales, del proyecto y `.mcp.json`) usando la
CLI de cada agente. Los detalles ocultan los secretos hasta que lo pides y un servidor se puede copiar de un agente al otro.

![Servidores MCP](docs/img/mcp.png)

**Consumo e historial.** Tokens de la ventana de 5 h de Claude, de hoy, de 7 días y totales; los porcentajes reales de límite que
da Anthropic (se consultan una vez al abrir la pestaña, con la sesión de Claude Code); el consumo de OpenCode; y el historial del
proyecto, donde puedes retomar, renombrar o borrar una sesión.

**Git.** Cambios del proyecto con preparar, commit y push, y selector de ramas con búsqueda (`Ctrl+Shift+G`).

![Selector de ramas](docs/img/ramas.png)

**Próximamente.** Extensiones, el grafo de git y la base de datos Oracle (eran extensiones en la versión anterior).

## Atajos

`F1` muestra la lista completa dentro de la app.

| Atajo | Acción |
|---|---|
| `Ctrl+S` / `Ctrl+W` | Guardar / cerrar el archivo abierto |
| `Ctrl+Shift+L` | Permitir o bloquear la edición |
| `Ctrl+Shift+N` | Abrir un agente |
| `Ctrl+Shift+T` | Mostrar u ocultar la terminal |
| `Ctrl+Shift+W` | Cerrar el panel activo |
| `Ctrl+AvPág` / `Ctrl+RePág` | Panel siguiente / anterior |
| `Ctrl+Shift+B` | Mostrar u ocultar la barra lateral |
| `Ctrl+Shift+E` · `A` · `G` · `X` · `U` · `Z` | Archivos · Agentes · Git · MCP · Consumo · Extensiones |

## Desarrollo

```bash
npm install          # instala y recompila node-pty y better-sqlite3 para Electron
npm run dev          # con recarga en caliente (la interfaz se actualiza al guardar; main y preload reinician la app)
npm test             # pruebas unitarias (vitest)
npm run typecheck
npm run dist         # empaqueta el AppImage en release/
```

Si tu terminal define `ELECTRON_RUN_AS_NODE` (algunos editores lo hacen), `npm run dev` ya la quita por ti.

```
src/
  main/        proceso principal: ventana, terminales (node-pty), git, servidor MCP, MCP de los agentes, consumo, actualizador
  preload/     el puente seguro hacia la interfaz (window.api)
  renderer/    interfaz en React + Tailwind (componentes, vistas, estado con zustand)
  shared/      tipos compartidos
resources/     ícono de la app
scripts/       dev.mjs
```

Herramientas de depuración, todas por variable de entorno: `ORCHES_MCP_LOG=1` imprime cada petición que reciben los servidores MCP;
`ORCHES_CAPTURE=<carpeta>` abre la app con ajustes aislados, recorre las pantallas y guarda una captura de cada una (así se hicieron las
de este README); `ORCHES_SELFTEST=1` prueba el reparto de tareas de punta a punta con agentes falsos.

## Publicar una release

1. Sube `version` en `package.json` (p. ej. `0.2.1`) y haz commit.
2. `git tag v0.2.1 && git push origin v0.2.1`.

GitHub Actions comprueba que el tag coincide con la versión, pasa tipos y pruebas, empaqueta el AppImage y crea la release con el
AppImage, `latest-linux.yml` (lo que lee el actualizador) e `install.sh`. Las instalaciones existentes ven el botón **Actualizar**
al cabo de unos minutos.

## Datos que lee

Solo lectura: los registros de Claude Code (`~/.claude/projects`), su configuración MCP (`~/.claude.json`) y la base de OpenCode
(`~/.local/share/opencode`). La app solo sale a internet para consultar tus límites en Anthropic (con la sesión de Claude Code) y
para buscar actualizaciones en GitHub.
