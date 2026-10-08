"""Servidor MCP local para que el agente líder reparta tareas a los demás agentes de la app.

Escucha solo en 127.0.0.1, con un token aleatorio por ejecución. El líder lo ve como un servidor
MCP más ("orches") con estas herramientas: list_agents, delegate_task, read_agent_output y
wait_agent. La app (`host`) hace el trabajo real: abrir paneles, escribir en sus terminales y
leer su pantalla.
"""
import json
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PROTOCOL = "2025-03-26"

INSTRUCTIONS = """\
Eres el agente líder de una app que ejecuta varios agentes de programación en paralelo, cada uno \
con un modelo distinto. Puedes repartir trabajo con estas herramientas:
- list_agents: agentes abiertos y disponibles, con su modelo y nivel (basic, standard, advanced).
- delegate_task: manda una tarea a otro agente; si no está abierto, la app lo abre con la tarea.
- wait_agent / read_agent_output: espera y lee lo que respondió.
Reparte según la dificultad: tareas fáciles o mecánicas (renombrar, texto, boilerplate, tests \
simples, búsquedas) a agentes de nivel basic o standard; lo difícil (arquitectura, bugs sutiles, \
cambios que tocan muchas partes) hazlo tú o pásalo a uno advanced. Cada tarea debe ser \
autosuficiente: indica archivos, objetivo y criterio de terminado. Evita que dos agentes editen \
los mismos archivos a la vez. Revisa siempre el resultado antes de darlo por bueno."""

TOOLS = [
  {
    "name": "list_agents",
    "description": "Lista los agentes abiertos (con id, modelo, nivel y si están ocupados) y los "
                   "instalados que se pueden abrir.",
    "inputSchema": {"type": "object", "properties": {}},
  },
  {
    "name": "delegate_task",
    "description": "Envía una tarea a otro agente. `agent` es el id de un agente abierto (p. ej. "
                   "\"a2\") o el nombre de un agente instalado (p. ej. \"opencode\"): si no hay uno "
                   "libre, la app abre uno nuevo con la tarea ya cargada. Elige según la dificultad: "
                   "fácil → nivel basic/standard, difícil → advanced.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "agent": {"type": "string", "description": "Id de un agente abierto o nombre de uno instalado."},
        "task": {"type": "string", "description": "Instrucción completa y autosuficiente."},
        "new_instance": {"type": "boolean", "description": "Abrir uno nuevo aunque ya haya uno libre."},
      },
      "required": ["agent", "task"],
    },
  },
  {
    "name": "wait_agent",
    "description": "Espera a que un agente termine (sin salida durante `quiet_seconds`) y devuelve "
                   "las últimas líneas de su pantalla.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "agent_id": {"type": "string"},
        "timeout_seconds": {"type": "integer", "description": "Máximo a esperar (por defecto 120)."},
        "quiet_seconds": {"type": "integer", "description": "Silencio que cuenta como terminado (5)."},
      },
      "required": ["agent_id"],
    },
  },
  {
    "name": "read_agent_output",
    "description": "Lee las últimas líneas de la pantalla de un agente y dice si sigue ocupado.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "agent_id": {"type": "string"},
        "lines": {"type": "integer", "description": "Cuántas líneas (por defecto 80)."},
      },
      "required": ["agent_id"],
    },
  },
]


def _text(value, error=False):
  body = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=1)
  return {"content": [{"type": "text", "text": body}], "isError": error}


class Orchestra:
  def __init__(self, host):
    self.host = host
    self.token = secrets.token_urlsafe(24)
    self.port = 0
    self._server = None

  # --- ciclo de vida ------------------------------------------------------------------------
  def start(self):
    orchestra = self

    class Handler(BaseHTTPRequestHandler):
      protocol_version = "HTTP/1.1"

      def log_message(self, *args):   # sin ruido en la terminal
        pass

      def _send(self, code, payload=None):
        body = b"" if payload is None else json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

      def _authorized(self):
        return self.headers.get("Authorization") == f"Bearer {orchestra.token}"

      def do_POST(self):
        if not self._authorized():
          return self._send(401, {"error": "unauthorized"})
        caller = self.path.rstrip("/").split("/")[-1]
        try:
          data = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        except ValueError:
          return self._send(400, {"error": "invalid json"})
        batch = data if isinstance(data, list) else [data]
        replies = [r for r in (orchestra.handle(m, caller) for m in batch) if r is not None]
        if not replies:
          return self._send(202)
        self._send(200, replies if isinstance(data, list) else replies[0])

      def do_GET(self):      # no hay canal de eventos del servidor
        self._send(405)

      def do_DELETE(self):
        self._send(200)

    self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    self._server.daemon_threads = True
    self.port = self._server.server_address[1]
    threading.Thread(target=self._server.serve_forever, daemon=True).start()
    return self

  def stop(self):
    if self._server:
      self._server.shutdown()

  def config_for(self, caller_id):
    """Entrada de servidor MCP (formato `mcpServers`) para que un agente se conecte como `caller_id`."""
    return {"type": "http", "url": f"http://127.0.0.1:{self.port}/mcp/{caller_id}",
            "headers": {"Authorization": f"Bearer {self.token}"}}

  # --- JSON-RPC -----------------------------------------------------------------------------
  def handle(self, message, caller):
    method, params, msg_id = message.get("method"), message.get("params") or {}, message.get("id")
    if msg_id is None:           # notificaciones (initialized...): sin respuesta
      return None
    try:
      if method == "initialize":
        result = {
          "protocolVersion": params.get("protocolVersion") or PROTOCOL,
          "capabilities": {"tools": {"listChanged": False}},
          "serverInfo": {"name": "orches", "version": "0.1"},
          "instructions": INSTRUCTIONS,
        }
      elif method == "ping":
        result = {}
      elif method == "tools/list":
        result = {"tools": TOOLS}
      elif method == "tools/call":
        result = self.call(params.get("name"), params.get("arguments") or {}, caller)
      else:
        return {"jsonrpc": "2.0", "id": msg_id, "error": {"code": -32601, "message": f"método desconocido: {method}"}}
    except Exception as e:   # un fallo de una herramienta no debe tumbar el servidor
      result = _text(f"Error interno: {e}", error=True)
    return {"jsonrpc": "2.0", "id": msg_id, "result": result}

  def call(self, name, args, caller):
    host = self.host
    if name == "list_agents":
      return _text(host.list_agents(caller))
    if name == "delegate_task":
      task = (args.get("task") or "").strip()
      if not args.get("agent") or not task:
        return _text("Faltan `agent` y `task`.", error=True)
      ok, info = host.delegate(caller, args["agent"], task, bool(args.get("new_instance")))
      return _text(info, error=not ok)
    if name == "read_agent_output":
      out = host.output(args.get("agent_id", ""), int(args.get("lines") or 80))
      return _text(out, error=out is None) if out else _text("No existe ese agente.", error=True)
    if name == "wait_agent":
      return self.wait(args)
    return _text(f"Herramienta desconocida: {name}", error=True)

  def wait(self, args):
    agent_id = args.get("agent_id", "")
    timeout = min(int(args.get("timeout_seconds") or 120), 600)
    quiet = max(2, int(args.get("quiet_seconds") or 5))
    deadline = time.monotonic() + timeout
    while True:
      out = self.host.output(agent_id, int(args.get("lines") or 80))
      if not out:
        return _text("No existe ese agente.", error=True)
      if out["idle_seconds"] >= quiet:
        out["finished"] = True
        return _text(out)
      if time.monotonic() >= deadline:
        out["finished"] = False
        out["note"] = "Se agotó la espera; el agente sigue trabajando."
        return _text(out)
      time.sleep(0.5)
