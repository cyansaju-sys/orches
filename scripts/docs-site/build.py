"""Genera docs/documentacion.html a partir de content.py (el texto, en español y en inglés).

    python3 scripts/docs-site/build.py
"""
import pathlib, sys
HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from content import SECTIONS, L

# tabla de contenidos agrupada
toc = ''
last = None
for s in SECTIONS:
    if s['group'] and s['group'] != last:
        g_es, g_en = s['group'].split('|')
        toc += f'<div class="toc-group">{L(g_es, g_en)}</div>'
        last = s['group']
    toc += f'<a href="#{s["id"]}" data-id="{s["id"]}">{L(s["es"], s["en"])}</a>'

body = ''
for s in SECTIONS:
    body += f'''
<section id="{s["id"]}">
  <h2>{L(s["es"], s["en"])}</h2>
  <div class="es">{s["be"]}</div>
  <div class="en">{s["bn"]}</div>
</section>'''

html = '''<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Documentación · Tutti</title>
<meta name="description" content="Documentación de Tutti: instalación, editor, agentes, reparto de tareas, MCP, git, atajos, ajustes y desarrollo." />
<link rel="icon" href="icon.png" />
<script>
  (function () {
    var pref = 'system', lang = null
    try { pref = localStorage.getItem('tutti-site-theme') || 'system'; lang = localStorage.getItem('tutti-site-lang') } catch (e) {}
    var dark = pref === 'dark' || (pref !== 'light' && !matchMedia('(prefers-color-scheme: light)').matches)
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    document.documentElement.lang = lang === 'en' || lang === 'es' ? lang : ((navigator.language || 'es').toLowerCase().indexOf('es') === 0 ? 'es' : 'en')
  })()
</script>
<style>
  :root {
    --bg: #090b11; --bg2: #0d0f16; --panel: #11141d; --raised: #151925; --line: #2a2f3d;
    --text: #e6e8ef; --muted: #8a90a6; --accent: #8fa6c4; --accent-2: #b4c6e0; --glow: rgba(143, 166, 196, .22);
    --hair: rgba(255, 255, 255, .06); --header-bg: rgba(9, 11, 17, .78); --on-accent: #0b0e15; --shadow: rgba(0, 0, 0, .8);
    --code-bg: #0d0f16; --warn: #e2c08d; --warn-bg: rgba(226, 192, 141, .10);
    color-scheme: dark;
  }
  :root[data-theme="light"] {
    --bg: #dfe3ea; --bg2: #e9ebf1; --panel: #f1f2f6; --raised: #f6f7fa; --line: #c8cdd9;
    --text: #272c3b; --muted: #5b6277; --accent: #3f628f; --accent-2: #2f4f78; --glow: rgba(63, 98, 143, .20);
    --hair: rgba(0, 0, 0, .08); --header-bg: rgba(223, 227, 234, .82); --on-accent: #f6f7fa; --shadow: rgba(40, 50, 75, .35);
    --code-bg: #e9ebf1; --warn: #8f5f00; --warn-bg: rgba(143, 95, 0, .09);
    color-scheme: light;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; scroll-padding-top: 84px; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.7 Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
  a { color: var(--accent-2); text-decoration: none; } a:hover { text-decoration: underline; }
  img { max-width: 100%; height: auto; display: block; border-radius: 10px; border: 1px solid var(--line); margin: 18px 0; box-shadow: 0 20px 50px -28px var(--shadow); }
  .wrap { width: min(1240px, calc(100% - 40px)); margin: 0 auto; }
  html[lang="es"] .en, html[lang="en"] .es { display: none !important; }

  header { position: sticky; top: 0; z-index: 30; backdrop-filter: blur(14px); background: var(--header-bg); border-bottom: 1px solid var(--hair); }
  .bar { display: flex; align-items: center; justify-content: space-between; height: 62px; gap: 16px; }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 650; font-size: 18px; color: var(--text); }
  .brand img { width: 28px; height: 28px; margin: 0; border: 0; border-radius: 0; box-shadow: none; }
  .brand small { color: var(--muted); font-weight: 500; font-size: 14px; }
  nav { display: flex; align-items: center; gap: 20px; font-size: 14px; color: var(--muted); }
  nav a { color: var(--muted); } nav a:hover { color: var(--text); text-decoration: none; }
  .star { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line); border-radius: 999px; padding: 4px 12px 4px 10px; color: var(--text); font-size: 13px; font-weight: 600; background: var(--raised); }
  .star:hover { border-color: var(--accent); text-decoration: none; color: var(--text); }
  .star svg { width: 14px; height: 14px; color: #e2b93b; }
  [data-stars]:empty { display: none; }
  [data-stars]:not(:empty)::before { content: "·"; margin-right: 6px; color: var(--muted); }
  .seg, .lang { display: inline-flex; border: 1px solid var(--line); border-radius: 999px; padding: 2px; }
  .seg button { background: none; border: 0; color: var(--muted); width: 28px; height: 24px; display: grid; place-items: center; border-radius: 999px; cursor: pointer; }
  .seg button svg { width: 15px; height: 15px; }
  .lang button { background: none; border: 0; color: var(--muted); font: inherit; font-size: 12px; font-weight: 600; padding: 4px 11px; border-radius: 999px; cursor: pointer; }
  .seg button[aria-pressed="true"], .lang button[aria-pressed="true"] { background: var(--raised); color: var(--text); }
  @media (max-width: 700px) { nav a.hide-sm { display: none; } }

  .layout { display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: 56px; padding-top: 40px; }
  aside { position: sticky; top: 84px; align-self: start; max-height: calc(100vh - 100px); overflow-y: auto; padding-right: 6px; font-size: 14px; }
  .toc-group { margin: 18px 0 6px; color: var(--accent); font-size: 11px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
  .toc-group:first-child { margin-top: 0; }
  aside a { display: block; padding: 5px 12px; border-left: 2px solid var(--line); color: var(--muted); }
  aside a:hover { color: var(--text); text-decoration: none; }
  aside a.on { color: var(--text); border-left-color: var(--accent); background: linear-gradient(90deg, var(--glow), transparent); font-weight: 600; }
  .toc-toggle { display: none; }
  @media (max-width: 920px) {
    .layout { grid-template-columns: 1fr; gap: 0; }
    aside { position: static; max-height: none; margin-bottom: 24px; }
    .toc-toggle { display: block; width: 100%; padding: 10px 14px; border: 1px solid var(--line); background: var(--raised); color: var(--text); border-radius: 10px; font: inherit; cursor: pointer; text-align: left; }
    aside .toc { display: none; margin-top: 10px; } aside.open .toc { display: block; }
  }

  main { min-width: 0; padding-bottom: 80px; }
  .hero h1 { font-size: clamp(32px, 5vw, 46px); line-height: 1.1; letter-spacing: -.025em; margin: 0 0 10px; }
  .hero p { color: var(--muted); font-size: 18px; margin: 0 0 8px; max-width: 680px; }
  section { padding-top: 46px; border-top: 1px solid var(--hair); margin-top: 46px; }
  main > section:first-of-type { border-top: 0; margin-top: 8px; }
  h2 { font-size: 30px; line-height: 1.2; letter-spacing: -.02em; margin: 0 0 14px; }
  h3 { font-size: 19px; margin: 30px 0 8px; letter-spacing: -.01em; }
  p, li, dd { color: var(--text); } p { margin: 12px 0; }
  ul, ol { padding-left: 22px; } li { margin: 6px 0; } li::marker { color: var(--accent); }
  code { font: .88em "DejaVu Sans Mono", ui-monospace, Menlo, Consolas, monospace; background: var(--code-bg); border: 1px solid var(--hair); padding: 1px 6px; border-radius: 6px; color: var(--accent-2); }
  pre { position: relative; background: var(--code-bg); border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; overflow-x: auto; margin: 16px 0; }
  pre code { background: none; border: 0; padding: 0; font-size: 13px; line-height: 1.65; color: var(--text); white-space: pre; }
  .copy { position: absolute; top: 8px; right: 8px; border: 1px solid var(--line); background: var(--raised); color: var(--muted); font: inherit; font-size: 12px; padding: 3px 10px; border-radius: 7px; cursor: pointer; opacity: 0; transition: opacity .15s; }
  pre:hover .copy, .copy:focus { opacity: 1; } .copy:hover { color: var(--text); }
  kbd { font: 12px "DejaVu Sans Mono", ui-monospace, monospace; background: var(--raised); border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 6px; padding: 1px 7px; color: var(--accent-2); white-space: nowrap; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 15px; }
  .tw { overflow-x: auto; margin: 16px 0; } .tw table { margin: 0; min-width: 520px; }
  th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--hair); vertical-align: top; }
  th { color: var(--muted); font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; background: var(--panel); position: sticky; top: 0; }
  tr:hover td { background: var(--glow); }
  .note { border: 1px solid var(--line); background: var(--panel); border-left: 3px solid var(--accent); border-radius: 10px; padding: 12px 16px; margin: 16px 0; font-size: 15px; }
  .note.warn { border-left-color: var(--warn); background: var(--warn-bg); }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; } .grid2 img { margin: 18px 0 0; }
  @media (max-width: 640px) { .grid2 { grid-template-columns: 1fr; } }
  dl { margin: 0; } dt { font-weight: 650; margin-top: 22px; } dd { margin: 4px 0 0; color: var(--muted); }
  dd code { color: var(--accent-2); }
  footer { border-top: 1px solid var(--hair); padding: 28px 0 44px; color: var(--muted); font-size: 14px; }
  footer .in { display: flex; flex-wrap: wrap; gap: 12px 26px; justify-content: space-between; }
  .top { position: fixed; right: 22px; bottom: 22px; width: 42px; height: 42px; border-radius: 50%; border: 1px solid var(--line); background: var(--raised); color: var(--text); cursor: pointer; display: none; place-items: center; box-shadow: 0 10px 30px -10px var(--shadow); }
  .top.show { display: grid; }
</style>
</head>
<body>
<header>
  <div class="wrap bar">
    <a class="brand" href="index.html"><img src="icon.png" alt="" />Tutti <small>· <span class="es">Documentación</span><span class="en">Docs</span></small></a>
    <nav>
      <a class="hide-sm" href="index.html"><span class="es">Inicio</span><span class="en">Home</span></a>
      <a class="hide-sm" href="index.html#instalar"><span class="es">Descargar</span><span class="en">Download</span></a>
      <a class="star" href="https://github.com/cyansaju-sys/tutti" target="_blank" rel="noopener" title="Star on GitHub"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.9 6.2 6.8.8-5 4.7 1.3 6.7L12 17.5l-6 3.4 1.3-6.7-5-4.7 6.8-.8z"/></svg><span class="es">Estrella</span><span class="en">Star</span><span data-stars></span></a>
      <span class="seg" role="group" aria-label="Tema / Theme">
        <button data-theme-pref="system" title="Auto"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg></button>
        <button data-theme-pref="dark" title="Dark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg></button>
        <button data-theme-pref="light" title="Light"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg></button>
      </span>
      <span class="lang" role="group" aria-label="Idioma / Language"><button data-lang="es">ES</button><button data-lang="en">EN</button></span>
    </nav>
  </div>
</header>

<div class="wrap layout">
  <aside id="aside">
    <button class="toc-toggle" id="toc-toggle"><span class="es">Contenido ▾</span><span class="en">Contents ▾</span></button>
    <div class="toc">__TOC__</div>
  </aside>
  <main>
    <div class="hero">
      <h1><span class="es">Documentación</span><span class="en">Documentation</span></h1>
      <p><span class="es">Todo lo que Tutti hace y cómo sacarle partido: desde instalarlo hasta publicar una release.</span><span class="en">Everything Tutti does and how to get the most out of it: from installing it to publishing a release.</span></p>
    </div>
__BODY__
  </main>
</div>

<footer>
  <div class="wrap in">
    <span>Tutti · MIT · <span class="es">Hecho con la ayuda de <a href="https://claude.com/claude-code" target="_blank" rel="noopener">Claude</a> (Anthropic)</span><span class="en">Built with the help of <a href="https://claude.com/claude-code" target="_blank" rel="noopener">Claude</a> (Anthropic)</span></span>
    <span><a href="index.html"><span class="es">Volver al inicio</span><span class="en">Back to home</span></a> · <a href="https://github.com/cyansaju-sys/tutti/blob/master/CHANGELOG.md" target="_blank" rel="noopener"><span class="es">Novedades</span><span class="en">Changelog</span></a> · <a href="#contribuir"><span class="es">Contribuir</span><span class="en">Contribute</span></a> · <a href="https://github.com/cyansaju-sys/tutti/issues" target="_blank" rel="noopener"><span class="es">Reportar un problema</span><span class="en">Report an issue</span></a></span>
  </div>
</footer>
<button class="top" id="top" title="↑" aria-label="Top">↑</button>

<script>
const media = matchMedia('(prefers-color-scheme: light)')
let themePref = 'system'
try { themePref = localStorage.getItem('tutti-site-theme') || 'system' } catch {}
function applyTheme(pref) {
  themePref = pref
  document.documentElement.dataset.theme = pref === 'light' || (pref === 'system' && media.matches) ? 'light' : 'dark'
  document.querySelectorAll('[data-theme-pref]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themePref === pref)))
  try { localStorage.setItem('tutti-site-theme', pref) } catch {}
}
document.querySelectorAll('[data-theme-pref]').forEach((b) => b.addEventListener('click', () => applyTheme(b.dataset.themePref)))
media.addEventListener('change', () => { if (themePref === 'system') applyTheme('system') })
applyTheme(themePref)

function applyLang(l) {
  document.documentElement.lang = l
  document.querySelectorAll('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === l)))
  const names = l === 'es' ? { system: 'Automático', dark: 'Oscuro', light: 'Claro' } : { system: 'Auto', dark: 'Dark', light: 'Light' }
  document.querySelectorAll('[data-theme-pref]').forEach((b) => { b.title = names[b.dataset.themePref] })
  document.title = l === 'es' ? 'Documentación · Tutti' : 'Documentation · Tutti'
  try { localStorage.setItem('tutti-site-lang', l) } catch {}
}
applyLang(document.documentElement.lang)
document.querySelectorAll('.lang button').forEach((b) => b.addEventListener('click', () => applyLang(b.dataset.lang)))

// las tablas se envuelven para poder desplazarlas en pantallas estrechas
document.querySelectorAll('main table').forEach((t) => { const w = document.createElement('div'); w.className = 'tw'; t.replaceWith(w); w.appendChild(t) })

// botón de copiar en los bloques de código
document.querySelectorAll('pre').forEach((pre) => {
  const b = document.createElement('button'); b.className = 'copy'; b.textContent = 'Copy'
  b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(pre.innerText.replace(/\\nCopy$/, '')) } catch { return } b.textContent = '✓'; setTimeout(() => { b.textContent = 'Copy' }, 1400) })
  pre.appendChild(b)
})

// resalta en el índice la sección que se está leyendo
const links = [...document.querySelectorAll('aside a[data-id]')]
const spy = new IntersectionObserver((entries) => {
  entries.forEach((e) => { if (e.isIntersecting) { links.forEach((a) => a.classList.toggle('on', a.dataset.id === e.target.id)) } })
}, { rootMargin: '-90px 0px -70% 0px' })
document.querySelectorAll('main section[id]').forEach((s) => spy.observe(s))


// estrellas de GitHub (se piden una vez por sesión; si falla, el botón queda sin número)
;(async () => {
  let n = null
  try {
    const cached = sessionStorage.getItem('tutti-stars')
    if (cached) n = Number(cached)
    else {
      const r = await fetch('https://api.github.com/repos/cyansaju-sys/tutti')
      if (r.ok) { n = (await r.json()).stargazers_count; sessionStorage.setItem('tutti-stars', String(n)) }
    }
  } catch {}
  if (typeof n === 'number' && n > 0) {      // con 0 estrellas no se muestra el número
    const text = n >= 1000 ? (n / 1000).toFixed(1).replace(/\\.0$/, '') + 'k' : String(n)
    document.querySelectorAll('[data-stars]').forEach((el) => { el.textContent = text })
  }
})()

document.getElementById('toc-toggle').addEventListener('click', () => document.getElementById('aside').classList.toggle('open'))
links.forEach((a) => a.addEventListener('click', () => document.getElementById('aside').classList.remove('open')))
const toTop = document.getElementById('top')
addEventListener('scroll', () => toTop.classList.toggle('show', scrollY > 900), { passive: true })
toTop.addEventListener('click', () => scrollTo({ top: 0 }))
</script>
</body>
</html>
'''
html = html.replace('__TOC__', toc).replace('__BODY__', body)
(HERE.parent.parent / 'docs' / 'documentacion.html').write_text(html, encoding='utf-8')
print(len(html))
