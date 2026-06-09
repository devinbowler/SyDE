import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import type { SydeSettings } from '../types'

interface Props {
  open: boolean
  onClose: () => void
}

const KEY_PLACEHOLDER = '••••••••••••••••••••••••••••••••••••'

export function SettingsModal({ open, onClose }: Props) {
  const setLastError = useStore((s) => s.setLastError)
  const setLastEvent = useStore((s) => s.setLastEvent)

  const [settings, setSettings] = useState<SydeSettings | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [modelInput, setModelInput] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{
    ok: boolean
    text: string
  } | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    void window.syde.settings.get().then((s) => {
      setSettings(s)
      setModelInput(s.model)
      setKeyInput('')
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

  const sourceLabel = settings
    ? settings.apiKeySource === 'env'
      ? 'environment variable (ANTHROPIC_API_KEY)'
      : settings.apiKeySource === 'stored'
      ? settings.encryptionAvailable
        ? 'stored locally (encrypted)'
        : 'stored locally (plaintext fallback)'
      : 'not configured'
    : 'loading…'

  const save = async (clear = false) => {
    if (!clear && !keyInput && !modelInput) {
      onClose()
      return
    }
    setSaving(true)
    try {
      const updated = await window.syde.settings.set({
        apiKey: clear
          ? null
          : keyInput.trim()
          ? keyInput.trim()
          : undefined,
        model: modelInput.trim() ? modelInput.trim() : undefined
      })
      setSettings(updated)
      setKeyInput('')
      setLastError(null)
      setLastEvent(
        clear ? 'API key cleared' : 'settings saved'
      )
      onClose()
    } catch (e) {
      setLastError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    const candidate = keyInput.trim()
    if (!candidate) {
      setTestResult({ ok: false, text: 'Enter a key first' })
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.syde.settings.testKey(candidate)
      if (result.ok) {
        setTestResult({
          ok: true,
          text: `valid · model "${result.model}" responded`
        })
      } else {
        setTestResult({ ok: false, text: result.error ?? 'failed' })
      }
    } catch (e) {
      setTestResult({ ok: false, text: (e as Error).message })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        className="mt-24 w-full max-w-lg rounded-lg border border-border bg-bg-panel shadow-2xl"
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

        <div className="space-y-5 px-4 py-4 syde-selectable">
          {/* API key */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-2xs uppercase tracking-[0.18em] text-fg-dim">
                Anthropic API key
              </label>
              <span
                className={`text-2xs ${
                  settings?.apiKeySource === 'none'
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
                  value={keyInput}
                  onChange={(e) => {
                    setKeyInput(e.target.value)
                    setTestResult(null)
                  }}
                  placeholder={
                    settings?.hasApiKey
                      ? KEY_PLACEHOLDER
                      : 'sk-ant-api03-…'
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
                disabled={testing || !keyInput.trim()}
                className="rounded-md border border-border-subtle bg-bg-subtle px-3 text-xs text-fg-base transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                {testing ? 'testing…' : 'test'}
              </button>
            </div>
            {testResult && (
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
              {settings?.apiKeySource === 'env' && (
                <span className="ml-1 text-fg-muted">
                  Environment variable takes precedence over stored value.
                </span>
              )}
            </div>
          </div>

          {/* Model */}
          <div>
            <label className="text-2xs uppercase tracking-[0.18em] text-fg-dim">
              Model
            </label>
            <input
              value={modelInput}
              onChange={(e) => setModelInput(e.target.value)}
              spellCheck={false}
              placeholder="claude-sonnet-4-6"
              className="syde-selectable mt-1.5 w-full rounded-md border border-border-subtle bg-bg-subtle px-2.5 py-1.5 font-mono text-xs text-fg-base placeholder:text-fg-dim focus:outline-none focus:ring-1 focus:ring-accent/60"
            />
            <div className="mt-1.5 text-2xs text-fg-subtle">
              The Anthropic model id. Defaults to{' '}
              <code className="rounded bg-bg-subtle px-1 py-0.5 text-fg-muted">
                claude-sonnet-4-6
              </code>
              . Override via the{' '}
              <code className="rounded bg-bg-subtle px-1 py-0.5 text-fg-muted">
                SYDE_MODEL
              </code>{' '}
              env var if you prefer.
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border-subtle px-4 py-3">
          <button
            onClick={() => void save(true)}
            disabled={!settings?.hasApiKey || settings?.apiKeySource === 'env'}
            className="rounded-md px-2.5 py-1 text-2xs text-rose-400 transition-colors hover:bg-rose-950/30 disabled:cursor-not-allowed disabled:opacity-30"
            title={
              settings?.apiKeySource === 'env'
                ? 'Env var keys cannot be cleared from the UI'
                : 'Remove the stored key'
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
