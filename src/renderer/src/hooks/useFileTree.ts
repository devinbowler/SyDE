import { useCallback, useEffect } from 'react'
import { useStore, languageFromPath } from '../store'
import type { FileTreeNode } from '../types'

export function useFileTree() {
  const workspaceRoot = useStore((s) => s.workspaceRoot)
  const fileTree = useStore((s) => s.fileTree)
  const setWorkspaceRoot = useStore((s) => s.setWorkspaceRoot)
  const setFileTree = useStore((s) => s.setFileTree)
  const openFile = useStore((s) => s.openFile)
  const onPathDeleted = useStore((s) => s.onPathDeleted)

  const refresh = useCallback(async () => {
    if (!workspaceRoot) return
    const tree = await window.syde.fs.readDir(workspaceRoot)
    setFileTree(tree)
  }, [workspaceRoot, setFileTree])

  const openWorkspace = useCallback(async () => {
    const dir = await window.syde.fs.openDirDialog()
    if (!dir) return
    setWorkspaceRoot(dir)
    const tree = await window.syde.fs.readDir(dir)
    setFileTree(tree)
  }, [setFileTree, setWorkspaceRoot])

  const openFromPath = useCallback(
    async (filePath: string) => {
      try {
        const content = await window.syde.fs.readFile(filePath)
        openFile(filePath, content, languageFromPath(filePath))
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Failed to open file:', e)
      }
    },
    [openFile]
  )

  // File watcher: refresh tree on any change.
  useEffect(() => {
    if (!workspaceRoot) return
    const watchId = `workspace-${Date.now()}`
    void window.syde.fs.watchStart(watchId, workspaceRoot)
    let timeout: ReturnType<typeof setTimeout> | null = null
    const off = window.syde.fs.onWatchEvent(() => {
      if (timeout) clearTimeout(timeout)
      timeout = setTimeout(() => {
        void refresh()
      }, 250)
    })
    return () => {
      off()
      void window.syde.fs.watchStop(watchId)
      if (timeout) clearTimeout(timeout)
    }
  }, [workspaceRoot, refresh])

  const createFile = useCallback(
    async (parentDir: string, name: string) => {
      if (!workspaceRoot) return null
      const trimmed = name.trim()
      if (!trimmed) return null
      const sep = parentDir.includes('\\') ? '\\' : '/'
      const filePath = `${parentDir}${parentDir.endsWith(sep) ? '' : sep}${trimmed}`
      try {
        const created = await window.syde.fs.createFile({
          rootPath: workspaceRoot,
          filePath,
          content: ''
        })
        await refresh()
        return created
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Failed to create file:', e)
        return null
      }
    },
    [workspaceRoot, refresh]
  )

  const createFolder = useCallback(
    async (parentDir: string, name: string) => {
      if (!workspaceRoot) return null
      const trimmed = name.trim()
      if (!trimmed) return null
      const sep = parentDir.includes('\\') ? '\\' : '/'
      const dirPath = `${parentDir}${parentDir.endsWith(sep) ? '' : sep}${trimmed}`
      try {
        const created = await window.syde.fs.createDir({
          rootPath: workspaceRoot,
          dirPath
        })
        await refresh()
        return created
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Failed to create folder:', e)
        return null
      }
    },
    [workspaceRoot, refresh]
  )

  const deleteItem = useCallback(
    async (targetPath: string) => {
      if (!workspaceRoot) return false
      try {
        await window.syde.fs.delete({ rootPath: workspaceRoot, targetPath })
        onPathDeleted(targetPath)
        await refresh()
        return true
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Failed to delete:', e)
        return false
      }
    },
    [workspaceRoot, refresh, onPathDeleted]
  )

  return {
    workspaceRoot,
    fileTree,
    openWorkspace,
    openFromPath,
    refresh,
    createFile,
    createFolder,
    deleteItem
  }
}

export function flattenFiles(
  node: FileTreeNode | null,
  out: string[] = []
): string[] {
  if (!node) return out
  if (!node.isDirectory) {
    out.push(node.path)
    return out
  }
  for (const c of node.children ?? []) flattenFiles(c, out)
  return out
}
