import { useEffect, useState } from 'react'
import type { Plan } from './generated/types'
import { fetchPlan, fetchReview, type ReviewInfo } from './review'
import { Walkthrough } from './walkthrough/Walkthrough'

type Load =
  | { state: 'loading' }
  | { state: 'ready'; review: ReviewInfo; plan: Plan | null }
  | { state: 'failed'; message: string }

export function App() {
  const [load, setLoad] = useState<Load>({ state: 'loading' })

  useEffect(() => {
    let live = true
    Promise.all([fetchReview(), fetchPlan()]).then(
      ([review, plan]) => {
        if (live) setLoad({ state: 'ready', review, plan })
      },
      (error: unknown) => {
        if (live) setLoad({ state: 'failed', message: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => {
      live = false
    }
  }, [])

  return (
    <div className="app">
      <header className="topbar">
        <h1>xenagos</h1>
        {load.state === 'ready' && <ReviewHeader review={load.review} />}
      </header>
      {load.state === 'loading' && <p className="notice">Loading the review…</p>}
      {load.state === 'failed' && (
        <p className="notice" role="alert">
          Could not load the review: {load.message}
        </p>
      )}
      {load.state === 'ready' && load.plan === null && <p className="notice">This review has no walkthrough yet.</p>}
      {load.state === 'ready' && load.plan !== null && <Walkthrough plan={load.plan} />}
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
