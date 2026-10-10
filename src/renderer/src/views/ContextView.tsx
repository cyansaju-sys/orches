import { useEffect, useRef, useState } from 'react'
import { MdAutoAwesome, MdSave } from 'react-icons/md'
import { useT } from '@/lib/i18n'
import { useStore } from '@/store'

const SAVE_MS = 600

/** Contexto del proyecto: un texto que los agentes (Claude Code y OpenCode) reciben al arrancar en este proyecto. */
export function ContextView() {
  const t = useT()
  const project = useStore((s) => s.project)
  const [file, setFile] = useState<string | null>(null)
  const [text, setText] = useState('')
  const toast = useStore((s) => s.toast)
  const [writing, setWriting] = useState('')
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const pending = useRef<{ file: string; value: string } | null>(null)

  // guarda lo pendiente (al cambiar de proyecto o de pestaña no se pierde lo último que se escribió)
  const flush = (): Promise<void> => {
    clearTimeout(timer.current)
    const p = pending.current
    pending.current = null
    return p ? window.api.fs.write(p.file, p.value, false).then(() => undefined) : Promise.resolve()
  }

  useEffect(() => {
    setFile(null); setText(''); setState('idle')
    if (!project) return
    let live = true
    void window.api.context.ensure(project).then(async (path) => {
      const data = await window.api.fs.read(path)
      if (live) { setFile(path); setText(data.text) }
    })
    return () => { live = false; void flush() }
  }, [project])  // eslint-disable-line react-hooks/exhaustive-deps

  // al salir del apartado se deja de redactar
  useEffect(() => () => { void window.api.ai.cancel('context') }, [])

  const change = (value: string): void => {
    setText(value); setState('saving')
    if (!file) return
    clearTimeout(timer.current)
    pending.current = { file, value }
    timer.current = setTimeout(() => void flush().then(() => setState('saved')), SAVE_MS)
  }

  const save = async (): Promise<void> => {
    await flush()
    setState('saved')
    toast(t('ctx.saved'), 'ok')
  }

  const generate = async (): Promise<void> => {
    if (writing || !project) return
    if (text.trim() && !/Lo que escribas aquí lo leen|What you write here is read by/.test(text) && !window.confirm(t('ctx.replace'))) return
    setWriting(t('git.anAgent'))
    const off = window.api.context.onAgent(setWriting)
    const res = await window.api.context.generate(project)
    off()
    setWriting('')
    if (!res.ok && !res.message) { toast(t('ctx.cancelled'), 'info'); return }
    if (res.ok && res.text) { change(res.text); toast(t('ctx.generated', { agent: res.agent ? t('ctx.with', { agent: res.agent }) : '' }), 'ok') }
    else toast(res.message || t('ctx.failed'), 'error')
  }

  if (!project) return <p className="px-4 pt-2 text-[11px] text-muted">{t('ctx.openProject')}</p>

  return (
    <div className="flex h-full flex-col gap-2 px-2 pb-2">
      <p className="px-1 text-[11px] leading-snug text-muted">
        {t('ctx.help')}
      </p>
      <div className="flex gap-2">
        <button onClick={() => void generate()} disabled={!file || !!writing}
          title={t('ctx.generateTip')}
          className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-md border border-line px-3 py-1.5 text-[12px] text-accent transition-colors hover:border-accent hover:bg-accent-bg disabled:opacity-60">
          <MdAutoAwesome size={14} className={writing ? 'animate-pulse' : ''} /> <span className="truncate">{writing ? t('ctx.writingWith', { agent: writing }) : t('ctx.generate')}</span>
        </button>
        <button onClick={() => void save()} disabled={!file || state !== 'saving'} title={t('ctx.saveTip')}
          className="flex items-center justify-center gap-2 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-bg transition-[filter] hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100">
          <MdSave size={14} /> {t('ctx.save')}
        </button>
      </div>
      <textarea value={text} onChange={(e) => change(e.target.value)} disabled={!file} spellCheck={false}
        placeholder={t('ctx.placeholder')}
        className="min-h-0 flex-1 resize-none rounded-md bg-ov/[0.04] p-2.5 font-mono text-[12px] leading-relaxed text-text outline-none" />
      <div className="flex items-center justify-between px-1 text-[10px] text-muted">
        <span title={file ?? ''} className="min-w-0 truncate">{file ?? ''}</span>
        <span className="shrink-0">{state === 'saving' ? t('ctx.saving') : state === 'saved' ? t('ctx.savedState') : ''}</span>
      </div>
    </div>
  )
}
