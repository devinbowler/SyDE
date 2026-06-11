import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  safeStorage,
  shell,
  Tray
} from 'electron'
import path from 'path'
import os from 'os'
import fs from 'fs'
import zlib from 'zlib'
import { IPC } from '@shared/types'
import type {
  CollectContextArgs,
  CollectedContext,
  LLMProvider,
  LLMRequest,
  ReplaceOptions,
  SearchOptions,
  SettingsUpdate,
  SydeSettings,
  TerminalSpawnOptions
} from '@shared/types'
import {
  readDirectoryTree,
  readFileSafe,
  writeFileSafe,
  createFileSafe,
  createDirectorySafe,
  deletePathSafe,
  assertWithinRoot,
  renameSafe,
  startWatching,
  stopWatching,
  stopAllWatchers,
  collectProjectContext,
  projectSearch,
  projectReplace
} from './fileSystem'
import {
  initDatabase,
  closeDatabase,
  createSession,
  listSessions,
  listSessionSummaries,
  getMessages,
  appendMessage,
  setSecret
} from './db'
import {
  ANTHROPIC_API_KEY_PREF,
  ANTHROPIC_MODEL_PREF,
  OPENAI_API_KEY_PREF,
  OPENAI_MODEL_PREF,
  ACTIVE_PROVIDER_PREF,
  LLMSession,
  getActiveProvider,
  getApiKeySource,
  getModelFor
} from './llm'

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
let tray: Tray | null = null
// Distinguish "user closed the window" (we hide instead) from "user actually
// wants to quit the app" (Cmd/Ctrl+Q, tray menu Quit, app.quit, OS shutdown).
let forceQuit = false
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

// CRC32 lookup for PNG chunk checksums. Standalone so we don't pull in a dep
// just to draw a 16×16 tray icon.
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([length, typeBuf, data, crc])
}

/**
 * Build a 16×16 RGBA PNG entirely in memory. Avoids shipping a binary asset
 * — handy because the build's `files: ["out/**"]` rule strips `build/*.png`
 * unless we explicitly include it.
 */
function buildTrayIconBuffer(): Buffer {
  const w = 16
  const h = 16
  // Filled rounded square with a brand-color "S" silhouette (very rough at
  // this resolution — it just needs to be recognizable in the tray).
  const stride = 1 + w * 4
  const raw = Buffer.alloc(stride * h)
  const center = (w - 1) / 2
  const radius = 7.2

  const insideColor = [0x9d, 0x7c, 0xff, 0xff] // accent purple
  const transparent = [0, 0, 0, 0]

  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0 // PNG filter: None
    for (let x = 0; x < w; x++) {
      const off = y * stride + 1 + x * 4
      const dx = x - center
      const dy = y - center
      const dist = Math.sqrt(dx * dx + dy * dy)
      const c = dist <= radius ? insideColor : transparent
      raw[off] = c[0]
      raw[off + 1] = c[1]
      raw[off + 2] = c[2]
      raw[off + 3] = c[3]
    }
  }

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr.writeUInt8(8, 8) // bit depth
  ihdr.writeUInt8(6, 9) // RGBA
  ihdr.writeUInt8(0, 10) // compression
  ihdr.writeUInt8(0, 11) // filter
  ihdr.writeUInt8(0, 12) // interlace

  const idatBody = zlib.deflateSync(raw)
  return Buffer.concat([
    sig,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', idatBody),
    makePngChunk('IEND', Buffer.alloc(0))
  ])
}

function ensureTray(): void {
  if (tray) return
  const img = nativeImage.createFromBuffer(buildTrayIconBuffer())
  tray = new Tray(img)
  tray.setToolTip('SyDE')
  const showWindow = () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show SyDE', click: showWindow },
      { type: 'separator' },
      {
        label: 'Quit SyDE',
        click: () => {
          forceQuit = true
          app.quit()
        }
      }
    ])
  )
  tray.on('click', () => {
    if (mainWindow?.isVisible() && !mainWindow.isMinimized()) {
      mainWindow.hide()
    } else {
      showWindow()
    }
  })
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

function buildAppMenu(): void {
  // We hide the menu bar visually (autoHideMenuBar + setMenuBarVisibility),
  // but installing a Menu wires up Cmd/Ctrl+Q so the user always has a
  // first-class quit path that bypasses the hide-on-close interception.
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              {
                label: 'Quit SyDE',
                accelerator: 'Cmd+Q',
                click: () => {
                  forceQuit = true
                  app.quit()
                }
              }
            ]
          }
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Hide Window',
          accelerator: isMac ? 'Cmd+W' : 'Ctrl+W',
          click: () => mainWindow?.hide()
        },
        { type: 'separator' },
        {
          label: 'Quit SyDE',
          accelerator: isMac ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            forceQuit = true
            app.quit()
          }
        }
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  buildAppMenu()

  mainWindow = new BrowserWindow({
    width: 1600,
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

  // Hide-on-close: if the user clicks the window's X (or Cmd/Ctrl+W via the
  // menu), don't terminate the app. Stash it in the system tray instead so
  // the file tree, terminal sessions, and chat history all stay alive. The
  // user can quit explicitly via Cmd/Ctrl+Q or the tray menu, which sets
  // `forceQuit` and lets the close go through normally.
  mainWindow.on('close', (e) => {
    if (forceQuit) {
      isShuttingDown = true
      teardownPtys()
      stopAllWatchers()
      return
    }
    e.preventDefault()
    mainWindow?.hide()
    ensureTray()
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

  ipcMain.handle(
    IPC.fsCreateFile,
    async (_e, args: { rootPath: string; filePath: string; content?: string }) => {
      const safe = assertWithinRoot(args.filePath, args.rootPath)
      await createFileSafe(safe, args.content ?? '')
      return safe
    }
  )

  ipcMain.handle(
    IPC.fsCreateDir,
    async (_e, args: { rootPath: string; dirPath: string }) => {
      const safe = assertWithinRoot(args.dirPath, args.rootPath)
      await createDirectorySafe(safe)
      return safe
    }
  )

  ipcMain.handle(
    IPC.fsDelete,
    async (_e, args: { rootPath: string; targetPath: string }) => {
      const root = path.resolve(args.rootPath)
      const safe = assertWithinRoot(args.targetPath, args.rootPath)
      if (safe === root) throw new Error('Cannot delete workspace root')
      await deletePathSafe(safe)
      return true
    }
  )

  ipcMain.handle(IPC.fsRename, async (_e, oldPath: string, newPath: string) => {
    await renameSafe(oldPath, newPath)
    return true
  })

  ipcMain.handle(IPC.fsProjectSearch, async (_e, opts: SearchOptions) => {
    return projectSearch(opts)
  })

  ipcMain.handle(IPC.fsProjectReplace, async (_e, opts: ReplaceOptions) => {
    return projectReplace(opts)
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
  ipcMain.handle(IPC.dbListSessionSummaries, (_e, limit?: number) =>
    listSessionSummaries(limit)
  )
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
      onEnd: (fullText, usage) =>
        safeSend(IPC.llmStream, {
          type: 'end',
          requestId: req.requestId,
          fullText,
          usage
        }),
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
          // Pinned entries can be either files or directories. Files are
          // added directly; directories are walked using the same
          // exclusions/limits as the project collector.
          let stat: import('fs').Stats | null = null
          try {
            stat = fs.statSync(p)
          } catch {
            out.skipped.push({ path: p, reason: 'pinned path missing' })
            continue
          }
          if (stat.isDirectory()) {
            const collected = await collectProjectContext(p, {
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
          } else {
            await tryAdd(p, 'pinned')
          }
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

function snapshotSettings(): SydeSettings {
  return {
    activeProvider: getActiveProvider(),
    providers: {
      anthropic: {
        hasApiKey: getApiKeySource('anthropic') !== 'none',
        apiKeySource: getApiKeySource('anthropic'),
        model: getModelFor('anthropic')
      },
      openai: {
        hasApiKey: getApiKeySource('openai') !== 'none',
        apiKeySource: getApiKeySource('openai'),
        model: getModelFor('openai')
      }
    },
    encryptionAvailable: safeStorage.isEncryptionAvailable()
  }
}

function registerSettingsIPC(): void {
  ipcMain.handle(IPC.settingsGet, (): SydeSettings => snapshotSettings())

  ipcMain.handle(
    IPC.settingsSet,
    (_e, args: SettingsUpdate): SydeSettings => {
      if (args.activeProvider) {
        setSecret(ACTIVE_PROVIDER_PREF, args.activeProvider)
        llm.invalidateClient()
      }
      if (args.provider) {
        const isAnthropic = args.provider === 'anthropic'
        if (args.apiKey !== undefined) {
          setSecret(
            isAnthropic ? ANTHROPIC_API_KEY_PREF : OPENAI_API_KEY_PREF,
            args.apiKey ?? null
          )
          llm.invalidateClient()
        }
        if (args.model !== undefined) {
          setSecret(
            isAnthropic ? ANTHROPIC_MODEL_PREF : OPENAI_MODEL_PREF,
            args.model ?? null
          )
          llm.invalidateClient()
        }
      }
      return snapshotSettings()
    }
  )

  ipcMain.handle(
    IPC.settingsTestKey,
    async (_e, args: { provider: LLMProvider; key: string }) => {
      return llm.testKey(args.provider, args.key)
    }
  )
}

// Single-instance lock: if the user launches the .exe again while SyDE is
// already running (especially handy when the window is hidden in the tray),
// the second launch refocuses the existing window instead of spawning a new
// process.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

app.whenReady().then(() => {
  initDatabase()

  const provider = getActiveProvider()
  const src = getApiKeySource(provider)
  const model = getModelFor(provider)
  if (src === 'env') {
    console.log(`[syde] active provider=${provider} model=${model} (key from env)`)
  } else if (src === 'stored') {
    console.log(`[syde] active provider=${provider} model=${model} (key stored, encrypted)`)
  } else {
    console.warn(
      `[syde] active provider=${provider} but no API key configured — open Settings (gear icon) inside SyDE to add one.`
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
  forceQuit = true
  isShuttingDown = true
  try {
    globalShortcut.unregisterAll()
  } catch {
    // ignore
  }
  teardownPtys()
  stopAllWatchers()
})

// We intentionally DO NOT auto-quit on window-all-closed. The whole point of
// the tray-hide pattern is that closing the last window keeps SyDE alive.
// Real quits go through `before-quit` → `forceQuit = true`.
app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return
  if (forceQuit) {
    closeDatabase()
    app.quit()
  }
})
