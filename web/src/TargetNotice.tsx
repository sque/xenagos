// What changed around the pinned review (spec: review-target): the reviewed branch moved, or files in the review
// have uncommitted changes. The review itself stays as it was. Checked on load, every 30 seconds while the page is
// open, and when the reviewer comes back to it.

import { useEffect, useState } from 'react'
import type { TargetStatus } from './generated/types'

const EVERY_MS = 30_000

export async function fetchTargetStatus(): Promise<TargetStatus> {
  const response = await fetch('/api/target/status')
  if (!response.ok) throw new Error(`the review server answered ${String(response.status)}`)
  return (await response.json()) as TargetStatus
}

const list = (paths: string[]) =>
  paths.length <= 1 ? (paths[0] ?? '') : `${paths.slice(0, -1).join(', ')} and ${paths[paths.length - 1] ?? ''}`

export function TargetNotice({ head }: { head: string }) {
  const [status, setStatus] = useState<TargetStatus | null>(null)
  useEffect(() => {
    let live = true
    const check = () => {
      fetchTargetStatus().then(
        (found) => {
          if (live) setStatus(found)
        },
        () => undefined,
      )
    }
    check()
    const timer = setInterval(check, EVERY_MS)
    const back = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', back)
    window.addEventListener('focus', back)
    return () => {
      live = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', back)
      window.removeEventListener('focus', back)
    }
  }, [])
  if (status === null || (status.moved === null && status.uncommitted.length === 0)) return null
  const moved = status.moved
  const pinned = head.slice(0, 7)
  return (
    <div className="targetnotice" role="status">
      {moved != null && (
        <p>
          {moved.tip === null
            ? `${moved.branch} no longer exists.`
            : moved.ahead === null
              ? `${moved.branch} was rewritten and no longer contains the reviewed head.`
              : `${moved.branch} is now ${String(moved.ahead)} commit${moved.ahead === 1 ? '' : 's'} ahead of the reviewed head.`}{' '}
          This review stays at <code>{pinned}</code>; run <code>xen</code> in the repository to review the new head.
        </p>
      )}
      {status.uncommitted.length > 0 && (
        <p>
          Uncommitted changes to {list(status.uncommitted)} are not included: the review shows committed changes only.
        </p>
      )}
    </div>
  )
}
