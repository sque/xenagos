// The small prompt at a selection (spec: agent-link, "Questions carry their selection"). The question goes to the
// review's session with a reference the server builds from the selection and the step the reviewer is on.

import { useEffect, useRef, useState } from 'react'
import type { LineSelection } from '../codeview/codeView'
import type { ElementSelection, Position } from '../generated/types'
import { ask } from './api'

/** Lines of code, or an element of a section's visual. */
export type Selection = ({ kind: 'code' } & LineSelection) | ElementSelection

export interface AskAt {
  selection: Selection
  /** Where the prompt opens: its horizontal middle and its top, in viewport coordinates. */
  x: number
  y: number
}

const WIDTH = 360

export function AskPrompt(props: {
  at: AskAt
  position: Position | null
  onAsking: () => void
  onClose: (sent: boolean) => void
}) {
  const [text, setText] = useState('')
  const [state, setState] = useState<{ sending: boolean; error: string | null }>({ sending: false, error: null })
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { selection } = props.at

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const send = () => {
    if (text.trim() === '' || state.sending) return
    props.onAsking()
    setState({ sending: true, error: null })
    ask({ question: text, selection, position: props.position }).then(
      () => {
        props.onClose(true)
      },
      (error: unknown) => {
        setState({ sending: false, error: error instanceof Error ? error.message : String(error) })
      },
    )
  }

  const left = Math.max(8, Math.min(props.at.x - WIDTH / 2, window.innerWidth - WIDTH - 8))
  const top = Math.min(props.at.y + 6, window.innerHeight - 170)
  return (
    <form
      className="askprompt"
      style={{ left, top, width: WIDTH }}
      aria-label="Ask the agent about the selection"
      onSubmit={(event) => {
        event.preventDefault()
        send()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') props.onClose(false)
      }}
    >
      <p className="askwhere">{describe(selection)}</p>
      <textarea
        ref={inputRef}
        rows={3}
        value={text}
        placeholder={selection.kind === 'code' ? 'Ask the agent about these lines' : 'Ask the agent about this element'}
        onChange={(event) => {
          setText(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            send()
          }
        }}
      />
      {state.error !== null && (
        <p className="askerror" role="alert">
          {state.error}
        </p>
      )}
      <div className="askactions">
        <button
          type="button"
          onClick={() => {
            props.onClose(false)
          }}
        >
          Cancel
        </button>
        <button type="submit" disabled={state.sending || text.trim() === ''}>
          {state.sending ? 'Sending…' : 'Ask'}
        </button>
      </div>
    </form>
  )
}

export function describe(selection: Selection): string {
  if (selection.kind === 'element') return `Visual ${selection.visual}, element ${selection.element}`
  const { path, startSide, startLine, endSide, endLine } = selection
  if (startSide !== endSide) return `${path}, line ${String(startLine)} (${startSide}) to ${String(endLine)} (${endSide})`
  const lines = startLine === endLine ? `line ${String(startLine)}` : `lines ${String(startLine)}–${String(endLine)}`
  return `${path}, ${lines}${startSide === 'base' ? ' (before the change)' : ''}`
}
