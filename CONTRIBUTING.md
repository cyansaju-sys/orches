# Contribuir a Tutti · Contributing

[Español](#español) · [English](#english)

---

## Español

¡Gracias por querer ayudar! Tutti es de código abierto (MIT) y cualquier aporte suma: un error bien descrito, una traducción, una mejora de la documentación o código.

### Antes de empezar

- **Busca primero** en los [issues](https://github.com/cyansaju-sys/tutti/issues): puede que ya exista.
- **Para cambios grandes** (una pantalla nueva, cambiar cómo funciona algo, añadir dependencias) abre un issue y cuéntalo antes de escribir código. Así nadie pierde tiempo en algo que no encaje.
- **Un cambio pequeño y claro** (un arreglo, un texto, una prueba) puede ir directo a un pull request.
- **Vulnerabilidades:** no las publiques en un issue. Escribe en privado a quien mantiene el proyecto (perfil de GitHub) y se corrige antes de contarlo.

### Cómo trabajar

1. Haz un *fork* y crea una rama desde `master` con un nombre que diga lo que hace: `fix/terminal-pegar`, `feat/abrir-archivo-rapido`, `docs/atajos`.
2. Instala y arranca: `yarn install` y `yarn dev` (más en [Desarrollo](https://cyansaju-sys.github.io/tutti/documentacion.html#desarrollo)).
3. Haz el cambio **pequeño y enfocado**: un pull request, un propósito. Sin reformatear archivos que no tocas.
4. Antes de abrir el PR, que pasen las dos comprobaciones:

   ```bash
   yarn typecheck
   yarn test
   ```

### Reglas del código

- **Imita lo que ya hay:** mismo estilo, nombres, nivel de comentarios y forma de organizar. Los comentarios van en español y explican el *porqué*, no el *qué*.
- **Textos de la interfaz:** nunca escritos a mano en el código. Van en `src/shared/locales/es.json` **y** en `en.json`, con la misma clave y las mismas variables `{nombre}`. Si falta una en inglés, no compila. Se usan con `t('clave')` (`useT()` en componentes).
- **Pruebas:** si arreglas un error o añades lógica, añade una prueba en `test/` (vitest). Las pruebas no deben depender del idioma ni de la máquina donde corren.
- **Sin dependencias nuevas** salvo que haya una razón clara; cuéntala en el PR.
- **Privacidad:** la app no envía datos a ningún sitio y no debe empezar a hacerlo. Los accesos a internet que existen están descritos en la [documentación](https://cyansaju-sys.github.io/tutti/documentacion.html#privacidad).
- **Capturas y documentación:** no subas imágenes con rutas, nombres de proyectos o datos personales. Usa `TUTTI_CAPTURE` con el proyecto de ejemplo.

### Commits y pull requests

- **Mensajes de commit** en [Conventional Commits](https://www.conventionalcommits.org): `feat(git): ...`, `fix(terminal): ...`, `docs: ...`, `test: ...`, `chore: ...`. Una línea, en imperativo.
- **Cambios que ve el usuario:** añade una línea en la sección de la versión siguiente de `CHANGELOG.md` **y** de `CHANGELOG.en.md` (frases pensadas para quien usa la app, no para quien programa).
- **Documentación:** el texto de la web está en `scripts/docs-site/content.py` (español e inglés). Edítalo y ejecuta `python3 scripts/docs-site/build.py`; no toques `docs/documentacion.html` a mano.
- En el PR explica **qué cambia y por qué**, y cómo lo probaste. Si cambia algo visible, adjunta una captura.

### Uso de IA

Tutti se ha hecho con ayuda de IA y no hay problema en que tú también la uses. Lo que importa: **entiendes y revisaste lo que envías**, pasa las pruebas y cumple estas reglas. Si una parte importante la escribió una IA, dilo en el PR.

### Trato entre personas

Se aplica el [código de conducta](CODE_OF_CONDUCT.md). En corto: respeto, críticas al código y no a la persona, y paciencia: quien mantiene el proyecto responde cuando puede.

### Licencia

Al contribuir aceptas que tu aporte se publique bajo la licencia [MIT](LICENSE) del proyecto.

---

## English

Thanks for wanting to help! Tutti is open source (MIT) and every contribution counts: a well-described bug, a translation, a documentation fix or code.

### Before you start

- **Search first** in the [issues](https://github.com/cyansaju-sys/tutti/issues): it may already exist.
- **For big changes** (a new screen, changing how something works, adding dependencies) open an issue and discuss it before writing code, so nobody wastes time on something that does not fit.
- **A small, clear change** (a fix, a text, a test) can go straight to a pull request.
- **Vulnerabilities:** do not post them in an issue. Write privately to the maintainer (GitHub profile) and it will be fixed before it is disclosed.

### How to work

1. Fork and create a branch from `master` with a name that says what it does: `fix/terminal-paste`, `feat/quick-open`, `docs/shortcuts`.
2. Install and run: `yarn install` and `yarn dev` (more in [Development](https://cyansaju-sys.github.io/tutti/documentacion.html#desarrollo)).
3. Keep the change **small and focused**: one pull request, one purpose. Do not reformat files you do not touch.
4. Before opening the PR, both checks must pass:

   ```bash
   yarn typecheck
   yarn test
   ```

### Code rules

- **Match what is there:** same style, names, comment level and structure. Comments are written in Spanish and explain the *why*, not the *what*.
- **Interface texts:** never hard-coded. They go in `src/shared/locales/es.json` **and** `en.json`, with the same key and the same `{name}` variables. A key missing in English does not compile. Use them with `t('key')` (`useT()` in components).
- **Tests:** if you fix a bug or add logic, add a test in `test/` (vitest). Tests must not depend on the language or the machine they run on.
- **No new dependencies** unless there is a clear reason; explain it in the PR.
- **Privacy:** the app sends no data anywhere and must not start to. The existing network accesses are described in the [documentation](https://cyansaju-sys.github.io/tutti/documentacion.html#privacidad).
- **Screenshots and docs:** do not upload images with paths, project names or personal data. Use `TUTTI_CAPTURE` with the sample project.

### Commits and pull requests

- **Commit messages** in [Conventional Commits](https://www.conventionalcommits.org): `feat(git): ...`, `fix(terminal): ...`, `docs: ...`, `test: ...`, `chore: ...`. One line, imperative.
- **User-visible changes:** add a line to the next version's section of `CHANGELOG.md` **and** `CHANGELOG.en.md` (sentences written for people who use the app, not for developers).
- **Documentation:** the website text lives in `scripts/docs-site/content.py` (Spanish and English). Edit it and run `python3 scripts/docs-site/build.py`; do not edit `docs/documentacion.html` by hand.
- In the PR explain **what changes and why**, and how you tested it. If something visible changes, attach a screenshot.

### Using AI

Tutti was built with the help of AI and you are welcome to use it too. What matters: **you understand and reviewed what you submit**, it passes the tests and follows these rules. If a significant part was written by an AI, say so in the PR.

### Treating each other well

The [code of conduct](CODE_OF_CONDUCT.md) applies. In short: respect, criticize the code and not the person, and be patient: the maintainer answers when possible.

### License

By contributing you agree that your work is published under the project's [MIT](LICENSE) license.
