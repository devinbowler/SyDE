import Anthropic from '@anthropic-ai/sdk'
import { getSecret } from './db'
import type { LLMRequest, Mode, Scope } from '@shared/types'

export const API_KEY_PREF = 'anthropic_api_key'
export const MODEL_PREF = 'syde_model'

const DEFAULT_MODEL_FALLBACK = 'claude-sonnet-4-6'
const MAX_TOKENS = Number(process.env.SYDE_MAX_TOKENS ?? '4096')

function getModel(): string {
  return process.env.SYDE_MODEL ?? getSecret(MODEL_PREF) ?? DEFAULT_MODEL_FALLBACK
}

export function getApiKeySource(): 'env' | 'stored' | 'none' {
  if (process.env.ANTHROPIC_API_KEY) return 'env'
  if (getSecret(API_KEY_PREF)) return 'stored'
  return 'none'
}

function resolveApiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY ?? getSecret(API_KEY_PREF)
}

function buildSystemPrompt(mode: Mode, scope: Scope, contextCount: number): string {
  const lines: string[] = []

  lines.push(
    'You are SyDE, an in-editor coding assistant. The developer is intentionally constraining what you may see and what you may change. Respect those constraints absolutely.'
  )

  // Scope rules
  switch (scope.level) {
    case 'line':
      lines.push(
        'SCOPE: SINGLE LINE. You may only return a replacement for the exact single line of code provided. Do not modify, suggest changes to, or reference any other line. Do not add new lines.'
      )
      break
    case 'block':
      lines.push(
        'SCOPE: BLOCK. You may only return a replacement for the exact selected block of code. Do not reference, modify, or return any code outside this block. Preserve surrounding indentation.'
      )
      break
    case 'file':
      lines.push(
        'SCOPE: FILE. You may rewrite the entire active file, but you may not assume anything about other files unless they are explicitly provided as CONTEXT below.'
      )
      break
    case 'project':
      lines.push(
        'SCOPE: PROJECT. You may reason across the provided context files. In edit mode, the developer expects a replacement for the active file unless they ask otherwise. In agent mode, you may propose multiple sequential edits, but each must target a specific file already in scope.'
      )
      break
    case 'custom':
      lines.push(
        'SCOPE: CUSTOM RANGE. You may only return a replacement for the exact custom range provided. Do not reference, modify, or return any code outside this range.'
      )
      break
  }

  // Mode rules
  switch (mode) {
    case 'ask':
      lines.push(
        'MODE: ASK (read-only). Do not attempt to write code into the editor. Answer the question conversationally. You may show short code snippets in fenced code blocks for illustration, but they will not be applied.'
      )
      break
    case 'edit':
      lines.push(
        'MODE: EDIT. Your entire response will be inserted directly into the editor at the scoped range. Output ONLY the replacement code. No explanations. No prose. No code fences. No leading or trailing commentary. If you cannot satisfy the request within the scope, output the original code unchanged.'
      )
      break
    case 'agent':
      lines.push(
        'MODE: AGENT. You may produce a sequence of edits across the provided context. For now, output the replacement code for the active scope only — multi-step orchestration is handled by the editor. No prose, no code fences.'
      )
      break
  }

  if (contextCount > 0) {
    lines.push(
      `CONTEXT: ${contextCount} file(s) have been pinned. They are provided below for reading only. Do not assume anything about files not pinned.`
    )
  } else {
    lines.push('CONTEXT: no files pinned. Reason only from the scope.')
  }

  lines.push(
    'Style: terse, surgical, no filler. The developer is the architect; you are a precision tool.'
  )

  return lines.join('\n\n')
}

function buildUserMessage(req: LLMRequest): string {
  const parts: string[] = []

  if (req.context.length > 0) {
    parts.push('--- PINNED CONTEXT ---')
    for (const f of req.context) {
      parts.push(`\n# ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
    }
    parts.push('--- END CONTEXT ---\n')
  }

  parts.push(
    `--- SCOPE (${req.scope.level}${req.scope.filePath ? ` · ${req.scope.filePath}` : ''}) ---`
  )
  parts.push('```')
  parts.push(req.scope.content)
  parts.push('```')
  parts.push('--- END SCOPE ---\n')

  parts.push('--- INSTRUCTION ---')
  parts.push(req.instruction)

  return parts.join('\n')
}

export interface StreamHandlers {
  onStart: () => void
  onDelta: (text: string) => void
  onEnd: (fullText: string) => void
  onError: (err: string) => void
}

export class LLMSession {
  private client: Anthropic | null = null
  private cachedKey: string | null = null
  private active: AbortController | null = null

  private getClient(): Anthropic {
    const key = resolveApiKey()
    if (!key) {
      throw new Error(
        'No Anthropic API key configured. Open Settings (gear icon, top right) to add one.'
      )
    }
    if (this.client && this.cachedKey === key) return this.client
    this.client = new Anthropic({ apiKey: key })
    this.cachedKey = key
    return this.client
  }

  /** Drop the cached client so the next request rebuilds it from the latest key. */
  invalidateClient(): void {
    this.client = null
    this.cachedKey = null
  }

  cancel(): void {
    if (this.active) {
      this.active.abort()
      this.active = null
    }
  }

  /** Validate a candidate key against the API without permanently storing it. */
  async testKey(apiKey: string): Promise<{ ok: boolean; error?: string; model?: string }> {
    if (!apiKey) return { ok: false, error: 'empty key' }
    const model = getModel()
    try {
      const c = new Anthropic({ apiKey })
      await c.messages.create({
        model,
        max_tokens: 4,
        messages: [{ role: 'user', content: 'ping' }]
      })
      return { ok: true, model }
    } catch (e) {
      const err = e as { message?: string; status?: number }
      const msg = err.status
        ? `${err.status}: ${err.message ?? 'request failed'}`
        : err.message ?? 'request failed'
      return { ok: false, error: msg, model }
    }
  }

  async run(req: LLMRequest, handlers: StreamHandlers): Promise<void> {
    let client: Anthropic
    try {
      client = this.getClient()
    } catch (e) {
      const msg = (e as Error).message
      console.error('[syde:llm] client init error:', msg)
      handlers.onError(msg)
      return
    }

    const system = buildSystemPrompt(req.mode, req.scope, req.context.length)
    const userContent = buildUserMessage(req)

    const messages: { role: 'user' | 'assistant'; content: string }[] = []
    for (const m of req.chatHistory) {
      messages.push({ role: m.role, content: m.content })
    }
    messages.push({ role: 'user', content: userContent })

    this.active = new AbortController()
    handlers.onStart()

    const model = getModel()
    console.log(
      `[syde:llm] start request=${req.requestId} model=${model} mode=${req.mode} scope=${req.scope.level} ctx=${req.context.length} scopeChars=${req.scope.content.length} histChars=${req.chatHistory.reduce((n, m) => n + m.content.length, 0)}`
    )

    let full = ''
    try {
      const stream = client.messages.stream(
        {
          model,
          max_tokens: MAX_TOKENS,
          system,
          messages
        },
        { signal: this.active.signal }
      )

      stream.on('text', (delta: string) => {
        full += delta
        handlers.onDelta(delta)
      })

      stream.on('error', (e: unknown) => {
        const err = e as Error
        console.error('[syde:llm] stream error:', err.message ?? err)
      })

      const final = await stream.finalMessage()
      if (!full && final.content) {
        for (const block of final.content) {
          if (block.type === 'text') full += block.text
        }
      }
      const usage = final.usage
        ? `in=${final.usage.input_tokens} out=${final.usage.output_tokens}`
        : ''
      console.log(
        `[syde:llm] end request=${req.requestId} chars=${full.length} ${usage} stop=${final.stop_reason ?? '?'}`
      )
      handlers.onEnd(full)
    } catch (e) {
      const err = e as Error
      if (err.name === 'AbortError') {
        console.log(`[syde:llm] aborted request=${req.requestId} chars=${full.length}`)
        handlers.onEnd(full)
      } else {
        console.error(`[syde:llm] error request=${req.requestId}:`, err.message ?? err)
        handlers.onError(err.message ?? String(err))
      }
    } finally {
      this.active = null
    }
  }
}
