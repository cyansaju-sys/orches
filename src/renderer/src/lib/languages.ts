import { t } from './i18n'
import type { Extension } from '@codemirror/state'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { PLSQL, sql } from '@codemirror/lang-sql'

const byExt: Record<string, () => Extension> = {
  js: () => javascript({ jsx: true }), jsx: () => javascript({ jsx: true }), mjs: () => javascript(), cjs: () => javascript(),
  ts: () => javascript({ typescript: true }), tsx: () => javascript({ jsx: true, typescript: true }),
  mts: () => javascript({ typescript: true }), cts: () => javascript({ typescript: true }),
  py: () => python(), pyw: () => python(),
  sql: () => sql({ dialect: PLSQL }), pks: () => sql({ dialect: PLSQL }), pkb: () => sql({ dialect: PLSQL }),
  fnc: () => sql({ dialect: PLSQL }), prc: () => sql({ dialect: PLSQL }), trg: () => sql({ dialect: PLSQL }), plsql: () => sql({ dialect: PLSQL }),
  json: () => json(), jsonc: () => json(), css: () => css(), scss: () => css(),
  html: () => html(), htm: () => html(), xml: () => html(), svg: () => html(), vue: () => html(),
  md: () => markdown(), markdown: () => markdown()
}

export function languageFor(fileName: string): Extension {
  const ext = fileName.toLowerCase().split('.').pop() ?? ''
  return byExt[ext]?.() ?? []
}

export function languageName(fileName: string): string {
  const ext = fileName.toLowerCase().split('.').pop() ?? ''
  const names: Record<string, string> = {
    js: 'JavaScript', jsx: 'JavaScript JSX', ts: 'TypeScript', tsx: 'TypeScript JSX', py: 'Python', sql: 'SQL', json: 'JSON',
    css: 'CSS', html: 'HTML', md: 'Markdown', xml: 'XML', svg: 'SVG', vue: 'Vue'
  }
  return names[ext] ?? t('lang.text')
}
