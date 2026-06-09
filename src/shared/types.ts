export type Mode = 'ask' | 'edit' | 'agent'

export type ScopeLevel = 'line' | 'block' | 'file' | 'project' | 'custom'

export interface ScopeRange {
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}

export interface Scope {
  level: ScopeLevel
  content: string
  range?: ScopeRange
  filePath?: string
}

export interface ContextFile {
  path: string
  content: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface LLMRequest {
  requestId: string
  mode: Mode
  scope: Scope
  context: ContextFile[]
  instruction: string
  chatHistory: ChatMessage[]
  sessionId?: number
  filePath?: string
}

export type LLMStreamEvent =
  | { type: 'start'; requestId: string }
  | { type: 'delta'; requestId: string; text: string }
  | { type: 'end'; requestId: string; fullText: string }
  | { type: 'error'; requestId: string; error: string }
  | { type: 'apply'; requestId: string; range: ScopeRange; text: string }

export interface FileTreeNode {
  name: string
  path: string
  isDirectory: boolean
  children?: FileTreeNode[]
}

export interface StoredMessage {
  id: number
  session_id: number
  role: 'user' | 'assistant'
  content: string
  scope_level: ScopeLevel | null
  mode: Mode | null
  timestamp: number
}

export interface StoredSession {
  id: number
  created_at: number
  file_path: string | null
}

export interface TerminalSpawnOptions {
  id: string
  cwd: string
  cols: number
  rows: number
}

export const IPC = {
  // File system
  fsReadDir: 'fs:readDir',
  fsReadFile: 'fs:readFile',
  fsWriteFile: 'fs:writeFile',
  fsOpenDirDialog: 'fs:openDirDialog',
  fsOpenFileDialog: 'fs:openFileDialog',
  fsWatchStart: 'fs:watchStart',
  fsWatchStop: 'fs:watchStop',
  fsWatchEvent: 'fs:watchEvent',

  // LLM
  llmStart: 'llm:start',
  llmCancel: 'llm:cancel',
  llmStream: 'llm:stream',

  // DB
  dbCreateSession: 'db:createSession',
  dbListSessions: 'db:listSessions',
  dbGetMessages: 'db:getMessages',
  dbAppendMessage: 'db:appendMessage',

  // Terminal
  ptySpawn: 'pty:spawn',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',

  // App
  appGetCwd: 'app:getCwd',

  // Settings
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsTestKey: 'settings:testKey',

  // Native chrome
  appSetTheme: 'app:setTheme',

  // Context collection
  fsCollectContext: 'fs:collectContext'
} as const

export interface SydeSettings {
  hasApiKey: boolean
  apiKeySource: 'env' | 'stored' | 'none'
  model: string
  encryptionAvailable: boolean
}

export interface KeyTestResult {
  ok: boolean
  error?: string
  model?: string
}

export type ContextMode = 'none' | 'pinned' | 'file' | 'project'

export interface CollectContextArgs {
  mode: ContextMode
  rootPath: string | null
  activeFilePath: string | null
  pinned: string[]
  maxFiles?: number
  maxLinesPerFile?: number
}

export interface CollectedContext {
  files: ContextFile[]
  skipped: { path: string; reason: string }[]
  totalChars: number
}
