export type {
  Mode,
  ScopeLevel,
  ScopeRange,
  Scope,
  ContextFile,
  ContextMode,
  CollectedContext,
  ChatMessage,
  LLMRequest,
  LLMStreamEvent,
  FileTreeNode,
  StoredMessage,
  StoredSession,
  SydeSettings,
  KeyTestResult
} from '@shared/types'

export interface ChatItem {
  id: string
  role: 'user' | 'assistant'
  content: string
  scopeLevel?: import('@shared/types').ScopeLevel
  mode?: import('@shared/types').Mode
  streaming?: boolean
  error?: string
}
