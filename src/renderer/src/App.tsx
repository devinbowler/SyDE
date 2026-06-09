import { useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import { Editor } from './components/Editor'
import { FileTree } from './components/FileTree'
import { ScopeBar } from './components/ScopeBar'
import { ChatPanel } from './components/ChatPanel'
import { Terminal } from './components/Terminal'
import { SettingsModal } from './components/SettingsModal'
import type { SydeSettings } from './types'

const MIN_LEFT = 180
const MAX_LEFT = 480
const MIN_RIGHT = 280
const MAX_RIGHT = 640
const MIN_BOTTOM = 120
const MAX_BOTTOM = 600

function HResizer({
  onDrag,
  side
}: {
  onDrag: (dx: number) => void
  side: 'left' | 'right'
}) {
  const dragging = useRef(false)
  const lastX = useRef(0)

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current) return
      const dx = e.clientX - lastX.current
      lastX.current = e.clientX
      onDrag(side === 'left' ? dx : -dx)
    }
    const up = () => {
      dragging.current = false
      document.body.style.cursor = ''
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [onDrag, side])

  return (
    <div
      onMouseDown={(e) => {
        dragging.current = true
        lastX.current = e.clientX
        document.body.style.cursor = 'col-resize'
      }}
      className="w-1 cursor-col-resize bg-transparent transition-colors hover:bg-accent/30"
    />
  )
}

function VResizer({ onDrag }: { onDrag: (dy: number) => void }) {
  const dragging = useRef(false)
  const lastY = useRef(0)

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current) return
      const dy = lastY.current - e.clientY
      lastY.current = e.clientY
      onDrag(dy)
    }
    const up = () => {
      dragging.current = false
      document.body.style.cursor = ''
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [onDrag])

  return (
    <div
      onMouseDown={(e) => {
        dragging.current = true
        lastY.current = e.clientY
        document.body.style.cursor = 'row-resize'
      }}
      className="h-1 cursor-row-resize bg-transparent transition-colors hover:bg-accent/30"
    />
  )
}

function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle
        cx="8"
        cy="8"
        r="2.2"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M8 1.5v1.5 M8 13v1.5 M1.5 8h1.5 M13 8h1.5 M3.4 3.4l1.05 1.05 M11.55 11.55l1.05 1.05 M3.4 12.6l1.05-1.05 M11.55 4.45l1.05-1.05"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.4" />
      <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <path d="M8 1.5v1.5" />
        <path d="M8 13v1.5" />
        <path d="M1.5 8h1.5" />
        <path d="M13 8h1.5" />
        <path d="M3.4 3.4l1.05 1.05" />
        <path d="M11.55 11.55l1.05 1.05" />
        <path d="M3.4 12.6l1.05-1.05" />
        <path d="M11.55 4.45l1.05-1.05" />
      </g>
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path
        d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a6 6 0 1 0 7 7z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function TitleBar({
  settings,
  onOpenSettings
}: {
  settings: SydeSettings | null
  onOpenSettings: () => void
}) {
  const activeFilePath = useStore((s) => s.activeFilePath)
  const activeDirty = useStore((s) => s.activeDirty)
  const theme = useStore((s) => s.theme)
  const toggleTheme = useStore((s) => s.toggleTheme)
  const fontSize = useStore((s) => s.editorFontSize)
  const setEditorFontSize = useStore((s) => s.setEditorFontSize)
  const fileName = activeFilePath ? activeFilePath.split(/[\\/]/).pop() : null
  const needsKey = settings && !settings.hasApiKey

  return (
    <div className="flex h-8 select-none items-center justify-between border-b border-border-subtle bg-bg-panel px-3 text-2xs">
      <div className="flex items-center gap-3">
        <span className="font-semibold tracking-[0.18em] text-fg-base">
          SyDE
        </span>
        <span className="text-fg-dim">·</span>
        <span className="text-fg-subtle">
          intentional · scope-limited · in your hands
        </span>
      </div>
      <div className="flex items-center gap-2 text-fg-muted">
        {fileName && (
          <span className="truncate" title={activeFilePath ?? ''}>
            {activeDirty ? '● ' : ''}
            {fileName}
          </span>
        )}

        <span className="syde-divider" />

        <div className="flex items-center gap-0.5 rounded-md bg-bg-subtle p-0.5">
          <button
            onClick={() => setEditorFontSize(fontSize - 1)}
            disabled={fontSize <= 10}
            className="flex h-5 w-5 items-center justify-center rounded text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-base disabled:opacity-40"
            title="Decrease editor font"
          >
            −
          </button>
          <span
            className="min-w-[1.4rem] text-center text-fg-muted"
            title="Editor font size"
          >
            {fontSize}
          </span>
          <button
            onClick={() => setEditorFontSize(fontSize + 1)}
            disabled={fontSize >= 28}
            className="flex h-5 w-5 items-center justify-center rounded text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-base disabled:opacity-40"
            title="Increase editor font"
          >
            +
          </button>
        </div>

        <button
          onClick={onOpenSettings}
          className={`relative flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
            needsKey
              ? 'bg-rose-950/40 text-rose-300 hover:bg-rose-900/40'
              : 'bg-bg-subtle text-fg-muted hover:bg-bg-hover hover:text-fg-base'
          }`}
          title={needsKey ? 'No API key — open settings' : 'Settings'}
        >
          <GearIcon />
          {needsKey && (
            <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-rose-400" />
          )}
        </button>

        <button
          onClick={toggleTheme}
          className="flex h-6 w-6 items-center justify-center rounded-md bg-bg-subtle text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-base"
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>
    </div>
  )
}

function EdgeRail({
  side,
  onClick,
  label
}: {
  side: 'left' | 'right' | 'bottom'
  onClick: () => void
  label: string
}) {
  const isVertical = side === 'left' || side === 'right'
  const arrow = side === 'left' ? '⟩' : side === 'right' ? '⟨' : '⌃'

  return (
    <button
      onClick={onClick}
      title={label}
      className={`group flex flex-none items-center justify-center bg-bg-panel text-fg-dim transition-colors hover:bg-bg-hover hover:text-fg-base ${
        isVertical
          ? `h-full w-3 border-${side === 'left' ? 'r' : 'l'} border-border-subtle`
          : 'h-3 w-full border-t border-border-subtle'
      }`}
    >
      <span
        className={`text-[10px] leading-none transition-transform group-hover:scale-110`}
      >
        {arrow}
      </span>
    </button>
  )
}

function NoKeyBanner({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-rose-900/40 bg-rose-950/30 px-3 py-1.5 text-2xs">
      <div className="flex items-center gap-2 truncate text-rose-200">
        <span className="h-1.5 w-1.5 flex-none rounded-full bg-rose-400" />
        <span className="truncate">
          No Anthropic API key configured. LLM requests won't work yet.
        </span>
      </div>
      <button
        onClick={onOpen}
        className="rounded-md border border-rose-900/60 bg-rose-950/50 px-2 py-0.5 text-rose-100 transition-colors hover:bg-rose-900/40"
      >
        add key
      </button>
    </div>
  )
}

export function App() {
  const panels = useStore((s) => s.panels)
  const toggleLeft = useStore((s) => s.toggleLeft)
  const toggleRight = useStore((s) => s.toggleRight)
  const toggleBottom = useStore((s) => s.toggleBottom)
  const theme = useStore((s) => s.theme)
  const [leftWidth, setLeftWidth] = useState(260)
  const [rightWidth, setRightWidth] = useState(380)
  const [bottomHeight, setBottomHeight] = useState(220)
  const [settings, setSettings] = useState<SydeSettings | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    document.documentElement.style.colorScheme = theme
    // Tell the OS title bar / system chrome to follow.
    void window.syde?.app.setTheme(theme)
  }, [theme])

  // Refresh settings whenever the modal closes (the user might've saved a key).
  useEffect(() => {
    let cancelled = false
    void window.syde.settings.get().then((s) => {
      if (!cancelled) setSettings(s)
    })
    return () => {
      cancelled = true
    }
  }, [settingsOpen])

  // Auto-open the settings modal once on first launch when no key is found.
  useEffect(() => {
    if (settings && !settings.hasApiKey) {
      const seen = (() => {
        try {
          return localStorage.getItem('syde:welcomed') === '1'
        } catch {
          return false
        }
      })()
      if (!seen) {
        setSettingsOpen(true)
        try {
          localStorage.setItem('syde:welcomed', '1')
        } catch {
          // ignore
        }
      }
    }
  }, [settings])

  return (
    <div className="flex h-full w-full flex-col bg-bg-base text-fg-base">
      <TitleBar settings={settings} onOpenSettings={() => setSettingsOpen(true)} />
      {settings && !settings.hasApiKey && (
        <NoKeyBanner onOpen={() => setSettingsOpen(true)} />
      )}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <div className="flex min-h-0 flex-1">
        {panels.leftOpen ? (
          <>
            <div
              style={{ width: leftWidth }}
              className="min-w-0 border-r border-border-subtle"
            >
              <FileTree />
            </div>
            <HResizer
              side="left"
              onDrag={(dx) =>
                setLeftWidth((w) =>
                  Math.min(MAX_LEFT, Math.max(MIN_LEFT, w + dx))
                )
              }
            />
          </>
        ) : (
          <EdgeRail
            side="left"
            onClick={toggleLeft}
            label="Show file tree"
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">
              <Editor />
            </div>
            {panels.bottomOpen ? (
              <>
                <VResizer
                  onDrag={(dy) =>
                    setBottomHeight((h) =>
                      Math.min(MAX_BOTTOM, Math.max(MIN_BOTTOM, h + dy))
                    )
                  }
                />
                <div
                  style={{ height: bottomHeight }}
                  className="min-h-0 border-t border-border-subtle"
                >
                  <Terminal />
                </div>
              </>
            ) : (
              <EdgeRail
                side="bottom"
                onClick={toggleBottom}
                label="Show terminal"
              />
            )}
          </div>
          <ScopeBar />
        </div>

        {panels.rightOpen ? (
          <>
            <HResizer
              side="right"
              onDrag={(dx) =>
                setRightWidth((w) =>
                  Math.min(MAX_RIGHT, Math.max(MIN_RIGHT, w + dx))
                )
              }
            />
            <div
              style={{ width: rightWidth }}
              className="min-w-0 border-l border-border-subtle"
            >
              <ChatPanel />
            </div>
          </>
        ) : (
          <EdgeRail
            side="right"
            onClick={toggleRight}
            label="Show chat panel"
          />
        )}
      </div>
    </div>
  )
}
