import { useCallback, useEffect, useRef } from 'react'
import { useStore } from '../store'
import {
  applyFullFileEdit,
  applyScopedEdit,
  findEnclosingBlock,
  getEditorInstance
} from './useEditor'
import type {
  ChatItem,
  ContextFile,
  EditSummary,
  LLMRequest,
  LLMStreamEvent,
  Mode,
  Scope,
  ScopeLevel,
  ScopeRange
} from '../types'

function makeId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function stripCodeFence(s: string): string {
  // If the model wrapped its output in a single fenced code block, peel it.
  const trimmed = s.trim()
  const fence = /^```(?:[a-zA-Z0-9_+-]*)\n([\s\S]*?)\n```$/m
  const m = fence.exec(trimmed)
  if (m && m[1] !== undefined) return m[1]
  return s
}

function countLines(s: string): number {
  if (!s) return 0
  return s.split(/\r\n|\r|\n/).length
}

function displayPathFor(filePath: string | null, root: string | null): string {
  if (!filePath) return '(no file)'
  if (root) {
    // Naive prefix-strip — works for both fwd and back slashes on Windows.
    const norm = (p: string) => p.replace(/\\/g, '/')
    const f = norm(filePath)
    const r = norm(root.endsWith('/') ? root : root + '/')
    if (f.startsWith(r)) return filePath.slice(root.length + 1)
  }
  // Fallback: last 2 path segments.
  const segs = filePath.split(/[/\\]/).filter(Boolean)
  return segs.slice(-2).join('/') || filePath
}

function buildEditSummary(
  prevContent: string,
  newContent: string,
  scopeLevel: ScopeLevel,
  range: ScopeRange | null,
  filePath: string | null,
  workspaceRoot: string | null
): EditSummary {
  const startLine = range?.startLine ?? 1
  const endLine = range?.endLine ?? countLines(prevContent)
  return {
    filePath,
    scopeLevel,
    startLine,
    endLine,
    prevLines: countLines(prevContent),
    newLines: countLines(newContent),
    prevChars: prevContent.length,
    newChars: newContent.length,
    displayPath: displayPathFor(filePath, workspaceRoot)
  }
}

function summaryToText(s: EditSummary): string {
  const verb =
    s.scopeLevel === 'file' || s.scopeLevel === 'project' ? 'Rewrote' : 'Edited'
  const lineDelta = s.newLines - s.prevLines
  const charDelta = s.newChars - s.prevChars
  const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`)
  const range =
    s.scopeLevel === 'file' || s.scopeLevel === 'project'
      ? `whole file (${s.prevLines} → ${s.newLines} lines)`
      : `L${s.startLine}–L${s.endLine} (${s.prevLines} → ${s.newLines} lines)`
  return `${verb} ${s.displayPath} · ${range} · ${sign(lineDelta)} lines · ${sign(charDelta)} chars`
}

interface SubmitArgs {
  instruction: string
}

export function useLLM() {
  const mode = useStore((s) => s.mode)
  const scopeLevel = useStore((s) => s.scopeLevel)
  const scopeRange = useStore((s) => s.scopeRange)
  const activeFilePath = useStore((s) => s.activeFilePath)
  const activeContent = useStore((s) => s.activeContent)
  const pinnedFiles = useStore((s) => s.pinnedFiles)
  const contextMode = useStore((s) => s.contextMode)
  const workspaceRoot = useStore((s) => s.workspaceRoot)
  const sessionId = useStore((s) => s.sessionId)
  const setSessionId = useStore((s) => s.setSessionId)
  const chat = useStore((s) => s.chat)
  const appendChat = useStore((s) => s.appendChat)
  const patchChat = useStore((s) => s.patchChat)
  const setStreamingId = useStore((s) => s.setStreamingId)
  const setLastError = useStore((s) => s.setLastError)
  const setLastEvent = useStore((s) => s.setLastEvent)
  const openRight = useStore((s) => s.openRight)

  // Track in-flight requests so the IPC stream listener can route deltas.
  const inflight = useRef(
    new Map<
      string,
      {
        chatItemId: string
        mode: Mode
        scopeLevel: ScopeLevel
        scopeRange: ScopeRange | null
        accum: string
        // Captured at submit time so we can produce an edit summary after
        // the model finishes — without re-reading the file from disk.
        prevContent: string
        filePath: string | null
        workspaceRoot: string | null
      }
    >()
  )

  // One global stream listener for the lifetime of the renderer.
  useEffect(() => {
    const off = window.syde.llm.onStream((event: LLMStreamEvent) => {
      const entry = inflight.current.get(event.requestId)
      // Verbose dev visibility — every event also shows in DevTools console.
      // eslint-disable-next-line no-console
      console.log('[syde:llm]', event.type, event)
      if (!entry) {
        if (event.type === 'error') setLastError(event.error)
        return
      }

      if (event.type === 'start') {
        setLastEvent('streaming…')
        return
      }

      if (event.type === 'delta') {
        entry.accum += event.text
        if (entry.mode === 'ask') {
          // Ask mode: stream the answer directly into the bubble.
          patchChat(entry.chatItemId, { content: entry.accum, streaming: true })
        } else {
          // Edit mode: don't dump code into the chat — the editor itself
          // will receive the final patch. Just show progress.
          patchChat(entry.chatItemId, {
            streaming: true,
            streamProgress: entry.accum.length
          })
        }
        setLastEvent(`streaming · ${entry.accum.length} chars`)
        return
      }

      if (event.type === 'end') {
        const finalText = event.fullText || entry.accum

        if (entry.mode === 'edit') {
          const cleaned = stripCodeFence(finalText)

          // Apply to editor in edit mode.
          if (entry.scopeLevel === 'file' || entry.scopeLevel === 'project') {
            applyFullFileEdit(cleaned)
          } else if (entry.scopeRange) {
            applyScopedEdit(entry.scopeRange, cleaned)
          }

          const summary = buildEditSummary(
            entry.prevContent,
            cleaned,
            entry.scopeLevel,
            entry.scopeRange,
            entry.filePath,
            entry.workspaceRoot
          )
          const summaryText = summaryToText(summary)

          patchChat(entry.chatItemId, {
            content: summaryText,
            streaming: false,
            streamProgress: undefined,
            editSummary: summary,
            usage: event.usage
          })

          // Persist the SUMMARY (not the code) so the chat history reads back
          // as an edit log instead of duplicating file contents.
          const sid = useStore.getState().sessionId
          if (sid) {
            void window.syde.db.appendMessage({
              sessionId: sid,
              role: 'assistant',
              content: summaryText,
              scopeLevel: entry.scopeLevel,
              mode: entry.mode
            })
          }

          setLastEvent(
            `${summary.scopeLevel} edit · ${summary.prevLines}→${summary.newLines} lines${
              event.usage
                ? ` · ${event.usage.input}/${event.usage.output} tok`
                : ''
            }`
          )
        } else {
          // Ask mode: keep the answer text as the bubble content.
          patchChat(entry.chatItemId, {
            content: finalText,
            streaming: false,
            usage: event.usage
          })
          const sid = useStore.getState().sessionId
          if (sid) {
            void window.syde.db.appendMessage({
              sessionId: sid,
              role: 'assistant',
              content: finalText,
              scopeLevel: entry.scopeLevel,
              mode: entry.mode
            })
          }
          setLastEvent(
            `done · ${finalText.length} chars${
              event.usage
                ? ` · ${event.usage.input}/${event.usage.output} tok`
                : ''
            }`
          )
        }

        inflight.current.delete(event.requestId)
        setStreamingId(null)
        return
      }

      if (event.type === 'error') {
        patchChat(entry.chatItemId, {
          content: `Error: ${event.error}`,
          streaming: false,
          streamProgress: undefined,
          error: event.error
        })
        inflight.current.delete(event.requestId)
        setStreamingId(null)
        setLastError(event.error)
        setLastEvent(`error: ${event.error}`)
      }
    })
    return () => off()
  }, [patchChat, setStreamingId, setLastError, setLastEvent])

  const submit = useCallback(
    async ({ instruction }: SubmitArgs) => {
      if (!instruction.trim()) return

      // Always make the chat panel visible when a request is fired.
      openRight()
      setLastError(null)
      setLastEvent('preparing request…')

      // Build scope content
      const ed = getEditorInstance()
      const model = ed?.getModel() ?? null

      let scopeContent = ''
      let effectiveRange: ScopeRange | null = scopeRange

      if (scopeLevel === 'file' || scopeLevel === 'project') {
        scopeContent = activeContent
        if (model) {
          const lc = model.getLineCount()
          effectiveRange = {
            startLine: 1,
            startColumn: 1,
            endLine: lc,
            endColumn: model.getLineMaxColumn(lc)
          }
        }
      } else if (scopeLevel === 'line') {
        if (model && scopeRange) {
          scopeContent = model.getLineContent(scopeRange.startLine)
          effectiveRange = {
            startLine: scopeRange.startLine,
            startColumn: 1,
            endLine: scopeRange.startLine,
            endColumn: model.getLineMaxColumn(scopeRange.startLine)
          }
        } else if (model && ed) {
          const pos = ed.getPosition()
          if (pos) {
            scopeContent = model.getLineContent(pos.lineNumber)
            effectiveRange = {
              startLine: pos.lineNumber,
              startColumn: 1,
              endLine: pos.lineNumber,
              endColumn: model.getLineMaxColumn(pos.lineNumber)
            }
          }
        }
      } else if (scopeLevel === 'block') {
        // Resolution order:
        //   1. user has an active selection → use it
        //   2. saved scopeRange (from the cursor handler) → use it
        //   3. detect enclosing block at cursor on the fly → use that
        const sel = ed?.getSelection()
        if (sel && model && !sel.isEmpty()) {
          scopeContent = model.getValueInRange(sel)
          effectiveRange = {
            startLine: sel.startLineNumber,
            startColumn: sel.startColumn,
            endLine: sel.endLineNumber,
            endColumn: sel.endColumn
          }
        } else if (model && scopeRange) {
          scopeContent = model.getValueInRange({
            startLineNumber: scopeRange.startLine,
            startColumn: scopeRange.startColumn,
            endLineNumber: scopeRange.endLine,
            endColumn: scopeRange.endColumn
          })
        } else if (model && ed) {
          const pos = ed.getPosition()
          if (pos) {
            const block = findEnclosingBlock(model, pos)
            if (block) {
              effectiveRange = block
              scopeContent = model.getValueInRange({
                startLineNumber: block.startLine,
                startColumn: block.startColumn,
                endLineNumber: block.endLine,
                endColumn: block.endColumn
              })
            } else {
              // No block found — degrade to the cursor line so we never
              // accidentally edit the whole file in 'block' mode.
              scopeContent = model.getLineContent(pos.lineNumber)
              effectiveRange = {
                startLine: pos.lineNumber,
                startColumn: 1,
                endLine: pos.lineNumber,
                endColumn: model.getLineMaxColumn(pos.lineNumber)
              }
            }
          }
        }
      } else {
        // custom — use the user's selection only
        if (model && scopeRange) {
          scopeContent = model.getValueInRange({
            startLineNumber: scopeRange.startLine,
            startColumn: scopeRange.startColumn,
            endLineNumber: scopeRange.endLine,
            endColumn: scopeRange.endColumn
          })
        } else if (ed) {
          const sel = ed.getSelection()
          if (sel && model && !sel.isEmpty()) {
            scopeContent = model.getValueInRange(sel)
            effectiveRange = {
              startLine: sel.startLineNumber,
              startColumn: sel.startColumn,
              endLine: sel.endLineNumber,
              endColumn: sel.endColumn
            }
          }
        }
      }

      // Build context based on the chosen contextMode.
      const pinned = Array.from(pinnedFiles)
      let context: ContextFile[] = []
      try {
        setLastEvent(`gathering context (${contextMode})…`)
        const collected = await window.syde.context.collect({
          mode: contextMode,
          rootPath: workspaceRoot ?? null,
          activeFilePath: activeFilePath ?? null,
          pinned
        })
        context = collected.files
        if (collected.skipped.length > 0) {
          // eslint-disable-next-line no-console
          console.log(
            `[syde:context] skipped ${collected.skipped.length} files`,
            collected.skipped.slice(0, 10)
          )
        }
        // eslint-disable-next-line no-console
        console.log(
          `[syde:context] mode=${contextMode} files=${context.length} chars=${collected.totalChars}`
        )
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[syde:context] failed', e)
      }

      // Ensure session exists
      let sid = sessionId
      if (sid == null) {
        const session = await window.syde.db.createSession(activeFilePath)
        sid = session.id
        setSessionId(sid)
      }

      const requestId = makeId()
      const userItem: ChatItem = {
        id: makeId(),
        role: 'user',
        content: instruction,
        scopeLevel,
        mode
      }
      const assistantItem: ChatItem = {
        id: makeId(),
        role: 'assistant',
        content: '',
        scopeLevel,
        mode,
        streaming: true
      }
      appendChat(userItem)
      appendChat(assistantItem)
      setStreamingId(assistantItem.id)

      // Persist user message
      void window.syde.db.appendMessage({
        sessionId: sid,
        role: 'user',
        content: instruction,
        scopeLevel,
        mode
      })

      const scope: Scope = {
        level: scopeLevel,
        content: scopeContent,
        range: effectiveRange ?? undefined,
        filePath: activeFilePath ?? undefined
      }

      const chatHistory = chat
        .filter((c) => !c.streaming && !c.error)
        .map((c) => ({ role: c.role, content: c.content }))

      const req: LLMRequest = {
        requestId,
        mode,
        scope,
        context,
        instruction,
        chatHistory,
        sessionId: sid,
        filePath: activeFilePath ?? undefined
      }

      inflight.current.set(requestId, {
        chatItemId: assistantItem.id,
        mode,
        scopeLevel,
        scopeRange: effectiveRange,
        accum: '',
        prevContent: scopeContent,
        filePath: activeFilePath ?? null,
        workspaceRoot: workspaceRoot ?? null
      })

      try {
        // eslint-disable-next-line no-console
        console.log('[syde:llm] submit', { requestId, mode, scopeLevel, contextCount: context.length, scopeChars: scopeContent.length })
        setLastEvent('sent · waiting for first token…')
        await window.syde.llm.start(req)
      } catch (e) {
        const err = e as Error
        patchChat(assistantItem.id, {
          content: `Error: ${err.message}`,
          streaming: false,
          error: err.message
        })
        inflight.current.delete(requestId)
        setStreamingId(null)
        setLastError(err.message)
        setLastEvent(`error: ${err.message}`)
      }
    },
    [
      mode,
      scopeLevel,
      scopeRange,
      activeFilePath,
      activeContent,
      pinnedFiles,
      contextMode,
      workspaceRoot,
      sessionId,
      setSessionId,
      chat,
      appendChat,
      patchChat,
      setStreamingId,
      openRight,
      setLastError,
      setLastEvent
    ]
  )

  const cancel = useCallback(() => {
    void window.syde.llm.cancel()
  }, [])

  return { submit, cancel }
}
