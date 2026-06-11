import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { useFileTree } from '../hooks/useFileTree'
import type { FileTreeNode } from '../types'

interface NodeProps {
  node: FileTreeNode
  depth: number
  workspaceRoot: string
  onOpen: (p: string) => void
  onContextMenu: (e: React.MouseEvent, node: FileTreeNode) => void
  renamingPath: string | null
  onCommitRename: (oldPath: string, newName: string) => Promise<void>
  onCancelRename: () => void
}

interface ContextMenuState {
  x: number
  y: number
  node: FileTreeNode
}

interface CreateState {
  parentDir: string
  type: 'file' | 'folder'
}

function joinPath(parent: string, name: string): string {
  // Preserve whatever separator the parent already uses (Windows vs POSIX).
  const sep = parent.includes('\\') && !parent.includes('/') ? '\\' : '/'
  return parent.replace(/[\\/]+$/, '') + sep + name
}

function dirnameOf(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return idx === -1 ? '' : p.slice(0, idx)
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      className={`text-fg-dim transition-transform ${open ? 'rotate-90' : ''}`}
    >
      <path
        d="M3 2 L7 5 L3 8"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" className="text-fg-dim">
      <path
        d="M3 1 H7 L9 3 V11 H3 Z"
        stroke="currentColor"
        strokeWidth="1"
        fill="none"
      />
      <path d="M7 1 V3 H9" stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  )
}

function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" className="text-fg-muted">
      {open ? (
        <path
          d="M1 4 L1 10 L11 10 L11 5 L6 5 L5 4 Z"
          stroke="currentColor"
          strokeWidth="1"
          fill="none"
        />
      ) : (
        <path
          d="M1 3 L5 3 L6 4 L11 4 L11 10 L1 10 Z"
          stroke="currentColor"
          strokeWidth="1"
          fill="none"
        />
      )}
    </svg>
  )
}

function Checkbox({
  checked,
  onChange
}: {
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
      className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm border transition-colors ${
        checked
          ? 'border-accent bg-accent/30'
          : 'border-border-subtle hover:border-border-strong'
      }`}
      title={checked ? 'Unpin from context' : 'Pin to context'}
    >
      {checked && (
        <svg width="9" height="9" viewBox="0 0 9 9" className="text-accent">
          <path
            d="M1.5 4.5 L3.5 6.5 L7.5 2.5"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  )
}

function RenameInput({
  initial,
  onCommit,
  onCancel
}: {
  initial: string
  onCommit: (next: string) => void
  onCancel: () => void
}) {
  const [val, setVal] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) {
      ref.current.focus()
      // Select up to (but not including) the file extension.
      const dot = initial.lastIndexOf('.')
      const end = dot > 0 ? dot : initial.length
      ref.current.setSelectionRange(0, end)
    }
  }, [initial])

  return (
    <input
      ref={ref}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          const trimmed = val.trim()
          if (!trimmed || trimmed === initial) onCancel()
          else onCommit(trimmed)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        }
      }}
      onBlur={() => {
        const trimmed = val.trim()
        if (!trimmed || trimmed === initial) onCancel()
        else onCommit(trimmed)
      }}
      className="syde-selectable min-w-0 flex-1 rounded-sm border border-accent/60 bg-bg-base px-1 py-0 text-xs text-fg-base focus:outline-none"
      spellCheck={false}
    />
  )
}

function CreateInput({
  type,
  onSubmit,
  onCancel
}: {
  type: 'file' | 'folder'
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div className="border-b border-border-subtle px-3 py-2">
      <div className="mb-1 text-2xs text-fg-dim">
        New {type === 'file' ? 'file' : 'folder'}
      </div>
      <input
        ref={inputRef}
        type="text"
        placeholder={type === 'file' ? 'filename.ts' : 'folder-name'}
        className="w-full rounded border border-border-subtle bg-bg-subtle px-2 py-1 text-xs text-fg-base outline-none focus:border-accent"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onSubmit(e.currentTarget.value)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        onBlur={() => onCancel()}
      />
    </div>
  )
}

function TreeNode({
  node,
  depth,
  workspaceRoot,
  onOpen,
  onContextMenu,
  renamingPath,
  onCommitRename,
  onCancelRename
}: NodeProps) {
  const [open, setOpen] = useState(depth < 1)
  const activeFilePath = useStore((s) => s.activeFilePath)
  const pinnedFiles = useStore((s) => s.pinnedFiles)
  const togglePinned = useStore((s) => s.togglePinned)

  const isActive = activeFilePath === node.path
  const isPinned = pinnedFiles.has(node.path)
  const isRenaming = renamingPath === node.path
  const isWorkspaceRoot = node.path === workspaceRoot

  if (node.isDirectory) {
    return (
      <div>
        <div
          onClick={() => !isRenaming && setOpen((o) => !o)}
          onContextMenu={(e) => onContextMenu(e, node)}
          className="group flex cursor-pointer items-center gap-1.5 rounded-sm px-1.5 py-0.5 hover:bg-bg-hover"
          style={{ paddingLeft: depth * 12 + 6 }}
        >
          <Chevron open={open} />
          {/* Workspace-root folder isn't pinnable — pinning the root is what
              `context: project` is for. */}
          {!isWorkspaceRoot && (
            <Checkbox
              checked={isPinned}
              onChange={() => togglePinned(node.path)}
            />
          )}
          <FolderIcon open={open} />
          {isRenaming && !isWorkspaceRoot ? (
            <RenameInput
              initial={node.name}
              onCommit={(next) => void onCommitRename(node.path, next)}
              onCancel={onCancelRename}
            />
          ) : (
            <span
              className={`truncate text-xs ${
                isPinned ? 'text-fg-base' : 'text-fg-muted'
              }`}
            >
              {node.name}
            </span>
          )}
        </div>
        {open && (
          <div>
            {(node.children ?? []).map((c) => (
              <TreeNode
                key={c.path}
                node={c}
                depth={depth + 1}
                workspaceRoot={workspaceRoot}
                onOpen={onOpen}
                onContextMenu={onContextMenu}
                renamingPath={renamingPath}
                onCommitRename={onCommitRename}
                onCancelRename={onCancelRename}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      onClick={() => !isRenaming && onOpen(node.path)}
      onContextMenu={(e) => onContextMenu(e, node)}
      className={`group flex cursor-pointer items-center gap-1.5 rounded-sm px-1.5 py-0.5 ${
        isActive ? 'bg-bg-raised text-fg-base' : 'text-fg-muted hover:bg-bg-hover'
      }`}
      style={{ paddingLeft: depth * 12 + 6 }}
    >
      <Checkbox checked={isPinned} onChange={() => togglePinned(node.path)} />
      <FileIcon />
      {isRenaming ? (
        <RenameInput
          initial={node.name}
          onCommit={(next) => void onCommitRename(node.path, next)}
          onCancel={onCancelRename}
        />
      ) : (
        <span className="truncate text-xs">{node.name}</span>
      )}
    </div>
  )
}

export function FileTree() {
  const {
    workspaceRoot,
    fileTree,
    openWorkspace,
    openFromPath,
    refresh,
    createFile,
    createFolder,
    deleteItem
  } = useFileTree()
  const pinnedCount = useStore((s) => s.pinnedFiles.size)
  const clearPinned = useStore((s) => s.clearPinned)
  const toggleLeft = useStore((s) => s.toggleLeft)
  const togglePinned = useStore((s) => s.togglePinned)
  const renameActiveFile = useStore((s) => s.renameActiveFile)
  const remapPinned = useStore((s) => s.remapPinned)
  const setLastError = useStore((s) => s.setLastError)
  const setLastEvent = useStore((s) => s.setLastEvent)

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [creating, setCreating] = useState<CreateState | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  useEffect(() => {
    if (!contextMenu) return
    const onClick = () => closeContextMenu()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeContextMenu()
    }
    window.addEventListener('click', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [contextMenu, closeContextMenu])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, node: FileTreeNode) => {
      e.preventDefault()
      e.stopPropagation()
      setContextMenu({ x: e.clientX, y: e.clientY, node })
    },
    []
  )

  const startCreate = useCallback(
    (parentDir: string, type: 'file' | 'folder') => {
      closeContextMenu()
      setCreating({ parentDir, type })
    },
    [closeContextMenu]
  )

  const handleCreateSubmit = useCallback(
    async (name: string) => {
      if (!creating) return
      const { parentDir, type } = creating
      setCreating(null)
      const trimmed = name.trim()
      if (!trimmed) return

      if (type === 'file') {
        const path = await createFile(parentDir, trimmed)
        if (path) void openFromPath(path)
      } else {
        await createFolder(parentDir, trimmed)
      }
    },
    [creating, createFile, createFolder, openFromPath]
  )

  const handleDelete = useCallback(
    async (node: FileTreeNode) => {
      closeContextMenu()
      const label = node.isDirectory ? 'folder' : 'file'
      const ok = window.confirm(`Delete ${label} "${node.name}"?`)
      if (!ok) return
      await deleteItem(node.path)
    },
    [closeContextMenu, deleteItem]
  )

  const startRename = useCallback(
    (node: FileTreeNode) => {
      closeContextMenu()
      setRenamingPath(node.path)
    },
    [closeContextMenu]
  )

  const onCommitRename = useCallback(
    async (oldPath: string, newName: string) => {
      setRenamingPath(null)
      if (!newName || /[\\/]/.test(newName)) {
        setLastError('Name cannot contain / or \\')
        return
      }
      const newPath = joinPath(dirnameOf(oldPath), newName)
      try {
        await window.syde.fs.rename(oldPath, newPath)
        // The chokidar watcher refreshes the tree; we still need to remap
        // the editor + pinned set so they don't dangle on the stale path.
        renameActiveFile(oldPath, newPath)
        remapPinned(oldPath, newPath)
        setLastEvent(`renamed → ${newName}`)
      } catch (e) {
        setLastError(`Rename failed: ${(e as Error).message}`)
      }
    },
    [renameActiveFile, remapPinned, setLastError, setLastEvent]
  )

  const isWorkspaceRootNode = (node: FileTreeNode) =>
    workspaceRoot !== null && node.path === workspaceRoot

  return (
    <div className="relative flex h-full flex-col bg-bg-panel">
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-2xs uppercase tracking-[0.2em] text-fg-dim">
            workspace
          </span>
          {pinnedCount > 0 && (
            <span
              className="rounded-sm bg-accent/15 px-1.5 py-0.5 text-2xs font-medium text-accent"
              title={`${pinnedCount} file${pinnedCount === 1 ? '' : 's'}/folder${pinnedCount === 1 ? '' : 's'} pinned to LLM context`}
            >
              {pinnedCount} pinned
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {workspaceRoot && (
            <>
              <button
                onClick={() => startCreate(workspaceRoot, 'file')}
                className="rounded px-1.5 py-0.5 text-2xs text-fg-subtle hover:bg-bg-hover hover:text-fg-muted"
                title="New file"
              >
                + file
              </button>
              <button
                onClick={() => startCreate(workspaceRoot, 'folder')}
                className="rounded px-1.5 py-0.5 text-2xs text-fg-subtle hover:bg-bg-hover hover:text-fg-muted"
                title="New folder"
              >
                + folder
              </button>
            </>
          )}
          {pinnedCount > 0 && (
            <button
              onClick={clearPinned}
              className="rounded px-1.5 py-0.5 text-2xs text-fg-subtle hover:bg-bg-hover hover:text-fg-muted"
              title="Clear all pinned context"
            >
              clear
            </button>
          )}
          <button
            onClick={() => void refresh()}
            className="rounded px-1.5 py-0.5 text-2xs text-fg-subtle hover:bg-bg-hover hover:text-fg-muted"
            title="Refresh"
          >
            ↻
          </button>
          <button
            onClick={toggleLeft}
            className="ml-1 rounded px-1.5 py-0.5 text-2xs text-fg-subtle transition-colors hover:bg-bg-hover hover:text-fg-base"
            title="Hide file tree"
          >
            ⟨
          </button>
        </div>
      </div>

      {workspaceRoot && (
        <div className="border-b border-border-subtle px-3 py-1.5">
          <div
            className="truncate text-2xs text-fg-subtle"
            title={workspaceRoot}
          >
            {workspaceRoot}
          </div>
        </div>
      )}

      {creating && (
        <CreateInput
          type={creating.type}
          onSubmit={(name) => void handleCreateSubmit(name)}
          onCancel={() => setCreating(null)}
        />
      )}

      <div className="flex-1 overflow-auto py-1">
        {!fileTree || !workspaceRoot ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
            <div className="text-xs text-fg-muted">No workspace open.</div>
            <button
              onClick={() => void openWorkspace()}
              className="rounded-md border border-border bg-bg-subtle px-3 py-1.5 text-xs text-fg-base transition-colors hover:bg-bg-hover"
            >
              Open folder
            </button>
          </div>
        ) : (
          <div className="px-1">
            <TreeNode
              node={fileTree}
              depth={0}
              workspaceRoot={workspaceRoot}
              onOpen={openFromPath}
              onContextMenu={handleContextMenu}
              renamingPath={renamingPath}
              onCommitRename={onCommitRename}
              onCancelRename={() => setRenamingPath(null)}
            />
          </div>
        )}
      </div>

      {fileTree && (
        <div className="border-t border-border-subtle px-3 py-1.5">
          <button
            onClick={() => void openWorkspace()}
            className="text-2xs text-fg-subtle hover:text-fg-muted"
          >
            change folder
          </button>
        </div>
      )}

      {contextMenu && (
        <div
          className="fixed z-50 min-w-[160px] overflow-hidden rounded-md border border-border-subtle bg-bg-panel py-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {contextMenu.node.isDirectory && (
            <>
              <button
                className="block w-full px-3 py-1.5 text-left text-xs text-fg-base hover:bg-bg-hover"
                onClick={() => startCreate(contextMenu.node.path, 'file')}
              >
                New file
              </button>
              <button
                className="block w-full px-3 py-1.5 text-left text-xs text-fg-base hover:bg-bg-hover"
                onClick={() => startCreate(contextMenu.node.path, 'folder')}
              >
                New folder
              </button>
              <div className="my-1 border-t border-border-subtle" />
            </>
          )}
          {!isWorkspaceRootNode(contextMenu.node) && (
            <button
              className="block w-full px-3 py-1.5 text-left text-xs text-fg-base hover:bg-bg-hover"
              onClick={() => startRename(contextMenu.node)}
            >
              Rename
            </button>
          )}
          {!isWorkspaceRootNode(contextMenu.node) && (
            <button
              className="block w-full px-3 py-1.5 text-left text-xs text-fg-base hover:bg-bg-hover"
              onClick={() => {
                togglePinned(contextMenu.node.path)
                closeContextMenu()
              }}
            >
              {useStore.getState().pinnedFiles.has(contextMenu.node.path)
                ? 'Unpin from context'
                : 'Pin to context'}
            </button>
          )}
          {!isWorkspaceRootNode(contextMenu.node) && (
            <>
              <div className="my-1 border-t border-border-subtle" />
              <button
                className="block w-full px-3 py-1.5 text-left text-xs text-rose-400 hover:bg-bg-hover"
                onClick={() => void handleDelete(contextMenu.node)}
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
