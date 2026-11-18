// Asking the review's agent for a walkthrough, first or again (spec: walkthrough-plan, "A walkthrough is asked for,
// not automatic"). The plan appears by itself once the agent submits one that passes the checks.

import { useState } from 'react'
import { request } from './api'

type Asked = { state: 'idle' | 'asking' | 'asked' } | { state: 'failed'; error: string }

/** `narratedWith` is the style the current walkthrough was narrated in; `style` the one a new request would use.
 * Rewriting the narration alone is asked for in the narration menu. */
export function AskWalkthrough({
  again,
  style,
  narratedWith = null,
}: {
  again: boolean
  style: string
  narratedWith?: string | null
}) {
  const [asked, setAsked] = useState<Asked>({ state: 'idle' })
  const ask = () => {
    setAsked({ state: 'asking' })
    request({ kind: 'walkthrough' }).then(
      () => {
        setAsked({ state: 'asked' })
      },
      (error: unknown) => {
        setAsked({ state: 'failed', error: error instanceof Error ? error.message : String(error) })
      },
    )
  }
  return (
    <div className="askwalkthrough">
      <button
        type="button"
        disabled={asked.state === 'asking'}
        onClick={ask}
      >
        {again ? 'Ask for a new walkthrough' : 'Ask the agent for a walkthrough'}
      </button>
      <span className="style">
        {narratedWith === null || narratedWith === style
          ? `Narration style: ${style}`
          : `Narrated in ${narratedWith} · active style: ${style}`}
      </span>
      {asked.state === 'asked' && (
        <p role="status">
          Asked.{' '}
          {again
            ? 'The new walkthrough replaces this one once the agent submits one that passes the checks.'
            : 'The walkthrough appears here once the agent submits one that passes the checks.'}
        </p>
      )}
      {asked.state === 'failed' && <p role="alert">{asked.error}</p>}
    </div>
  )
}
