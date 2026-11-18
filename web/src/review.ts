import type { FileSides } from './codeview/codeView'
import type { ChangedFile, CommitInfo, FileView, Plan, ReviewInfo } from './generated/types'

export type { ReviewInfo }

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`the review server answered ${String(response.status)}`)
  return response.json()
}

export async function fetchReview(): Promise<ReviewInfo> {
  return (await getJson('/api/review')) as ReviewInfo
}

/** The review's plan, or null when it has none yet. */
export async function fetchPlan(): Promise<Plan | null> {
  const response = await fetch('/api/plan')
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`the review server answered ${String(response.status)}`)
  return (await response.json()) as Plan
}

/** A file at both pinned revisions, or before and after one commit of the review. */
export async function fetchFile(path: string, commit: string | null = null): Promise<FileSides> {
  const query = commit === null ? '' : `&commit=${encodeURIComponent(commit)}`
  const file = (await getJson(`/api/file?path=${encodeURIComponent(path)}${query}`)) as FileView
  return { path: file.path, oldPath: file.oldPath, base: file.base, head: file.head }
}

/** Every file the change, or one of its commits, touches, with its hunks, line counts and category. */
export async function fetchChanges(commit: string | null = null): Promise<ChangedFile[]> {
  return (await getJson(commit === null ? '/api/changes' : `/api/changes?commit=${encodeURIComponent(commit)}`)) as ChangedFile[]
}

export async function fetchCommits(): Promise<CommitInfo[]> {
  return (await getJson('/api/commits')) as CommitInfo[]
}

/** Move a changed file to another category for this review; null puts it back where the rules place it. */
export async function setCategory(path: string, category: Category | null): Promise<void> {
  const response = await fetch('/api/categories', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, category }),
  })
  if (!response.ok) throw new Error(`the review server answered ${String(response.status)}`)
}

export type Category = ChangedFile['category']
