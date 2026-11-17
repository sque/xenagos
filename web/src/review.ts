// Mirrors the server's ReviewInfo. Replaced by types generated from the server's models in task 5.1.
export interface ReviewInfo {
  id: string
  repo: string
  label: string
  base: string
  head: string
  branch: string | null
}

export async function fetchReview(): Promise<ReviewInfo> {
  const response = await fetch('/api/review')
  if (!response.ok) throw new Error(`the review server answered ${String(response.status)}`)
  return (await response.json()) as ReviewInfo
}
