// The outline at the top of the right column (spec: walkthrough-narration, "Outline of sections and steps"; mockup
// b-walkthrough-chosen): the problem first, then every section with its role, or "done" once played to the end; the
// section on screen opens into its steps, each done, current or upcoming, with steps on unchanged code marked.

import type { ChangedFile, Plan } from '../generated/types'
import { type Progress, SOURCE, stepLabel, stepState, targetsUnchangedCode } from './progress'

const MARK = { done: '✓', current: '▸', upcoming: '○' } as const

export function Outline(props: {
  plan: Plan
  progress: Progress
  done: ReadonlySet<number>
  changes: ChangedFile[] | null
  onPlay: (section: number, step?: number) => void
}) {
  const { plan, progress, done, changes, onPlay } = props
  const orientation = plan.orientation
  const source = orientation.source === 'document' && orientation.document != null ? `from ${orientation.document}` : SOURCE[orientation.source]
  return (
    <>
      <h2 className="columnhead">Walkthrough</h2>
      <details className="problem" open>
        <summary>
          <span className="label">The problem</span>
          <span className="note">{source}</span>
        </summary>
        <p className="orientation">{orientation.problem}</p>
      </details>
      <ol className="sections">
        {plan.sections.map((section, i) => {
          const current = i === progress.section
          return (
            <li key={i} aria-current={current ? 'true' : undefined}>
              <button type="button" onClick={() => { onPlay(i) }}>
                <span className="number">{i + 1}</span>
                <span className="title">{section.title}</span>
                <span className="note">{done.has(i) && !current ? 'done' : section.role}</span>
              </button>
              {current && (
                <ol className="steps">
                  {section.steps.map((step, j) => {
                    const state = stepState(j, progress, done.has(i))
                    const unchanged = changes !== null && targetsUnchangedCode(step.target, changes)
                    return (
                      <li key={j} className={state} aria-current={state === 'current' ? 'step' : undefined}>
                        <button type="button" title={step.narration} onClick={() => { onPlay(i, j) }}>
                          <span className="mark" aria-label={state}>
                            {MARK[state]}
                          </span>
                          <span className="title">{stepLabel(step.narration)}</span>
                          {state === 'current' && <span className="note now">{progress.status}</span>}
                          {unchanged && <span className="note">unchanged</span>}
                        </button>
                      </li>
                    )
                  })}
                </ol>
              )}
            </li>
          )
        })}
      </ol>
    </>
  )
}
