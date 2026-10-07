from pathlib import Path


def list_dir(path, show_hidden=False, ignore=()):
  """Contenido de una carpeta: primero las carpetas, luego los archivos, por nombre."""
  try:
    entries = [p for p in Path(path).iterdir() if p.name not in ignore and (show_hidden or not p.name.startswith("."))]
  except OSError:
    return []
  return sorted(entries, key=lambda p: (not p.is_dir(), p.name.lower()))


def list_roots():
  """Unidades de Windows (C:\\, D:\\...); en Linux y macOS, la raíz y los puntos de montaje."""
  import os
  import string
  if os.name == "nt":
    return [Path(f"{d}:\\") for d in string.ascii_uppercase if Path(f"{d}:\\").exists()]
  roots = [Path("/")]
  for base in ("/Volumes", "/media", "/mnt", "/run/media"):
    b = Path(base)
    if b.is_dir():
      roots += [p for p in list_dir(b) if p.is_dir()]
  return roots
