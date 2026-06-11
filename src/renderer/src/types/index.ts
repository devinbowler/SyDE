export type {
  Mode,
  ScopeLevel,
  ScopeRange,
  Scope,
  ContextFile,
  ContextMode,
  CollectedContext,
  ChatMessage,
  LLMProvider,
  LLMRequest,
  LLMStreamEvent,
  FileTreeNode,
  StoredMessage,
  StoredSession,
  SessionSummary,
  SettingsUpdate,
  ProviderSettings,
  SearchHit,
  SearchOptions,
  SearchResult,
  ReplaceOptions,
  ReplaceResult,
  SydeSettings,
  KeyTestResult,
  TokenUsage
} from '@shared/types'

import type { ScopeLevel } from '@shared/types'

/** Structured info about a single edit applied to the editor. */
export interface EditSummary {
  filePath: string | null
  scopeLevel: ScopeLevel
  startLine: number
  endLine: number
  prevLines: number
  newLines: number
  prevChars: number
  newChars: number
  /**
   * Reasonably-sized display path. Always relative to the workspace root
   * when one is available, otherwise just the basename.
   */
  displayPath: string
}

export interface ChatItem {
  id: string
  role: 'user' | 'assistant'
  content: string
  scopeLevel?: import('@shared/types').ScopeLevel
  mode?: import('@shared/types').Mode
  streaming?: boolean
  error?: string
  /** Set on assistant items in `edit` mode after the edit is applied. */
  editSummary?: EditSummary
  /** Token usage reported by the model for this exchange. */
  usage?: import('@shared/types').TokenUsage
  /** While streaming an `edit` response, the running char count of code received. */
  streamProgress?: number
}
