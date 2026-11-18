// Browse mode (spec: diff-browser; mockup browse-mode): read the change freely, one file at a time, with the files
// grouped as Code, Tests and Generated in the left column. A diff shows its hunks with the unchanged lines between
// them folded; each fold opens in steps, and the whole file opens at once. Generated files are not rendered until
// the reviewer opens them. With several commits, one commit can be shown alone, under its message.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AskPrompt, type AskAt } from '../agent/AskPrompt'
import { CodeView, type Layout } from '../codeview/codeView'
import type { ChangedFile, CommitInfo } from '../generated/types'
import { type Category, fetchChanges, fetchCommits, fetchFile, setCategory } from '../review'
import { BrowseFiles, CATEGORIES, counts } from './BrowseFiles'

const LAYOUT_KEY = 'xenagos.browse-layout'

function savedLayout(): Layout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'split' ? 'split' : 'unified'
  } catch {
    return 'unified'
  }
}

/** The file shown first: the first in Code, then Tests; a Generated file only when there is nothing else. */
function firstFile(files: ChangedFile[]): string | null {
  for (const { id } of CATEGORIES) {
    const found = files.find((file) => file.category === id)
    if (found !== undefined) return found.path
  }
  return null
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function Browse(props: {
  /** The left column, drawn into by browse mode. */
  explorerSlot: HTMLElement | null
  /** Bumped when another viewer moved a file to another category. */
  categoriesSeq: number
  onChosen: () => void
}) {
  const [commits, setCommits] = useState<CommitInfo[]>([])
  const [showing, setShowing] = useState<string | null>(null)
  const [files, setFiles] = useState<{ showing: string | null; list: ChangedFile[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  const [layout, setLayout] = useState<Layout>(savedLayout)
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
  const [moves, setMoves] = useState(0)

  useEffect(() => {
    let live = true
    fetchCommits().then(
      (found) => {
        if (live) setCommits(found)
      },
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    let live = true
    fetchChanges(showing).then(
      (list) => {
        if (live) setFiles({ showing, list })
      },
      (failure: unknown) => {
        if (live) setError(message(failure))
      },
    )
    return () => {
      live = false
    }
  }, [showing, props.categoriesSeq, moves])

  const list = files?.showing === showing ? files.list : null
  const selected = list === null ? null : chosen !== null && list.some((f) => f.path === chosen) ? chosen : firstFile(list)
  const file = list?.find((f) => f.path === selected) ?? null
  const commit = showing === null ? null : (commits.find((c) => c.id === showing) ?? null)

  const move = (path: string, category: Category) => {
    setCategory(path, category).then(
      () => {
        setMoves((n) => n + 1)
      },
      (failure: unknown) => {
        setError(message(failure))
      },
    )
  }

  return (
    <section className="browse">
      {props.explorerSlot !== null &&
        createPortal(
          <BrowseFiles
            commits={commits}
            showing={showing}
            onShowing={setShowing}
            files={list}
            selected={selected}
            opened={opened}
            onSelect={(path) => {
              setChosen(path)
              props.onChosen()
            }}
            onMove={move}
          />,
          props.explorerSlot,
        )}
      {error !== null && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {commit !== null && (
        <div className="commitbanner">
          <p className="subject">
            {commit.subject} <code>{commit.id.slice(0, 7)}</code>
          </p>
          {commit.message.includes('\n') && <p className="body">{commit.message.slice(commit.subject.length).trim()}</p>}
          <p className="byline">
            {commit.author} · {new Date(commit.date).toLocaleString()}
          </p>
        </div>
      )}
      {file !== null && (
        <FilePanel
          key={`${showing ?? 'all'}:${file.path}`}
          file={file}
          commit={showing}
          layout={layout}
          onLayout={(next) => {
            setLayout(next)
            try {
              localStorage.setItem(LAYOUT_KEY, next)
            } catch {
              // No storage: the layout lasts for this page.
            }
          }}
          open={file.category !== 'generated' || opened.has(file.path)}
          onOpen={() => {
            setOpened(new Set(opened).add(file.path))
          }}
          onMove={(category) => {
            move(file.path, category)
          }}
        />
      )}
      {list !== null && file === null && <p className="notice">This change touches no files.</p>}
    </section>
  )
}

function FilePanel(props: {
  file: ChangedFile
  commit: string | null
  layout: Layout
  onLayout: (layout: Layout) => void
  open: boolean
  onOpen: () => void
  onMove: (category: Category) => void
}) {
  const { file, layout } = props
  const [full, setFull] = useState(false)
  const label =
    file.status === 'renamed' ? 'renamed' : file.status === 'added' ? 'added' : file.status === 'deleted' ? 'deleted' : null
  return (
    <div className="filepanel">
      <div className="filehead">
        <span className="filepath" title={file.path}>
          {file.oldPath != null && file.oldPath !== file.path ? `${file.oldPath} → ${file.path}` : file.path}
        </span>
        {label !== null && <span className={`filelabel ${file.status}`}>{label}</span>}
        {file.binary && <span className="filelabel binary">binary</span>}
        <select
          className="category"
          aria-label="Category"
          value={file.category}
          onChange={(event) => {
            props.onMove(event.target.value as Category)
          }}
        >
          {CATEGORIES.map(({ id, name }) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <span className="filecounts">{counts(file)}</span>
        <span className="spacer" />
        <div className="viewswitch" role="group" aria-label="Layout">
          <button type="button" aria-pressed={layout === 'unified'} onClick={() => { props.onLayout('unified') }}>
            Unified
          </button>
          <button type="button" aria-pressed={layout === 'split'} onClick={() => { props.onLayout('split') }}>
            Side by side
          </button>
        </div>
        <button
          type="button"
          className="plain"
          aria-pressed={full}
          disabled={file.binary || !props.open}
          onClick={() => {
            setFull(!full)
          }}
        >
          {full ? 'Collapse to changes' : 'Expand full file'}
        </button>
      </div>
      {file.binary ? (
        <p className="notice">Binary file {file.status}; its content is not shown.</p>
      ) : props.open ? (
        <Diff file={file} commit={props.commit} layout={layout} full={full} />
      ) : (
        <div className="notice collapsedfile">
          <p>
            Generated file, {counts(file)} lines. Its diff is not shown until you open it.
          </p>
          <button type="button" onClick={props.onOpen}>
            Show the diff
          </button>
        </div>
      )}
    </div>
  )
}

function Diff(props: { file: ChangedFile; commit: string | null; layout: Layout; full: boolean }) {
  const { file, commit, layout, full } = props
  const scrollerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<CodeView | null>(null)
  const [askAt, setAskAt] = useState<AskAt | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    const scroller = scrollerRef.current
    const content = contentRef.current
    if (scroller === null || content === null) return
    const view = new CodeView(scroller, content, () => undefined)
    viewRef.current = view
    // Questions about lines go to the review's agent; in one commit's view the line numbers are that commit's, which
    // the question's reference could not name, so asking is left to the combined view.
    view.onSelect = (selection) => {
      if (selection === null || commit !== null) return
      const row = view.rows(selection.endSide, selection.endLine, selection.endLine)[0]
      const code = scroller.getBoundingClientRect()
      const bounds = (row ?? scroller).getBoundingClientRect()
      setAskAt({
        selection: { kind: 'code', ...selection },
        x: code.left + Math.min(code.width / 2, 220),
        y: row ? bounds.bottom : bounds.top + 80,
      })
    }
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [commit])

  useEffect(() => {
    let live = true
    const view = viewRef.current
    if (view === null) return
    view.setLayout(layout)
    fetchFile(file.path, commit).then(
      (sides) => (live ? view.show(sides, { expandAll: full }) : undefined),
      (failure: unknown) => {
        if (live) setFailed(message(failure))
      },
    )
    return () => {
      live = false
    }
    // The layout is applied to the shown file by the effect below; a new layout does not reload the file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path, commit, full])

  useEffect(() => {
    viewRef.current?.setLayout(layout)
  }, [layout])

  return (
    <>
      {failed !== null && (
        <p className="notice" role="alert">
          Could not load {file.path}: {failed}
        </p>
      )}
      <div className="codepanel">
        <div className="scroller" ref={scrollerRef}>
          <div ref={contentRef} />
        </div>
      </div>
      {askAt !== null && (
        <AskPrompt
          key={JSON.stringify(askAt.selection)}
          at={askAt}
          position={null}
          onAsking={() => undefined}
          onClose={() => {
            viewRef.current?.clearSelection()
            setAskAt(null)
          }}
        />
      )}
    </>
  )
}
