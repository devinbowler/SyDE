import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import type { LLMProvider, ProviderSettings, SydeSettings } from '../types'

interface Props {
  open: boolean
  onClose: () => void
}

const KEY_PLACEHOLDER = '••••••••••••••••••••••••••••••••••••'

interface ProviderMeta {
  id: LLMProvider
  label: string
  envVarName: string
  keyPlaceholder: string
  modelDefault: string
  modelPresets: string[]
  helpUrl: string
  helpLabel: string
}

const PROVIDERS: ProviderMeta[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    envVarName: 'ANTHROPIC_API_KEY',
    keyPlaceholder: 'sk-ant-api03-…',
    modelDefault: 'claude-sonnet-4-6',
    modelPresets: [
      'claude-sonnet-4-6',
      'claude-opus-4-7',
      'claude-haiku-4',
      'claude-3-5-sonnet-latest'
    ],
    helpUrl: 'https://console.anthropic.com/settings/keys',
    helpLabel: 'console.anthropic.com'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    envVarName: 'OPENAI_API_KEY',
    keyPlaceholder: 'sk-…',
    modelDefault: 'gpt-4o',
    modelPresets: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o3-mini'],
    helpUrl: 'https://platform.openai.com/api-keys',
    helpLabel: 'platform.openai.com'
  }
]

function describeKeySource(p: ProviderSettings, meta: ProviderMeta, encrypted: boolean): string {
  if (p.apiKeySource === 'env') return `environment variable (${meta.envVarName})`
  if (p.apiKeySource === 'stored') {
    return encrypted ? 'stored locally (encrypted)' : 'stored locally (plaintext fallback)'
  }
  return 'not configured'
}

export function SettingsModal({ open, onClose }: Props) {
  const setLastError = useStore((s) => s.setLastError)
  const setLastEvent = useStore((s) => s.setLastEvent)

  const [settings, setSettings] = useState<SydeSettings | null>(null)
  const [tab, setTab] = useState<LLMProvider>('anthropic')
  const [keyInputs, setKeyInputs] = useState<Record<LLMProvider, string>>({
    anthropic: '',
    openai: ''
  })
  const [modelInputs, setModelInputs] = useState<Record<LLMProvider, string>>({
    anthropic: '',
    openai: ''
  })
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{
    provider: LLMProvider
    ok: boolean
    text: string
  } | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    void window.syde.settings.get().then((s) => {
      setSettings(s)
      setTab(s.activeProvider)
      setModelInputs({
        anthropic: s.providers.anthropic.model,
        openai: s.providers.openai.model
      })
      setKeyInputs({ anthropic: '', openai: '' })
      setTestResult(null)
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const meta = PROVIDERS.find((p) => p.id === tab)!
  const provState = settings?.providers[tab]
  const sourceLabel = settings && provState
    ? describeKeySource(provState, meta, settings.encryptionAvailable)
    : 'loading…'

  const setKey = (v: string) => {
    setKeyInputs((s) => ({ ...s, [tab]: v }))
    setTestResult(null)
  }
  const setModel = (v: string) => setModelInputs((s) => ({ ...s, [tab]: v }))

  const setActiveProvider = async (p: LLMProvider) => {
    try {
      const updated = await window.syde.settings.set({ activeProvider: p })
      setSettings(updated)
      setLastEvent(`active provider → ${p}`)
    } catch (e) {
      setLastError((e as Error).message)
    }
  }

  const save = async (clearKey = false) => {
    const keyInput = keyInputs[tab]
    const modelInput = modelInputs[tab]
    const hasChanges =
      clearKey ||
      keyInput.trim().length > 0 ||
      (modelInput.trim().length > 0 && modelInput.trim() !== provState?.model)

    if (!hasChanges) {
      onClose()
      return
    }

    setSaving(true)
    try {
      const updated = await window.syde.settings.set({
        provider: tab,
        apiKey: clearKey ? null : keyInput.trim() ? keyInput.trim() : undefined,
        model: modelInput.trim() ? modelInput.trim() : undefined
      })
      setSettings(updated)
      setKeyInputs((s) => ({ ...s, [tab]: '' }))
      setLastError(null)
      setLastEvent(clearKey ? `${meta.label} key cleared` : `${meta.label} settings saved`)
      onClose()
    } catch (e) {
      setLastError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    const candidate = keyInputs[tab].trim()
    if (!candidate) {
      setTestResult({ provider: tab, ok: false, text: 'Enter a key first' })
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.syde.settings.testKey(tab, candidate)
      if (result.ok) {
        setTestResult({
          provider: tab,
          ok: true,
          text: `valid · model "${result.model}" responded`
        })
      } else {
        setTestResult({
          provider: tab,
          ok: false,
          text: result.error ?? 'failed'
        })
      }
    } catch (e) {
      setTestResult({ provider: tab, ok: false, text: (e as Error).message })
    } finally {
      setTesting(false)
    }
  }

  const isActive = settings?.activeProvider === tab

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        className="mt-20 w-full max-w-xl rounded-lg border border-border bg-bg-panel shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-fg-base">Settings</div>
            <div className="text-2xs text-fg-subtle">
              Stored at{' '}
              <code className="rounded bg-bg-subtle px-1 py-0.5 text-fg-muted">
                userData/syde.db
              </code>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-base"
            title="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14">
              <path
                d="M3 3 L11 11 M11 3 L3 11"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Active provider picker — applies immediately, separate from save */}
        <div className="flex items-center gap-3 border-b border-border-subtle px-4 py-2.5">
          <span className="text-2xs uppercase tracking-[0.18em] text-fg-dim">
            Active provider
          </span>
          <div className="flex items-center gap-0.5 rounded-md bg-bg-subtle p-0.5">
            {PROVIDERS.map((p) => {
              const isOn = settings?.activeProvider === p.id
              const ready = settings?.providers[p.id].hasApiKey
              return (
                <button
                  key={p.id}
                  onClick={() => void setActiveProvider(p.id)}
                  className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors ${
                    isOn
                      ? 'bg-bg-raised text-fg-base ring-1 ring-border'
                      : 'text-fg-muted hover:text-fg-base'
                  }`}
                  title={
                    ready
                      ? `Use ${p.label} for ask & edit`
                      : `${p.label} (no key configured yet)`
                  }
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      ready ? 'bg-emerald-500' : 'bg-fg-dim'
                    } ${isOn ? '' : 'opacity-50'}`}
                  />
                  {p.label}
                </button>
              )
            })}
          </div>
          <div className="flex-1" />
          {settings && (
            <span className="text-2xs text-fg-subtle">
              using <span className="text-fg-muted">{settings.providers[settings.activeProvider].model}</span>
            </span>
          )}
        </div>

        {/* Provider tabs (configure each independently) */}
        <div className="flex items-center gap-0 border-b border-border-subtle px-4">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setTab(p.id)
                setTestResult(null)
              }}
              className={`relative px-3 py-2 text-xs transition-colors ${
                tab === p.id
                  ? 'text-fg-base'
                  : 'text-fg-muted hover:text-fg-base'
              }`}
            >
              {p.label}
              {tab === p.id && (
                <span className="absolute inset-x-3 -bottom-px h-px bg-accent" />
              )}
            </button>
          ))}
          <div className="flex-1" />
          {isActive && (
            <span className="rounded bg-accent/15 px-1.5 py-0.5 text-2xs text-accent">
              active
            </span>
          )}
        </div>

        <div className="space-y-5 px-4 py-4 syde-selectable">
          {/* API key */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-2xs uppercase tracking-[0.18em] text-fg-dim">
                {meta.label} API key
              </label>
              <span
                className={`text-2xs ${
                  provState?.apiKeySource === 'none'
                    ? 'text-rose-400'
                    : 'text-fg-muted'
                }`}
              >
                {sourceLabel}
              </span>
            </div>
            <div className="mt-1.5 flex items-stretch gap-1.5">
              <div className="flex flex-1 items-center rounded-md border border-border-subtle bg-bg-subtle px-2.5 focus-within:ring-1 focus-within:ring-accent/60">
                <input
                  type={showKey ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  value={keyInputs[tab]}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={
                    provState?.hasApiKey ? KEY_PLACEHOLDER : meta.keyPlaceholder
                  }
                  className="syde-selectable flex-1 bg-transparent py-1.5 font-mono text-xs text-fg-base placeholder:text-fg-dim focus:outline-none"
                />
                <button
                  onClick={() => setShowKey((v) => !v)}
                  className="ml-2 rounded px-1.5 py-0.5 text-2xs text-fg-subtle hover:bg-bg-hover hover:text-fg-muted"
                  title={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey ? 'hide' : 'show'}
                </button>
              </div>
              <button
                onClick={() => void test()}
                disabled={testing || !keyInputs[tab].trim()}
                className="rounded-md border border-border-subtle bg-bg-subtle px-3 text-xs text-fg-base transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                {testing ? 'testing…' : 'test'}
              </button>
            </div>
            {testResult && testResult.provider === tab && (
              <div
                className={`mt-1.5 text-2xs ${
                  testResult.ok ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {testResult.ok ? '✓ ' : '✗ '}
                {testResult.text}
              </div>
            )}
            <div className="mt-1.5 text-2xs text-fg-subtle">
              {settings?.encryptionAvailable
                ? 'Stored encrypted via your OS keychain (Windows DPAPI / macOS Keychain / libsecret).'
                : 'OS keychain unavailable — key would be stored as plaintext in syde.db. Use the env var instead if that worries you.'}
              {provState?.apiKeySource === 'env' && (
                <span className="ml-1 text-fg-muted">
                  Environment variable takes precedence over stored value.
                </span>
              )}
              <span className="ml-1 text-fg-dim">
                Get a key at{' '}
                <a
                  href={meta.helpUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-fg-muted underline decoration-fg-dim underline-offset-2 hover:text-fg-base"
                >
                  {meta.helpLabel}
                </a>
                .
              </span>
            </div>
          </div>

          {/* Model */}
          <div>
            <label className="text-2xs uppercase tracking-[0.18em] text-fg-dim">
              {meta.label} model
            </label>
            <input
              value={modelInputs[tab]}
              onChange={(e) => setModel(e.target.value)}
              spellCheck={false}
              placeholder={meta.modelDefault}
              className="syde-selectable mt-1.5 w-full rounded-md border border-border-subtle bg-bg-subtle px-2.5 py-1.5 font-mono text-xs text-fg-base placeholder:text-fg-dim focus:outline-none focus:ring-1 focus:ring-accent/60"
            />
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <span className="mr-1 text-2xs text-fg-dim">presets:</span>
              {meta.modelPresets.map((preset) => (
                <button
                  key={preset}
                  onClick={() => setModel(preset)}
                  className={`rounded border px-1.5 py-0.5 font-mono text-2xs transition-colors ${
                    modelInputs[tab] === preset
                      ? 'border-accent/60 bg-accent/15 text-fg-base'
                      : 'border-border-subtle bg-bg-subtle text-fg-muted hover:bg-bg-hover hover:text-fg-base'
                  }`}
                  title={`Use ${preset}`}
                >
                  {preset}
                </button>
              ))}
            </div>
            <div className="mt-1.5 text-2xs text-fg-subtle">
              Default:{' '}
              <code className="rounded bg-bg-subtle px-1 py-0.5 text-fg-muted">
                {meta.modelDefault}
              </code>
              . Free-form — type any model id the {meta.label} API accepts.
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border-subtle px-4 py-3">
          <button
            onClick={() => void save(true)}
            disabled={!provState?.hasApiKey || provState?.apiKeySource === 'env'}
            className="rounded-md px-2.5 py-1 text-2xs text-rose-400 transition-colors hover:bg-rose-950/30 disabled:cursor-not-allowed disabled:opacity-30"
            title={
              provState?.apiKeySource === 'env'
                ? 'Env var keys cannot be cleared from the UI'
                : `Remove the stored ${meta.label} key`
            }
          >
            clear stored key
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-md border border-border-subtle bg-bg-subtle px-3 py-1.5 text-xs text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-base"
            >
              cancel
            </button>
            <button
              onClick={() => void save(false)}
              disabled={saving}
              className="rounded-md border border-border bg-accent/20 px-3 py-1.5 text-xs text-fg-base transition-colors hover:bg-accent/30 disabled:opacity-40"
            >
              {saving ? 'saving…' : 'save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
