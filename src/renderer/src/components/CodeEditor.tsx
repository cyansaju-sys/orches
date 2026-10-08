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

/** Mismos colores de sintaxis que la versión anterior. */
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], color: '#c792ea', fontWeight: '600' },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], color: '#4cc9b0' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#7ccb8b' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#f0b67f' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: '#6b7088', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], color: '#82aaff' },
  { tag: [t.tagName, t.angleBracket], color: '#f07178' },
  { tag: [t.attributeName], color: '#ffcb6b' },
  { tag: [t.meta, t.annotation], color: '#ffcb6b' },
  { tag: [t.heading], color: '#c792ea', fontWeight: '700' },
  { tag: [t.link, t.url], color: '#82aaff', textDecoration: 'underline' }
])

const theme = EditorView.theme({
  '&': { color: '#e6e8ef', backgroundColor: '#0d0f16', fontSize: '12.5px' },
  '.cm-content': { caretColor: '#8fa6c4', padding: '4px 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#8fa6c4', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: '#222c3c !important' },
  '.cm-activeLine': { backgroundColor: '#ffffff08' },
  '.cm-gutters': { backgroundColor: '#0d0f16', color: '#6b7088', border: 'none' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#e6e8ef' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 6px', minWidth: '34px' },
  '.cm-matchingBracket': { backgroundColor: '#3b4a6366', outline: 'none' },
  '.cm-tooltip': { backgroundColor: '#11141d', border: '1px solid #2a2f3d', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 12px 32px #000a' },
  '.cm-tooltip-autocomplete ul': { fontFamily: 'var(--font-mono)', fontSize: '12px', maxHeight: '260px' },
  '.cm-tooltip-autocomplete ul li': { padding: '4px 10px' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: '#222c3c', color: '#e6e8ef' },
  '.cm-completionIcon': { opacity: 0.6 },
  '.cm-searchMatch': { backgroundColor: '#3b4a6388' },
  '.cm-panels': { backgroundColor: '#11141d', color: '#e6e8ef', borderColor: '#2a2f3d' },
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
}

/** Editor de código: guarda el estado de cada archivo (deshacer, cursor) al cambiar de pestaña. */
export function CodeEditor({ path, text, readOnly, marks, onChange, onSave, focusToken }: Props) {
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
      ro.current.of([EditorState.readOnly.of(locked), EditorView.editable.of(!locked)]),
      keymap.of([
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
  useEffect(() => { if (focusToken) view.current?.focus() }, [focusToken])

  return <div ref={host} className="min-h-0 flex-1 overflow-hidden" />
}
