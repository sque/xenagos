// The repository explorer, the walkthrough's left column (spec: repository-explorer; design decision 5b).
//
// The tree of the repository at the head, deleted files back in place, with the customary version-control letters
// and colours, a mark on folders holding changes, Generated files dimmed, files the walkthrough visits marked, and
// the changed files no section covers listed below. It highlights the file on screen and opens the folders down to
// it as the narrator moves. Choosing a file opens it; the walkthrough pauses (spec: repository-explorer).

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangedEntry, RepositoryTree } from '../generated/types'
import { ancestors, buildTree, type FileNode, type FolderNode, openByDefault, type View } from './tree'

const LETTER: Record<ChangedEntry['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  'type-changed': 'T',
}

export async function fetchTree(): Promise<RepositoryTree> {
  const response = await fetch('/api/tree')
  if (!response.ok) throw new Error(`the review server answered ${String(response.status)}`)
  return (await response.json()) as RepositoryTree
}

const plural = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? '' : 's'}`

export function Explorer(props: {
  tree: RepositoryTree | null
  error: string | null
  current: string | null
  onOpen: ((path: string) => void) | null
}) {
  const { tree, current, onOpen } = props
  const [view, setView] = useState<View>('narrow')
  // Folders the reviewer opened or closed by hand; the others follow `openByDefault`.
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map())
  // When the narrator moves to another file, the folders down to it open, even ones closed by hand.
  const [revealed, setRevealed] = useState(current)
  if (current !== revealed) {
    setRevealed(current)
    if (current !== null) {
      const next = new Map(toggled)
      for (const above of ancestors(current)) next.delete(above)
      setToggled(next)
    }
  }
  const built = useMemo(() => (tree === null ? null : buildTree(tree, view, current)), [tree, view, current])
  const defaults = useMemo(() => (tree === null ? new Set<string>() : openByDefault(tree, current)), [tree, current])
  const isOpen = (path: string) => toggled.get(path) ?? defaults.has(path)

  const listRef = useRef<HTMLUListElement>(null)
  useEffect(() => {
    if (current === null) return
    const row = listRef.current?.querySelector(`[data-path="${CSS.escape(current)}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }, [current, built])

  const uncovered = tree?.changed.filter((entry) => entry.covered === 'none') ?? []
  const statuses = new Set(tree?.changed.map((entry) => entry.status))

  return (
    <div className="repository">
      <div className="repohead">
        <h2 className="columnhead">Repository</h2>
        <div className="viewswitch" role="group" aria-label="Files shown">
          <button type="button" aria-pressed={view === 'narrow'} onClick={() => { setView('narrow'); }}>
            Changed + visited
          </button>
          <button type="button" aria-pressed={view === 'all'} onClick={() => { setView('all'); }}>
            All
          </button>
        </div>
      </div>
      {props.error !== null && <p className="notice">{props.error}</p>}
      {built !== null && (
        <ul className="tree" ref={listRef}>
          <Rows
            folder={built.root}
            depth={0}
            view={view}
            current={current}
            isOpen={isOpen}
            onToggle={(path) => {
              setToggled(new Map(toggled).set(path, !isOpen(path)))
            }}
            onOpen={onOpen}
          />
        </ul>
      )}
      {built !== null && (view === 'all' || built.hidden > 0) && (
        <p className="treefoot">
          {view === 'narrow' ? (
            <>
              {plural(built.hidden, 'unchanged file')} hidden ·{' '}
              <button type="button" className="link" onClick={() => { setView('all'); }}>
                show all
              </button>
            </>
          ) : (
            <>
              {plural(tree?.files.length ?? 0, 'file')} ·{' '}
              <button type="button" className="link" onClick={() => { setView('narrow'); }}>
                changed and visited only
              </button>
            </>
          )}
        </p>
      )}
      {tree !== null && (
        <div className="treelegend">
          {statuses.size > 0 && (
            <p>
              {(['modified', 'added', 'deleted', 'renamed', 'copied', 'type-changed'] as const)
                .filter((status) => statuses.has(status))
                .map((status, i) => (
                  <span key={status}>
                    {i > 0 && ' · '}
                    <span className={`letter ${status}`}>{LETTER[status]}</span> {status}
                  </span>
                ))}
            </p>
          )}
          {uncovered.length > 0 && (
            <p className="uncovered">
              Changed but not in this walkthrough:{' '}
              {uncovered.map((entry, i) => (
                <span key={entry.path}>
                  {i > 0 && ', '}
                  <button
                    type="button"
                    className="link"
                    title={entry.path}
                    disabled={onOpen === null || entry.binary}
                    onClick={() => onOpen?.(entry.path)}
                  >
                    {entry.path.slice(entry.path.lastIndexOf('/') + 1)}
                  </button>
                </span>
              ))}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function Rows(props: {
  folder: FolderNode
  depth: number
  view: View
  current: string | null
  isOpen: (path: string) => boolean
  onToggle: (path: string) => void
  onOpen: ((path: string) => void) | null
}) {
  const { folder, depth } = props
  return (
    <>
      {folder.children.map((node) =>
        node.kind === 'folder' ? (
          <FolderRow key={`d:${node.path}`} {...props} folder={node} depth={depth} />
        ) : (
          <FileRow key={`f:${node.path}`} file={node} depth={depth} current={props.current} onOpen={props.onOpen} />
        ),
      )}
    </>
  )
}

function FolderRow(props: Parameters<typeof Rows>[0]) {
  const { folder, depth, view, isOpen, onToggle } = props
  const open = isOpen(folder.path)
  return (
    <li className="folder" data-path={folder.path}>
      <button
        type="button"
        aria-expanded={open}
        style={{ paddingLeft: `${String(0.4 + depth * 0.9)}rem` }}
        title={folder.path}
        onClick={() => {
          onToggle(folder.path)
        }}
      >
        <span className="chevron" aria-hidden="true" />
        <FolderIcon />
        <span className="name">{folder.name}/</span>
        {view === 'narrow' && folder.hidden > 0 && <span className="more">{folder.hidden} more</span>}
        {folder.changes && <span className="changedot" title="Contains changes" aria-label="contains changes" />}
      </button>
      {open && (
        <ul>
          <Rows {...props} folder={folder} depth={depth + 1} />
        </ul>
      )}
    </li>
  )
}

function FileRow(props: { file: FileNode; depth: number; current: string | null; onOpen: ((path: string) => void) | null }) {
  const { file, depth, current, onOpen } = props
  const change = file.change
  const here = file.path === current
  const notes: string[] = []
  if (change?.oldPath != null) notes.push(`renamed from ${change.oldPath}`)
  if (change?.covered === 'none') notes.push('changed, not covered by the walkthrough')
  else if (change?.covered === 'partly') notes.push('partly covered by the walkthrough')
  if (file.visited && change === null) notes.push('visited by the walkthrough')
  const classes = ['file', change?.status ?? 'unchanged']
  if (change?.category === 'generated') classes.push('generated')
  if (change?.covered === 'none') classes.push('uncovered')
  return (
    <li className={classes.join(' ')} data-path={file.path} aria-current={here ? 'true' : undefined}>
      <button
        type="button"
        disabled={onOpen === null || change?.binary === true}
        style={{ paddingLeft: `${String(0.4 + depth * 0.9 + 0.95)}rem` }}
        title={[file.path, ...notes].join(' · ')}
        onClick={() => onOpen?.(file.path)}
      >
        <FileIcon />
        <span className="name">{file.name}</span>
        {here && <span className="note here">you are here</span>}
        {!here && file.visited && change === null && <span className="note">visited</span>}
        {change?.category === 'generated' && <span className="note">generated</span>}
        {change !== null && <span className={`letter ${change.status}`}>{LETTER[change.status]}</span>}
      </button>
    </li>
  )
}

function FolderIcon() {
  return (
    <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1.75 3h4l1.5 1.5h7v8.75H1.75z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 1.75h6l3 3v9.5h-9z M9.5 1.75v3h3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}
