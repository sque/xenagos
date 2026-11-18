import type { FileSides } from './codeview/codeView'
import type { ChangedFile, FileView, Plan, ReviewInfo } from './generated/types'

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

export async function fetchFile(path: string): Promise<FileSides> {
  const file = (await getJson(`/api/file?path=${encodeURIComponent(path)}`)) as FileView
  return { path: file.path, oldPath: file.oldPath, base: file.base, head: file.head }
}

/** Every file the change touches, with its hunks. */
export async function fetchChanges(): Promise<ChangedFile[]> {
  return (await getJson('/api/changes')) as ChangedFile[]
}
