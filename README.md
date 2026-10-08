# Orches

Panel de escritorio (Flet) para trabajar con varios agentes de programación a la vez —Claude Code,
OpenCode y otros— en terminales embebidas, con explorador de archivos, git, consumo de tokens e
historial de sesiones. Si hay más de un agente, el primero (el líder) puede repartir tareas a los
demás según su modelo.

## Ejecutar

```bash
uv sync
uv run poe dev            # flet run -r src/main.py  (recarga al guardar)
uv run poe test           # pytest
```

Windows, macOS y Linux. En Windows se usa `pywinpty` (se instala solo); no hace falta `zenity` ni
nada del sistema.

## Estructura

```
src/
  main.py                    punto de entrada: arma la ventana
  assets/                    fuente DejaVu Sans Mono e íconos (Material Icon Theme)
  orches/
    core/                    lógica sin interfaz (se puede probar sola)
      agents.py              detecta qué agentes hay instalados
      pty_session.py         proceso en un pseudo-terminal (pty / ConPTY)
      git.py                 estado, stage, commit y push
      usage.py               tokens, límites de Claude e historial de sesiones
      models.py              modelo de cada agente y su nivel (basic/standard/advanced)
      orchestra.py           servidor MCP local para repartir tareas entre agentes
      mcp.py                 servidores MCP de cada agente: leer, añadir y quitar
      extensions.py          sistema de extensiones (.zip): instalar, cargar y API para las extensiones
      secrets.py             llavero del sistema (keyring)
      files.py, settings.py  utilidades de archivos y configuración del usuario
    ui/
      theme.py               colores
      file_icons.py          ícono según el tipo de archivo
      components/            piezas reutilizables: botones sin foco, diálogos modales, redimensionado
      syntax.py              resaltado de SQL / PL-SQL
      terminal/view.py       terminal embebida (emulación con pyte, scroll, cursor)
      dialogs/               selector de agentes y de carpeta
      views/                 contenido de cada pestaña de la barra lateral
        files.py  agents.py  git.py  file_viewer.py  mcp.py  usage.py
      layout/
        editor_area.py       pestañas de documentos y ruta de navegación
        titlebar.py          barra de título propia
        sidebar.py           barra lateral con las pestañas
        workspace.py         área de terminales, entrada de teclado y reparto de tareas
tests/
  test_core.py               pruebas de la lógica (git, MCP, terminal, formatos)
```

`core` no importa nada de Flet; `ui` depende de `core`, nunca al revés.

## Bases de datos (Oracle)

La pestaña de la base de datos conecta con Oracle y muestra tablas, vistas, funciones,
procedimientos (SPR), paquetes, triggers, secuencias, tipos y sinónimos de cada esquema; al pulsar un
objeto abre su código (o las columnas, restricciones e índices de una tabla) en un panel. Solo lee: únicamente
ejecuta `SELECT` sobre el diccionario de datos.

Necesita dos paquetes opcionales (la app abre sin ellos y avisa con el comando):

```bash
uv add oracledb keyring
```

- `oracledb` conecta en modo *thin* (Python puro, sin Oracle Instant Client; Oracle 12.1 o superior).
- `keyring` guarda la contraseña en el llavero del sistema, solo si el usuario marca «Guardar la contraseña».
  Nunca se escribe en `settings.json`.

## Archivos, edición y atajos

Los archivos se abren como en VS Code: en **pestañas** a la izquierda de los agentes (ancho ajustable
arrastrando el borde), con la ruta de navegación, el código con colores y números de línea, marcas de git en el
margen (verde = añadido, azul = modificado, rojo = borrado) y la letra de git en cada pestaña.

Se abren ya **editables y con colores** (palabras reservadas, cadenas, números, comentarios) y sin barra de
botones: se escribe directamente, con sugerencias de autocompletado (`Ctrl+Espacio`) y `Ctrl+S` para guardar.
Si otra herramienta cambia el archivo y aquí no hay cambios sin guardar, se recarga solo. El permiso global
«Edición» de la barra de título (o `Ctrl+Shift+L`) los deja en solo lectura. `F1` muestra todos los atajos.

*Cómo se colorea mientras escribes:* el texto coloreado va debajo de un cuadro de texto transparente. Los dos usan la
misma fuente, alto de línea y ancho (sin partir líneas), y `ORCHES_OVERLAY_DY` ajusta el desplazamiento vertical si en
algún sistema se desalineara.

## Reparto de tareas entre agentes

La app abre un servidor MCP en `127.0.0.1` (puerto y token aleatorios por ejecución) y conecta a
cada agente a él. El agente líder dispone de `list_agents`, `delegate_task`, `wait_agent` y
`read_agent_output`: puede mandar una tarea a un agente abierto o abrir uno nuevo con la tarea ya
cargada, y elige según el modelo (`models.py` lo clasifica solo). Se desactiva con
`"orchestration": false` en `~/.config/orches/settings.json`.

## Datos que lee

Solo lectura: los registros de Claude Code (`~/.claude/projects`) y la base de OpenCode
(`~/.local/share/opencode`). El porcentaje de uso de Claude se consulta a Anthropic con la sesión de
Claude Code, solo al abrir la pestaña IA.

## Extensiones

Una extensión es un `.zip` con `extension.json` (id, nombre, versión, `icon`, `main`, `shortcut`), un `main.py` con
`activate(api)` y su ícono. Se descomprime en `~/.config/orches/extensions/<id>/` y se carga al arrancar; una
extensión rota se ignora sin tumbar la app. Su código corre con los permisos de la app: instala solo las que conozcas.

Desde `activate(api)` puede:

- `api.add_sidebar_view(build, title)` — pestaña propia en la barra lateral con el ícono del `.zip` (y atajo `Ctrl+Shift+<shortcut>`).
- `api.add_editor_toolbar(["sql"], build)` — franja sobre los archivos de esos tipos; `build(page, doc)` recibe `doc.path` y `doc.get_text()`.
- `api.open_document(...)` — abre una pestaña del editor.

La base de datos Oracle (explorador + botón ▶ en los `.sql`) es ahora la extensión `extensions/oracle_db/`.
`python tools/build_extensions.py` la empaqueta en `src/assets/extensions/oracle_db.zip`, que la app instala sola.
Para quitarla: `extensions.uninstall("oracle_db")` (no se reinstala).
