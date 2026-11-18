import { useCallback, useEffect, useState } from 'react'
import { AgentPane } from './agent/AgentPane'
import { type AgentStatus, fetchAgent } from './agent/api'
import { AskWalkthrough } from './agent/AskWalkthrough'
import { listen } from './agent/events'
import type { Plan } from './generated/types'
import { Explorer } from './layout/Explorer'
import { Layout } from './layout/Layout'
import { fetchPlan, fetchReview, type ReviewInfo } from './review'
import { type Opening, type Pointing, Walkthrough } from './walkthrough/Walkthrough'

type Load =
  | { state: 'loading' }
  | { state: 'ready'; review: ReviewInfo; plan: Plan | null }
  | { state: 'failed'; message: string }

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function App() {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [agent, setAgent] = useState<AgentStatus | null>(null)
  const [pointing, setPointing] = useState<Pointing | null>(null)
  const [outlineSlot, setOutlineSlot] = useState<HTMLElement | null>(null)
  const [currentFile, setCurrentFile] = useState<string | null>(null)
  const [opening, setOpening] = useState<Opening | null>(null)
  const [explorerOpen, setExplorerOpen] = useState(false)

  const refreshAgent = useCallback(() => {
    fetchAgent().then(setAgent, (error: unknown) => {
      setAgent({ state: 'unavailable', reason: message(error) })
    })
  }, [])

  useEffect(() => {
    let live = true
    Promise.all([fetchReview(), fetchPlan()]).then(
      ([review, plan]) => {
        if (live) setLoad({ state: 'ready', review, plan })
      },
      (error: unknown) => {
        if (live) setLoad({ state: 'failed', message: message(error) })
      },
    )
    const refreshPlan = () => {
      fetchPlan().then(
        (plan) => {
          if (live) setLoad((current) => (current.state === 'ready' ? { ...current, plan } : current))
        },
        () => undefined,
      )
    }
    refreshAgent()
    let seq = 0
    const stop = listen(
      (event) => {
        if (event.type === 'plan') refreshPlan()
        else if (event.type === 'agent') refreshAgent()
        else setPointing({ target: event.target, form: event.form, seq: ++seq })
      },
      () => {
        refreshAgent()
        refreshPlan()
      },
    )
    return () => {
      live = false
      stop()
    }
  }, [refreshAgent])

  const plan = load.state === 'ready' ? load.plan : null
  return (
    <div className="app">
      <header className="topbar">
        <button
          type="button"
          className="explorertoggle"
          aria-expanded={explorerOpen}
          onClick={() => {
            setExplorerOpen(!explorerOpen)
          }}
        >
          Files
        </button>
        <h1>xenagos</h1>
        {load.state === 'ready' && <ReviewHeader review={load.review} />}
      </header>
      <Layout
        explorerOpen={explorerOpen}
        explorer={
          <Explorer
            current={currentFile}
            onOpen={
              plan === null
                ? null
                : (path) => {
                    setOpening((previous) => ({ path, seq: (previous?.seq ?? 0) + 1 }))
                    setExplorerOpen(false)
                  }
            }
          />
        }
        middle={
          <>
            {load.state === 'loading' && <p className="notice">Loading the review…</p>}
            {load.state === 'failed' && (
              <p className="notice" role="alert">
                Could not load the review: {load.message}
              </p>
            )}
            {load.state === 'ready' && plan === null && <NoWalkthrough style={load.review.style} />}
            {load.state === 'ready' && plan !== null && (
              <Walkthrough
                plan={plan}
                pointing={pointing}
                opening={opening}
                style={load.review.style}
                outlineSlot={outlineSlot}
                onFile={setCurrentFile}
              />
            )}
          </>
        }
        outlineInto={setOutlineSlot}
        outline={plan === null ? <p className="notice">The outline of the walkthrough appears here.</p> : null}
        agent={<AgentPane status={agent} onEnded={refreshAgent} onStatus={setAgent} />}
      />
    </div>
  )
}

/** Walkthrough mode with no plan (spec: walkthrough-plan, "A walkthrough is asked for, not automatic"). */
function NoWalkthrough({ style }: { style: string }) {
  return (
    <div className="notice empty">
      <p>This review has no walkthrough yet.</p>
      <AskWalkthrough again={false} style={style} />
    </div>
  )
}

function ReviewHeader({ review }: { review: ReviewInfo }) {
  return (
    <div className="target">
      <span>{review.label}</span>
      <dl>
        <dt>Base</dt>
        <dd>
          <code title={review.base}>{review.base.slice(0, 10)}</code>
        </dd>
        <dt>Head</dt>
        <dd>
          <code title={review.head}>{review.head.slice(0, 10)}</code>
        </dd>
      </dl>
    </div>
  )
}
