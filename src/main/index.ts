import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  safeStorage,
  shell
} from 'electron'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { IPC } from '@shared/types'
import type {
  CollectContextArgs,
  CollectedContext,
  LLMRequest,
  SydeSettings,
  TerminalSpawnOptions
} from '@shared/types'
import {
  readDirectoryTree,
  readFileSafe,
  writeFileSafe,
  startWatching,
  stopWatching,
  stopAllWatchers,
  collectProjectContext
} from './fileSystem'
import {
  initDatabase,
  closeDatabase,
  createSession,
  listSessions,
  getMessages,
  appendMessage,
  setSecret,
  getSecret
} from './db'
import { API_KEY_PREF, MODEL_PREF, LLMSession, getApiKeySource } from './llm'

// node-pty is loaded lazily because it's a native module that may need rebuilding.
type IPty = {
  onData: (cb: (data: string) => void) => void
  onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => void
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  kill: (signal?: string) => void
  pid: number
}

let mainWindow: BrowserWindow | null = null
let isShuttingDown = false
const llm = new LLMSession()
const ptys = new Map<string, IPty>()

/**
 * Send safely from main → renderer. Avoids the classic "Object has been
 * destroyed" crash that happens when a native source (node-pty, chokidar)
 * fires data after the BrowserWindow's webContents has been destroyed but
 * before the underlying socket has closed.
 */
function safeSend(channel: string, payload: unknown): void {
  if (isShuttingDown) return
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  const wc = win.webContents
  if (!wc || wc.isDestroyed()) return
  try {
    wc.send(channel, payload)
  } catch {
    // window was destroyed between checks; safe to swallow
  }
}

function teardownPtys(): void {
  for (const p of ptys.values()) {
    try {
      p.kill()
    } catch {
      // ignore
    }
  }
  ptys.clear()
}

function createWindow(): void {
  // Strip Electron's default app menu — SyDE provides its own chrome and the
  // native menu doesn't theme cleanly across platforms.
  Menu.setApplicationMenu(null)

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0c0c0e' : '#fcfcfd',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.setMenuBarVisibility(false)

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // When the window starts closing, kill native sources BEFORE webContents is
  // destroyed — otherwise their final data events crash with
  // "Object has been destroyed".
  mainWindow.on('close', () => {
    isShuttingDown = true
    teardownPtys()
    stopAllWatchers()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function registerFileSystemIPC(): void {
  ipcMain.handle(IPC.fsReadDir, async (_e, rootPath: string) => {
    return readDirectoryTree(rootPath)
  })

  ipcMain.handle(IPC.fsReadFile, async (_e, filePath: string) => {
    return readFileSafe(filePath)
  })

  ipcMain.handle(IPC.fsWriteFile, async (_e, filePath: string, content: string) => {
    await writeFileSafe(filePath, content)
    return true
  })

  ipcMain.handle(IPC.fsOpenDirDialog, async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.fsOpenFileDialog, async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.fsWatchStart, async (_e, watchId: string, rootPath: string) => {
    startWatching(watchId, rootPath, (event) => {
      safeSend(IPC.fsWatchEvent, { watchId, ...event })
    })
    return true
  })

  ipcMain.handle(IPC.fsWatchStop, async (_e, watchId: string) => {
    stopWatching(watchId)
    return true
  })
}

function registerDbIPC(): void {
  ipcMain.handle(IPC.dbCreateSession, (_e, filePath: string | null) =>
    createSession(filePath)
  )
  ipcMain.handle(IPC.dbListSessions, (_e, limit?: number) => listSessions(limit))
  ipcMain.handle(IPC.dbGetMessages, (_e, sessionId: number) => getMessages(sessionId))
  ipcMain.handle(IPC.dbAppendMessage, (_e, args) => appendMessage(args))
}

function registerLLMIPC(): void {
  ipcMain.handle(IPC.llmStart, async (_e, req: LLMRequest) => {
    console.log(`[syde:ipc] llm:start request=${req.requestId} mode=${req.mode}`)

    void llm.run(req, {
      onStart: () => safeSend(IPC.llmStream, { type: 'start', requestId: req.requestId }),
      onDelta: (text) =>
        safeSend(IPC.llmStream, { type: 'delta', requestId: req.requestId, text }),
      onEnd: (fullText) =>
        safeSend(IPC.llmStream, { type: 'end', requestId: req.requestId, fullText }),
      onError: (error) =>
        safeSend(IPC.llmStream, { type: 'error', requestId: req.requestId, error })
    })

    return { ok: true }
  })

  ipcMain.handle(IPC.llmCancel, () => {
    console.log('[syde:ipc] llm:cancel')
    llm.cancel()
    return true
  })
}

function buildShellEnv(): Record<string, string> {
  // Electron injects internals (ELECTRON_RUN_AS_NODE, ELECTRON_NO_ATTACH_CONSOLE,
  // ATOM_SHELL_*, NODE_OPTIONS pointing into Electron's runtime, etc.) that crash
  // child shells with STATUS_DLL_INIT_FAILED on Windows. Strip them.
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v !== 'string') continue
    if (k.startsWith('ELECTRON_')) continue
    if (k.startsWith('ATOM_')) continue
    if (k === 'NODE_OPTIONS') continue
    if (k === 'GTK_PATH') continue
    out[k] = v
  }
  // Useful identifier for shells / scripts to detect SyDE.
  out.SYDE = '1'
  out.TERM = 'xterm-256color'
  return out
}

function pickShell(): { cmd: string; args: string[] } {
  if (process.platform === 'win32') {
    // Prefer PowerShell 7 (pwsh) → Windows PowerShell → cmd
    const pwsh = process.env['ProgramFiles']
      ? `${process.env['ProgramFiles']}\\PowerShell\\7\\pwsh.exe`
      : ''
    if (pwsh && fs.existsSync(pwsh)) return { cmd: pwsh, args: ['-NoLogo'] }
    const winps = `${process.env['SystemRoot'] ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
    if (fs.existsSync(winps)) return { cmd: winps, args: ['-NoLogo'] }
    return { cmd: process.env.COMSPEC ?? 'cmd.exe', args: [] }
  }
  return { cmd: process.env.SHELL ?? '/bin/bash', args: [] }
}

function registerPtyIPC(): void {
  ipcMain.handle(IPC.ptySpawn, async (_e, opts: TerminalSpawnOptions) => {
    let pty: typeof import('node-pty')
    try {
      // Lazy require because node-pty is native and may not be rebuilt.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      pty = require('node-pty')
    } catch (e) {
      throw new Error(
        'node-pty failed to load. Run `npm run rebuild` to compile native modules for Electron.'
      )
    }

    const { cmd, args } = pickShell()
    const env = buildShellEnv()

    type SpawnOpts = {
      name: string
      cols: number
      rows: number
      cwd: string
      env: Record<string, string>
      useConpty?: boolean
      conptyInheritCursor?: boolean
    }

    const spawnOpts: SpawnOpts = {
      name: 'xterm-256color',
      cols: opts.cols || 80,
      rows: opts.rows || 24,
      cwd: opts.cwd || os.homedir(),
      env
    }
    if (process.platform === 'win32') {
      spawnOpts.useConpty = true
      spawnOpts.conptyInheritCursor = false
    }

    let proc: IPty
    try {
      proc = pty.spawn(cmd, args, spawnOpts as unknown as Parameters<typeof pty.spawn>[2]) as unknown as IPty
    } catch (e) {
      throw new Error(`Failed to spawn shell '${cmd}': ${(e as Error).message}`)
    }

    proc.onData((data) => {
      safeSend(IPC.ptyData, { id: opts.id, data })
    })
    proc.onExit(({ exitCode }) => {
      safeSend(IPC.ptyExit, { id: opts.id, exitCode })
      ptys.delete(opts.id)
    })

    ptys.set(opts.id, proc)
    return { pid: proc.pid, shell: cmd }
  })

  ipcMain.handle(IPC.ptyWrite, (_e, id: string, data: string) => {
    ptys.get(id)?.write(data)
    return true
  })

  ipcMain.handle(IPC.ptyResize, (_e, id: string, cols: number, rows: number) => {
    ptys.get(id)?.resize(cols, rows)
    return true
  })

  ipcMain.handle(IPC.ptyKill, (_e, id: string) => {
    const p = ptys.get(id)
    if (p) {
      try {
        p.kill()
      } catch {
        // ignore
      }
      ptys.delete(id)
    }
    return true
  })
}

function registerAppIPC(): void {
  ipcMain.handle(IPC.appGetCwd, () => process.cwd())

  ipcMain.handle(
    IPC.appSetTheme,
    (_e, theme: 'dark' | 'light' | 'system') => {
      nativeTheme.themeSource = theme
      // Update window background color to match so resizes don't flash.
      const bg = theme === 'light' ? '#fcfcfd' : '#0c0c0e'
      try {
        mainWindow?.setBackgroundColor(bg)
      } catch {
        // ignore
      }
      return { ok: true }
    }
  )
}

function registerContextIPC(): void {
  ipcMain.handle(
    IPC.fsCollectContext,
    async (_e, args: CollectContextArgs): Promise<CollectedContext> => {
      const { mode, rootPath, activeFilePath, pinned } = args
      const maxFiles = args.maxFiles ?? 60
      const maxLinesPerFile = args.maxLinesPerFile ?? 250

      const out: CollectedContext = { files: [], skipped: [], totalChars: 0 }

      if (mode === 'none') return out

      const seen = new Set<string>()
      const tryAdd = async (p: string, reason: string) => {
        if (seen.has(p)) return
        seen.add(p)
        try {
          const content = await readFileSafe(p)
          const lines = content.split(/\r\n|\r|\n/).length
          if (lines > maxLinesPerFile) {
            out.skipped.push({ path: p, reason: `${lines} lines > ${maxLinesPerFile}` })
            return
          }
          out.files.push({ path: p, content })
          out.totalChars += content.length
        } catch (e) {
          out.skipped.push({ path: p, reason: `read failed: ${(e as Error).message}` })
        }
      }

      if (mode === 'file') {
        if (activeFilePath) await tryAdd(activeFilePath, 'active file')
        return out
      }

      if (mode === 'pinned') {
        for (const p of pinned) {
          if (out.files.length >= maxFiles) break
          await tryAdd(p, 'pinned')
        }
        return out
      }

      if (mode === 'project') {
        if (!rootPath) {
          if (activeFilePath) await tryAdd(activeFilePath, 'no workspace, fell back to active file')
          return out
        }
        // Always ensure the active file is included even if it would otherwise be filtered.
        if (activeFilePath) await tryAdd(activeFilePath, 'active file')
        const collected = await collectProjectContext(rootPath, {
          maxFiles: maxFiles - out.files.length,
          maxLinesPerFile
        })
        for (const f of collected.files) {
          if (out.files.length >= maxFiles) break
          if (seen.has(f.path)) continue
          seen.add(f.path)
          out.files.push(f)
          out.totalChars += f.content.length
        }
        out.skipped.push(...collected.skipped)
      }

      return out
    }
  )
}

function registerSettingsIPC(): void {
  ipcMain.handle(IPC.settingsGet, (): SydeSettings => {
    return {
      hasApiKey: getApiKeySource() !== 'none',
      apiKeySource: getApiKeySource(),
      model: process.env.SYDE_MODEL ?? getSecret(MODEL_PREF) ?? 'claude-sonnet-4-6',
      encryptionAvailable: safeStorage.isEncryptionAvailable()
    }
  })

  ipcMain.handle(
    IPC.settingsSet,
    (_e, args: { apiKey?: string | null; model?: string | null }) => {
      if (args.apiKey !== undefined) {
        setSecret(API_KEY_PREF, args.apiKey ?? null)
        llm.invalidateClient()
      }
      if (args.model !== undefined) {
        setSecret(MODEL_PREF, args.model ?? null)
        llm.invalidateClient()
      }
      return {
        hasApiKey: getApiKeySource() !== 'none',
        apiKeySource: getApiKeySource(),
        model: process.env.SYDE_MODEL ?? getSecret(MODEL_PREF) ?? 'claude-sonnet-4-6',
        encryptionAvailable: safeStorage.isEncryptionAvailable()
      } satisfies SydeSettings
    }
  )

  ipcMain.handle(IPC.settingsTestKey, async (_e, key: string) => {
    return llm.testKey(key)
  })
}

app.whenReady().then(() => {
  initDatabase()

  const src = getApiKeySource()
  if (src === 'env') {
    console.log('[syde] using ANTHROPIC_API_KEY from environment')
  } else if (src === 'stored') {
    console.log('[syde] using stored Anthropic API key (encrypted on disk)')
  } else {
    console.warn(
      '[syde] no Anthropic API key configured — open Settings (gear icon) inside SyDE to add one.'
    )
  }

  registerFileSystemIPC()
  registerDbIPC()
  registerLLMIPC()
  registerPtyIPC()
  registerAppIPC()
  registerSettingsIPC()
  registerContextIPC()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  isShuttingDown = true
  teardownPtys()
  stopAllWatchers()
})

app.on('window-all-closed', () => {
  isShuttingDown = true
  teardownPtys()
  stopAllWatchers()
  closeDatabase()
  if (process.platform !== 'darwin') app.quit()
})
