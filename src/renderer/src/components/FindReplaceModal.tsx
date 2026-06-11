import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, languageFromPath } from '../store'
import type { SearchHit, SearchResult } from '../types'

interface Props {
  open: boolean
  onClose: () => void
}

interface ToggleProps {
  active: boolean
  onClick: () => void
  label: string
  title: string
}

function Toggle({ active, onClick, label, title }: ToggleProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded px-1.5 py-0.5 text-2xs font-mono transition-colors ${
        active
          ? 'bg-accent/20 text-accent ring-1 ring-accent/40'
          : 'text-fg-muted hover:bg-bg-hover hover:text-fg-base'
      }`}
    >
      {label}
    </button>
  )
}

function relPath(filePath: string, root: string | null): string {
  if (!root) return filePath
  const norm = (p: string) => p.replace(/\\/g, '/')
  const f = norm(filePath)
  const r = norm(root.endsWith('/') ? root : root + '/')
  return f.startsWith(r) ? filePath.slice(root.length + 1) : filePath
}

/**
 * Group hits by file for the results pane. Files keep insertion order so
 * results appear in walk order rather than jumping around alphabetically.
 */
function groupByFile(hits: SearchHit[]): { file: string; hits: SearchHit[] }[] {
  const map = new Map<string, SearchHit[]>()
  for (const h of hits) {
    const arr = map.get(h.filePath)
    if (arr) arr.push(h)
    else map.set(h.filePath, [h])
  }
  return Array.from(map.entries()).map(([file, hits]) => ({ file, hits }))
}

export function FindReplaceModal({ open, onClose }: Props) {
  const workspaceRoot = useStore((s) => s.workspaceRoot)
  const openFile = useStore((s) => s.openFile)
  const setLastError = useStore((s) => s.setLastError)
  const setLastEvent = useStore((s) => s.setLastEvent)

  const [pattern, setPattern] = useState('')
  const [replacement, setReplacement] = useState('')
  const [isRegex, setIsRegex] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [searching, setSearching] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [confirming, setConfirming] = useState(false)
  const findRef = useRef<HTMLInputElement>(null)

  // Reset and focus the input every time the modal is freshly opened.
  useEffect(() => {
    if (!open) return
    setResult(null)
    setConfirming(false)
    setReplacing(false)
    setSearching(false)
    setTimeout(() => findRef.current?.focus(), 0)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const groups = useMemo(() => groupByFile(result?.hits ?? []), [result])

  if (!open) return null

  const runSearch = async () => {
    if (!workspaceRoot) {
      setLastError('Open a workspace first.')
      return
    }
    if (!pattern) {
      setResult(null)
      return
    }
    setSearching(true)
    setConfirming(false)
    try {
      const r = await window.syde.fs.projectSearch({
        pattern,
        isRegex,
        caseSensitive,
        wholeWord,
        rootPath: workspaceRoot
      })
      setResult(r)
      setLastEvent(
        `search: ${r.hits.length} hit${r.hits.length === 1 ? '' : 's'} in ${groupByFile(
          r.hits
        ).length} file${r.filesScanned === 1 ? '' : 's'}${r.truncated ? ' (truncated)' : ''}`
      )
    } catch (e) {
      setLastError(`Search failed: ${(e as Error).message}`)
      setResult(null)
    } finally {
      setSearching(false)
    }
  }

  const runReplaceAll = async () => {
    if (!workspaceRoot) return
    if (!pattern) return
    setReplacing(true)
    try {
      const r = await window.syde.fs.projectReplace({
        pattern,
        isRegex,
        caseSensitive,
        wholeWord,
        rootPath: workspaceRoot,
        replacement
      })
      setLastEvent(
        `replace: ${r.replacements} replacement${r.replacements === 1 ? '' : 's'} across ${r.filesChanged} file${r.filesChanged === 1 ? '' : 's'}${
          r.errors.length ? ` · ${r.errors.length} error(s)` : ''
        }`
      )
      if (r.errors.length > 0) {
        setLastError(
          `Replace finished with ${r.errors.length} error(s). First: ${r.errors[0].reason}`
        )
      }
      // Re-run the search so the user can see what's left (should be 0
      // for non-overlapping replacements).
      await runSearch()
      setConfirming(false)
    } catch (e) {
      setLastError(`Replace failed: ${(e as Error).message}`)
    } finally {
      setReplacing(false)
    }
  }

  const onPickHit = async (hit: SearchHit) => {
    try {
      const content = await window.syde.fs.readFile(hit.filePath)
      openFile(hit.filePath, content, languageFromPath(hit.filePath))
      onClose()
      // The editor scroll/cursor adjustment isn't wired through the modal —
      // a future polish pass could snap to the hit's line. For now the file
      // opens at the top.
    } catch (e) {
      setLastError(`Open failed: ${(e as Error).message}`)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="mt-16 flex w-full max-w-3xl flex-col rounded-lg border border-border bg-bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-fg-base">
              Find in project
            </div>
            <div className="text-2xs text-fg-subtle">
              Searches code-shaped files in {workspaceRoot ? 'the workspace' : '(no workspace)'}
              . Skips <code className="rounded bg-bg-subtle px-1">node_modules</code>, lockfiles, binaries.
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-base"
            title="Close (Esc)"
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

        <div className="space-y-2 border-b border-border-subtle px-4 py-3">
          <div className="flex items-stretch gap-1.5">
            <div className="flex flex-1 items-center rounded-md border border-border-subtle bg-bg-subtle px-2.5 focus-within:ring-1 focus-within:ring-accent/60">
              <input
                ref={findRef}
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void runSearch()
                }}
                placeholder="search…"
                spellCheck={false}
                className="syde-selectable flex-1 bg-transparent py-1.5 font-mono text-xs text-fg-base placeholder:text-fg-dim focus:outline-none"
              />
              <div className="flex items-center gap-0.5">
                <Toggle
                  active={caseSensitive}
                  onClick={() => setCaseSensitive((v) => !v)}
                  label="Aa"
                  title="Match case"
                />
                <Toggle
                  active={wholeWord}
                  onClick={() => setWholeWord((v) => !v)}
                  label="ab"
                  title="Match whole word"
                />
                <Toggle
                  active={isRegex}
                  onClick={() => setIsRegex((v) => !v)}
                  label=".*"
                  title="Use regex"
                />
              </div>
            </div>
            <button
              onClick={() => void runSearch()}
              disabled={searching || !pattern || !workspaceRoot}
              className="rounded-md border border-border-subtle bg-bg-subtle px-3 text-xs text-fg-base transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {searching ? 'finding…' : 'find'}
            </button>
          </div>

          <div className="flex items-stretch gap-1.5">
            <div className="flex flex-1 items-center rounded-md border border-border-subtle bg-bg-subtle px-2.5 focus-within:ring-1 focus-within:ring-accent/60">
              <input
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
                placeholder="replacement (leave empty to delete matches)"
                spellCheck={false}
                className="syde-selectable flex-1 bg-transparent py-1.5 font-mono text-xs text-fg-base placeholder:text-fg-dim focus:outline-none"
              />
            </div>
            {confirming ? (
              <>
                <button
                  onClick={() => void runReplaceAll()}
                  disabled={replacing}
                  className="rounded-md border border-rose-700/50 bg-rose-900/30 px-3 text-xs text-rose-100 transition-colors hover:bg-rose-900/50 disabled:opacity-40"
                >
                  {replacing ? 'replacing…' : 'confirm replace all'}
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  className="rounded-md border border-border-subtle bg-bg-subtle px-3 text-xs text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-base"
                >
                  cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirming(true)}
                disabled={!result || result.hits.length === 0 || replacing}
                className="rounded-md border border-border-subtle bg-bg-subtle px-3 text-xs text-fg-base transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-40"
                title="Replace every match across the project"
              >
                replace all
              </button>
            )}
          </div>

          {confirming && result && (
            <div className="rounded-md border border-rose-900/40 bg-error-bg px-2.5 py-1.5 text-2xs text-error-fg-strong">
              About to replace <strong>{result.hits.length}</strong> occurrence
              {result.hits.length === 1 ? '' : 's'} across{' '}
              <strong>{groups.length}</strong> file
              {groups.length === 1 ? '' : 's'}. This rewrites files on disk —
              there's no undo. Make sure you have a clean git tree.
            </div>
          )}
        </div>

        <div className="flex max-h-[50vh] min-h-[200px] flex-col overflow-y-auto px-2 py-2">
          {!result && !searching && (
            <div className="flex flex-1 items-center justify-center text-2xs text-fg-subtle">
              Type a query and press Enter or click <em className="ml-1">find</em>.
            </div>
          )}
          {searching && (
            <div className="flex flex-1 items-center justify-center text-2xs text-fg-muted">
              searching…
            </div>
          )}
          {result && result.hits.length === 0 && !searching && (
            <div className="flex flex-1 items-center justify-center text-2xs text-fg-subtle">
              No matches in {result.filesScanned} files scanned.
            </div>
          )}
          {result && result.hits.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="px-2 text-2xs text-fg-subtle">
                {result.hits.length} match{result.hits.length === 1 ? '' : 'es'}{' '}
                in {groups.length} file{groups.length === 1 ? '' : 's'}
                {result.truncated && ' (truncated — narrow your search)'}
              </div>
              {groups.map((g) => (
                <div key={g.file} className="rounded-md border border-border-subtle bg-bg-subtle/40">
                  <div
                    className="truncate px-2.5 py-1 font-mono text-2xs text-fg-base"
                    title={g.file}
                  >
                    {relPath(g.file, workspaceRoot)}{' '}
                    <span className="text-fg-subtle">· {g.hits.length}</span>
                  </div>
                  <div className="border-t border-border-subtle">
                    {g.hits.slice(0, 200).map((h, i) => (
                      <button
                        key={`${h.line}-${h.column}-${i}`}
                        onClick={() => void onPickHit(h)}
                        className="flex w-full items-baseline gap-2 px-2.5 py-0.5 text-left font-mono text-2xs text-fg-muted hover:bg-bg-hover hover:text-fg-base"
                        title={`Open ${h.filePath} (line ${h.line})`}
                      >
                        <span className="w-12 text-right text-fg-subtle">
                          {h.line}:{h.column}
                        </span>
                        <span className="flex-1 truncate">{h.preview}</span>
                      </button>
                    ))}
                    {g.hits.length > 200 && (
                      <div className="px-2.5 py-1 text-2xs text-fg-subtle">
                        … {g.hits.length - 200} more in this file
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
