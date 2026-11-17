// The agent pane (spec: agent-link, "The agent pane is the session itself"). It shows the review's session as Claude
// Code's own interface when the session can be shown, and otherwise says why the pane is empty.

import { useEffect, useRef, useState } from 'react'
import type { AgentStatus } from './api'
import { AgentTerminal, type TerminalEnd } from './terminal'

export function AgentPane({ status, onEnded }: { status: AgentStatus | null; onEnded: () => void }) {
  const attachable = status?.state === 'attachable'
  return (
    <aside className="agent" aria-label="Agent">
      <header className="agentbar">
        <span className="agentname">{status?.name ?? 'Agent'}</span>
        {status?.activity != null && <span className="activity">{status.activity}</span>}
      </header>
      {status === null && <p className="agentnote">Asking Claude Code about the review's session…</p>}
      {status?.state === 'none' && (
        <p className="agentnote">
          No agent session yet. Asking about selected code, or asking for a walkthrough, starts one in this
          repository.
        </p>
      )}
      {status !== null && !attachable && status.state !== 'none' && (
        <p className="agentnote" role="status">
          {status.reason}
        </p>
      )}
      {attachable && <Session key={status.session} onEnded={onEnded} />}
    </aside>
  )
}

function Session({ onEnded }: { onEnded: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [end, setEnd] = useState<TerminalEnd | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const terminal = new AgentTerminal(host, (ended) => {
      setEnd(ended)
      onEnded()
    })
    return () => {
      terminal.dispose()
      host.replaceChildren()
    }
  }, [attempt, onEnded])

  return (
    <div className="session">
      <div className="terminal" ref={hostRef} />
      {end !== null && (
        <div className="terminalend" role="status">
          <p>{end.kind === 'unavailable' ? end.reason : 'The pane lost its connection to the session.'}</p>
          <button
            type="button"
            onClick={() => {
              setEnd(null)
              setAttempt(attempt + 1)
            }}
          >
            Show the session again
          </button>
        </div>
      )}
    </div>
  )
}
