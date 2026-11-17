import { useEffect, useState } from 'react'
import { fetchReview, type ReviewInfo } from './review'

type Load = { state: 'loading' } | { state: 'ready'; review: ReviewInfo } | { state: 'failed'; message: string }

export function App() {
  const [load, setLoad] = useState<Load>({ state: 'loading' })

  useEffect(() => {
    let live = true
    fetchReview().then(
      (review) => {
        if (live) setLoad({ state: 'ready', review })
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
    <main>
      <h1>xenagos</h1>
      {load.state === 'loading' && <p>Loading the review…</p>}
      {load.state === 'failed' && <p role="alert">Could not load the review: {load.message}</p>}
      {load.state === 'ready' && <ReviewHeader review={load.review} />}
    </main>
  )
}

function ReviewHeader({ review }: { review: ReviewInfo }) {
  return (
    <header>
      <p>{review.label}</p>
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
    </header>
  )
}
