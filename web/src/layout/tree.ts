// The repository explorer's tree (spec: repository-explorer), built from the server's flat data.
//
// Narrow view: the changed files, the files the walkthrough visits and the file on screen, under their folders; a
// folder holding none of them is left out, and each shown folder counts the files hidden in it. Whole view: every
// file. Folders sort before files, by name. A chain of folders that each hold only one folder is drawn as one row
// ("server/src/xenagos"), unless a folder in it has hidden files of its own to count.

import type { ChangedEntry, RepositoryTree } from '../generated/types'

export type View = 'narrow' | 'all'

export interface FileNode {
  kind: 'file'
  name: string
  path: string
  /** The change to this file; absent when the change does not touch it. */
  change: ChangedEntry | null
  visited: boolean
}

export interface FolderNode {
  kind: 'folder'
  /** One or more folder names joined by "/" when a chain was drawn as one row. */
  name: string
  /** The full path of the deepest folder in the row; what expanding and collapsing are keyed by. */
  path: string
  children: TreeNode[]
  /** Some file below changed. */
  changes: boolean
  /** Files below that the narrow view leaves out and no shown subfolder counts. */
  hidden: number
}

export type TreeNode = FileNode | FolderNode

export interface BuiltTree {
  root: FolderNode
  /** Files left out in the narrow view; 0 in the whole view. */
  hidden: number
}

/** Every folder that holds `path`, from the top: "a", "a/b" for "a/b/c.py". */
export function ancestors(path: string): string[] {
  const parts = path.split('/')
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))
}

export function buildTree(data: RepositoryTree, view: View, current: string | null): BuiltTree {
  const changes = new Map(data.changed.map((entry) => [entry.path, entry]))
  const visited = new Set(data.visited)
  const shown = (path: string) => view === 'all' || changes.has(path) || visited.has(path) || path === current
  const root: FolderNode = { kind: 'folder', name: '', path: '', children: [], changes: false, hidden: 0 }
  const folders = new Map<string, FolderNode>([['', root]])
  const folder = (path: string): FolderNode => {
    const found = folders.get(path)
    if (found !== undefined) return found
    const slash = path.lastIndexOf('/')
    const parent = folder(slash < 0 ? '' : path.slice(0, slash))
    const made: FolderNode = { kind: 'folder', name: path.slice(slash + 1), path, children: [], changes: false, hidden: 0 }
    parent.children.push(made)
    folders.set(path, made)
    return made
  }
  const hiddenFiles: string[] = []
  for (const path of data.files) {
    if (!shown(path)) {
      hiddenFiles.push(path)
      continue
    }
    const slash = path.lastIndexOf('/')
    const change = changes.get(path) ?? null
    folder(slash < 0 ? '' : path.slice(0, slash)).children.push({
      kind: 'file',
      name: path.slice(slash + 1),
      path,
      change,
      visited: visited.has(path),
    })
    if (change !== null) {
      for (const above of ['', ...ancestors(path)]) {
        const node = folders.get(above)
        if (node !== undefined) node.changes = true
      }
    }
  }
  // A hidden file is counted by the nearest folder above it that is shown.
  for (const path of hiddenFiles) {
    const holder = [...ancestors(path)].reverse().find((above) => folders.has(above)) ?? ''
    const node = folders.get(holder)
    if (node !== undefined) node.hidden += 1
  }
  sortAndCompact(root)
  return { root, hidden: hiddenFiles.length }
}

const byName = (a: TreeNode, b: TreeNode) => {
  if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
  const x = a.name.toLowerCase()
  const y = b.name.toLowerCase()
  return x < y ? -1 : x > y ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

function sortAndCompact(node: FolderNode): void {
  node.children = node.children.map((child) => (child.kind === 'folder' ? compacted(child) : child))
  node.children.sort(byName)
  for (const child of node.children) {
    if (child.kind === 'folder') sortAndCompact(child)
  }
}

function compacted(node: FolderNode): FolderNode {
  let current = node
  let name = node.name
  for (;;) {
    const [only] = current.children
    if (current.children.length !== 1 || only?.kind !== 'folder' || current.hidden > 0) break
    name = `${name}/${only.name}`
    current = only
  }
  return current === node ? node : { ...current, name }
}

/** The folders the tree opens by default: those holding a changed or visited file, or the file on screen. */
export function openByDefault(data: RepositoryTree, current: string | null): Set<string> {
  const open = new Set<string>()
  const paths = [...data.changed.map((entry) => entry.path), ...data.visited, ...(current === null ? [] : [current])]
  for (const path of paths) {
    for (const above of ancestors(path)) open.add(above)
  }
  return open
}
