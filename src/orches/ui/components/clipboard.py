from flet import Clipboard

_services = {}


async def copy_text(page, text):
  """Copia `text` al portapapeles del sistema (un solo servicio por ventana)."""
  service = _services.get(id(page))
  if service is None:
    service = _services[id(page)] = Clipboard()
    page.services.append(service)
  await service.set(text)
