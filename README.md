# SyDE

A personal IDE built around intentional, scope-limited LLM assistance — the antithesis of vibe coding. The developer stays in control; the LLM operates only within explicitly defined boundaries.

## The three controls

- **Scope** — what the LLM can touch (`line` / `block` / `file` / `project` / `custom`)
- **Context** — what the LLM can see (file-tree checkboxes pin files into the prompt)
- **Mode** — how the LLM behaves (`ask` / `edit`)

## Stack

- **Electron** (main + renderer + preload, IPC bridge)
- **Monaco Editor** via `@monaco-editor/react`
- **React + Tailwind** for UI chrome
- **Anthropic SDK** for streaming completions (main process only)
- **better-sqlite3** for chat history and preferences
- **node-pty + xterm.js** for the embedded terminal
- **chokidar** for filesystem watching

## Setup

```bash
npm install
# Native modules (better-sqlite3, node-pty) need to be rebuilt against Electron's Node ABI:
npm run rebuild
```

Set your Anthropic key as an environment variable before launching:

```bash
# PowerShell
$env:ANTHROPIC_API_KEY = "sk-ant-..."

# bash / zsh
export ANTHROPIC_API_KEY="sk-ant-..."
```

Optional overrides:

- `SYDE_MODEL` — Anthropic model id (default: `claude-sonnet-4-6`)
- `SYDE_MAX_TOKENS` — max output tokens per response (default: `4096`)

## Develop

```bash
npm run dev
```

## Build a distributable

`electron-builder` is wired up. Run from the platform you want to ship for:

```bash
# Windows: produces a Setup .exe (NSIS) + a Portable .exe
npm run dist:win

# macOS: produces a .dmg for x64 and arm64
npm run dist:mac

# Linux: produces an AppImage
npm run dist:linux

# Build for the current platform (whatever you're on)
npm run dist

# Or just bundle the unpacked app (no installer) into release/<platform>-unpacked/
npm run pack
```

Output goes to `release/`. The Windows installer ends up at
`release/SyDE-Setup-0.1.0.exe`; the portable build at
`release/SyDE-Portable-0.1.0.exe`. macOS DMGs and Linux AppImages follow
similar names.

### Notes for distribution

- **Cross-compilation** is limited. Build Windows installers on Windows, macOS DMGs on macOS, etc. (electron-builder can sometimes cross-build with extra tooling — easier to just build on each OS.)
- **Unsigned builds**: SyDE doesn't sign its binaries. On Windows, SmartScreen will warn users with an "unknown publisher" dialog (click *More info → Run anyway*). On macOS, recipients need to right-click → *Open* the first time, or run `xattr -d com.apple.quarantine /Applications/SyDE.app`.
- **Icons**: drop a 256×256+ `icon.ico` (Windows), `icon.icns` (macOS), or 512×512 `icon.png` (Linux) into `build/` and uncomment the matching `icon:` line in `electron-builder.yml` to brand the installer.
- **API keys aren't bundled.** Recipients install the app, open Settings (gear icon), and paste their own Anthropic key. It's stored encrypted via the OS keychain (DPAPI on Windows, Keychain on macOS).

### Troubleshooting

- **Windows: `Cannot create symbolic link` during the first build.** electron-builder caches its signing tools as a `.7z` whose macOS dylib symlinks Windows refuses to create without elevated privileges. Either enable *Settings → For Developers → Developer Mode* (then re-run `npm run dist:win`), or run PowerShell once as Administrator for the first build. Subsequent builds reuse the cache and work without elevation.
- **Native module errors (`better-sqlite3` / `node-pty`) at runtime.** Run `npm run rebuild` — that recompiles them against Electron's Node ABI. The `postinstall` hook does this automatically after `npm install`, but if you change Electron versions you'll need to re-run it.

## Layout

```
syde/
├── electron.vite.config.ts
├── package.json
├── tailwind.config.js
├── tsconfig*.json
└── src/
    ├── main/           # Electron main process (IPC, LLM, DB, fs)
    ├── preload/        # contextBridge API
    ├── shared/         # types shared across processes
    └── renderer/       # React + Monaco UI
        ├── index.html
        └── src/
            ├── App.tsx
            ├── components/
            ├── hooks/
            └── store/
```

## What's intentionally not built (yet)

- Diff / accept / reject UI (the `diff` package is installed for future use)
- Multi-tab editor
- LSP integration

The point of SyDE is to make the LLM a sharp tool, not a co-pilot. Build features only when they preserve that.
