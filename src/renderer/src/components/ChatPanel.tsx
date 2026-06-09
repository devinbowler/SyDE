import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { PromptInput } from './PromptInput'
import type { ChatItem, Mode, ScopeLevel } from '../types'

const SCOPE_DOT: Record<ScopeLevel, string> = {
  line: 'bg-scope-line',
  block: 'bg-scope-block',
  file: 'bg-scope-file',
  project: 'bg-scope-project',
  custom: 'bg-scope-custom'
}

function ModeTag({ mode }: { mode?: Mode }) {
  if (!mode) return null
  return (
    <span className="rounded-sm bg-bg-subtle px-1.5 py-0.5 text-2xs uppercase tracking-[0.15em] text-fg-muted">
      {mode}
    </span>
  )
}

function ScopeTag({ level }: { level?: ScopeLevel }) {
  if (!level) return null
  return (
    <span className="inline-flex items-center gap-1 rounded-sm bg-bg-subtle px-1.5 py-0.5 text-2xs uppercase tracking-[0.15em] text-fg-muted">
      <span className={`h-1.5 w-1.5 rounded-full ${SCOPE_DOT[level]}`} />
      {level}
    </span>
  )
}

function Bubble({ item }: { item: ChatItem }) {
  const isUser = item.role === 'user'
  return (
    <div className="flex flex-col gap-1 px-3 py-2">
      <div className="flex items-center gap-1.5">
        <span
          className={`text-2xs uppercase tracking-[0.18em] ${
            isUser ? 'text-fg-muted' : 'text-accent'
          }`}
        >
          {isUser ? 'you' : 'syde'}
        </span>
        <ScopeTag level={item.scopeLevel} />
        <ModeTag mode={item.mode} />
        {item.streaming && (
          <span className="ml-1 inline-flex items-center gap-1 text-2xs text-fg-subtle">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            streaming
          </span>
        )}
      </div>
      <div
        className={`syde-selectable whitespace-pre-wrap break-words rounded-md border px-3 py-2 text-xs leading-relaxed ${
          isUser
            ? 'border-border-subtle bg-bg-panel text-fg-base'
            : item.error
            ? 'border-rose-900/40 bg-rose-950/20 text-rose-200'
            : 'border-border-subtle bg-bg-subtle text-fg-base'
        }`}
      >
        {item.content || (item.streaming ? '…' : '')}
      </div>
    </div>
  )
}

export function ChatPanel() {
  const chat = useStore((s) => s.chat)
  const clearChat = useStore((s) => s.clearChat)
  const sessionId = useStore((s) => s.sessionId)
  const toggleRight = useStore((s) => s.toggleRight)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [chat])

  return (
    <div className="flex h-full flex-col bg-bg-panel">
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            onClick={toggleRight}
            className="-ml-1 rounded px-1.5 py-0.5 text-2xs text-fg-subtle transition-colors hover:bg-bg-hover hover:text-fg-base"
            title="Hide chat panel"
          >
            ⟩
          </button>
          <span className="text-2xs uppercase tracking-[0.2em] text-fg-dim">
            chat
          </span>
          {sessionId && (
            <span className="text-2xs text-fg-subtle">session {sessionId}</span>
          )}
        </div>
        <button
          onClick={clearChat}
          className="rounded px-1.5 py-0.5 text-2xs text-fg-subtle hover:bg-bg-hover hover:text-fg-muted"
        >
          clear
        </button>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto py-1">
        {chat.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="text-2xs uppercase tracking-[0.2em] text-fg-dim">
              empty
            </div>
            <p className="max-w-[28ch] text-xs leading-relaxed text-fg-subtle">
              Every exchange with the LLM appears here.
            </p>
            <p className="max-w-[28ch] text-xs leading-relaxed text-fg-subtle">
              Streaming is live. In{' '}
              <span className="rounded bg-bg-subtle px-1 py-0.5 font-mono text-fg-muted">
                edit
              </span>{' '}
              mode the result is also written into the editor.
            </p>
          </div>
        ) : (
          chat.map((m) => <Bubble key={m.id} item={m} />)
        )}
      </div>
      <PromptInput />
    </div>
  )
}
