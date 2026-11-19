// Browse mode's left column (spec: diff-browser; mockup browse-mode): which commits are shown, then the changed files
// in three groups, Code, Tests and Generated, each with its file count and line totals and its files kept under their
// folders. A file dragged onto another group moves there for the rest of the review.

import { useState } from 'react'
import type { ChangedFile, CommitInfo } from '../generated/types'
import { buildTree, type FolderNode } from '../layout/tree'
import type { Category } from '../review'

export const CATEGORIES: { id: Category; name: string }[] = [
  { id: 'code', name: 'Code' },
  { id: 'tests', name: 'Tests' },
  { id: 'generated', name: 'Generated' },
]

const LETTER: Record<ChangedFile['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  'type-changed': 'T',
}
const DRAG_TYPE = 'application/x-xenagos-path'

export const counts = (file: Pick<ChangedFile, 'added' | 'removed' | 'binary'>) =>
  file.binary ? 'binary' : `+${String(file.added)} −${String(file.removed)}`

export function BrowseFiles(props: {
  commits: CommitInfo[]
  showing: string | null
  onShowing: (commit: string | null) => void
  files: ChangedFile[] | null
  selected: string | null
  onSelect: (path: string) => void
  /** Generated files whose diff the reviewer opened. */
  opened: ReadonlySet<string>
  onMove: (path: string, category: Category) => void
}) {
  const { files, selected } = props
  const [closedFolders, setClosedFolders] = useState<ReadonlySet<string>>(new Set())
  const [dropTarget, setDropTarget] = useState<Category | null>(null)
  const byPath = new Map(files?.map((file) => [file.path, file]))

  return (
    <div className="browsefiles">
      {props.commits.length > 1 && (
        <label className="showing">
          <span>Showing</span>
          <select
            value={props.showing ?? ''}
            onChange={(event) => {
              props.onShowing(event.target.value === '' ? null : event.target.value)
            }}
          >
            <option value="">All {props.commits.length} commits together</option>
            {props.commits.map((commit, i) => (
              <option key={commit.id} value={commit.id}>
                {i + 1}. {commit.subject} ({commit.id.slice(0, 7)})
              </option>
            ))}
          </select>
        </label>
      )}
      {files === null && <p className="notice">Loading the changed files…</p>}
      {files !== null && files.length === 0 && <p className="notice">No files changed.</p>}
      {files !== null &&
        CATEGORIES.map(({ id, name }) => {
          const members = files.filter((file) => file.category === id)
          const added = members.reduce((sum, file) => sum + file.added, 0)
          const removed = members.reduce((sum, file) => sum + file.removed, 0)
          const tree = buildTree({ files: members.map((file) => file.path), changed: [], visited: [] }, 'all', null).root
          return (
            <section
              key={id}
              className="category"
              aria-label={name}
              data-category={id}
              data-drop={dropTarget === id ? 'yes' : undefined}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes(DRAG_TYPE)) return
                event.preventDefault()
                setDropTarget(id)
              }}
              onDragLeave={() => {
                setDropTarget(null)
              }}
              onDrop={(event) => {
                event.preventDefault()
                setDropTarget(null)
                const path = event.dataTransfer.getData(DRAG_TYPE)
                if (path !== '' && byPath.get(path)?.category !== id) props.onMove(path, id)
              }}
            >
              <h3>
                <span>
                  {name} · {members.length} file{members.length === 1 ? '' : 's'}
                </span>
                <span className="count">{counts({ added, removed, binary: false })}</span>
              </h3>
              {members.length > 0 && (
                <ul className="tree">
                  <Folder
                    folder={tree}
                    depth={0}
                    byPath={byPath}
                    selected={selected}
                    opened={props.opened}
                    closed={closedFolders}
                    onToggle={(path) => {
                      const next = new Set(closedFolders)
                      if (next.has(path)) next.delete(path)
                      else next.add(path)
                      setClosedFolders(next)
                    }}
                    onSelect={props.onSelect}
                    category={id}
                  />
                </ul>
              )}
            </section>
          )
        })}
      <p className="treehint">Folders are kept inside each group. Drag a file to another group if it is in the wrong one.</p>
    </div>
  )
}

function Folder(props: {
  folder: FolderNode
  depth: number
  byPath: Map<string, ChangedFile>
  selected: string | null
  opened: ReadonlySet<string>
  closed: ReadonlySet<string>
  onToggle: (path: string) => void
  onSelect: (path: string) => void
  category: Category
}) {
  const { folder, depth } = props
  const indent = (extra: number) => ({ paddingLeft: `${String(0.4 + depth * 0.9 + extra)}rem` })
  return (
    <>
      {folder.children.map((node) => {
        if (node.kind === 'folder') {
          const open = !props.closed.has(node.path)
          return (
            <li key={`d:${node.path}`} className="folder" data-path={node.path}>
              <button
                type="button"
                aria-expanded={open}
                style={indent(0)}
                onClick={() => {
                  props.onToggle(node.path)
                }}
              >
                <span className="chevron" aria-hidden="true" />
                <span className="name">{node.name}/</span>
              </button>
              {open && (
                <ul>
                  <Folder {...props} folder={node} depth={depth + 1} />
                </ul>
              )}
            </li>
          )
        }
        const file = props.byPath.get(node.path)
        if (file === undefined) return null
        const collapsed = props.category === 'generated' && !props.opened.has(file.path)
        return (
          <li
            key={`f:${node.path}`}
            className={`file ${file.status}${props.category === 'generated' ? ' generated' : ''}`}
            data-path={file.path}
            aria-current={file.path === props.selected ? 'true' : undefined}
          >
            <button
              type="button"
              draggable
              style={indent(0.95)}
              title={file.oldPath != null ? `${file.oldPath} → ${file.path}` : file.path}
              onDragStart={(event) => {
                event.dataTransfer.setData(DRAG_TYPE, file.path)
                event.dataTransfer.effectAllowed = 'move'
              }}
              onClick={() => {
                props.onSelect(file.path)
              }}
            >
              <span className="name">{node.name}</span>
              {collapsed && <span className="note">collapsed</span>}
              {/* The status is the letter, as in the walkthrough's explorer; the diff's heading names it in full. */}
              <span className="lines">{counts(file)}</span>
              <span className={`letter ${file.status}`}>{LETTER[file.status]}</span>
            </button>
          </li>
        )
      })}
    </>
  )
}
