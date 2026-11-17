import type { ReviewInfo } from './generated/types'

export type { ReviewInfo }

export async function fetchReview(): Promise<ReviewInfo> {
  const response = await fetch('/api/review')
  if (!response.ok) throw new Error(`the review server answered ${String(response.status)}`)
  return (await response.json()) as ReviewInfo
}
