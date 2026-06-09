import { useCallback, useEffect, useRef } from 'react'
import type { editor } from 'monaco-editor'
import { useStore } from '../store'
import type { ScopeRange } from '../types'

/**
 * Holds a singleton reference to the Monaco editor instance and exposes
 * helpers for programmatic edits driven by the LLM.
 */
const editorRef: { current: editor.IStandaloneCodeEditor | null } = { current: null }
const monacoRef: { current: typeof import('monaco-editor') | null } = { current: null }
const decorationCollectionRef: {
  current: editor.IEditorDecorationsCollection | null
} = { current: null }

export function setEditorInstance(
  ed: editor.IStandaloneCodeEditor | null,
  monaco: typeof import('monaco-editor') | null
): void {
  editorRef.current = ed
  monacoRef.current = monaco
  if (!ed) {
    decorationCollectionRef.current = null
  }
}

export function getEditorInstance(): editor.IStandaloneCodeEditor | null {
  return editorRef.current
}

export function getMonaco(): typeof import('monaco-editor') | null {
  return monacoRef.current
}

export function applyScopeDecoration(
  range: ScopeRange | null,
  level: 'line' | 'block' | 'file' | 'project' | 'custom'
): void {
  const ed = editorRef.current
  const monaco = monacoRef.current
  if (!ed || !monaco) return
  if (!decorationCollectionRef.current) {
    decorationCollectionRef.current = ed.createDecorationsCollection()
  }

  if (!range || level === 'project') {
    decorationCollectionRef.current.clear()
    return
  }

  let r: ScopeRange = range
  if (level === 'file') {
    const model = ed.getModel()
    if (!model) {
      decorationCollectionRef.current.clear()
      return
    }
    const lineCount = model.getLineCount()
    r = {
      startLine: 1,
      startColumn: 1,
      endLine: lineCount,
      endColumn: model.getLineMaxColumn(lineCount)
    }
  }

  const className =
    level === 'line'
      ? 'syde-scope-decoration-line'
      : level === 'file'
      ? 'syde-scope-decoration-file'
      : level === 'custom'
      ? 'syde-scope-decoration-custom'
      : 'syde-scope-decoration-block'

  decorationCollectionRef.current.set([
    {
      range: new monaco.Range(r.startLine, r.startColumn, r.endLine, r.endColumn),
      options: {
        isWholeLine: level === 'line' || level === 'file',
        className,
        linesDecorationsClassName: 'syde-scope-glyph',
        overviewRuler: {
          color: 'rgba(157,124,255,0.5)',
          position: monaco.editor.OverviewRulerLane.Left
        }
      }
    }
  ])
}

/**
 * Replace a scoped range in the active editor with a new string.
 * Used by the LLM in `edit` and `agent` modes to apply results.
 */
export function applyScopedEdit(range: ScopeRange, text: string): void {
  const ed = editorRef.current
  const monaco = monacoRef.current
  if (!ed || !monaco) return
  const model = ed.getModel()
  if (!model) return

  // Clamp to valid model coordinates so a stale range never crashes the editor.
  const lineCount = model.getLineCount()
  const sl = Math.min(Math.max(range.startLine, 1), lineCount)
  const el = Math.min(Math.max(range.endLine, sl), lineCount)
  const sc = Math.min(Math.max(range.startColumn, 1), model.getLineMaxColumn(sl))
  const ec = Math.min(Math.max(range.endColumn, 1), model.getLineMaxColumn(el))

  const monacoRange = new monaco.Range(sl, sc, el, ec)
  ed.executeEdits('syde-llm', [
    {
      range: monacoRange,
      text,
      forceMoveMarkers: true
    }
  ])
  ed.focus()
}

/**
 * Replace the entire file contents (used for `file` scope or `project` mode applied
 * to the active file).
 */
export function applyFullFileEdit(text: string): void {
  const ed = editorRef.current
  const monaco = monacoRef.current
  if (!ed || !monaco) return
  const model = ed.getModel()
  if (!model) return
  const lineCount = model.getLineCount()
  const fullRange = new monaco.Range(1, 1, lineCount, model.getLineMaxColumn(lineCount))
  ed.executeEdits('syde-llm', [
    {
      range: fullRange,
      text,
      forceMoveMarkers: true
    }
  ])
  ed.focus()
}

/**
 * Hook that re-applies the scope decoration whenever scope state changes.
 */
export function useScopeDecoration(): void {
  const scopeLevel = useStore((s) => s.scopeLevel)
  const scopeRange = useStore((s) => s.scopeRange)
  const activeFilePath = useStore((s) => s.activeFilePath)

  useEffect(() => {
    applyScopeDecoration(scopeRange, scopeLevel)
  }, [scopeRange, scopeLevel, activeFilePath])
}

/**
 * Cmd/Ctrl+S to save active file.
 */
export function useSaveShortcut(onSave: () => void): void {
  const cb = useRef(onSave)
  cb.current = onSave

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isSave = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's'
      if (isSave) {
        e.preventDefault()
        cb.current()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}

/**
 * Compute a default scope (full file) when nothing is selected.
 */
export function useFullFileScope(): () => ScopeRange | null {
  return useCallback(() => {
    const ed = editorRef.current
    if (!ed) return null
    const model = ed.getModel()
    if (!model) return null
    const lineCount = model.getLineCount()
    return {
      startLine: 1,
      startColumn: 1,
      endLine: lineCount,
      endColumn: model.getLineMaxColumn(lineCount)
    }
  }, [])
}

const INDENT_LANGS = new Set(['python', 'yaml', 'coffeescript', 'pug', 'haml'])

/**
 * Find the smallest enclosing block at a position.
 *
 *  - For curly-brace languages: walks back to the nearest unmatched `{` and
 *    forward to its match. Strings and line comments are skipped naively
 *    (good enough for most cases — Monaco doesn't expose its tokenizer
 *    publicly without ceremony).
 *  - For indent-based languages (Python, YAML…): selects the contiguous
 *    block of lines whose indent is >= the cursor line's indent, plus the
 *    first non-blank line above it that introduces the block.
 */
export function findEnclosingBlock(
  model: import('monaco-editor').editor.ITextModel,
  position: { lineNumber: number; column: number }
): ScopeRange | null {
  const language = model.getLanguageId()
  if (INDENT_LANGS.has(language)) {
    return findIndentBlock(model, position)
  }
  return findBraceBlock(model, position)
}

function findBraceBlock(
  model: import('monaco-editor').editor.ITextModel,
  position: { lineNumber: number; column: number }
): ScopeRange | null {
  const text = model.getValue()
  const offset = model.getOffsetAt({
    lineNumber: position.lineNumber,
    column: position.column
  })

  // Naive walker that skips characters inside strings and line/block comments.
  // Walk backward, tracking depth of `}` we've seen; the first `{` that brings
  // depth below zero is the enclosing brace.
  let depth = 0
  let openIdx = -1
  let i = offset - 1
  while (i >= 0) {
    const c = text[i]
    // Skip string literals and line comments by walking past them.
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      let j = i - 1
      while (j >= 0 && text[j] !== quote) {
        if (text[j] === '\\') j--
        j--
      }
      i = j - 1
      continue
    }
    if (c === '/' && i > 0 && text[i - 1] === '*') {
      // inside a block comment closing — skip back to /*
      let j = i - 2
      while (j > 0 && !(text[j] === '/' && text[j + 1] === '*')) j--
      i = j - 1
      continue
    }
    if (c === '\n') {
      // Detect single-line `// ...` by looking forward on this line.
      // (We don't strictly need this, but it avoids false matches.)
    }
    if (c === '}') depth++
    else if (c === '{') {
      if (depth === 0) {
        openIdx = i
        break
      }
      depth--
    }
    i--
  }
  if (openIdx === -1) return null

  // Now walk forward from openIdx to find the matching `}`.
  depth = 0
  let closeIdx = -1
  let k = openIdx + 1
  while (k < text.length) {
    const c = text[k]
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      let j = k + 1
      while (j < text.length && text[j] !== quote) {
        if (text[j] === '\\') j++
        j++
      }
      k = j + 1
      continue
    }
    if (c === '/' && text[k + 1] === '/') {
      while (k < text.length && text[k] !== '\n') k++
      continue
    }
    if (c === '/' && text[k + 1] === '*') {
      k += 2
      while (k < text.length - 1 && !(text[k] === '*' && text[k + 1] === '/')) k++
      k += 2
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      if (depth === 0) {
        closeIdx = k
        break
      }
      depth--
    }
    k++
  }
  if (closeIdx === -1) return null

  const start = model.getPositionAt(openIdx)
  const end = model.getPositionAt(closeIdx + 1)
  return {
    startLine: start.lineNumber,
    startColumn: start.column,
    endLine: end.lineNumber,
    endColumn: end.column
  }
}

function indentOf(line: string): number {
  let n = 0
  for (let i = 0; i < line.length; i++) {
    if (line[i] === ' ') n++
    else if (line[i] === '\t') n += 4
    else break
  }
  return n
}

function findIndentBlock(
  model: import('monaco-editor').editor.ITextModel,
  position: { lineNumber: number }
): ScopeRange | null {
  const total = model.getLineCount()
  let cursorLine = position.lineNumber
  // Find the first non-blank line at or above the cursor.
  while (
    cursorLine > 1 &&
    model.getLineContent(cursorLine).trim() === ''
  ) {
    cursorLine--
  }
  const cursorIndent = indentOf(model.getLineContent(cursorLine))

  // Walk backwards to find the line that introduces this block (smaller indent).
  let startLine = cursorLine
  for (let l = cursorLine - 1; l >= 1; l--) {
    const c = model.getLineContent(l)
    if (c.trim() === '') {
      startLine = l // include leading blank lines? skip for now
      continue
    }
    const ind = indentOf(c)
    if (ind < cursorIndent) {
      startLine = l
      break
    }
    startLine = l
  }

  // Walk forward to find the last line with indent >= cursorIndent.
  let endLine = cursorLine
  for (let l = cursorLine + 1; l <= total; l++) {
    const c = model.getLineContent(l)
    if (c.trim() === '') continue
    const ind = indentOf(c)
    if (ind < cursorIndent) break
    endLine = l
  }

  return {
    startLine,
    startColumn: 1,
    endLine,
    endColumn: model.getLineMaxColumn(endLine)
  }
}
