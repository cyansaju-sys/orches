# Extensiones

Una extensión es un `.zip` que añade cosas a la app: una pestaña en la barra lateral, un botón en la barra de título,
una franja sobre ciertos archivos, resaltado de sintaxis o sugerencias de autocompletado. Se instalan desde la pestaña
**Extensiones** (`Ctrl+Shift+Z`) y se cargan al arrancar la app.

![Pestaña Extensiones](img/06-extensiones.png)

> **Seguridad.** El código de una extensión corre con los mismos permisos que la app (archivos, red, procesos).
> Instala solo extensiones que conozcas. Una extensión que falla al cargar se ignora y su error aparece en rojo en la
> lista, sin tumbar la app.

## Instalar, actualizar y quitar

- **Desde un `.zip`:** «Añadir extensión (.zip)» abre un explorador que solo muestra carpetas y `.zip`.
- **Desde el catálogo en línea:** «Disponibles en línea» → ↻ lee los `.zip` de
  [`dist/extensions/`](https://github.com/cyansaju-sys/orches/tree/master/dist/extensions) en GitHub y los instala con
  un clic. Solo acepta `https` y archivos de hasta 20 MB.
- **Actualizaciones:** la app compara el hash de cada `.zip` del catálogo con el que instaló. Si cambió, la tarjeta
  muestra **Actualizar** y un globo amarillo con el número aparece sobre el ícono de Extensiones (se revisa al arrancar).
  Las que se instalaron desde un `.zip` local cuentan como desactualizadas la primera vez.
- **Quitar:** la papelera de la tarjeta. Las que vienen con la app no se reinstalan solas después de quitarlas.
- Tras instalar, actualizar o quitar hay que **reiniciar la app**: las extensiones se cargan al arrancar.

Se guardan en `~/.config/orches/extensions/<id>/` (en Windows, `%APPDATA%\orches\extensions\`).

## Estructura de un `.zip`

En la raíz del `.zip` (no dentro de una carpeta):

```
extension.json     manifiesto
main.py            define activate(api)
icon.svg           ícono (opcional; .png también sirve)
...                los demás archivos que necesite (se pueden importar con "from . import x")
```

`extension.json`:

| Campo | Obligatorio | Qué es |
|---|---|---|
| `id` | sí | Nombre único: letras, números y `_` (es el nombre de la carpeta instalada) |
| `name` | no | Nombre que se muestra (por defecto, el `id`) |
| `version` | no | Cambia la versión cuando cambies el código: así la app sabe que debe reinstalar las que vienen incluidas |
| `description` | no | Una frase para la tarjeta |
| `icon` | no | Ruta del ícono dentro del `.zip`. Sin ícono, su pestaña y su botón usan el ícono genérico de extensión |
| `main` | no | Archivo con `activate(api)`; por defecto `main.py` |
| `shortcut` | no | Una letra: la pestaña se abre con `Ctrl+Shift+<letra>` |
| `bundled` | no | `true` = `tools/build_extensions.py` la deja en `src/assets/extensions/` y la app la instala sola; si no, en `dist/extensions/` |

## API

`activate(api)` se llama una vez al arrancar. `api` ofrece:

| Método | Qué hace |
|---|---|
| `api.page`, `api.id`, `api.dir` | La ventana de Flet, el id y la carpeta de la extensión |
| `api.add_sidebar_view(build, title=None)` | Pestaña en la barra lateral, con el ícono del `.zip`. `build(page)` devuelve el control; se crea la primera vez que se abre. Si el control tiene un atributo `on_enter`, se llama cada vez que se abre la pestaña |
| `api.add_titlebar_button(label, on_click, tooltip=None)` | Botón en la barra de título, junto a «Terminal», con el ícono de la extensión. `on_click()` no recibe argumentos |
| `api.add_editor_toolbar(suffixes, build)` | Franja sobre los archivos con esas extensiones (`["sql"]`). `build(page, doc)` recibe `doc.path` y `doc.get_text()` (el texto actual del editor, aunque no esté guardado) |
| `api.open_document(title, icon, make, key=None, crumbs=None, path=None)` | Abre una pestaña del editor. `make()` devuelve su contenido; con `key`, si ya está abierta solo se selecciona |
| `api.toast(message, kind=None)` | Aviso breve abajo a la derecha. `kind`: `"ok"`, `"error"` o `"info"` (por defecto se deduce del texto) |
| `api.add_language(name, suffixes, keywords="", types="", line_comments=(), block=(), quotes="'\"", ignore_case=False, rules=(), colors=None, title=None)` | Resaltado de sintaxis. `keywords` y `types` son texto con palabras separadas por espacios. `rules` es una lista de `(tipo, regex)` que se prueban antes que números y palabras (sin grupos con nombre); `colors` da color a los tipos nuevos, por ejemplo `{"tag": "#F07178"}`. Si usas extensiones de archivo que la app ya resaltaba, tu lenguaje reemplaza al de la app mientras la extensión esté instalada |
| `api.add_completions(languages, provide)` | Sugerencias propias para esos lenguajes (los nombres de `add_language`). `provide(text, cursor, path)` devuelve una lista de `orches.core.completion.Suggestion(label, kind, start, detail)`, o `[]` si no aplica donde está el cursor. `start` es dónde empieza el texto que reemplaza |

Los controles son de [Flet](https://flet.dev). Para que se vean como el resto de la app puedes importar
`orches.ui.theme` (colores), `orches.ui.components.clickable` (botones sin foco de teclado) y
`orches.ui.components.modal` (diálogos).

## Ejemplo mínimo

[`docs/ejemplo_extension/`](ejemplo_extension/) es una extensión completa de dos archivos:

```json
{ "id": "hola", "name": "Hola", "version": "1.0.0", "main": "main.py" }
```

```python
from flet import Container, Padding, Text


def activate(api):
  api.add_titlebar_button("Hola", lambda: api.toast("¡Hola desde una extensión!", kind="ok"))

  def banner(page, doc):
    return Container(padding=Padding(left=12, right=12, top=4, bottom=4), bgcolor="#151925",
                     content=Text(f"Archivo de texto: {doc.path.name}", size=11, color="#6B7088"))

  api.add_editor_toolbar(["txt"], banner)
```

Para probarla, comprime esos dos archivos **en la raíz** del `.zip`:

```bash
cd docs/ejemplo_extension && zip ../hola.zip extension.json main.py
```

y añádelo con «Añadir extensión (.zip)». Reinicia la app: aparece un botón **Hola** en la barra de título y, al abrir un
`.txt`, la franja sobre el archivo.

## Las extensiones incluidas

| Extensión | Dónde | Qué usa de la API |
|---|---|---|
| [`oracle_db`](../extensions/oracle_db/) | Viene con la app | `add_sidebar_view`, `add_editor_toolbar` (el ▶ de los `.sql`), `open_document` |
| [`git_graph`](../extensions/git_graph/) | `dist/extensions/` | `add_titlebar_button`, `open_document` |
| [`js_syntax`](../extensions/js_syntax/) | `dist/extensions/` | `add_language`, `add_completions` (sin ícono ni pestaña: solo comportamiento) |

## Empaquetar y publicar

```bash
python tools/build_extensions.py
```

Comprime cada carpeta de `extensions/` (las que tienen `extension.json`) en un `.zip`: las marcadas con
`"bundled": true` en `src/assets/extensions/`, las demás en `dist/extensions/`. Para que una extensión aparezca en el
catálogo en línea, sube su `.zip` a `dist/extensions/` del repositorio. Sube su `version` cada vez que cambies el
código, o las instalaciones que ya la tienen no se enterarán.
