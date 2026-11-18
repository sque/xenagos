// The walkthrough layout from design decision 5b: repository explorer on the left, the section (header, visual, code)
// in the middle, the outline above the agent on the right with a draggable divider between them. Below 1100 px the
// explorer folds away and opens over the middle column on request.

import { type ReactNode, useCallback, useRef, useState } from 'react'

const SPLIT_KEY = 'xenagos.outline-split'
const MIN_SPLIT = 0.15
const MAX_SPLIT = 0.85

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
  middle: ReactNode
  /** Receives the element the outline is drawn into (the walkthrough renders it there). */
  outlineInto: (element: HTMLElement | null) => void
  outline: ReactNode
  agent: ReactNode
  explorerOpen: boolean
}) {
  const { explorer, middle, outlineInto, outline, agent, explorerOpen } = props
  const rightRef = useRef<HTMLDivElement>(null)
  const [split, setSplit] = useState(savedSplit)

  const keep = useCallback((value: number) => {
    const clamped = Math.max(MIN_SPLIT, Math.min(MAX_SPLIT, value))
    setSplit(clamped)
    try {
      localStorage.setItem(SPLIT_KEY, String(clamped))
    } catch {
      // A private window may refuse storage; the split then lasts for this page only.
    }
  }, [])

  return (
    <div className="layout" data-explorer={explorerOpen ? 'open' : 'closed'}>
      <aside className="explorer" aria-label="Repository">
        {explorer}
      </aside>
      <div className="middle">{middle}</div>
      <div className="right" ref={rightRef} style={{ ['--split' as string]: `${String(split * 100)}%` }}>
        <nav className="outline" aria-label="Walkthrough" ref={outlineInto}>
          {outline}
        </nav>
        <div
          className="divider"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize the outline and the agent"
          aria-valuemin={MIN_SPLIT * 100}
          aria-valuemax={MAX_SPLIT * 100}
          aria-valuenow={Math.round(split * 100)}
          tabIndex={0}
          onPointerDown={(event) => {
            const right = rightRef.current
            if (right === null) return
            event.currentTarget.setPointerCapture(event.pointerId)
            const bounds = right.getBoundingClientRect()
            const move = (e: PointerEvent) => {
              keep((e.clientY - bounds.top) / bounds.height)
            }
            const up = () => {
              window.removeEventListener('pointermove', move)
              window.removeEventListener('pointerup', up)
            }
            window.addEventListener('pointermove', move)
            window.addEventListener('pointerup', up)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp') keep(split - 0.05)
            else if (event.key === 'ArrowDown') keep(split + 0.05)
            else return
            event.preventDefault()
          }}
        />
        <div className="agentslot">{agent}</div>
      </div>
    </div>
  )
}
