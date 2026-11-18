// Asking the review's agent for a walkthrough, first or again (spec: walkthrough-plan, "A walkthrough is asked for,
// not automatic"). The plan appears by itself once the agent submits one that passes the checks.

import { useState } from 'react'
import { request } from './api'

type Asked = { state: 'idle' | 'asking' | 'asked' } | { state: 'failed'; error: string }

export function AskWalkthrough({ again, style }: { again: boolean; style: string }) {
  const [asked, setAsked] = useState<Asked>({ state: 'idle' })
  return (
    <div className="askwalkthrough">
      <button
        type="button"
        disabled={asked.state === 'asking'}
        onClick={() => {
          setAsked({ state: 'asking' })
          request({ kind: 'walkthrough' }).then(
            () => {
              setAsked({ state: 'asked' })
            },
            (error: unknown) => {
              setAsked({ state: 'failed', error: error instanceof Error ? error.message : String(error) })
            },
          )
        }}
      >
        {again ? 'Ask for a new walkthrough' : 'Ask the agent for a walkthrough'}
      </button>
      <span className="style">Narration style: {style}</span>
      {asked.state === 'asked' && (
        <p role="status">
          Asked. {again ? 'The new walkthrough replaces this one' : 'The walkthrough appears here'} once the agent
          submits one that passes the checks.
        </p>
      )}
      {asked.state === 'failed' && <p role="alert">{asked.error}</p>}
    </div>
  )
}
