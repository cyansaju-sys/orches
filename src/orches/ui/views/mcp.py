import asyncio
import re
import shlex
from pathlib import Path
from flet import (
  AlertDialog, Container, Column, Row, Text, Icon, Icons, TextField, TextButton, Padding, Checkbox,
  RoundedRectangleBorder, ScrollMode, TextOverflow, FontWeight, MainAxisAlignment,
  CrossAxisAlignment, SnackBar, Clipboard,
)
from orches.core import settings
from orches.core.agents import detect_agents
from orches.core.mcp import (
  GLOBAL, PROJECT, SCOPE_LABELS, SHARED, SUPPORTED, add_server, agents_missing, installed_agents, list_servers,
  remove_server, spec_from_server, validate,
)
from orches.ui.components.clickable import Clickable, IconAction
from orches.ui.components.modal import show_modal
from orches.ui.theme import ACCENT, ACCENT_BG, BORDER_COLOR, border_all

MUTED = "#6B7088"
TEXT = "#E6E8EF"
CARD = "#11141D"
SECRET = re.compile(r"key|token|secret|auth|pass|pwd|credential", re.I)   # valores que se ocultan
REFRESH = 5   # segundos entre lecturas de la configuración de los agentes


def _pairs(text, separators):
  """'Clave: valor' o 'CLAVE=valor' por línea -> dict."""
  result = {}
  for line in (text or "").splitlines():
    line = line.strip()
    for sep in separators:
      if sep in line:
        key, value = line.split(sep, 1)
        if key.strip():
          result[key.strip()] = value.strip()
        break
  return result


def McpView(page):
  """Servidores MCP de cada agente instalado, con + para añadir uno y papelera para quitarlo."""
  body = Column(spacing=2, scroll=ScrollMode.AUTO, expand=True, horizontal_alignment=CrossAxisAlignment.STRETCH)
  body.controls = [Text("Leyendo servidores…", size=11, color=MUTED)]
  state = {"key": None}

  def toast(message):
    page.show_dialog(SnackBar(Text(message)))

  def project():
    value = settings.get("project")
    return value if value and Path(value).is_dir() else None

  # --- lista ------------------------------------------------------------------------------------
  def row(server):
    return Clickable(
      Row(spacing=8, vertical_alignment=CrossAxisAlignment.CENTER, controls=[
        Icon(Icons.CLOUD_OUTLINED if server.kind == "remote" else Icons.TERMINAL, size=16, color=ACCENT),
        Column(spacing=1, expand=True, controls=[
          Text(server.name, size=12, color=TEXT, weight=FontWeight.W_600),
          Text(f"{server.agent_name} · {SCOPE_LABELS[server.scope]} · {server.target}", size=10, color=MUTED,
               no_wrap=True, overflow=TextOverflow.ELLIPSIS),
        ]),
        IconAction(Icons.DELETE_OUTLINE, lambda e, s=server: ask_remove(s), size=16, color=MUTED,
                   hover_color="#FF6B81", hover_bg="#2A1A22", width=26, height=26, tooltip="Quitar"),
      ]),
      lambda e, s=server: open_details(s),     # al pulsar: detalles
      hover_bg=ACCENT_BG, padding=Padding(left=6, right=2, top=3, bottom=3), border_radius=6,
      tooltip="Ver detalles",
    )

  # --- detalles ---------------------------------------------------------------------------------
  clipboard = Clipboard()
  page.services.append(clipboard)

  async def copy(text):
    await clipboard.set(text)
    toast("Copiado")

  def open_details(server):
    cfg = server.config
    view = {"reveal": False}
    body_box = Column(spacing=10, tight=True, scroll=ScrollMode.AUTO)

    def mask(key, value):
      return str(value) if view["reveal"] or not SECRET.search(key) else "•" * min(12, max(4, len(str(value))))

    def field(label, value, copyable=False):
      return Column(spacing=2, controls=[
        Text(label, size=10, color=MUTED),
        Row(spacing=4, vertical_alignment=CrossAxisAlignment.START, controls=[
          Text(value or "—", size=12, color=TEXT, selectable=True, expand=True),
          *([IconAction(Icons.CONTENT_COPY, lambda e, v=value: page.run_task(copy, v), size=14, color=MUTED,
                        hover_color=ACCENT, hover_bg=ACCENT_BG, width=24, height=24, tooltip="Copiar")]
            if copyable and value else []),
        ]),
      ])

    def pairs(label, mapping):
      if not mapping:
        return None
      lines = "\n".join(f"{k}: {mask(k, v)}" for k, v in mapping.items())
      return field(label, lines)

    def render():
      remote = server.kind == "remote"
      secrets = any(SECRET.search(k) for k in {**(cfg.get("headers") or {}), **(cfg.get("env") or {}),
                                                 **(cfg.get("environment") or {})})
      parts = [
        Row(wrap=True, spacing=6, controls=[chip_text(server.agent_name), chip_text(SCOPE_LABELS[server.scope]),
                                            chip_text("Remoto (HTTP)" if remote else "Local (stdio)")]),
        field("URL" if remote else "Comando", server.target, copyable=True),
        pairs("Cabeceras", cfg.get("headers")),
        pairs("Variables de entorno", cfg.get("env") or cfg.get("environment")),
        field("Guardado en", server.source, copyable=True),
        Clickable(Row(spacing=6, controls=[Icon(Icons.VISIBILITY_OUTLINED if not view["reveal"] else Icons.VISIBILITY_OFF_OUTLINED,
                                                size=14, color=MUTED),
                                           Text("Mostrar valores" if not view["reveal"] else "Ocultar valores", size=11, color=MUTED)]),
                  lambda e: toggle(), hover_bg=ACCENT_BG, padding=Padding(left=6, right=8, top=4, bottom=4),
                  border_radius=6) if secrets else None,
      ]
      body_box.controls = [p for p in parts if p is not None]

    def toggle():
      view["reveal"] = not view["reveal"]
      render()
      body_box.update()

    def chip_text(text):
      return Container(content=Text(text, size=10, color=ACCENT), padding=Padding(left=8, right=8, top=3, bottom=3),
                       border_radius=10, border=border_all(color=ACCENT_BG), bgcolor=ACCENT_BG)

    render()

    # el mismo servidor, en los demás agentes instalados que aún no lo tienen
    installed = {a["command"] for a in (state.get("agents") or [])}
    missing = [a for a in agents_missing(server, state.get("servers") or []) if a in installed]

    async def copy_to(agent):
      scope = PROJECT if server.scope == SHARED else server.scope
      ok, message = await asyncio.to_thread(add_server, agent, spec_from_server(server), scope, project())
      toast(f"«{server.name}» añadido a {SUPPORTED[agent]}" if ok
            else "No se pudo añadir: " + (message.splitlines()[0] if message else "error"))
      await refresh()

    copy_buttons = [TextButton(f"Añadir a {SUPPORTED[a]}", icon=Icons.ADD,
                               on_click=lambda e, a=a: (close(), page.run_task(copy_to, a))) for a in missing]
    close = show_modal(page, AlertDialog(
      modal=False, bgcolor=CARD, shape=RoundedRectangleBorder(radius=10),
      title=Row(spacing=8, controls=[Icon(Icons.CLOUD_OUTLINED if server.kind == "remote" else Icons.TERMINAL,
                                          size=18, color=ACCENT), Text(server.name, size=15)]),
      content=Container(width=440, content=body_box),
      actions=[*copy_buttons, TextButton("Quitar", on_click=lambda e: (close(), ask_remove(server))),
               TextButton("Cerrar", on_click=lambda e: close())],
    ))

  def build(servers, agents):
    header = Row(alignment=MainAxisAlignment.SPACE_BETWEEN, vertical_alignment=CrossAxisAlignment.CENTER, controls=[
      Text("SERVIDORES MCP", size=11, weight=FontWeight.W_600, color=MUTED),
      IconAction(Icons.ADD, lambda e: open_add(), size=18, color=ACCENT, hover_bg=ACCENT_BG, width=28, height=28,
                 tooltip="Añadir servidor MCP"),
    ])
    controls = [Container(content=header, padding=Padding(left=6, right=2, bottom=4))]
    if not agents:
      controls.append(Text("Ninguno de tus agentes instalados admite MCP desde aquí", size=11, color=MUTED))
    elif not servers:
      controls.append(Text("Sin servidores. Pulsa + para añadir uno a tus agentes.", size=11, color=MUTED))
    controls += [row(s) for s in servers]
    body.controls = controls

  async def refresh():
    proj = project()
    servers, agents = await asyncio.to_thread(lambda: (list_servers(proj), installed_agents(detect_agents())))
    key = (proj, tuple(servers), tuple(a["command"] for a in agents))
    if key != state["key"]:
      state["key"] = key
      state["agents"] = agents
      state["servers"] = servers
      build(servers, agents)
      try:
        body.update()
      except RuntimeError:
        state["key"] = None

  async def loop():
    while True:
      await refresh()
      await asyncio.sleep(REFRESH)

  # --- quitar -----------------------------------------------------------------------------------
  def ask_remove(server):
    async def confirm(e):
      close()
      ok, message = await asyncio.to_thread(remove_server, server, project())
      toast("Servidor quitado" if ok else "No se pudo quitar: " + (message.splitlines()[0] if message else ""))
      await refresh()

    close = show_modal(page, AlertDialog(
      modal=False, bgcolor=CARD, shape=RoundedRectangleBorder(radius=10),
      title=Text("¿Quitar este servidor?", size=14),
      content=Text(f"«{server.name}» dejará de estar disponible en {server.agent_name} "
                   f"({SCOPE_LABELS[server.scope].lower()}).", size=12, color=MUTED),
      actions=[TextButton("Cancelar", on_click=lambda e: close()), TextButton("Quitar", on_click=confirm)],
    ))

  # --- añadir -----------------------------------------------------------------------------------
  def open_add():
    agents = state.get("agents") or installed_agents(detect_agents())
    if not agents:
      toast("No hay agentes con soporte de MCP instalados")
      return
    form = {"kind": "remote", "scope": PROJECT if project() else GLOBAL}

    def style(field):
      field.dense = True
      field.text_size = 12
      field.cursor_color = ACCENT
      field.border_color = BORDER_COLOR
      field.focused_border_color = ACCENT
      return field

    name = style(TextField(label="Nombre", hint_text="p. ej. github", autofocus=True))
    url = style(TextField(label="URL del servidor", hint_text="https://…/mcp"))
    headers = style(TextField(label="Cabeceras (una por línea: Clave: valor)", multiline=True, min_lines=1, max_lines=3))
    command = style(TextField(label="Comando y argumentos", hint_text="npx -y @modelcontextprotocol/server-filesystem ."))
    env = style(TextField(label="Variables de entorno (una por línea: CLAVE=valor)", multiline=True, min_lines=1, max_lines=3))
    error = Text("", size=11, color="#FF6B81")
    checks = [Checkbox(label=a["name"], value=True, data=a["command"]) for a in agents]

    remote_fields = Column(spacing=8, controls=[url, headers])
    local_fields = Column(spacing=8, controls=[command, env], visible=False)

    def chip(label, group, value):
      box = Clickable(Text(label, size=12), lambda e: pick(group, value), hover_bg=ACCENT_BG,
                      padding=Padding(left=12, right=12, top=6, bottom=6), border_radius=6)
      box.data = (group, value)
      return box

    chips = [chip("Remoto (URL)", "kind", "remote"), chip("Local (comando)", "kind", "local"),
             *([chip("Este proyecto", "scope", PROJECT)] if project() else []), chip("Todos los proyectos", "scope", GLOBAL)]

    def paint():
      for c in chips:
        group, value = c.data
        active = form[group] == value
        c.content.bgcolor = ACCENT_BG if active else None
        c.content.border = border_all(color=ACCENT if active else BORDER_COLOR)
        c.content.content.color = ACCENT if active else MUTED
      remote_fields.visible = form["kind"] == "remote"
      local_fields.visible = form["kind"] == "local"

    def pick(group, value):
      form[group] = value
      paint()
      for part in (*chips, remote_fields, local_fields):
        part.update()

    paint()

    def add(e=None):
      targets = [c.data for c in checks if c.value]
      spec = {"name": (name.value or "").strip(), "kind": form["kind"], "url": (url.value or "").strip(),
              "headers": _pairs(headers.value, (": ", "=")), "env": _pairs(env.value, ("=",))}
      if form["kind"] == "local":
        try:
          parts = shlex.split(command.value or "")
        except ValueError:
          parts = []
        spec["command"], spec["args"] = (parts[0], parts[1:]) if parts else ("", [])
      message = validate(spec) or ("Elige al menos un agente" if not targets else None)
      if message:
        error.value = message
        error.update()
        return
      close()
      page.run_task(run_add, spec, targets, form["scope"])

    close = show_modal(page, AlertDialog(
      modal=False, bgcolor=CARD, shape=RoundedRectangleBorder(radius=10),
      title=Text("Añadir servidor MCP", size=14),
      content=Container(width=420, content=Column(spacing=10, scroll=ScrollMode.AUTO, tight=True, controls=[
        name,
        Row(spacing=6, wrap=True, controls=chips[:2]),
        remote_fields, local_fields,
        Text("Agentes", size=11, color=MUTED), Row(wrap=True, controls=checks),
        Text("Dónde", size=11, color=MUTED), Row(spacing=6, wrap=True, controls=chips[2:]),
        error,
      ])),
      actions=[TextButton("Cancelar", on_click=lambda e: close()), TextButton("Añadir", on_click=add)],
    ))

  async def run_add(spec, targets, scope):
    results = []
    for agent in targets:
      ok, message = await asyncio.to_thread(add_server, agent, spec, scope, project())
      results.append((agent, ok, message))
    failed = [f"{a}: {m.splitlines()[0] if m else 'error'}" for a, ok, m in results if not ok]
    toast(f"«{spec['name']}» añadido" if not failed else "No se pudo añadir: " + "; ".join(failed))
    await refresh()

  page.run_task(loop)
  return body
