import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { PromptInput } from './PromptInput'
import type {
  ChatItem,
  EditSummary,
  Mode,
  ScopeLevel,
  SessionSummary,
  StoredMessage,
  TokenUsage
} from '../types'

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

/* ── Edit summary card (replaces code-paste in chat for `edit` mode) ───── */

function EditSummaryCard({ summary }: { summary: EditSummary }) {
  const lineDelta = summary.newLines - summary.prevLines
  const charDelta = summary.newChars - summary.prevChars
  const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`)
  const isFull =
    summary.scopeLevel === 'file' || summary.scopeLevel === 'project'
  return (
    <div className="rounded-md border border-border-subtle bg-bg-subtle px-3 py-2">
      <div className="flex items-center gap-2 text-2xs uppercase tracking-[0.16em] text-fg-muted">
        <span className="text-accent">●</span>
        <span>{isFull ? 'rewrote file' : 'edited'}</span>
      </div>
      <div className="mt-1 break-all font-mono text-xs text-fg-base">
        {summary.displayPath || '(no file)'}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] text-fg-muted">
        {!isFull && (
          <span>
            L{summary.startLine}–L{summary.endLine}
          </span>
        )}
        <span>
          {summary.prevLines} → {summary.newLines} lines
        </span>
        <span>
          {sign(lineDelta)}{lineDelta === 1 || lineDelta === -1 ? ' line' : ' lines'}
        </span>
        <span>{sign(charDelta)} chars</span>
      </div>
    </div>
  )
}

function UsageLine({ usage }: { usage: TokenUsage }) {
  const total = usage.input + usage.output
  const fmt = (n: number) => n.toLocaleString()
  return (
    <div className="px-1 pt-0.5 font-mono text-[10px] text-fg-dim">
      {fmt(usage.input)} in · {fmt(usage.output)} out · {fmt(total)} total tokens
    </div>
  )
}

/* ── Error bubble (kept from earlier work) ─────────────────────────────── */

function summarizeError(raw: string): { headline: string; details: string } {
  const isRate =
    /rate[_ ]limit/i.test(raw) || /\b429\b/.test(raw) || /per minute/i.test(raw)
  if (isRate) {
    const limitMatch = raw.match(/limit of ([\d,]+) input tokens per minute/i)
    const headline = limitMatch
      ? `Rate limited · ${limitMatch[1]} input tokens/min cap hit. Try again shortly, or switch Context to "pinned" / "none".`
      : 'Rate limited by Anthropic. Try again shortly, or reduce context.'
    return { headline, details: raw }
  }
  const m = raw.match(/"message":\s*"((?:[^"\\]|\\.)*)"/)
  if (m) {
    const headline = m[1].replace(/\\n/g, ' ').replace(/\\"/g, '"')
    return { headline, details: raw }
  }
  return { headline: raw, details: '' }
}

function ErrorBubble({ raw }: { raw: string }) {
  const { headline, details } = summarizeError(raw)
  const [open, setOpen] = useState(false)
  const hasDetails = details && details.length > headline.length + 4
  return (
    <div className="syde-selectable rounded-md border border-error-border/70 bg-error-bg px-3 py-2 text-xs leading-relaxed text-error-fg-strong">
      <div className="whitespace-pre-wrap break-words">{headline}</div>
      {hasDetails && (
        <div className="mt-1.5 border-t border-error-border/40 pt-1.5">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-2xs uppercase tracking-[0.15em] text-error-fg hover:text-error-fg-strong"
          >
            {open ? '▾ hide details' : '▸ show details'}
          </button>
          {open && (
            <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border border-error-border/30 bg-bg-base/50 px-2 py-1.5 font-mono text-[10px] text-error-fg">
              {details}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Chat bubble ───────────────────────────────────────────────────────── */

function Bubble({ item }: { item: ChatItem }) {
  const isUser = item.role === 'user'
  const isEdit = item.mode === 'edit' && !isUser

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
            {isEdit
              ? `applying edit · ${item.streamProgress ?? 0} chars`
              : 'streaming'}
          </span>
        )}
      </div>

      {item.error ? (
        <ErrorBubble raw={item.error || item.content} />
      ) : isEdit && item.editSummary ? (
        <EditSummaryCard summary={item.editSummary} />
      ) : isEdit && item.streaming ? (
        // While streaming an edit, the editor is the canvas — keep chat quiet.
        <div className="rounded-md border border-dashed border-border-subtle bg-bg-subtle/50 px-3 py-2 text-2xs italic text-fg-muted">
          editor is receiving the patch…
        </div>
      ) : item.content || (!isEdit && item.streaming) ? (
        <div
          className={`syde-selectable whitespace-pre-wrap break-words rounded-md border px-3 py-2 text-xs leading-relaxed ${
            isUser
              ? 'border-border-subtle bg-bg-panel text-fg-base'
              : 'border-border-subtle bg-bg-subtle text-fg-base'
          }`}
        >
          {item.content || (item.streaming ? '…' : '')}
        </div>
      ) : null}

      {item.usage && !item.streaming && <UsageLine usage={item.usage} />}
    </div>
  )
}

/* ── Sessions dropdown ─────────────────────────────────────────────────── */

function relTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(ts).toLocaleDateString()
}

function preview(s: string | null, max = 70): string {
  if (!s) return '(no messages)'
  const oneLine = s.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? oneLine.slice(0, max - 1) + '…' : oneLine
}

function basename(p: string | null): string {
  if (!p) return '(no file)'
  const segs = p.split(/[/\\]/).filter(Boolean)
  return segs[segs.length - 1] ?? p
}

function storedToChatItem(m: StoredMessage): ChatItem {
  return {
    id: `db-${m.id}`,
    role: m.role,
    content: m.content,
    scopeLevel: m.scope_level ?? undefined,
    mode: m.mode ?? undefined,
    streaming: false
  }
}

function SessionsDropdown({
  open,
  onClose,
  onPick,
  onNew
}: {
  open: boolean
  onClose: () => void
  onPick: (id: number) => void
  onNew: () => void
}) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const currentSessionId = useStore((s) => s.sessionId)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    void window.syde.db.listSessionSummaries(50).then((rows) => {
      if (cancelled) return
      setSessions(rows)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const node = containerRef.current
      if (!node) return
      if (!node.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={containerRef}
      className="absolute right-2 top-9 z-30 flex max-h-[60vh] w-[320px] flex-col overflow-hidden rounded-md border border-border bg-bg-raised shadow-lg"
    >
      <div className="flex items-center justify-between border-b border-border-subtle px-2.5 py-1.5">
        <span className="text-2xs uppercase tracking-[0.18em] text-fg-dim">
          chat history
        </span>
        <button
          onClick={() => {
            onNew()
            onClose()
          }}
          className="rounded px-1.5 py-0.5 text-2xs uppercase tracking-[0.15em] text-fg-muted hover:bg-bg-hover hover:text-fg-base"
        >
          + new
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {loading ? (
          <div className="px-3 py-2 text-2xs text-fg-subtle">loading…</div>
        ) : sessions.length === 0 ? (
          <div className="px-3 py-2 text-2xs text-fg-subtle">
            no past sessions yet — submit a prompt to start one.
          </div>
        ) : (
          sessions.map((s) => {
            const isActive = s.id === currentSessionId
            return (
              <button
                key={s.id}
                onClick={() => {
                  onPick(s.id)
                  onClose()
                }}
                className={`flex w-full flex-col gap-0.5 px-3 py-1.5 text-left transition-colors ${
                  isActive ? 'bg-bg-subtle' : 'hover:bg-bg-hover'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-2xs font-mono text-fg-muted">
                    #{s.id}
                  </span>
                  <span className="truncate font-mono text-2xs text-fg-base">
                    {basename(s.file_path)}
                  </span>
                  <span className="ml-auto text-2xs text-fg-dim">
                    {relTime(s.created_at)}
                  </span>
                </div>
                <div className="truncate text-2xs text-fg-subtle">
                  {preview(s.first_user_message)}
                </div>
                <div className="text-2xs text-fg-dim">
                  {s.message_count} message{s.message_count === 1 ? '' : 's'}
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

/* ── Panel ─────────────────────────────────────────────────────────────── */

export function ChatPanel() {
  const chat = useStore((s) => s.chat)
  const clearChat = useStore((s) => s.clearChat)
  const setChat = useStore((s) => s.setChat)
  const sessionId = useStore((s) => s.sessionId)
  const setSessionId = useStore((s) => s.setSessionId)
  const toggleRight = useStore((s) => s.toggleRight)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [chat])

  const onPickSession = async (id: number) => {
    try {
      const messages = await window.syde.db.getMessages(id)
      setChat(messages.map(storedToChatItem))
      setSessionId(id)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[syde:chat] failed to load session', e)
    }
  }

  const onNewSession = () => {
    setSessionId(null)
    clearChat()
  }

  return (
    <div className="relative flex h-full flex-col bg-bg-panel">
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
            <span className="text-2xs text-fg-subtle">session #{sessionId}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            className="rounded px-1.5 py-0.5 text-2xs text-fg-subtle hover:bg-bg-hover hover:text-fg-muted"
            title="Open chat history"
          >
            history ▾
          </button>
          <button
            onClick={onNewSession}
            className="rounded px-1.5 py-0.5 text-2xs text-fg-subtle hover:bg-bg-hover hover:text-fg-muted"
            title="Start a new session"
          >
            new
          </button>
          <button
            onClick={clearChat}
            className="rounded px-1.5 py-0.5 text-2xs text-fg-subtle hover:bg-bg-hover hover:text-fg-muted"
            title="Clear current chat (does not delete the session)"
          >
            clear
          </button>
        </div>
      </div>

      <SessionsDropdown
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onPick={(id) => void onPickSession(id)}
        onNew={onNewSession}
      />

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto py-1">
        {chat.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="text-2xs uppercase tracking-[0.2em] text-fg-dim">
              empty
            </div>
            <p className="max-w-[28ch] text-xs leading-relaxed text-fg-subtle">
              Every exchange with the LLM appears here.
            </p>
            <p className="max-w-[30ch] text-xs leading-relaxed text-fg-subtle">
              In{' '}
              <span className="rounded bg-bg-subtle px-1 py-0.5 font-mono text-fg-muted">
                edit
              </span>{' '}
              mode the result is written into the editor and a summary appears
              here.
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
