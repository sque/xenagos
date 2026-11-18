// One section visual in its sandboxed frame (spec: section-visuals). Messages from the frame are accepted only from
// that frame, only of the known types, and only for elements the visual declared; everything else is ignored, so a
// visual cannot make the viewer do anything else, nor put text into the agent session.

import { useEffect, useMemo, useRef, useState } from 'react'
import { request } from '../agent/api'
import type { Visual } from '../generated/types'
import { frameDocument } from './frameDocument'

export interface ElementBox {
  left: number
  top: number
  right: number
  bottom: number
}

export interface VisualSpot {
  element: string
  form: 'lines' | 'box' | 'circle'
}

/** How long a visual may take to say it is ready before it counts as broken. */
export const READY_TIMEOUT_MS = 8000

type Load = { state: 'loading' } | { state: 'ready' } | { state: 'broken'; reason: string }

export function VisualFrame(props: {
  visual: Visual
  spot: VisualSpot | null
  onLink: (element: string) => void
  /** The reviewer chose to ask about an element; `box` is where it is, in viewport coordinates. */
  onSelect: (element: string, box: ElementBox) => void
}) {
  const { visual, spot, onLink, onSelect } = props
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const source = useMemo(() => frameDocument(visual, new URL('/visual-assets/', location.href).href), [visual])
  const declared = useMemo(() => new Set((visual.elements ?? []).map((e) => e.id)), [visual])
  const handlers = useRef({ onLink, onSelect })
  useEffect(() => {
    handlers.current = { onLink, onSelect }
  })

  // A visual whose content changes is a new frame (the pane keys frames by content), so loading starts once.
  useEffect(() => {
    const timer = setTimeout(() => {
      setLoad((current) =>
        current.state === 'loading' ? { state: 'broken', reason: 'it did not finish loading' } : current,
      )
    }, READY_TIMEOUT_MS)
    const receive = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return
      const data: unknown = event.data
      if (typeof data !== 'object' || data === null || (data as { xenagos?: unknown }).xenagos !== 1) return
      const message = data as { type?: unknown; element?: unknown; message?: unknown; box?: unknown }
      if (message.type === 'ready') {
        setLoad((current) => (current.state === 'loading' ? { state: 'ready' } : current))
        return
      }
      if (message.type === 'error') {
        const reason = typeof message.message === 'string' ? message.message.slice(0, 200) : 'it raised an error'
        setLoad({ state: 'broken', reason })
        return
      }
      if (typeof message.element !== 'string' || !declared.has(message.element)) return
      if (message.type === 'link') handlers.current.onLink(message.element)
      if (message.type === 'select') handlers.current.onSelect(message.element, place(frameRef.current, message.box))
    }
    window.addEventListener('message', receive)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('message', receive)
    }
  }, [source, declared])

  useEffect(() => {
    if (load.state !== 'ready') return
    frameRef.current?.contentWindow?.postMessage(
      { xenagos: 1, type: 'spotlight', element: spot?.element ?? null, form: spot?.form ?? 'box' },
      '*',
    )
  }, [spot, load.state])

  if (load.state === 'broken') return <BrokenVisual visual={visual} reason={load.reason} />
  return (
    <iframe
      ref={frameRef}
      className="visualframe"
      title={visual.title ?? `Visual ${visual.id}`}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={source}
    />
  )
}

/** Where an element of the frame is in the viewer's viewport. Values from the frame are only numbers, clamped to it. */
function place(frame: HTMLIFrameElement | null, box: unknown): ElementBox {
  const outer = frame?.getBoundingClientRect() ?? { left: 0, top: 0, right: 0, bottom: 0 }
  const value = (key: keyof ElementBox) => {
    const raw = (box as Partial<Record<keyof ElementBox, unknown>> | null)?.[key]
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
  }
  const clampX = (x: number) => Math.max(outer.left, Math.min(outer.left + x, outer.right))
  const clampY = (y: number) => Math.max(outer.top, Math.min(outer.top + y, outer.bottom))
  return { left: clampX(value('left')), top: clampY(value('top')), right: clampX(value('right')), bottom: clampY(value('bottom')) }
}

/** Shown in place of a visual that failed (spec: "A broken visual does not break the section"). */
type Repair = { state: 'idle' | 'asking' | 'asked' } | { state: 'failed'; error: string }

function BrokenVisual({ visual, reason }: { visual: Visual; reason: string }) {
  const [repair, setRepair] = useState<Repair>({ state: 'idle' })
  return (
    <div className="visualbroken" role="status">
      <p>
        This visual could not be shown: {reason}. The section's steps and code still work.
      </p>
      <button
        type="button"
        disabled={repair.state === 'asking' || repair.state === 'asked'}
        onClick={() => {
          setRepair({ state: 'asking' })
          request({ kind: 'visual', visual: visual.id }).then(
            () => {
              setRepair({ state: 'asked' })
            },
            (error: unknown) => {
              setRepair({ state: 'failed', error: error instanceof Error ? error.message : String(error) })
            },
          )
        }}
      >
        {repair.state === 'asked' ? 'Asked the agent to repair it' : 'Ask the agent to repair it'}
      </button>
      {repair.state === 'failed' && <p role="alert">{repair.error}</p>}
    </div>
  )
}
