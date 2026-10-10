import { autocompletion, closeBrackets, closeBracketsKeymap, completeAnyWord, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, StateEffect, StateField } from '@codemirror/state'
import { drawSelection, EditorView, gutter, GutterMarker, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { useEffect, useRef } from 'react'
import type { GitMarks } from '@shared/types'
import { languageFor } from '@/lib/languages'
import { findPanel, openFind } from './searchPanel'

/** Mismos colores de sintaxis que la versión anterior. */
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], color: 'var(--syn-keyword)', fontWeight: '600' },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], color: 'var(--syn-type)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syn-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--color-muted)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], color: 'var(--syn-func)' },
  { tag: [t.tagName, t.angleBracket], color: 'var(--syn-tag)' },
  { tag: [t.attributeName], color: 'var(--syn-attr)' },
  { tag: [t.meta, t.annotation], color: 'var(--syn-attr)' },
  { tag: [t.heading], color: 'var(--syn-keyword)', fontWeight: '700' },
  { tag: [t.link, t.url], color: 'var(--syn-func)', textDecoration: 'underline' }
])

const theme = EditorView.theme({
  '&': { color: 'var(--color-text)', backgroundColor: 'var(--color-surface)', fontSize: '12.5px' },
  '.cm-content': { caretColor: 'var(--color-accent)', padding: '4px 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-accent)', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--color-accent-bg) !important' },
  '.cm-activeLine': { backgroundColor: 'var(--ed-line)' },
  '.cm-gutters': { backgroundColor: 'var(--color-surface)', color: 'var(--color-muted)', border: 'none' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--color-text)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 6px', minWidth: '34px' },
  '.cm-matchingBracket': { backgroundColor: 'var(--ed-bracket)', outline: 'none' },
  '.cm-tooltip': { backgroundColor: 'var(--color-panel)', border: '1px solid var(--color-line)', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 12px 32px var(--ed-shadow)' },
  '.cm-tooltip-autocomplete ul': { fontFamily: 'var(--font-mono)', fontSize: '12px', maxHeight: '260px' },
  '.cm-tooltip-autocomplete ul li': { padding: '4px 10px' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--color-accent-bg)', color: 'var(--color-text)' },
  '.cm-completionIcon': { opacity: 0.6 },
  '.cm-searchMatch': { backgroundColor: 'var(--ed-match)' },
  '.cm-panels': { position: 'absolute', top: '6px', right: '18px', left: 'auto', backgroundColor: 'transparent', border: 'none', pointerEvents: 'none', zIndex: '20' },
  '.cm-panels-top': { border: 'none' },
  '.tutti-find': { pointerEvents: 'auto', display: 'flex', alignItems: 'flex-start', gap: '1px', padding: '4px 5px 4px 0', backgroundColor: 'var(--color-panel)', border: '1px solid var(--color-line)', borderRadius: '8px', boxShadow: '0 8px 24px var(--ed-shadow)', fontSize: '11px', color: 'var(--color-text)' },
  '.tutti-find-chevron': { width: '13px', alignSelf: 'stretch', border: 'none', background: 'transparent', color: 'var(--color-muted)', cursor: 'pointer', fontSize: '12px', padding: 0 },
  '.tutti-find-chevron:hover': { color: 'var(--color-text)' },
  '.tutti-find-rows': { display: 'flex', flexDirection: 'column', gap: '3px' },
  '.tutti-find-row': { display: 'flex', alignItems: 'center', gap: '2px' },
  '.tutti-find-box': { display: 'flex', alignItems: 'center', gap: '1px', width: '200px', backgroundColor: 'var(--ed-field)', borderRadius: '5px', padding: '0 2px 0 0' },
  '.tutti-find-input': { flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: 'var(--color-text)', caretColor: 'var(--color-accent)', padding: '3px 6px', font: 'inherit' },
  '.tutti-find-input.invalid': { color: 'var(--color-danger)' },
  '.tutti-find-opt': { height: '17px', minWidth: '17px', border: 'none', borderRadius: '4px', background: 'transparent', color: 'var(--color-muted)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: '10px', padding: '0 2px' },
  '.tutti-find-opt:hover': { color: 'var(--color-text)' },
  '.tutti-find-opt.on': { backgroundColor: 'var(--color-accent-bg)', color: 'var(--color-accent)' },
  '.tutti-find-status': { minWidth: '58px', textAlign: 'center', color: 'var(--color-muted)', fontSize: '10px', whiteSpace: 'nowrap' },
  '.tutti-find-status.none': { color: 'var(--color-danger)' },
  '.tutti-find-btn': { height: '20px', minWidth: '20px', border: 'none', borderRadius: '4px', background: 'transparent', color: 'var(--color-text)', cursor: 'pointer', fontSize: '12px', padding: '0 3px' },
  '.tutti-find-btn:hover:not(:disabled)': { backgroundColor: 'var(--color-accent-bg)' },
  '.tutti-find-btn:disabled': { opacity: 0.35, cursor: 'default' },
  '.tutti-find-text': { fontSize: '10px', padding: '0 6px' },
  '.cm-git-gutter': { width: '4px' }
}, { dark: true })

// --- marcas de git en el margen -------------------------------------------------------------------------------------
class MarkerBar extends GutterMarker {
  constructor(readonly color: string) { super() }
  toDOM(): HTMLElement {
    const el = document.createElement('div')
    el.style.cssText = `width:3px;height:100%;background:${this.color};border-radius:1px;margin-left:1px`
    return el
  }
  eq(other: MarkerBar): boolean { return other.color === this.color }
}
const COLORS = { added: new MarkerBar('#73c991'), modified: new MarkerBar('#4fa3ff'), deleted: new MarkerBar('#ff6b81') }
const setMarks = StateEffect.define<GitMarks>()
const marksField = StateField.define<GitMarks>({
  create: () => ({}),
  update: (value, tr) => { for (const e of tr.effects) if (e.is(setMarks)) return e.value; return value }
})
const gitGutter = [marksField, gutter({
  class: 'cm-git-gutter',
  lineMarker(view, line) {
    const n = view.state.doc.lineAt(line.from).number
    const kind = view.state.field(marksField)[n]
    return kind ? COLORS[kind] : null
  },
  lineMarkerChange: (update) => update.transactions.some((tr) => tr.effects.some((e) => e.is(setMarks)))
})]

interface Props {
  path: string
  text: string
  readOnly: boolean
  marks: GitMarks
  onChange: (text: string) => void
  onSave: () => void
  focusToken: number
  reveal?: { path: string; line: number; col: number; length: number; token: number } | null
}

/** Editor de código: guarda el estado de cada archivo (deshacer, cursor) al cambiar de pestaña. */
export function CodeEditor({ path, text, readOnly, marks, onChange, onSave, focusToken, reveal }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const states = useRef(new Map<string, EditorState>())
  const current = useRef(path)
  const ro = useRef(new Compartment())
  const handlers = useRef({ onChange, onSave })
  handlers.current = { onChange, onSave }

  const makeState = (p: string, doc: string, locked: boolean): EditorState => EditorState.create({
    doc,
    extensions: [
      lineNumbers(), gitGutter, highlightActiveLineGutter(), highlightActiveLine(), history(), drawSelection(), indentOnInput(),
      bracketMatching(), closeBrackets(), highlightSelectionMatches(), syntaxHighlighting(highlight), theme,
      autocompletion({ override: undefined, activateOnTyping: true, icons: true }),
      EditorState.languageData.of(() => [{ autocomplete: completeAnyWord }]),
      languageFor(p.split(/[\\/]/).pop() ?? p),
      findPanel,
      ro.current.of([EditorState.readOnly.of(locked), EditorView.editable.of(!locked)]),
      keymap.of([
        { key: 'Mod-f', run: (v) => openFind(v, false), scope: 'editor search-panel', preventDefault: true },
        { key: 'Mod-h', run: (v) => openFind(v, true), scope: 'editor search-panel', preventDefault: true },
        { key: 'Mod-s', run: () => { handlers.current.onSave(); return true } },
        ...closeBracketsKeymap, ...completionKeymap, ...searchKeymap, ...historyKeymap, indentWithTab, ...defaultKeymap
      ]),
      EditorView.updateListener.of((u) => { if (u.docChanged) handlers.current.onChange(u.state.doc.toString()) })
    ]
  })

  useEffect(() => {
    view.current = new EditorView({ parent: host.current!, state: makeState(path, text, readOnly) })
    view.current.dispatch({ effects: setMarks.of(marks) })
    return () => { view.current?.destroy(); view.current = null }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // cambio de archivo: se guarda el estado del anterior y se recupera (o crea) el del nuevo
  useEffect(() => {
    const v = view.current
    if (!v || current.current === path) return
    states.current.set(current.current, v.state)
    current.current = path
    v.setState(states.current.get(path) ?? makeState(path, text, readOnly))
    v.dispatch({ effects: setMarks.of(marks) })
  }, [path])  // eslint-disable-line react-hooks/exhaustive-deps

  // el texto cambió desde fuera (recarga del disco): se reemplaza sin tocar el historial del usuario más de lo necesario
  useEffect(() => {
    const v = view.current
    if (v && v.state.doc.toString() !== text) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } })
  }, [text])

  useEffect(() => {
    view.current?.dispatch({ effects: ro.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]) })
  }, [readOnly])

  useEffect(() => { view.current?.dispatch({ effects: setMarks.of(marks) }) }, [marks])
  // un resultado de búsqueda: el cursor va a la coincidencia y queda seleccionada
  useEffect(() => {
    const v = view.current
    if (!v || !reveal || reveal.path !== path) return
    const line = v.state.doc.line(Math.min(Math.max(reveal.line, 1), v.state.doc.lines))
    const from = Math.min(line.from + reveal.col, line.to)
    v.dispatch({ selection: { anchor: from, head: Math.min(from + reveal.length, line.to) }, effects: EditorView.scrollIntoView(from, { y: 'center' }) })
    v.focus()
  }, [reveal?.token])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (focusToken) view.current?.focus() }, [focusToken])

  return <div ref={host} className="min-h-0 flex-1 overflow-hidden" />
}
