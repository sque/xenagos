// The section's visuals, above the code in the same column (spec: section-visuals, "The visual comes before the
// code"). Absent when the section has none; the reviewer can collapse and enlarge it.

import { useState } from 'react'
import type { Visual } from '../generated/types'
import { type ElementBox, VisualFrame, type VisualSpot } from './VisualFrame'

export type PaneMode = 'normal' | 'collapsed' | 'enlarged'

export interface SectionSpot extends VisualSpot {
  visual: string
}

export function VisualPane(props: {
  visuals: Visual[]
  spot: SectionSpot | null
  onLink: (visual: Visual, element: string) => void
  onSelect: (visual: Visual, element: string, box: ElementBox) => void
}) {
  const { visuals, spot } = props
  const [chosen, setChosen] = useState(0)
  const [mode, setMode] = useState<PaneMode>('normal')
  // A spotlight on another visual of the section brings that one forward.
  const spotted = spot === null ? -1 : visuals.findIndex((v) => v.id === spot.visual)
  const index = spotted >= 0 ? spotted : Math.min(chosen, visuals.length - 1)
  const visual = visuals[index]
  if (visual === undefined) return null
  return (
    <section className="visualpane" data-mode={mode} aria-label="Section visual">
      <header className="visualbar">
        {visuals.length > 1 ? (
          <div role="tablist">
            {visuals.map((v, i) => (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={i === index}
                onClick={() => {
                  setChosen(i)
                }}
              >
                {v.title ?? v.id}
              </button>
            ))}
          </div>
        ) : (
          <span className="visualtitle">{visual.title ?? visual.id}</span>
        )}
        <span className="visualhint">Click an element to see its code; Shift+click to ask about it.</span>
        <button
          type="button"
          onClick={() => {
            setMode(mode === 'enlarged' ? 'normal' : 'enlarged')
          }}
          disabled={mode === 'collapsed'}
        >
          {mode === 'enlarged' ? 'Shrink' : 'Enlarge'}
        </button>
        <button
          type="button"
          aria-expanded={mode !== 'collapsed'}
          onClick={() => {
            setMode(mode === 'collapsed' ? 'normal' : 'collapsed')
          }}
        >
          {mode === 'collapsed' ? 'Show visual' : 'Collapse'}
        </button>
      </header>
      {mode !== 'collapsed' && (
        <VisualFrame
          key={JSON.stringify(visual)}
          visual={visual}
          spot={spot !== null && spot.visual === visual.id ? spot : null}
          onLink={(element) => {
            props.onLink(visual, element)
          }}
          onSelect={(element, box) => {
            props.onSelect(visual, element, box)
          }}
        />
      )}
    </section>
  )
}
