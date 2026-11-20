// The agent pane (spec: agent-link, "The agent pane is the session itself"). It shows the review's session as Claude
// Code's own interface when the session can be shown, and otherwise says why the pane is empty.

import { useEffect, useRef, useState } from 'react'
import {
  type AgentStatus,
  continueSession,
  fetchSessions,
  replaceSession,
  type SessionChoiceItem,
  startSession,
} from './api'
import { AgentTerminal, type TerminalEnd } from './terminal'

export function AgentPane({
  status,
  onEnded,
  onStatus,
}: {
  status: AgentStatus | null
  onEnded: () => void
  onStatus: (status: AgentStatus) => void
}) {
  const attachable = status?.state === 'attachable'
  const [replacing, setReplacing] = useState(false)
  return (
    <aside className="agent" aria-label="Agent">
      <header className="agentbar">
        <span className="agentname">{status?.name ?? 'Agent'}</span>
        {status !== null && state(status) !== null && (
          <span className={`activity ${state(status) ?? ''}`}>{label[state(status) ?? 'idle']}</span>
        )}
        {status !== null && status.state !== 'none' && (
          <button
            type="button"
            className="replace"
            aria-expanded={replacing}
            onClick={() => {
              setReplacing(!replacing)
            }}
          >
            Replace session
          </button>
        )}
      </header>
      {replacing && status !== null && (
        <Replace
          current={status.session ?? null}
          onDone={(next) => {
            setReplacing(false)
            onStatus(next)
          }}
        />
      )}
      {attachable && status.shared === true && (
        <p className="agentnote shared" role="note">
          This session is also open in another terminal. The two share one display size, so it may look wrong here or
          there.
        </p>
      )}
      {status === null && <p className="agentnote">Asking Claude Code about the review's session…</p>}
      {status?.state === 'none' && (
        <p className="agentnote">
          {status.privateCheckout === true
            ? "No agent session yet. Asking about selected code, or asking for a walkthrough, starts one in xenagos's " +
              'private checkout of the reviewed commit, because your checkout is not at it.'
            : 'No agent session yet. Asking about selected code, or asking for a walkthrough, starts one in this ' +
              'repository.'}
        </p>
      )}
      {status !== null && status.state !== 'none' && status.privateCheckout === true && (
        <p className="agentnote private" role="note">
          This session works in xenagos&apos;s private checkout of the reviewed commit, not in your checkout. Settings
          and instructions that exist only in your checkout do not apply there, and its edits stay in that copy.
        </p>
      )}
      {status !== null && !attachable && status.state !== 'none' && (
        <p className="agentnote" role="status">
          {status.reason}
        </p>
      )}
      {(status?.state === 'not-shown' || status?.state === 'ended') && <SessionChoice onStatus={onStatus} />}
      {attachable && <Session key={status.session} onEnded={onEnded} />}
    </aside>
  )
}

type State = 'working' | 'idle' | 'waiting' | 'ended'

const label: Record<State, string> = {
  working: 'working',
  idle: 'idle',
  waiting: 'waiting for you',
  ended: 'ended',
}

/** What the session is doing, as the reviewer needs to know it (spec: agent-link, "A question to a busy agent
 * waits"). Claude Code reports `busy`, `idle` or `waiting` while the session runs. */
export function state(status: AgentStatus): State | null {
  if (status.state === 'ended') return 'ended'
  if (status.state !== 'attachable' && status.state !== 'not-shown') return null
  if (status.activity === 'waiting') return 'waiting'
  if (status.activity === 'idle') return 'idle'
  return status.activity == null ? null : 'working'
}

/** Replace the review's session with another running background session or a new one (spec: review-session,
 * "One agent session per review": only on the user's request). The old session keeps running. */
function Replace({ current, onDone }: { current: string | null; onDone: (status: AgentStatus) => void }) {
  const [sessions, setSessions] = useState<SessionChoiceItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    fetchSessions().then(
      (found) => {
        setSessions(found.filter((s) => s.session !== current))
      },
      (failure: unknown) => {
        setError(failure instanceof Error ? failure.message : String(failure))
      },
    )
  }, [current])
  const choose = (action: Promise<AgentStatus>) => {
    setBusy(true)
    setError(null)
    action.then(onDone, (failure: unknown) => {
      setBusy(false)
      setError(failure instanceof Error ? failure.message : String(failure))
    })
  }
  return (
    <div className="replacepanel" role="group" aria-label="Replace the review's session">
      <p>The review's current session keeps running; it is just no longer this review's agent.</p>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          choose(startSession())
        }}
      >
        Start a new session
      </button>
      {sessions === null && error === null && <p>Looking for running sessions…</p>}
      {sessions?.length === 0 && <p>No other background session is running.</p>}
      {sessions !== null && sessions.length > 0 && (
        <ul>
          {sessions.map((s) => (
            <li key={s.session}>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  choose(replaceSession(s.session))
                }}
              >
                Use {s.name ?? s.session.slice(0, 8)}
              </button>
              {s.cwd !== null && <span className="cwd">{s.cwd}</span>}
            </li>
          ))}
        </ul>
      )}
      {error !== null && (
        <p className="agenterror" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

/** For a session the pane cannot show: continue that same session here, or start a new one. Either happens only
 * when the reviewer chooses it (spec: agent-link). */
function SessionChoice({ onStatus }: { onStatus: (status: AgentStatus) => void }) {
  const [busy, setBusy] = useState<'continue' | 'start' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = (which: 'continue' | 'start') => {
    setBusy(which)
    setError(null)
    ;(which === 'continue' ? continueSession() : startSession()).then(
      (status) => {
        setBusy(null)
        onStatus(status)
      },
      (failure: unknown) => {
        setBusy(null)
        setError(failure instanceof Error ? failure.message : String(failure))
      },
    )
  }
  return (
    <div className="sessionchoice">
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => {
          run('continue')
        }}
      >
        {busy === 'continue' ? 'Continuing…' : 'Continue it here'}
      </button>
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => {
          run('start')
        }}
      >
        {busy === 'start' ? 'Starting…' : 'Start a new session'}
      </button>
      {error !== null && (
        <p className="agenterror" role="alert">
          {error}
        </p>
      )}
    </div>
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
