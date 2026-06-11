import { promises as fs } from 'fs'
import path from 'path'
import chokidar, { FSWatcher } from 'chokidar'
import type {
  ContextFile,
  FileTreeNode,
  ReplaceOptions,
  ReplaceResult,
  SearchHit,
  SearchOptions,
  SearchResult
} from '@shared/types'

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'out',
  'dist',
  '.next',
  '.turbo',
  '.cache',
  '.idea',
  '.vscode'
])

const IGNORE_FILES = new Set(['.DS_Store'])

const TEXT_EXT_LIMIT_BYTES = 2 * 1024 * 1024 // 2 MB hard cap on read

export async function readDirectoryTree(rootPath: string, maxDepth = 6): Promise<FileTreeNode> {
  const stat = await fs.stat(rootPath)
  if (!stat.isDirectory()) {
    return {
      name: path.basename(rootPath),
      path: rootPath,
      isDirectory: false
    }
  }

  async function walk(current: string, depth: number): Promise<FileTreeNode> {
    const name = path.basename(current) || current
    const node: FileTreeNode = {
      name,
      path: current,
      isDirectory: true,
      children: []
    }

    if (depth >= maxDepth) {
      return node
    }

    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return node
    }

    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    for (const entry of entries) {
      if (entry.isDirectory() && IGNORE_DIRS.has(entry.name)) continue
      if (!entry.isDirectory() && IGNORE_FILES.has(entry.name)) continue
      const child = path.join(current, entry.name)
      if (entry.isDirectory()) {
        node.children!.push(await walk(child, depth + 1))
      } else {
        node.children!.push({
          name: entry.name,
          path: child,
          isDirectory: false
        })
      }
    }
    return node
  }

  return walk(rootPath, 0)
}

export async function readFileSafe(filePath: string): Promise<string> {
  const stat = await fs.stat(filePath)
  if (stat.size > TEXT_EXT_LIMIT_BYTES) {
    throw new Error(`File too large to open (${stat.size} bytes)`)
  }
  const buf = await fs.readFile(filePath)
  // crude binary detection: a NUL byte in the first 8 KB
  const slice = buf.subarray(0, Math.min(buf.length, 8192))
  for (let i = 0; i < slice.length; i++) {
    if (slice[i] === 0) {
      throw new Error('File appears to be binary')
    }
  }
  return buf.toString('utf8')
}

export async function writeFileSafe(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, 'utf8')
}

export function assertWithinRoot(targetPath: string, rootPath: string): string {
  const resolved = path.resolve(targetPath)
  const root = path.resolve(rootPath)
  const rel = path.relative(root, resolved)
  if (rel === '' || rel === '.') return resolved
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path is outside workspace')
  }
  return resolved
}

export async function createFileSafe(filePath: string, content = ''): Promise<void> {
  const parent = path.dirname(filePath)
  try {
    const stat = await fs.stat(parent)
    if (!stat.isDirectory()) throw new Error('Parent is not a directory')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('Parent folder does not exist')
    }
    throw e
  }

  try {
    await fs.access(filePath)
    throw new Error('File already exists')
  } catch (e) {
    if ((e as Error).message === 'File already exists') throw e
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }

  await fs.writeFile(filePath, content, 'utf8')
}

export async function createDirectorySafe(dirPath: string): Promise<void> {
  const parent = path.dirname(dirPath)
  try {
    const stat = await fs.stat(parent)
    if (!stat.isDirectory()) throw new Error('Parent is not a directory')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('Parent folder does not exist')
    }
    throw e
  }

  try {
    await fs.access(dirPath)
    throw new Error('Folder already exists')
  } catch (e) {
    if ((e as Error).message === 'Folder already exists') throw e
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }

  await fs.mkdir(dirPath)
}

export async function deletePathSafe(targetPath: string): Promise<void> {
  const stat = await fs.stat(targetPath)
  if (stat.isDirectory()) {
    await fs.rm(targetPath, { recursive: true })
  } else {
    await fs.unlink(targetPath)
  }
}

/**
 * Rename a file or directory. Refuses to overwrite an existing target so we
 * never silently clobber the user's data.
 */
export async function renameSafe(oldPath: string, newPath: string): Promise<void> {
  if (!oldPath || !newPath) throw new Error('rename: empty path')
  if (oldPath === newPath) return
  try {
    await fs.access(newPath)
    throw new Error(`Target already exists: ${path.basename(newPath)}`)
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code !== 'ENOENT') throw e
  }
  await fs.mkdir(path.dirname(newPath), { recursive: true })
  await fs.rename(oldPath, newPath)
}

const watchers = new Map<string, FSWatcher>()

export function startWatching(
  watchId: string,
  rootPath: string,
  onEvent: (event: { type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'; path: string }) => void
): void {
  stopWatching(watchId)
  const watcher = chokidar.watch(rootPath, {
    ignored: (p: string) => {
      const segs = p.split(/[\\/]/)
      return segs.some((s) => IGNORE_DIRS.has(s) || IGNORE_FILES.has(s))
    },
    ignoreInitial: true,
    persistent: true,
    depth: 8
  })

  for (const t of ['add', 'change', 'unlink', 'addDir', 'unlinkDir'] as const) {
    watcher.on(t, (p: string) => onEvent({ type: t, path: p }))
  }

  watchers.set(watchId, watcher)
}

export function stopWatching(watchId: string): void {
  const w = watchers.get(watchId)
  if (w) {
    void w.close()
    watchers.delete(watchId)
  }
}

export function stopAllWatchers(): void {
  for (const w of watchers.values()) {
    void w.close()
  }
  watchers.clear()
}

// ── Project context collection ────────────────────────────────────────────

const CONTEXT_ALLOWED_EXT = new Set([
  // Code
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'rs', 'go', 'java', 'kt', 'scala',
  'c', 'h', 'cpp', 'hpp', 'cc', 'cs',
  'rb', 'php', 'swift', 'dart', 'lua',
  'sh', 'bash', 'zsh', 'ps1',
  // Web
  'html', 'htm', 'css', 'scss', 'sass', 'less',
  'vue', 'svelte', 'astro',
  // Data / config
  'json', 'yaml', 'yml', 'toml', 'ini', 'env', 'xml',
  // Docs
  'md', 'mdx', 'rst', 'txt',
  // Misc
  'sql', 'graphql', 'gql', 'proto'
])

const CONTEXT_EXCLUDED_FILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'composer.lock',
  'Cargo.lock',
  'poetry.lock',
  '.DS_Store'
])

export interface CollectOptions {
  maxFiles?: number
  maxLinesPerFile?: number
  maxBytes?: number
}

export async function collectProjectContext(
  rootPath: string,
  opts: CollectOptions = {}
): Promise<{ files: ContextFile[]; skipped: { path: string; reason: string }[] }> {
  const maxFiles = opts.maxFiles ?? 60
  const maxLines = opts.maxLinesPerFile ?? 250
  const maxBytes = opts.maxBytes ?? 64 * 1024 // 64 KB per file

  const files: ContextFile[] = []
  const skipped: { path: string; reason: string }[] = []

  async function walk(dir: string, depth: number): Promise<void> {
    if (files.length >= maxFiles) return
    if (depth > 8) return

    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    // Sort directories last so files in the root are picked up first.
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? 1 : -1
      return a.name.localeCompare(b.name)
    })

    for (const entry of entries) {
      if (files.length >= maxFiles) return
      const full = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue
        if (entry.name.startsWith('.')) continue
        await walk(full, depth + 1)
        continue
      }

      if (CONTEXT_EXCLUDED_FILES.has(entry.name)) continue
      if (entry.name.startsWith('.')) continue

      const dotIdx = entry.name.lastIndexOf('.')
      const ext = dotIdx === -1 ? '' : entry.name.slice(dotIdx + 1).toLowerCase()
      if (!CONTEXT_ALLOWED_EXT.has(ext)) continue

      try {
        const stat = await fs.stat(full)
        if (stat.size > maxBytes) {
          skipped.push({ path: full, reason: `${stat.size} bytes > ${maxBytes}` })
          continue
        }
        const buf = await fs.readFile(full)
        // crude binary check
        const probe = buf.subarray(0, Math.min(buf.length, 4096))
        let binary = false
        for (let i = 0; i < probe.length; i++) {
          if (probe[i] === 0) {
            binary = true
            break
          }
        }
        if (binary) {
          skipped.push({ path: full, reason: 'binary' })
          continue
        }
        const content = buf.toString('utf8')
        const lineCount = content.split(/\r\n|\r|\n/).length
        if (lineCount > maxLines) {
          skipped.push({ path: full, reason: `${lineCount} lines > ${maxLines}` })
          continue
        }
        files.push({ path: full, content })
      } catch (e) {
        skipped.push({ path: full, reason: (e as Error).message })
      }
    }
  }

  await walk(rootPath, 0)
  return { files, skipped }
}

// ── Global find / replace ─────────────────────────────────────────────────

const SEARCH_MAX_FILE_BYTES = 1.5 * 1024 * 1024 // 1.5 MB hard cap per file

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildSearchRegex(opts: {
  pattern: string
  isRegex: boolean
  caseSensitive: boolean
  wholeWord: boolean
}): RegExp {
  let body = opts.isRegex ? opts.pattern : escapeRegExp(opts.pattern)
  if (opts.wholeWord) body = `\\b(?:${body})\\b`
  const flags = opts.caseSensitive ? 'g' : 'gi'
  return new RegExp(body, flags)
}

/**
 * Walk every code-shaped file under `rootPath` and collect regex hits. Honors
 * the same exclusion rules as project-context collection (no node_modules,
 * no lockfiles, no binaries, size cap per file).
 */
export async function projectSearch(opts: SearchOptions): Promise<SearchResult> {
  const maxResults = opts.maxResults ?? 2000
  const maxFiles = opts.maxFilesScanned ?? 5000
  const re = buildSearchRegex(opts)
  const hits: SearchHit[] = []
  let filesScanned = 0
  let truncated = false

  async function walk(dir: string, depth: number): Promise<void> {
    if (truncated) return
    if (depth > 10) return

    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (truncated) return
      const full = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue
        if (entry.name.startsWith('.')) continue
        await walk(full, depth + 1)
        continue
      }

      if (CONTEXT_EXCLUDED_FILES.has(entry.name)) continue
      const dotIdx = entry.name.lastIndexOf('.')
      const ext = dotIdx === -1 ? '' : entry.name.slice(dotIdx + 1).toLowerCase()
      if (!CONTEXT_ALLOWED_EXT.has(ext)) continue

      filesScanned++
      if (filesScanned > maxFiles) {
        truncated = true
        return
      }

      try {
        const stat = await fs.stat(full)
        if (stat.size > SEARCH_MAX_FILE_BYTES) continue
        const buf = await fs.readFile(full)
        // crude binary check — first 4 KB must be NUL-free
        const probe = buf.subarray(0, Math.min(buf.length, 4096))
        let binary = false
        for (let i = 0; i < probe.length; i++) {
          if (probe[i] === 0) {
            binary = true
            break
          }
        }
        if (binary) continue

        const text = buf.toString('utf8')
        const lines = text.split(/\r\n|\r|\n/)
        for (let li = 0; li < lines.length; li++) {
          const line = lines[li]
          re.lastIndex = 0
          let m: RegExpExecArray | null
          while ((m = re.exec(line)) !== null) {
            if (hits.length >= maxResults) {
              truncated = true
              return
            }
            hits.push({
              filePath: full,
              line: li + 1,
              column: m.index + 1,
              preview: line.length > 240 ? line.slice(0, 240) + '…' : line,
              matchLength: m[0].length
            })
            // Empty-match guard for zero-width regexes.
            if (m.index === re.lastIndex) re.lastIndex++
          }
        }
      } catch {
        // Skip unreadable files silently — they shouldn't show up in results.
      }
    }
  }

  await walk(opts.rootPath, 0)
  return { hits, filesScanned, truncated }
}

/**
 * Apply the replacement to every matched file. Operates per-file: read the
 * full text, run String.replace with a global regex, write back if changed.
 * No partial-match selection in v1 — it's "replace all".
 */
export async function projectReplace(opts: ReplaceOptions): Promise<ReplaceResult> {
  // First pass: find which files contain any match. Reuses the search walker.
  const search = await projectSearch(opts)
  const filesWithHits = new Map<string, number>()
  for (const h of search.hits) {
    filesWithHits.set(h.filePath, (filesWithHits.get(h.filePath) ?? 0) + 1)
  }

  const errors: { filePath: string; reason: string }[] = []
  let filesChanged = 0
  let replacements = 0

  for (const [filePath, hitCount] of filesWithHits.entries()) {
    try {
      const buf = await fs.readFile(filePath)
      const text = buf.toString('utf8')
      const re = buildSearchRegex(opts)
      const next = text.replace(re, opts.replacement)
      if (next !== text) {
        await fs.writeFile(filePath, next, 'utf8')
        filesChanged++
        replacements += hitCount
      }
    } catch (e) {
      errors.push({ filePath, reason: (e as Error).message })
    }
  }

  return { filesChanged, replacements, errors }
}
