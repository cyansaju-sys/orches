/** Buscar y reemplazar dentro del archivo: un cuadro flotante arriba a la derecha, como el de VS Code, sobre el motor de CodeMirror. */
import { closeSearchPanel, findNext, findPrevious, getSearchQuery, openSearchPanel, replaceAll, replaceNext, search, SearchQuery, setSearchQuery } from '@codemirror/search'
import { t } from '@/lib/i18n'
import { EditorState, StateEffect, type Extension } from '@codemirror/state'
import { EditorView, runScopeHandlers, type Panel, type ViewUpdate } from '@codemirror/view'

const MAX_COUNT = 1000
const showReplace = StateEffect.define<boolean>()

/** Ctrl+F / Ctrl+H: abre el cuadro (con o sin la fila de reemplazo) o, si ya está abierto, solo le da el foco. */
export function openFind(view: EditorView, replace: boolean): boolean {
  openSearchPanel(view)
  view.dispatch({ effects: showReplace.of(replace) })
  return true
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = '', title = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  e.className = cls
  if (text) e.textContent = text
  if (title) e.title = title
  return e
}

function count(state: EditorState, q: SearchQuery): { index: number; total: number } {
  const sel = state.selection.main
  let total = 0
  let index = 0
  for (const cur = q.getCursor(state); ;) {
    const r = cur.next()
    if (r.done) break
    total++
    if (!index && r.value.from === sel.from && r.value.to === sel.to) index = total
    if (total >= MAX_COUNT) break
  }
  return { index, total }
}

function createPanel(view: EditorView): Panel {
  const dom = el('div', 'tutti-find')
  const toggle = el('button', 'tutti-find-chevron', '›', t('find.showReplace'))
  const rows = el('div', 'tutti-find-rows')

  const findRow = el('div', 'tutti-find-row')
  const findBox = el('div', 'tutti-find-box')
  const find = el('input', 'tutti-find-input')
  find.placeholder = t('find.find'); find.spellcheck = false; find.setAttribute('main-field', 'true')
  const mkOpt = (label: string, title: string): HTMLButtonElement => el('button', 'tutti-find-opt', label, title)
  const optCase = mkOpt('Aa', t('find.matchCase'))
  const optWord = mkOpt('ab', t('find.wholeWord'))
  const optRegex = mkOpt('.*', t('find.regex'))
  findBox.append(find, optCase, optWord, optRegex)
  const status = el('span', 'tutti-find-status')
  const prev = el('button', 'tutti-find-btn', '↑', t('find.prev'))
  const next = el('button', 'tutti-find-btn', '↓', t('find.next'))
  const close = el('button', 'tutti-find-btn', '×', t('find.close'))
  findRow.append(findBox, status, prev, next, close)

  const replRow = el('div', 'tutti-find-row')
  const replBox = el('div', 'tutti-find-box')
  const repl = el('input', 'tutti-find-input')
  repl.placeholder = t('find.replaceWith'); repl.spellcheck = false
  replBox.append(repl)
  const one = el('button', 'tutti-find-btn tutti-find-text', t('find.replaceWith'), t('find.replaceOne'))
  const all = el('button', 'tutti-find-btn tutti-find-text', t('find.all'), t('find.replaceAll'))
  replRow.append(replBox, one, all)

  rows.append(findRow, replRow)
  dom.append(toggle, rows)

  let replaceVisible = false
  const render = (state: EditorState): void => {
    const q = getSearchQuery(state)
    if (document.activeElement !== find && find.value !== q.search) find.value = q.search
    if (document.activeElement !== repl && repl.value !== q.replace) repl.value = q.replace
    optCase.classList.toggle('on', q.caseSensitive)
    optWord.classList.toggle('on', q.wholeWord)
    optRegex.classList.toggle('on', q.regexp)
    replRow.style.display = replaceVisible ? '' : 'none'
    toggle.textContent = replaceVisible ? '⌄' : '›'
    toggle.title = replaceVisible ? t('find.hideReplace') : t('find.showReplace')
    const readOnly = state.readOnly
    one.disabled = all.disabled = readOnly
    find.classList.toggle('invalid', !!q.search && !q.valid)
    if (!q.search) status.textContent = ''
    else if (!q.valid) status.textContent = t('find.invalid')
    else {
      const { index, total } = count(state, q)
      status.textContent = !total ? t('find.noResults') : t('find.count', { i: index || '?', total: total >= MAX_COUNT ? `${MAX_COUNT}+` : total })
    }
    status.classList.toggle('none', !!q.search && (!q.valid || status.textContent === t('find.noResults')))
  }

  const commit = (patch: Partial<{ search: string; replace: string; caseSensitive: boolean; wholeWord: boolean; regexp: boolean }>): void => {
    const q = getSearchQuery(view.state)
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({
      search: q.search, replace: q.replace, caseSensitive: q.caseSensitive, wholeWord: q.wholeWord, regexp: q.regexp, literal: q.literal, ...patch
    })) })
  }
  const bind = (b: HTMLElement, fn: () => void): void => { b.addEventListener('mousedown', (e) => e.preventDefault()); b.addEventListener('click', fn) }

  find.addEventListener('input', () => commit({ search: find.value }))
  repl.addEventListener('input', () => commit({ replace: repl.value }))
  bind(optCase, () => commit({ caseSensitive: !getSearchQuery(view.state).caseSensitive }))
  bind(optWord, () => commit({ wholeWord: !getSearchQuery(view.state).wholeWord }))
  bind(optRegex, () => commit({ regexp: !getSearchQuery(view.state).regexp }))
  bind(prev, () => findPrevious(view)); bind(next, () => findNext(view)); bind(one, () => replaceNext(view)); bind(all, () => replaceAll(view))
  bind(close, () => { closeSearchPanel(view); view.focus() })
  bind(toggle, () => { replaceVisible = !replaceVisible; render(view.state); if (replaceVisible) repl.focus() })

  dom.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeSearchPanel(view); view.focus(); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.target === repl) { if (e.ctrlKey && e.altKey) replaceAll(view); else replaceNext(view) }
      else if (e.shiftKey) findPrevious(view)
      else findNext(view)
      return
    }
    if (runScopeHandlers(view, e, 'search-panel')) e.preventDefault()      // Ctrl+G, Ctrl+Shift+L…
  })

  return {
    dom, top: true,
    mount() { render(view.state); find.focus(); find.select() },
    update(u: ViewUpdate) {
      for (const tr of u.transactions) for (const e of tr.effects) if (e.is(showReplace)) { if (e.value) replaceVisible = true; if (e.value) repl.focus(); else find.focus() }
      render(u.state)
    }
  }
}

export const findPanel: Extension = search({ top: true, createPanel })
