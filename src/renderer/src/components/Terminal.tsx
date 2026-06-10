import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm, ITheme } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import { useStore } from '../store'

const DARK_THEME: ITheme = {
  background: '#0c0c0e',
  foreground: '#e6e6ea',
  cursor: '#9d7cff',
  selectionBackground: '#26262e',
  black: '#15151a',
  brightBlack: '#3a3a44',
  red: '#ff6a8d',
  brightRed: '#ff8aa8',
  green: '#6ad29a',
  brightGreen: '#88e0b0',
  yellow: '#ffb454',
  brightYellow: '#ffc97a',
  blue: '#3aa6ff',
  brightBlue: '#69bdff',
  magenta: '#9d7cff',
  brightMagenta: '#b89dff',
  cyan: '#6ad2c5',
  brightCyan: '#88e0d5',
  white: '#e6e6ea',
  brightWhite: '#ffffff'
}

// Note on white/brightWhite: most shells (PowerShell included) emit
// unstyled text as ANSI "white" (color 37). On a light background that
// must be DARK to remain legible. We mirror the dark-theme convention
// where `white` ≈ foreground and `brightWhite` is the most-emphasized.
const LIGHT_THEME: ITheme = {
  background: '#fcfcfd',
  foreground: '#18181e',
  cursor: '#6047c7',
  selectionBackground: '#d8d4f4',
  black: '#18181e',
  brightBlack: '#4a4a54',
  red: '#b8344a',
  brightRed: '#8a1f30',
  green: '#1f6e3f',
  brightGreen: '#155028',
  yellow: '#a05810',
  brightYellow: '#7a4208',
  blue: '#1a5da3',
  brightBlue: '#103f73',
  magenta: '#5a3fb5',
  brightMagenta: '#3d2980',
  cyan: '#1a7a72',
  brightCyan: '#0f5a54',
  white: '#2a2a32',
  brightWhite: '#000000'
}

interface TerminalDebug {
  id: string
  pid: number | null
  shell: string
  ready: boolean
  exited: boolean
  exitCode: number | null
  keysCaptured: number
  bytesSent: number
  bytesReceived: number
  hasFocus: boolean
  error: string | null
}

const initialDebug = (id: string): TerminalDebug => ({
  id,
  pid: null,
  shell: 'starting…',
  ready: false,
  exited: false,
  exitCode: null,
  keysCaptured: 0,
  bytesSent: 0,
  bytesReceived: 0,
  hasFocus: false,
  error: null
})

export function Terminal() {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const offDataRef = useRef<(() => void) | null>(null)
  const offExitRef = useRef<(() => void) | null>(null)
  const debugRef = useRef<TerminalDebug>(initialDebug('pending'))
  const [debug, setDebug] = useState<TerminalDebug>(debugRef.current)
  const bottomOpen = useStore((s) => s.panels.bottomOpen)
  const toggleBottom = useStore((s) => s.toggleBottom)
  const workspaceRoot = useStore((s) => s.workspaceRoot)
  const theme = useStore((s) => s.theme)

  const updateDebug = (patch: Partial<TerminalDebug>) => {
    debugRef.current = { ...debugRef.current, ...patch }
    setDebug(debugRef.current)
  }

  useEffect(() => {
    if (!bottomOpen) return
    if (!containerRef.current) return
    if (termRef.current) return

    // Fresh id per mount — never reuse across react re-mounts (strict mode).
    const id = 'term-' + Math.random().toString(36).slice(2)
    debugRef.current = initialDebug(id)
    setDebug(debugRef.current)

    const term = new XTerm({
      fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.3,
      cursorBlink: true,
      cursorStyle: 'bar',
      convertEol: false,
      scrollback: 5000,
      allowProposedApi: true,
      theme: theme === 'light' ? LIGHT_THEME : DARK_THEME
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)
    try {
      fit.fit()
    } catch {
      // ignore
    }
    termRef.current = term
    fitRef.current = fit

    // Focus state tracking on the underlying textarea xterm uses.
    term.onSelectionChange(() => {
      // no-op, just keeps the addon hot
    })
    const textarea = containerRef.current.querySelector('textarea')
    if (textarea) {
      textarea.addEventListener('focus', () =>
        updateDebug({ hasFocus: true })
      )
      textarea.addEventListener('blur', () =>
        updateDebug({ hasFocus: false })
      )
    }

    // Pump user keystrokes to the pty. Registered up-front so nothing is
    // dropped before the spawn resolves.
    term.onData((data) => {
      debugRef.current.keysCaptured += data.length
      // eslint-disable-next-line no-console
      console.log('[syde:term] onData', JSON.stringify(data))
      if (debugRef.current.error) {
        setDebug({ ...debugRef.current })
        return
      }
      if (!debugRef.current.ready) {
        setDebug({ ...debugRef.current })
        return
      }
      void window.syde.pty.write(id, data).then(() => {
        debugRef.current.bytesSent += data.length
        setDebug({ ...debugRef.current })
      })
    })

    term.onResize(({ cols, rows }) => {
      if (debugRef.current.error || !debugRef.current.ready) return
      void window.syde.pty.resize(id, cols, rows)
    })

    // Bind data / exit listeners up-front too, scoped by id.
    offDataRef.current = window.syde.pty.onData((e) => {
      if (e.id !== id) return
      term.write(e.data)
      debugRef.current.bytesReceived += e.data.length
      setDebug({ ...debugRef.current })
    })
    offExitRef.current = window.syde.pty.onExit((e) => {
      if (e.id !== id) return
      updateDebug({
        ready: false,
        exited: true,
        exitCode: e.exitCode,
        shell: 'exited'
      })
      term.writeln(`\r\n\u001b[2m[process exited with code ${e.exitCode}]\u001b[0m`)
    })

    void (async () => {
      try {
        const cwd = workspaceRoot ?? (await window.syde.app.getCwd())
        const result = await window.syde.pty.spawn({
          id,
          cwd,
          cols: term.cols,
          rows: term.rows
        })
        const shellName =
          (result.shell ?? '').split(/[\\/]/).pop() || 'shell'
        updateDebug({
          ready: true,
          pid: result.pid,
          shell: shellName,
          error: null
        })
        // Refocus after the pty is alive — first keystrokes should land.
        requestAnimationFrame(() => term.focus())
      } catch (e) {
        const msg = (e as Error).message
        updateDebug({
          shell: 'failed',
          ready: false,
          error: msg
        })
        term.writeln('\u001b[31m' + msg + '\u001b[0m')
        term.writeln('')
        term.writeln(
          '\u001b[2mTerminal disabled. Run `npm run rebuild` to recompile native modules.\u001b[0m'
        )
      }
    })()

    // Initial focus.
    term.focus()

    const onWinResize = () => {
      try {
        fit.fit()
      } catch {
        // ignore
      }
    }
    window.addEventListener('resize', onWinResize)
    const ro = new ResizeObserver(() => onWinResize())
    ro.observe(containerRef.current)

    return () => {
      window.removeEventListener('resize', onWinResize)
      ro.disconnect()
      offDataRef.current?.()
      offExitRef.current?.()
      offDataRef.current = null
      offExitRef.current = null
      void window.syde.pty.kill(id)
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [bottomOpen, workspaceRoot])

  // Refit + refocus whenever the panel comes back into view.
  useEffect(() => {
    if (!bottomOpen) return
    const t = setTimeout(() => {
      try {
        fitRef.current?.fit()
      } catch {
        // ignore
      }
      termRef.current?.focus()
    }, 60)
    return () => clearTimeout(t)
  }, [bottomOpen])

  // Live theme swap on the existing terminal instance.
  useEffect(() => {
    if (!termRef.current) return
    termRef.current.options.theme = theme === 'light' ? LIGHT_THEME : DARK_THEME
  }, [theme])

  const focusTerm = () => termRef.current?.focus()

  const statusColor =
    debug.error || debug.exited
      ? 'text-rose-400'
      : debug.ready
      ? 'text-emerald-400'
      : 'text-fg-subtle'

  return (
    <div className="flex h-full flex-col bg-bg-base">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border-subtle bg-bg-panel px-3 py-1.5 text-2xs">
        <div className="flex items-center gap-2">
          <span className="uppercase tracking-[0.2em] text-fg-dim">terminal</span>
          <span className={statusColor}>{debug.shell}</span>
          {debug.pid !== null && (
            <span className="text-fg-subtle">pid {debug.pid}</span>
          )}
          {debug.error && (
            <span
              className="max-w-[40ch] truncate text-rose-400"
              title={debug.error}
            >
              · {debug.error}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 font-mono text-fg-subtle">
          <span title="key events captured by xterm">
            keys {debug.keysCaptured}
          </span>
          <span className="text-fg-dim">·</span>
          <span title="bytes written to the shell">
            tx {debug.bytesSent}
          </span>
          <span className="text-fg-dim">·</span>
          <span title="bytes received from the shell">
            rx {debug.bytesReceived}
          </span>
          <span className="text-fg-dim">·</span>
          <span
            className={debug.hasFocus ? 'text-emerald-400' : 'text-fg-subtle'}
            title={debug.hasFocus ? 'terminal has focus' : 'click terminal to focus'}
          >
            {debug.hasFocus ? 'focused' : 'click to focus'}
          </span>
          <span className="text-fg-subtle">{workspaceRoot ?? '~'}</span>
          <button
            onClick={toggleBottom}
            className="ml-1 rounded px-1.5 py-0.5 text-2xs text-fg-subtle transition-colors hover:bg-bg-hover hover:text-fg-base"
            title="Hide terminal"
          >
            ⌄
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        onMouseDown={focusTerm}
        onClick={focusTerm}
        className="min-h-0 flex-1 cursor-text overflow-hidden p-2"
      />
    </div>
  )
}
