import Monaco, { OnMount, loader } from '@monaco-editor/react'
import { useEffect } from 'react'
import * as monacoEditor from 'monaco-editor'
import { useStore } from '../store'
import {
  findEnclosingBlock,
  setEditorInstance,
  useScopeDecoration,
  useSaveShortcut
} from '../hooks/useEditor'
import type { editor as MonacoEditor } from 'monaco-editor'

// Bundle monaco directly so the IDE works fully offline and in production.
// This must run before the first <Monaco /> render.
loader.config({ monaco: monacoEditor })

const SYDE_DARK: MonacoEditor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '5f5f6a', fontStyle: 'italic' },
    { token: 'keyword', foreground: '9d7cff' },
    { token: 'string', foreground: '6ad29a' },
    { token: 'number', foreground: 'ffb454' },
    { token: 'type', foreground: '3aa6ff' },
    { token: 'function', foreground: 'e6e6ea' }
  ],
  colors: {
    'editor.background': '#0c0c0e',
    'editor.foreground': '#e6e6ea',
    'editorLineNumber.foreground': '#3a3a44',
    'editorLineNumber.activeForeground': '#9a9aa3',
    'editor.selectionBackground': '#26262e',
    'editor.inactiveSelectionBackground': '#1a1a20',
    'editorCursor.foreground': '#9d7cff',
    'editor.lineHighlightBackground': '#101013',
    'editorIndentGuide.background': '#1a1a20',
    'editorIndentGuide.activeBackground': '#26262e',
    'editor.findMatchBackground': '#9d7cff44',
    'editor.findMatchHighlightBackground': '#9d7cff22',
    'editorWidget.background': '#15151a',
    'editorWidget.border': '#26262e',
    'editorSuggestWidget.background': '#15151a',
    'editorSuggestWidget.border': '#26262e',
    'editorSuggestWidget.selectedBackground': '#1f1f26',
    'editorGutter.background': '#0c0c0e',
    'scrollbarSlider.background': '#1f1f2688',
    'scrollbarSlider.hoverBackground': '#26262e',
    'scrollbarSlider.activeBackground': '#33333d'
  }
}

const SYDE_LIGHT: MonacoEditor.IStandaloneThemeData = {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '8a8a96', fontStyle: 'italic' },
    { token: 'keyword', foreground: '6047c7' },
    { token: 'string', foreground: '2c8a52' },
    { token: 'number', foreground: 'b46a18' },
    { token: 'type', foreground: '1f6dbd' },
    { token: 'function', foreground: '18181e' }
  ],
  colors: {
    'editor.background': '#fcfcfd',
    'editor.foreground': '#18181e',
    'editorLineNumber.foreground': '#b4b4c0',
    'editorLineNumber.activeForeground': '#585864',
    'editor.selectionBackground': '#d8d4f4',
    'editor.inactiveSelectionBackground': '#e8e6f4',
    'editorCursor.foreground': '#6047c7',
    'editor.lineHighlightBackground': '#f3f3f7',
    'editorIndentGuide.background': '#ececf2',
    'editorIndentGuide.activeBackground': '#dcdce4',
    'editor.findMatchBackground': '#6047c744',
    'editor.findMatchHighlightBackground': '#6047c722',
    'editorWidget.background': '#ffffff',
    'editorWidget.border': '#d5d5dd',
    'editorSuggestWidget.background': '#ffffff',
    'editorSuggestWidget.border': '#d5d5dd',
    'editorSuggestWidget.selectedBackground': '#eaeaf0',
    'editorGutter.background': '#fcfcfd',
    'scrollbarSlider.background': '#d5d5dd88',
    'scrollbarSlider.hoverBackground': '#c0c0ca',
    'scrollbarSlider.activeBackground': '#a8a8b4'
  }
}

export function Editor() {
  const activeFilePath = useStore((s) => s.activeFilePath)
  const activeContent = useStore((s) => s.activeContent)
  const activeLanguage = useStore((s) => s.activeLanguage)
  const setActiveContent = useStore((s) => s.setActiveContent)
  const markSaved = useStore((s) => s.markSaved)
  const setScopeRange = useStore((s) => s.setScopeRange)
  const scopeLevel = useStore((s) => s.scopeLevel)
  const theme = useStore((s) => s.theme)
  const fontSize = useStore((s) => s.editorFontSize)

  useScopeDecoration()

  useSaveShortcut(() => {
    const { activeFilePath: p, activeContent: c, activeDirty } = useStore.getState()
    if (!p || !activeDirty) return
    void window.syde.fs.writeFile(p, c).then(() => markSaved())
  })

  // Live theme switch.
  useEffect(() => {
    const m = monacoEditor
    m.editor.defineTheme('syde-dark', SYDE_DARK)
    m.editor.defineTheme('syde-light', SYDE_LIGHT)
    m.editor.setTheme(theme === 'light' ? 'syde-light' : 'syde-dark')
  }, [theme])

  const handleMount: OnMount = (ed, monaco) => {
    monaco.editor.defineTheme('syde-dark', SYDE_DARK)
    monaco.editor.defineTheme('syde-light', SYDE_LIGHT)
    monaco.editor.setTheme(
      useStore.getState().theme === 'light' ? 'syde-light' : 'syde-dark'
    )
    setEditorInstance(ed, monaco)

    ed.onDidChangeCursorSelection((e) => {
      const sel = e.selection
      const lvl = useStore.getState().scopeLevel
      const model = ed.getModel()
      // Don't override file/project ranges with selection.
      if (lvl === 'file' || lvl === 'project') return

      if (!sel.isEmpty()) {
        // User has an active selection — that overrides everything.
        setScopeRange({
          startLine: sel.startLineNumber,
          startColumn: sel.startColumn,
          endLine: sel.endLineNumber,
          endColumn: sel.endColumn
        })
        return
      }

      if (lvl === 'line' && model) {
        setScopeRange({
          startLine: sel.startLineNumber,
          startColumn: 1,
          endLine: sel.startLineNumber,
          endColumn: model.getLineMaxColumn(sel.startLineNumber)
        })
        return
      }

      if (lvl === 'block' && model) {
        // Auto-detect the enclosing block at the cursor.
        const block = findEnclosingBlock(model, {
          lineNumber: sel.startLineNumber,
          column: sel.startColumn
        })
        if (block) {
          setScopeRange(block)
          return
        }
      }

      setScopeRange(null)
    })
  }

  // React to scope-level changes:
  //  - file/project: clear the explicit range so the editor highlights nothing
  //    line-specific (decoration covers full file via useScopeDecoration).
  //  - block: immediately compute the enclosing block at the cursor so the
  //    user sees the highlight without having to move the caret.
  //  - line: snap to the cursor's current line.
  useEffect(() => {
    if (scopeLevel === 'file' || scopeLevel === 'project') {
      setScopeRange(null)
      return
    }
    const ed = monacoEditor.editor.getEditors()[0]
    if (!ed) return
    const model = ed.getModel()
    const pos = ed.getPosition()
    if (!model || !pos) return
    const sel = ed.getSelection()
    if (sel && !sel.isEmpty()) return // respect user's selection

    if (scopeLevel === 'line') {
      setScopeRange({
        startLine: pos.lineNumber,
        startColumn: 1,
        endLine: pos.lineNumber,
        endColumn: model.getLineMaxColumn(pos.lineNumber)
      })
    } else if (scopeLevel === 'block') {
      const block = findEnclosingBlock(model, pos)
      setScopeRange(block)
    }
  }, [scopeLevel, setScopeRange])

  if (!activeFilePath) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg-base text-fg-subtle">
        <div className="text-center">
          <div className="text-xs uppercase tracking-[0.2em] text-fg-dim">syde</div>
          <div className="mt-3 text-sm text-fg-muted">
            Open a workspace, then a file.
          </div>
          <div className="mt-1 text-xs text-fg-subtle">
            scope · context · mode
          </div>
        </div>
      </div>
    )
  }

  return (
    <Monaco
      key={activeFilePath}
      height="100%"
      width="100%"
      theme={theme === 'light' ? 'syde-light' : 'syde-dark'}
      language={activeLanguage}
      path={activeFilePath}
      value={activeContent}
      onMount={handleMount}
      onChange={(v) => setActiveContent(v ?? '')}
      options={{
        fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace",
        fontSize,
        lineHeight: 1.55,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        cursorBlinking: 'smooth',
        cursorSmoothCaretAnimation: 'on',
        renderLineHighlight: 'line',
        roundedSelection: false,
        padding: { top: 12, bottom: 12 },
        guides: {
          indentation: true,
          highlightActiveIndentation: false,
          bracketPairs: false
        },
        bracketPairColorization: { enabled: false },
        wordWrap: 'off',
        tabSize: 2,
        renderWhitespace: 'none',
        glyphMargin: true,
        folding: true,
        showFoldingControls: 'mouseover',
        scrollbar: {
          verticalScrollbarSize: 10,
          horizontalScrollbarSize: 10
        },
        overviewRulerBorder: false,
        hideCursorInOverviewRuler: true,
        fixedOverflowWidgets: true
      }}
    />
  )
}
