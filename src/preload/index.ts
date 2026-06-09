import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/types'
import type {
  CollectContextArgs,
  CollectedContext,
  FileTreeNode,
  KeyTestResult,
  LLMRequest,
  LLMStreamEvent,
  Mode,
  ScopeLevel,
  StoredMessage,
  StoredSession,
  SydeSettings,
  TerminalSpawnOptions
} from '@shared/types'

const api = {
  // file system
  fs: {
    readDir: (rootPath: string): Promise<FileTreeNode> =>
      ipcRenderer.invoke(IPC.fsReadDir, rootPath),
    readFile: (filePath: string): Promise<string> =>
      ipcRenderer.invoke(IPC.fsReadFile, filePath),
    writeFile: (filePath: string, content: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.fsWriteFile, filePath, content),
    openDirDialog: (): Promise<string | null> =>
      ipcRenderer.invoke(IPC.fsOpenDirDialog),
    openFileDialog: (): Promise<string | null> =>
      ipcRenderer.invoke(IPC.fsOpenFileDialog),
    watchStart: (watchId: string, rootPath: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.fsWatchStart, watchId, rootPath),
    watchStop: (watchId: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.fsWatchStop, watchId),
    onWatchEvent: (
      cb: (e: {
        watchId: string
        type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'
        path: string
      }) => void
    ): (() => void) => {
      const handler = (_: unknown, payload: Parameters<typeof cb>[0]) => cb(payload)
      ipcRenderer.on(IPC.fsWatchEvent, handler)
      return () => ipcRenderer.off(IPC.fsWatchEvent, handler)
    }
  },

  // db
  db: {
    createSession: (filePath: string | null): Promise<StoredSession> =>
      ipcRenderer.invoke(IPC.dbCreateSession, filePath),
    listSessions: (limit?: number): Promise<StoredSession[]> =>
      ipcRenderer.invoke(IPC.dbListSessions, limit),
    getMessages: (sessionId: number): Promise<StoredMessage[]> =>
      ipcRenderer.invoke(IPC.dbGetMessages, sessionId),
    appendMessage: (args: {
      sessionId: number
      role: 'user' | 'assistant'
      content: string
      scopeLevel: ScopeLevel | null
      mode: Mode | null
    }): Promise<StoredMessage> => ipcRenderer.invoke(IPC.dbAppendMessage, args)
  },

  // llm
  llm: {
    start: (req: LLMRequest): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.llmStart, req),
    cancel: (): Promise<boolean> => ipcRenderer.invoke(IPC.llmCancel),
    onStream: (cb: (event: LLMStreamEvent) => void): (() => void) => {
      const handler = (_: unknown, event: LLMStreamEvent) => cb(event)
      ipcRenderer.on(IPC.llmStream, handler)
      return () => ipcRenderer.off(IPC.llmStream, handler)
    }
  },

  // terminal
  pty: {
    spawn: (opts: TerminalSpawnOptions): Promise<{ pid: number; shell?: string }> =>
      ipcRenderer.invoke(IPC.ptySpawn, opts),
    write: (id: string, data: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.ptyWrite, id, data),
    resize: (id: string, cols: number, rows: number): Promise<boolean> =>
      ipcRenderer.invoke(IPC.ptyResize, id, cols, rows),
    kill: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.ptyKill, id),
    onData: (cb: (e: { id: string; data: string }) => void): (() => void) => {
      const handler = (_: unknown, payload: { id: string; data: string }) => cb(payload)
      ipcRenderer.on(IPC.ptyData, handler)
      return () => ipcRenderer.off(IPC.ptyData, handler)
    },
    onExit: (cb: (e: { id: string; exitCode: number }) => void): (() => void) => {
      const handler = (_: unknown, payload: { id: string; exitCode: number }) =>
        cb(payload)
      ipcRenderer.on(IPC.ptyExit, handler)
      return () => ipcRenderer.off(IPC.ptyExit, handler)
    }
  },

  // app
  app: {
    getCwd: (): Promise<string> => ipcRenderer.invoke(IPC.appGetCwd),
    setTheme: (theme: 'dark' | 'light' | 'system'): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.appSetTheme, theme)
  },

  // context collection
  context: {
    collect: (args: CollectContextArgs): Promise<CollectedContext> =>
      ipcRenderer.invoke(IPC.fsCollectContext, args)
  },

  // settings
  settings: {
    get: (): Promise<SydeSettings> => ipcRenderer.invoke(IPC.settingsGet),
    set: (args: {
      apiKey?: string | null
      model?: string | null
    }): Promise<SydeSettings> => ipcRenderer.invoke(IPC.settingsSet, args),
    testKey: (key: string): Promise<KeyTestResult> =>
      ipcRenderer.invoke(IPC.settingsTestKey, key)
  }
}

export type SydeAPI = typeof api

contextBridge.exposeInMainWorld('syde', api)
