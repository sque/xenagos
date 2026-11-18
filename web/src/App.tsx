import { useCallback, useEffect, useState } from 'react'
import { AgentPane } from './agent/AgentPane'
import { type AgentStatus, fetchAgent } from './agent/api'
import { AskWalkthrough } from './agent/AskWalkthrough'
import { EarlierQuestions } from './agent/EarlierQuestions'
import { Browse } from './browse/Browse'
import { listen } from './agent/events'
import type { AskedQuestion, CodeTarget, Coverage, Plan, RepositoryTree } from './generated/types'
import { Explorer, fetchTree } from './layout/Explorer'
import { Layout } from './layout/Layout'
import { fetchPlan, fetchProgress, fetchQuestions, fetchReview, type ReviewInfo, saveProgress } from './review'
import { TargetNotice } from './TargetNotice'
import { fetchCoverage } from './walkthrough/NotCovered'
import { type Opening, type Pointing, type Position, Walkthrough } from './walkthrough/Walkthrough'

type Load =
  | { state: 'loading' }
  | { state: 'ready'; review: ReviewInfo; plan: Plan | null }
  | { state: 'failed'; message: string }

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

type Mode = 'browse' | 'walkthrough'

/** The mode named in the address (#browse, #walkthrough), so a reload keeps it. */
function modeInAddress(): Mode | null {
  return location.hash === '#browse' ? 'browse' : location.hash === '#walkthrough' ? 'walkthrough' : null
}

export function App() {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [agent, setAgent] = useState<AgentStatus | null>(null)
  const [pointing, setPointing] = useState<Pointing | null>(null)
  const [outlineSlot, setOutlineSlot] = useState<HTMLElement | null>(null)
  const [currentFile, setCurrentFile] = useState<string | null>(null)
  const [opening, setOpening] = useState<Opening | null>(null)
  const [explorerOpen, setExplorerOpen] = useState(false)
  const [covered, setCovered] = useState<{ plan: Plan; coverage: Coverage | null } | null>(null)
  const [tree, setTree] = useState<{ tree: RepositoryTree | null; error: string | null }>({ tree: null, error: null })
  // Browse mode unless the review already has a walkthrough when it opens (spec: review-session); chosen at load.
  const [mode, setModeState] = useState<Mode>(modeInAddress() ?? 'browse')
  const [explorerSlot, setExplorerSlot] = useState<HTMLElement | null>(null)
  const [categoriesSeq, setCategoriesSeq] = useState(0)
  // Where the walkthrough was when the reviewer switched to browsing, to come back to it.
  const [position, setPosition] = useState<Position | null>(null)
  const [questions, setQuestions] = useState<AskedQuestion[]>([])
  const setMode = useCallback((next: Mode) => {
    setModeState(next)
    history.replaceState(null, '', `#${next}`)
  }, [])

  const refreshAgent = useCallback(() => {
    fetchAgent().then(setAgent, (error: unknown) => {
      setAgent({ state: 'unavailable', reason: message(error) })
    })
  }, [])

  useEffect(() => {
    let live = true
    // Progress and earlier questions are kept with the review (spec: review-session); a review opened again starts
    // where it was left.
    const progress = fetchProgress().catch(() => null)
    Promise.all([fetchReview(), fetchPlan(), progress]).then(
      ([review, plan, saved]) => {
        if (!live) return
        if (saved !== null) setPosition({ section: saved.section - 1, step: saved.step - 1 })
        setLoad({ state: 'ready', review, plan })
        if (modeInAddress() === null) setModeState(plan !== null ? 'walkthrough' : 'browse')
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
    const refreshQuestions = () => {
      fetchQuestions().then(
        (found) => {
          if (live) setQuestions(found)
        },
        () => undefined,
      )
    }
    refreshAgent()
    refreshQuestions()
    let seq = 0
    const stop = listen(
      (event) => {
        if (event.type === 'plan') refreshPlan()
        else if (event.type === 'agent') refreshAgent()
        else if (event.type === 'categories') setCategoriesSeq((n) => n + 1)
        else if (event.type === 'questions') refreshQuestions()
        else {
          // The agent points at code: the walkthrough's code view shows it, so a browsing reviewer is taken there.
          setPointing({ target: event.target, form: event.form, seq: ++seq })
          setModeState((current) => (current === 'browse' ? 'walkthrough' : current))
        }
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

  // The not-covered list and the explorer's marks follow the plan: a new plan may claim other hunks and visit
  // other files.
  useEffect(() => {
    let live = true
    fetchTree().then(
      (found) => {
        if (live) setTree({ tree: found, error: null })
      },
      (error: unknown) => {
        if (live) setTree((previous) => ({ ...previous, error: message(error) }))
      },
    )
    if (plan !== null) {
      fetchCoverage().then(
        (coverage) => {
          if (live) setCovered({ plan, coverage })
        },
        () => undefined,
      )
    }
    return () => {
      live = false
    }
  }, [plan])
  const coverage = covered !== null && covered.plan === plan ? covered.coverage : null

  // Save where the reviewer is, shortly after they stop moving.
  const section = position?.section
  const step = position?.step
  useEffect(() => {
    if (plan === null || section === undefined || step === undefined) return
    const timer = setTimeout(() => {
      saveProgress({ section: section + 1, step: step + 1 }).catch(() => undefined)
    }, 400)
    return () => {
      clearTimeout(timer)
    }
  }, [plan, section, step])

  const showQuestion = (target: CodeTarget) => {
    setPointing((previous) => ({ target, form: 'lines', seq: (previous?.seq ?? 0) + 1 }))
    setMode('walkthrough')
  }
  const earlier = <EarlierQuestions questions={questions} onShow={plan === null ? null : showQuestion} />
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
        <div className="modeswitch" role="group" aria-label="Mode">
          {(['browse', 'walkthrough'] as const).map((each) => (
            <button
              key={each}
              type="button"
              aria-pressed={mode === each}
              onClick={() => {
                setMode(each)
              }}
            >
              {each === 'browse' ? 'Browse' : 'Walkthrough'}
            </button>
          ))}
        </div>
      </header>
      {load.state === 'ready' && <TargetNotice head={load.review.head} />}
      <Layout
        explorerOpen={explorerOpen}
        explorerInto={setExplorerSlot}
        explorer={
          mode === 'browse' ? null : (
          <Explorer
            tree={tree.tree}
            error={tree.error}
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
          )
        }
        middle={
          <>
            {load.state === 'loading' && <p className="notice">Loading the review…</p>}
            {load.state === 'failed' && (
              <p className="notice" role="alert">
                Could not load the review: {load.message}
              </p>
            )}
            {load.state === 'ready' && mode === 'browse' && (
              <Browse
                explorerSlot={explorerSlot}
                categoriesSeq={categoriesSeq}
                onChosen={() => {
                  setExplorerOpen(false)
                }}
              />
            )}
            {load.state === 'ready' && mode === 'walkthrough' && plan === null && <NoWalkthrough style={load.review.style} />}
            {load.state === 'ready' && mode === 'walkthrough' && plan !== null && (
              <Walkthrough
                plan={plan}
                pointing={pointing}
                opening={opening}
                coverage={coverage}
                style={load.review.style}
                reviewId={load.review.id}
                voice={load.review.voice}
                outlineSlot={outlineSlot}
                onFile={setCurrentFile}
                start={position}
                onPosition={setPosition}
                extra={earlier}
              />
            )}
          </>
        }
        outlineInto={setOutlineSlot}
        outline={
          mode === 'browse' && load.state === 'ready' ? (
            <>
              <BrowsePanel
                plan={plan}
                style={load.review.style}
                onOpen={() => {
                  setMode('walkthrough')
                }}
              />
              {earlier}
            </>
          ) : plan === null ? (
            <p className="notice">The outline of the walkthrough appears here.</p>
          ) : null
        }
        agent={<AgentPane status={agent} onEnded={refreshAgent} onStatus={setAgent} />}
      />
    </div>
  )
}

/** The right column's top in browse mode: the way to the walkthrough, or to asking for one. */
function BrowsePanel({ plan, style, onOpen }: { plan: Plan | null; style: string; onOpen: () => void }) {
  if (plan === null) {
    return (
      <div className="browsepanel">
        <h2 className="columnhead">Walkthrough</h2>
        <p>No walkthrough yet. Browsing never starts an agent; asking for one does.</p>
        <AskWalkthrough again={false} style={style} />
      </div>
    )
  }
  const steps = plan.sections.reduce((sum, section) => sum + section.steps.length, 0)
  return (
    <div className="browsepanel">
      <h2 className="columnhead">Walkthrough</h2>
      <p>
        This review has a walkthrough: {plan.sections.length} section{plan.sections.length === 1 ? '' : 's'}, {steps}{' '}
        step{steps === 1 ? '' : 's'}.
      </p>
      <button type="button" className="primary" onClick={onOpen}>
        Open the walkthrough
      </button>
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
