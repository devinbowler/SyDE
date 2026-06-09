import { useStore } from '../store'
import type { ContextMode, Mode, ScopeLevel } from '../types'

const SCOPE_OPTIONS: { value: ScopeLevel; label: string; hint: string }[] = [
  { value: 'line', label: 'line', hint: 'cursor line only' },
  { value: 'block', label: 'block', hint: 'enclosing block at cursor (or selection)' },
  { value: 'file', label: 'file', hint: 'whole active file' },
  { value: 'project', label: 'project', hint: 'pinned / project context + active file' },
  { value: 'custom', label: 'custom', hint: 'arbitrary range from selection' }
]

const MODE_OPTIONS: { value: Mode; label: string; hint: string }[] = [
  { value: 'ask', label: 'ask', hint: 'read-only Q&A' },
  { value: 'edit', label: 'edit', hint: 'apply directly to scope' },
  { value: 'agent', label: 'agent', hint: 'multi-step edits' }
]

const CONTEXT_OPTIONS: { value: ContextMode; label: string; hint: string }[] = [
  { value: 'none', label: 'none', hint: 'no extra files' },
  { value: 'pinned', label: 'pinned', hint: 'files checked in the file tree' },
  { value: 'file', label: 'file', hint: 'just the active file' },
  {
    value: 'project',
    label: 'project',
    hint: 'all relevant project files (excludes node_modules, files >250 lines, binaries)'
  }
]

const SCOPE_COLORS: Record<ScopeLevel, string> = {
  line: 'bg-scope-line',
  block: 'bg-scope-block',
  file: 'bg-scope-file',
  project: 'bg-scope-project',
  custom: 'bg-scope-custom'
}

function PillSelector<T extends string>({
  value,
  options,
  onChange,
  colors,
  label
}: {
  value: T
  options: { value: T; label: string; hint: string }[]
  onChange: (v: T) => void
  colors?: Record<string, string>
  label: string
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="select-none text-2xs uppercase tracking-[0.18em] text-fg-dim">
        {label}
      </span>
      <div className="flex items-center gap-0.5 rounded-md bg-bg-subtle p-0.5">
        {options.map((o) => {
          const active = o.value === value
          return (
            <button
              key={o.value}
              title={o.hint}
              onClick={() => onChange(o.value)}
              className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors ${
                active
                  ? 'bg-bg-raised text-fg-base ring-1 ring-border'
                  : 'text-fg-muted hover:text-fg-base'
              }`}
            >
              {colors && (
                <span
                  className={`h-1.5 w-1.5 rounded-full ${colors[o.value]} ${
                    active ? '' : 'opacity-50'
                  }`}
                />
              )}
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function ScopeBar() {
  const scopeLevel = useStore((s) => s.scopeLevel)
  const setScopeLevel = useStore((s) => s.setScopeLevel)
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)
  const contextMode = useStore((s) => s.contextMode)
  const setContextMode = useStore((s) => s.setContextMode)
  const scopeRange = useStore((s) => s.scopeRange)
  const activeFilePath = useStore((s) => s.activeFilePath)
  const pinnedCount = useStore((s) => s.pinnedFiles.size)
  const streamingId = useStore((s) => s.streamingId)
  const lastError = useStore((s) => s.lastError)
  const lastEvent = useStore((s) => s.lastEvent)
  const setLastError = useStore((s) => s.setLastError)

  const scopeBadge = (() => {
    if (scopeLevel === 'project') {
      return contextMode === 'project'
        ? 'project context + active'
        : `${pinnedCount} pinned + active`
    }
    if (scopeLevel === 'file') {
      return activeFilePath ? 'whole file' : 'no file'
    }
    if (scopeLevel === 'line') {
      return scopeRange ? `L${scopeRange.startLine}` : 'cursor line'
    }
    if (scopeLevel === 'block') {
      if (!scopeRange) return 'no block'
      if (scopeRange.startLine === scopeRange.endLine) {
        return `block · L${scopeRange.startLine}`
      }
      return `block · L${scopeRange.startLine}–${scopeRange.endLine}`
    }
    if (!scopeRange) return 'no selection'
    if (scopeRange.startLine === scopeRange.endLine) {
      return `L${scopeRange.startLine}`
    }
    return `L${scopeRange.startLine}–${scopeRange.endLine}`
  })()

  const contextBadge =
    contextMode === 'pinned'
      ? `${pinnedCount} pinned`
      : contextMode === 'project'
      ? 'project'
      : contextMode === 'file'
      ? 'active'
      : 'none'

  const statusKind: 'idle' | 'streaming' | 'error' | 'info' = lastError
    ? 'error'
    : streamingId
    ? 'streaming'
    : lastEvent
    ? 'info'
    : 'idle'

  const statusBg =
    statusKind === 'error'
      ? 'bg-rose-950/40 text-rose-200'
      : statusKind === 'streaming'
      ? 'bg-accent/10 text-accent'
      : statusKind === 'info'
      ? 'bg-bg-subtle text-fg-muted'
      : 'bg-bg-panel text-fg-muted'

  const statusDot =
    statusKind === 'error'
      ? 'bg-rose-400'
      : statusKind === 'streaming'
      ? 'animate-pulse bg-accent'
      : statusKind === 'info'
      ? 'bg-fg-subtle'
      : 'bg-fg-dim'

  const statusText =
    statusKind === 'error'
      ? `error · ${lastError}`
      : statusKind === 'streaming'
      ? lastEvent ?? 'streaming…'
      : statusKind === 'info'
      ? lastEvent
      : 'idle'

  return (
    <div className="flex flex-col border-t border-border-subtle bg-bg-panel">
      {/* Status strip — always visible. Left: streaming/error/info. Right: scope info. */}
      <div
        className={`flex items-center justify-between gap-3 border-b border-border-subtle px-3 py-1 text-2xs ${statusBg}`}
      >
        <div className="flex min-w-0 items-center gap-2 truncate">
          <span className={`h-1.5 w-1.5 flex-none rounded-full ${statusDot}`} />
          <span className="truncate">{statusText}</span>
          {lastError && (
            <button
              onClick={() => setLastError(null)}
              className="rounded px-1.5 py-0.5 text-2xs text-fg-muted hover:bg-bg-hover hover:text-fg-base"
            >
              dismiss
            </button>
          )}
        </div>
        <div className="flex flex-none items-center gap-2 text-fg-muted">
          <span
            className={`h-1.5 w-1.5 rounded-full ${SCOPE_COLORS[scopeLevel]}`}
          />
          <span>{scopeBadge}</span>
          <span className="text-fg-dim">·</span>
          <span className="text-fg-subtle">ctx: {contextBadge}</span>
        </div>
      </div>

      {/* Settings strip: scope · mode · context */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
        <PillSelector
          label="scope"
          value={scopeLevel}
          options={SCOPE_OPTIONS}
          onChange={setScopeLevel}
          colors={SCOPE_COLORS}
        />
        <div className="syde-divider" />
        <PillSelector
          label="mode"
          value={mode}
          options={MODE_OPTIONS}
          onChange={setMode}
        />
        <div className="syde-divider" />
        <PillSelector
          label="context"
          value={contextMode}
          options={CONTEXT_OPTIONS}
          onChange={setContextMode}
        />
      </div>
    </div>
  )
}
