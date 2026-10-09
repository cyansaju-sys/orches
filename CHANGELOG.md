# Novedades

Cada versión lleva su sección `## x.y.z` con frases pensadas para quien usa la app. Orches las muestra una vez, la primera vez que se abre tras actualizar.

## 1.0.5

- **Varias terminales:** el panel de terminal ahora admite varias a la vez, con barra de acciones (nueva, maximizar, cerrar) y una lista al costado. El chip «Terminal» de la barra de título abre un menú.
- **Modelos de cada agente:** al repartir tareas, los agentes ven los modelos que ofrece cada uno (Claude, OpenCode, Antigravity y otros) y pueden pedir uno concreto con `model`.
- **Tareas delegadas:** nuevo apartado en Agentes con a quién se delegó cada tarea, su estado, modelo y duración.
- **Aviso al líder:** cuando un agente termina una tarea, el líder recibe un mensaje `[Orches]` y no tiene que quedarse esperando.
- **Entrega fiable de tareas:** si un agente (por ejemplo Antigravity) abre sin recibir la tarea, la app la reenvía.
- **Borrar historial de IA:** botón para borrar las sesiones del proyecto, ahora también las de Antigravity.

## 1.0.4

- **Contexto del proyecto:** nuevo apartado en la barra lateral (Ctrl+Shift+K). Lo que escribas ahí lo leen los agentes que abras en ese proyecto (Claude Code y OpenCode). Se guarda fuera del repositorio.
- **Generar con IA:** un botón redacta el contexto a partir de un resumen pequeño del proyecto, con muy pocos tokens. Si cambias de apartado mientras tanto, se cancela.
- **Proyectos recientes:** cuando no hay agentes abiertos verás el historial de proyectos para volver a ellos con un clic, abrir otro o quitar uno con la X.
- **Barra lateral plegable:** al ocultarla quedan solo los iconos; doble clic en un icono la oculta o la muestra.
- **Archivos sin agentes:** si no hay ningún agente, el archivo que abras ocupa todo el espacio.
- **Versión a la vista:** el número de versión aparece junto al nombre de la app.
- **Diálogos centrados** en la ventana.
