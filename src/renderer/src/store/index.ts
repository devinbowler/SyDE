import { create } from 'zustand'
import type {
  ChatItem,
  ContextMode,
  Mode,
  ScopeLevel,
  ScopeRange,
  FileTreeNode
} from '../types'

interface PanelState {
  leftOpen: boolean
  rightOpen: boolean
  bottomOpen: boolean
}

export type Theme = 'dark' | 'light'

interface SydeState {
  // Workspace
  workspaceRoot: string | null
  fileTree: FileTreeNode | null
  pinnedFiles: Set<string>

  // Active editor
  activeFilePath: string | null
  activeContent: string
  activeDirty: boolean
  activeLanguage: string

  // LLM controls
  scopeLevel: ScopeLevel
  scopeRange: ScopeRange | null // selection in active editor (for line/block/custom)
  mode: Mode
  contextMode: ContextMode

  // Chat
  sessionId: number | null
  chat: ChatItem[]
  streamingId: string | null
  lastError: string | null
  lastEvent: string | null

  // Panels
  panels: PanelState

  // Appearance
  theme: Theme
  editorFontSize: number

  // setters
  setWorkspaceRoot: (p: string | null) => void
  setFileTree: (t: FileTreeNode | null) => void
  togglePinned: (p: string) => void
  setPinned: (paths: string[]) => void
  clearPinned: () => void

  openFile: (path: string, content: string, language: string) => void
  setActiveContent: (content: string, dirty?: boolean) => void
  markSaved: () => void

  setScopeLevel: (s: ScopeLevel) => void
  setScopeRange: (r: ScopeRange | null) => void
  setMode: (m: Mode) => void
  setContextMode: (c: ContextMode) => void

  setSessionId: (id: number | null) => void
  appendChat: (item: ChatItem) => void
  patchChat: (id: string, patch: Partial<ChatItem>) => void
  setChat: (items: ChatItem[]) => void
  setStreamingId: (id: string | null) => void
  clearChat: () => void
  setLastError: (err: string | null) => void
  setLastEvent: (e: string | null) => void

  toggleLeft: () => void
  toggleRight: () => void
  toggleBottom: () => void
  openRight: () => void

  setTheme: (t: Theme) => void
  toggleTheme: () => void
  setEditorFontSize: (n: number) => void
}

const THEME_KEY = 'syde:theme'
const FONT_KEY = 'syde:editor-font-size'

function loadTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {
    // ignore
  }
  return 'dark'
}

function loadFontSize(): number {
  try {
    const raw = localStorage.getItem(FONT_KEY)
    if (raw) {
      const n = Number(raw)
      if (Number.isFinite(n) && n >= 10 && n <= 28) return n
    }
  } catch {
    // ignore
  }
  return 15
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore
  }
}

export const useStore = create<SydeState>((set) => ({
  workspaceRoot: null,
  fileTree: null,
  pinnedFiles: new Set<string>(),

  activeFilePath: null,
  activeContent: '',
  activeDirty: false,
  activeLanguage: 'plaintext',

  scopeLevel: 'block',
  scopeRange: null,
  mode: 'edit',
  contextMode: 'pinned',

  sessionId: null,
  chat: [],
  streamingId: null,
  lastError: null,
  lastEvent: null,

  panels: { leftOpen: true, rightOpen: true, bottomOpen: false },

  theme: loadTheme(),
  editorFontSize: loadFontSize(),

  setWorkspaceRoot: (p) => set({ workspaceRoot: p }),
  setFileTree: (t) => set({ fileTree: t }),
  togglePinned: (p) =>
    set((s) => {
      const next = new Set(s.pinnedFiles)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return { pinnedFiles: next }
    }),
  setPinned: (paths) => set({ pinnedFiles: new Set(paths) }),
  clearPinned: () => set({ pinnedFiles: new Set() }),

  openFile: (p, content, language) =>
    set({
      activeFilePath: p,
      activeContent: content,
      activeDirty: false,
      activeLanguage: language,
      scopeRange: null
    }),
  setActiveContent: (content, dirty = true) =>
    set({ activeContent: content, activeDirty: dirty }),
  markSaved: () => set({ activeDirty: false }),

  setScopeLevel: (s) => set({ scopeLevel: s }),
  setScopeRange: (r) => set({ scopeRange: r }),
  setMode: (m) => set({ mode: m }),
  setContextMode: (c) => set({ contextMode: c }),

  setSessionId: (id) => set({ sessionId: id }),
  appendChat: (item) => set((s) => ({ chat: [...s.chat, item] })),
  patchChat: (id, patch) =>
    set((s) => ({
      chat: s.chat.map((m) => (m.id === id ? { ...m, ...patch } : m))
    })),
  setChat: (items) => set({ chat: items, lastError: null, lastEvent: null }),
  setStreamingId: (id) => set({ streamingId: id }),
  clearChat: () => set({ chat: [], lastError: null, lastEvent: null }),
  setLastError: (err) => set({ lastError: err }),
  setLastEvent: (e) => set({ lastEvent: e }),

  toggleLeft: () =>
    set((s) => ({ panels: { ...s.panels, leftOpen: !s.panels.leftOpen } })),
  toggleRight: () =>
    set((s) => ({ panels: { ...s.panels, rightOpen: !s.panels.rightOpen } })),
  toggleBottom: () =>
    set((s) => ({ panels: { ...s.panels, bottomOpen: !s.panels.bottomOpen } })),
  openRight: () =>
    set((s) =>
      s.panels.rightOpen ? s : { panels: { ...s.panels, rightOpen: true } }
    ),

  setTheme: (t) => {
    persist(THEME_KEY, t)
    void window.syde?.app.setTheme(t)
    set({ theme: t })
  },
  toggleTheme: () =>
    set((s) => {
      const next: Theme = s.theme === 'dark' ? 'light' : 'dark'
      persist(THEME_KEY, next)
      void window.syde?.app.setTheme(next)
      return { theme: next }
    }),
  setEditorFontSize: (n) => {
    const clamped = Math.max(10, Math.min(28, Math.round(n)))
    persist(FONT_KEY, String(clamped))
    set({ editorFontSize: clamped })
  }
}))

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  md: 'markdown',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'plaintext',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  ps1: 'powershell',
  sql: 'sql',
  xml: 'xml',
  vue: 'html',
  svelte: 'html'
}

export function languageFromPath(p: string): string {
  const idx = p.lastIndexOf('.')
  if (idx === -1) return 'plaintext'
  const ext = p.slice(idx + 1).toLowerCase()
  return EXT_TO_LANG[ext] ?? 'plaintext'
}
