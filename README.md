# SyDE

A personal IDE built around intentional, scope-limited LLM assistance — the antithesis of vibe coding. The developer stays in control; the LLM operates only within explicitly defined boundaries.

## The three controls

- **Scope** — what the LLM can touch (`line` / `block` / `file` / `project` / `custom`)
- **Context** — what the LLM can see (file-tree checkboxes pin files into the prompt)
- **Mode** — how the LLM behaves (`ask` / `edit` / `agent`)

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

## Build

```bash
npm run build
```

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
