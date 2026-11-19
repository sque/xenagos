// The walkthrough layout from design decision 5b: repository explorer on the left, the section (header, visual, code)
// in the middle, the outline above the agent on the right with a draggable divider between them. Below 1100 px the
// explorer folds away and opens over the middle column on request.

import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Divider } from './Divider'
import { DEFAULT_LEFT, type Side, clampWidth } from './widths'

const SPLIT_KEY = 'xenagos.outline-split'
const MIN_SPLIT = 0.15
const MAX_SPLIT = 0.85
const WIDTH_KEY: Record<Side, string> = { left: 'xenagos.left-width', right: 'xenagos.right-width' }
const STEP = 16
const RIGHT_MIN = 320

function savedWidth(side: Side): number | null {
  try {
    const raw = localStorage.getItem(WIDTH_KEY[side])
    const value = raw === null ? Number.NaN : Number(raw)
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

function savedSplit(): number {
  try {
    const value = Number(localStorage.getItem(SPLIT_KEY))
    return value >= MIN_SPLIT && value <= MAX_SPLIT ? value : 0.45
  } catch {
    return 0.45
  }
}

export function Layout(props: {
  explorer: ReactNode
  /** Receives the left column's element, for a mode that draws into it itself. */
  explorerInto?: (element: HTMLElement | null) => void
  middle: ReactNode
  /** Receives the element the outline is drawn into (the walkthrough renders it there). */
  outlineInto: (element: HTMLElement | null) => void
  outline: ReactNode
  agent: ReactNode
  explorerOpen: boolean
}) {
  const { explorer, explorerInto, middle, outlineInto, outline, agent, explorerOpen } = props
  const layoutRef = useRef<HTMLDivElement>(null)
  const explorerRef = useRef<HTMLElement | null>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const [split, setSplit] = useState(savedSplit)
  // The widths the reviewer asked for (null: the stylesheet's default) and the layout's measured width (0: unknown).
  const [wanted, setWanted] = useState<Record<Side, number | null>>(() => ({ left: savedWidth('left'), right: savedWidth('right') }))
  const [total, setTotal] = useState(0)
  // Below 1100 px (as in the stylesheet) the explorer is a pop-over and takes no room in the grid.
  const [narrow, setNarrow] = useState(false)

  const keep = useCallback((value: number) => {
    const clamped = Math.max(MIN_SPLIT, Math.min(MAX_SPLIT, value))
    setSplit(clamped)
    try {
      localStorage.setItem(SPLIT_KEY, String(clamped))
    } catch {
      // A private window may refuse storage; the split then lasts for this page only.
    }
  }, [])

  useLayoutEffect(() => {
    const layout = layoutRef.current
    if (layout === null) return
    const measure = () => {
      setTotal(layout.clientWidth)
      setNarrow(window.matchMedia('(max-width: 1100px)').matches)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('resize', measure)
    }
  }, [])

  // The widths in use: the wanted ones, held within what the window allows (left first, against the right minimum).
  const left = wanted.left === null || total <= 0 ? wanted.left : clampWidth('left', wanted.left, total, RIGHT_MIN)
  const right =
    wanted.right === null || total <= 0 ? wanted.right : clampWidth('right', wanted.right, total, narrow ? 0 : (left ?? DEFAULT_LEFT))

  const remember = useCallback((side: Side, width: number | null) => {
    setWanted((current) => ({ ...current, [side]: width }))
    try {
      if (width === null) localStorage.removeItem(WIDTH_KEY[side])
      else localStorage.setItem(WIDTH_KEY[side], String(width))
    } catch {
      // A private window may refuse storage; the width then lasts for this page only.
    }
  }, [])

  const rendered = (side: Side): number =>
    (side === 'left' ? explorerRef.current : rightRef.current)?.getBoundingClientRect().width ?? 0

  // The width a side column gets when its divider is moved to `want`, against the other column as it stands.
  const resize = (side: Side, want: number) => {
    const layoutWidth = layoutRef.current?.clientWidth ?? 0
    if (layoutWidth <= 0) return
    remember(side, Math.round(clampWidth(side, want, layoutWidth, rendered(side === 'left' ? 'right' : 'left'))))
  }

  const style: Record<string, string> = {}
  if (left !== null) style['--left-col'] = `${String(left)}px`
  if (right !== null) style['--right-col'] = `${String(right)}px`

  return (
    <div className="layout" data-explorer={explorerOpen ? 'open' : 'closed'} ref={layoutRef} style={style}>
      <aside
        className="explorer"
        aria-label="Files"
        ref={(element) => {
          explorerRef.current = element
          explorerInto?.(element)
        }}
      >
        {explorer}
      </aside>
      <Divider
        orientation="vertical"
        className="coldivider left"
        label="Resize the file tree"
        value={Math.round(left ?? DEFAULT_LEFT)}
        min={192}
        max={Math.round(0.4 * total)}
        onDrag={(pointer) => {
          resize('left', pointer.x - (layoutRef.current?.getBoundingClientRect().left ?? 0))
        }}
        onStep={(direction) => {
          resize('left', rendered('left') + direction * STEP)
        }}
        onReset={() => {
          remember('left', null)
        }}
      />
      <div className="middle">{middle}</div>
      <Divider
        orientation="vertical"
        className="coldivider rightcol"
        label="Resize the outline and agent column"
        value={Math.round(right ?? RIGHT_MIN)}
        min={RIGHT_MIN}
        max={Math.round(0.45 * total)}
        onDrag={(pointer) => {
          resize('right', (layoutRef.current?.getBoundingClientRect().right ?? 0) - pointer.x)
        }}
        onStep={(direction) => {
          resize('right', rendered('right') - direction * STEP)
        }}
        onReset={() => {
          remember('right', null)
        }}
      />
      <div className="right" ref={rightRef} style={{ ['--split' as string]: `${String(split * 100)}%` }}>
        <nav className="outline" aria-label="Walkthrough" ref={outlineInto}>
          {outline}
        </nav>
        <Divider
          orientation="horizontal"
          className="divider"
          label="Resize the outline and the agent"
          value={Math.round(split * 100)}
          min={MIN_SPLIT * 100}
          max={MAX_SPLIT * 100}
          onDrag={(pointer) => {
            const bounds = rightRef.current?.getBoundingClientRect()
            if (bounds !== undefined) keep((pointer.y - bounds.top) / bounds.height)
          }}
          onStep={(direction) => {
            keep(split + direction * 0.05)
          }}
        />
        <div className="agentslot">{agent}</div>
      </div>
    </div>
  )
}
