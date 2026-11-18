// The questions asked in this review, kept with it (spec: review-session, "A review survives its instance"). Their
// answers are in the agent session's conversation, in the pane; choosing a question about code shows that code again.

import type { AskedQuestion, CodeTarget } from '../generated/types'

/** The code a question was about, as a target to show; null for an element of a visual. */
export function questionTarget(asked: AskedQuestion): CodeTarget | null {
  const selection = asked.selection
  if (selection.kind !== 'code') return null
  if (selection.startSide === selection.endSide) {
    return { path: selection.path, side: selection.startSide, startLine: selection.startLine, endLine: selection.endLine }
  }
  // From a deleted line to an added one in the unified view: show where it ends, at the head.
  return { path: selection.path, side: selection.endSide, startLine: selection.endLine, endLine: selection.endLine }
}

function where(asked: AskedQuestion): string {
  const selection = asked.selection
  if (selection.kind === 'element') return `${selection.visual} · ${selection.element}`
  const lines =
    selection.startSide === selection.endSide && selection.startLine === selection.endLine
      ? `line ${String(selection.startLine)}`
      : `lines ${String(selection.startLine)}–${String(selection.endLine)}`
  return `${selection.path} ${lines}${selection.endSide === 'base' ? ' (before)' : ''}`
}

export function EarlierQuestions(props: { questions: AskedQuestion[]; onShow: ((target: CodeTarget) => void) | null }) {
  const { questions, onShow } = props
  if (questions.length === 0) return null
  return (
    <details className="questions">
      <summary>
        Your questions <span className="count">{questions.length}</span>
      </summary>
      <p className="hint">The answers are in the agent's conversation below.</p>
      <ol>
        {[...questions].reverse().map((asked) => {
          const target = questionTarget(asked)
          return (
            <li key={`${String(asked.asked)}:${asked.question}`}>
              <button
                type="button"
                disabled={target === null || onShow === null}
                title={new Date(asked.asked * 1000).toLocaleString()}
                onClick={() => {
                  if (target !== null) onShow?.(target)
                }}
              >
                <span className="where">{where(asked)}</span>
                <span className="text">{asked.question}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </details>
  )
}
