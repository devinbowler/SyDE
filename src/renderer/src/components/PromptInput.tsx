import { KeyboardEvent, useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { useLLM } from '../hooks/useLLM'
import type { Mode } from '../types'

const MODE_RING: Record<Mode, string> = {
  ask: 'ring-fg-subtle/40',
  edit: 'ring-accent/60',
  agent: 'ring-scope-project/60'
}

export function PromptInput() {
  const mode = useStore((s) => s.mode)
  const streamingId = useStore((s) => s.streamingId)
  const { submit, cancel } = useLLM()

  const [instruction, setInstruction] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [instruction])

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (streamingId) return
      const text = instruction.trim()
      if (!text) return
      void submit({ instruction: text })
      setInstruction('')
    }
  }

  const placeholder =
    mode === 'ask'
      ? 'Ask a question about the scope…'
      : mode === 'edit'
      ? 'Describe the change to apply within scope…'
      : 'Describe the multi-step task…'

  return (
    <div className="flex items-end gap-2 border-t border-border-subtle bg-bg-panel px-3 py-2">
      <div
        className={`flex-1 rounded-md border border-border-subtle bg-bg-subtle px-2.5 py-2 ring-1 ${MODE_RING[mode]}`}
      >
        <textarea
          ref={inputRef}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={placeholder}
          className="syde-selectable w-full resize-none bg-transparent text-sm text-fg-base placeholder:text-fg-dim focus:outline-none"
          style={{ maxHeight: 200 }}
        />
        <div className="mt-1 flex items-center justify-between text-2xs text-fg-dim">
          <span>
            <kbd className="rounded bg-bg-base/40 px-1 py-0.5 font-mono text-fg-subtle">
              ↵
            </kbd>{' '}
            send · <kbd className="rounded bg-bg-base/40 px-1 py-0.5 font-mono text-fg-subtle">⇧↵</kbd> newline
          </span>
          <span className="uppercase tracking-[0.2em]">{mode}</span>
        </div>
      </div>

      {streamingId ? (
        <button
          onClick={cancel}
          className="self-stretch rounded-md border border-border bg-bg-subtle px-3 text-xs text-fg-base transition-colors hover:bg-bg-hover"
        >
          stop
        </button>
      ) : (
        <button
          disabled={!instruction.trim()}
          onClick={() => {
            const text = instruction.trim()
            if (!text) return
            void submit({ instruction: text })
            setInstruction('')
          }}
          className="self-stretch rounded-md border border-border bg-accent/20 px-3 text-xs text-fg-base transition-colors hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-40"
        >
          send
        </button>
      )}
    </div>
  )
}
