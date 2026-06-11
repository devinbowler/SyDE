import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { getSecret } from './db'
import type {
  LLMProvider,
  LLMRequest,
  Mode,
  Scope,
  TokenUsage
} from '@shared/types'

// ── Preference keys (string-keyed, persisted in syde.db) ──────────────────
//
// Provider-scoped:
export const ANTHROPIC_API_KEY_PREF = 'anthropic_api_key'
export const ANTHROPIC_MODEL_PREF = 'anthropic_model'
export const OPENAI_API_KEY_PREF = 'openai_api_key'
export const OPENAI_MODEL_PREF = 'openai_model'
//
// Which provider is currently active (used by `run` for both ask and edit):
export const ACTIVE_PROVIDER_PREF = 'active_provider'
//
// Backwards-compat aliases. Earlier builds stored the Anthropic key under
// `anthropic_api_key` (already provider-scoped — unchanged) and the model
// under the generic key `syde_model`. We migrate seamlessly by reading the
// old key as a fallback, so nobody loses their settings on upgrade.
export const LEGACY_MODEL_PREF = 'syde_model'

// Preserved for callers that imported these names from older builds. They
// now point at the Anthropic-scoped versions.
export const API_KEY_PREF = ANTHROPIC_API_KEY_PREF
export const MODEL_PREF = ANTHROPIC_MODEL_PREF

// ── Defaults ──────────────────────────────────────────────────────────────
const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-4-6'
const OPENAI_DEFAULT_MODEL = 'gpt-4o'
const MAX_TOKENS = Number(process.env.SYDE_MAX_TOKENS ?? '4096')

// ── Provider helpers ──────────────────────────────────────────────────────

export function getActiveProvider(): LLMProvider {
  const stored = getSecret(ACTIVE_PROVIDER_PREF)
  if (stored === 'openai') return 'openai'
  return 'anthropic'
}

export function getApiKeySource(
  provider: LLMProvider = getActiveProvider()
): 'env' | 'stored' | 'none' {
  if (provider === 'anthropic') {
    if (process.env.ANTHROPIC_API_KEY) return 'env'
    if (getSecret(ANTHROPIC_API_KEY_PREF)) return 'stored'
    return 'none'
  }
  if (process.env.OPENAI_API_KEY) return 'env'
  if (getSecret(OPENAI_API_KEY_PREF)) return 'stored'
  return 'none'
}

function resolveApiKey(provider: LLMProvider): string | null {
  if (provider === 'anthropic') {
    return process.env.ANTHROPIC_API_KEY ?? getSecret(ANTHROPIC_API_KEY_PREF)
  }
  return process.env.OPENAI_API_KEY ?? getSecret(OPENAI_API_KEY_PREF)
}

export function getModelFor(provider: LLMProvider): string {
  if (provider === 'anthropic') {
    return (
      process.env.SYDE_MODEL ??
      getSecret(ANTHROPIC_MODEL_PREF) ??
      getSecret(LEGACY_MODEL_PREF) ??
      ANTHROPIC_DEFAULT_MODEL
    )
  }
  return getSecret(OPENAI_MODEL_PREF) ?? OPENAI_DEFAULT_MODEL
}

export function getDefaultModelFor(provider: LLMProvider): string {
  return provider === 'anthropic' ? ANTHROPIC_DEFAULT_MODEL : OPENAI_DEFAULT_MODEL
}

// ── Prompt builders (provider-agnostic) ───────────────────────────────────

function buildSystemPrompt(mode: Mode, scope: Scope, contextCount: number): string {
  const lines: string[] = []

  lines.push(
    'You are SyDE, an in-editor coding assistant. The developer is intentionally constraining what you may see and what you may change. Respect those constraints absolutely.'
  )

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
        'SCOPE: PROJECT. You may reason across the provided context files. In edit mode, the developer expects a replacement for the active file unless they ask otherwise.'
      )
      break
    case 'custom':
      lines.push(
        'SCOPE: CUSTOM RANGE. You may only return a replacement for the exact custom range provided. Do not reference, modify, or return any code outside this range.'
      )
      break
  }

  switch (mode) {
    case 'ask':
      lines.push(
        'MODE: ASK (read-only). Do not attempt to write code into the editor. Answer the question conversationally. You may show short code snippets in fenced code blocks for illustration, but they will not be applied.'
      )
      break
    case 'edit':
      lines.push(
        [
          'MODE: EDIT. Your entire response is inserted verbatim into the editor at the scoped range.',
          'Output ONLY the replacement code. No explanations. No prose. No leading or trailing commentary.',
          'Do NOT describe what you changed. Do NOT say "Edited", "Rewrote", "Updated", "I changed", "Here is", etc.',
          'Do NOT wrap the code in markdown fences (no ```). Just emit the raw code.',
          'If you literally cannot satisfy the request inside the scope, output the original scope contents unchanged — never produce a summary.'
        ].join(' ')
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
  onEnd: (fullText: string, usage?: TokenUsage) => void
  onError: (err: string) => void
}

// ── Session ───────────────────────────────────────────────────────────────

export class LLMSession {
  private anthropicClient: Anthropic | null = null
  private anthropicKey: string | null = null
  private openaiClient: OpenAI | null = null
  private openaiKey: string | null = null
  private active: AbortController | null = null

  private getAnthropic(): Anthropic {
    const key = resolveApiKey('anthropic')
    if (!key) {
      throw new Error(
        'No Anthropic API key configured. Open Settings (gear icon, top right) to add one.'
      )
    }
    if (this.anthropicClient && this.anthropicKey === key) return this.anthropicClient
    this.anthropicClient = new Anthropic({ apiKey: key })
    this.anthropicKey = key
    return this.anthropicClient
  }

  private getOpenAI(): OpenAI {
    const key = resolveApiKey('openai')
    if (!key) {
      throw new Error(
        'No OpenAI API key configured. Open Settings (gear icon, top right) to add one.'
      )
    }
    if (this.openaiClient && this.openaiKey === key) return this.openaiClient
    this.openaiClient = new OpenAI({ apiKey: key })
    this.openaiKey = key
    return this.openaiClient
  }

  /** Drop the cached clients so the next request rebuilds them from the latest keys. */
  invalidateClient(): void {
    this.anthropicClient = null
    this.anthropicKey = null
    this.openaiClient = null
    this.openaiKey = null
  }

  cancel(): void {
    if (this.active) {
      this.active.abort()
      this.active = null
    }
  }

  /** Validate a candidate key for the given provider. */
  async testKey(
    provider: LLMProvider,
    apiKey: string
  ): Promise<{ ok: boolean; error?: string; model?: string }> {
    if (!apiKey) return { ok: false, error: 'empty key' }
    const model = getModelFor(provider)
    try {
      if (provider === 'anthropic') {
        const c = new Anthropic({ apiKey })
        await c.messages.create({
          model,
          max_tokens: 4,
          messages: [{ role: 'user', content: 'ping' }]
        })
      } else {
        const c = new OpenAI({ apiKey })
        await c.chat.completions.create({
          model,
          max_tokens: 4,
          messages: [{ role: 'user', content: 'ping' }]
        })
      }
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
    const provider = getActiveProvider()
    if (provider === 'openai') {
      return this.runOpenAI(req, handlers)
    }
    return this.runAnthropic(req, handlers)
  }

  private async runAnthropic(req: LLMRequest, handlers: StreamHandlers): Promise<void> {
    let client: Anthropic
    try {
      client = this.getAnthropic()
    } catch (e) {
      const msg = (e as Error).message
      console.error('[syde:llm] anthropic init error:', msg)
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

    const model = getModelFor('anthropic')
    console.log(
      `[syde:llm] start provider=anthropic request=${req.requestId} model=${model} mode=${req.mode} scope=${req.scope.level} ctx=${req.context.length} scopeChars=${req.scope.content.length} histChars=${req.chatHistory.reduce((n, m) => n + m.content.length, 0)}`
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
        console.error('[syde:llm] anthropic stream error:', err.message ?? err)
      })

      const final = await stream.finalMessage()
      if (!full && final.content) {
        for (const block of final.content) {
          if (block.type === 'text') full += block.text
        }
      }
      const usage: TokenUsage | undefined = final.usage
        ? { input: final.usage.input_tokens, output: final.usage.output_tokens }
        : undefined
      console.log(
        `[syde:llm] end provider=anthropic request=${req.requestId} chars=${full.length} ${
          usage ? `in=${usage.input} out=${usage.output}` : ''
        } stop=${final.stop_reason ?? '?'}`
      )
      handlers.onEnd(full, usage)
    } catch (e) {
      const err = e as Error
      if (err.name === 'AbortError') {
        console.log(`[syde:llm] anthropic aborted request=${req.requestId} chars=${full.length}`)
        handlers.onEnd(full)
      } else {
        console.error(`[syde:llm] anthropic error request=${req.requestId}:`, err.message ?? err)
        handlers.onError(err.message ?? String(err))
      }
    } finally {
      this.active = null
    }
  }

  private async runOpenAI(req: LLMRequest, handlers: StreamHandlers): Promise<void> {
    let client: OpenAI
    try {
      client = this.getOpenAI()
    } catch (e) {
      const msg = (e as Error).message
      console.error('[syde:llm] openai init error:', msg)
      handlers.onError(msg)
      return
    }

    const system = buildSystemPrompt(req.mode, req.scope, req.context.length)
    const userContent = buildUserMessage(req)

    type ChatRole = 'system' | 'user' | 'assistant'
    const messages: { role: ChatRole; content: string }[] = [
      { role: 'system', content: system }
    ]
    for (const m of req.chatHistory) {
      messages.push({ role: m.role, content: m.content })
    }
    messages.push({ role: 'user', content: userContent })

    this.active = new AbortController()
    handlers.onStart()

    const model = getModelFor('openai')
    console.log(
      `[syde:llm] start provider=openai request=${req.requestId} model=${model} mode=${req.mode} scope=${req.scope.level} ctx=${req.context.length} scopeChars=${req.scope.content.length} histChars=${req.chatHistory.reduce((n, m) => n + m.content.length, 0)}`
    )

    let full = ''
    let usage: TokenUsage | undefined
    let stop: string | null | undefined

    try {
      // Some newer OpenAI models (o1/o3 family) don't accept `max_tokens` and
      // require `max_completion_tokens` instead. Most of the gpt-4* family
      // accept either, so prefer the new field across the board.
      const params: Parameters<typeof client.chat.completions.create>[0] = {
        model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        max_completion_tokens: MAX_TOKENS
      }

      const stream = await client.chat.completions.create(params, {
        signal: this.active.signal
      })

      // The streaming overload returns an AsyncIterable<ChatCompletionChunk>.
      for await (const chunk of stream as unknown as AsyncIterable<{
        choices?: Array<{
          delta?: { content?: string | null }
          finish_reason?: string | null
        }>
        usage?: { prompt_tokens?: number; completion_tokens?: number } | null
      }>) {
        const choice = chunk.choices?.[0]
        const delta = choice?.delta?.content
        if (typeof delta === 'string' && delta.length > 0) {
          full += delta
          handlers.onDelta(delta)
        }
        if (choice?.finish_reason) stop = choice.finish_reason
        if (chunk.usage) {
          usage = {
            input: chunk.usage.prompt_tokens ?? 0,
            output: chunk.usage.completion_tokens ?? 0
          }
        }
      }

      console.log(
        `[syde:llm] end provider=openai request=${req.requestId} chars=${full.length} ${
          usage ? `in=${usage.input} out=${usage.output}` : ''
        } stop=${stop ?? '?'}`
      )
      handlers.onEnd(full, usage)
    } catch (e) {
      const err = e as Error
      if (err.name === 'AbortError' || /aborted/i.test(err.message ?? '')) {
        console.log(`[syde:llm] openai aborted request=${req.requestId} chars=${full.length}`)
        handlers.onEnd(full, usage)
      } else {
        console.error(`[syde:llm] openai error request=${req.requestId}:`, err.message ?? err)
        handlers.onError(err.message ?? String(err))
      }
    } finally {
      this.active = null
    }
  }
}
