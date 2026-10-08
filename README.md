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
      db/oracle.py           explorador de Oracle (solo lectura): objetos, código, tablas
      db/profiles.py         conexiones guardadas (la contraseña va al llavero, no a la configuración)
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
        files.py  agents.py  git.py  database.py  db_object.py  file_viewer.py  mcp.py  usage.py
      layout/
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

## Edición y atajos

Los archivos de texto se abren ya editables (permiso global «Edición» de la barra de título; con
`Ctrl+Shift+L` se bloquea y pasan a solo lectura). `Ctrl+S` guarda; `F1` muestra todos los atajos
(archivos, paneles y pestañas de la barra lateral con `Ctrl+Shift+…`).

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
