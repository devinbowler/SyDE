import { useState } from 'react'
import { useStore } from '../store'
import { useFileTree } from '../hooks/useFileTree'
import type { FileTreeNode } from '../types'

interface NodeProps {
  node: FileTreeNode
  depth: number
  onOpen: (p: string) => void
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

function TreeNode({ node, depth, onOpen }: NodeProps) {
  const [open, setOpen] = useState(depth < 1)
  const activeFilePath = useStore((s) => s.activeFilePath)
  const pinnedFiles = useStore((s) => s.pinnedFiles)
  const togglePinned = useStore((s) => s.togglePinned)

  const isActive = activeFilePath === node.path
  const isPinned = pinnedFiles.has(node.path)

  if (node.isDirectory) {
    return (
      <div>
        <div
          onClick={() => setOpen((o) => !o)}
          className="group flex cursor-pointer items-center gap-1.5 rounded-sm px-1.5 py-0.5 hover:bg-bg-hover"
          style={{ paddingLeft: depth * 12 + 6 }}
        >
          <Chevron open={open} />
          <FolderIcon open={open} />
          <span className="truncate text-xs text-fg-muted">{node.name}</span>
        </div>
        {open && (
          <div>
            {(node.children ?? []).map((c) => (
              <TreeNode key={c.path} node={c} depth={depth + 1} onOpen={onOpen} />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      onClick={() => onOpen(node.path)}
      className={`group flex cursor-pointer items-center gap-1.5 rounded-sm px-1.5 py-0.5 ${
        isActive ? 'bg-bg-raised text-fg-base' : 'text-fg-muted hover:bg-bg-hover'
      }`}
      style={{ paddingLeft: depth * 12 + 6 }}
    >
      <Checkbox checked={isPinned} onChange={() => togglePinned(node.path)} />
      <FileIcon />
      <span className="truncate text-xs">{node.name}</span>
    </div>
  )
}

export function FileTree() {
  const { workspaceRoot, fileTree, openWorkspace, openFromPath, refresh } =
    useFileTree()
  const pinnedCount = useStore((s) => s.pinnedFiles.size)
  const clearPinned = useStore((s) => s.clearPinned)
  const toggleLeft = useStore((s) => s.toggleLeft)

  return (
    <div className="flex h-full flex-col bg-bg-panel">
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-2xs uppercase tracking-[0.2em] text-fg-dim">
            workspace
          </span>
          {pinnedCount > 0 && (
            <span
              className="rounded-sm bg-accent/15 px-1.5 py-0.5 text-2xs font-medium text-accent"
              title={`${pinnedCount} files pinned to LLM context`}
            >
              {pinnedCount} pinned
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
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

      <div className="flex-1 overflow-auto py-1">
        {!fileTree ? (
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
            <TreeNode node={fileTree} depth={0} onOpen={openFromPath} />
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
    </div>
  )
}
