// Requests about the review's agent session (spec: agent-link).

import type { AgentRequest, AgentStatus, Delivery, Question, Show } from '../generated/types'

export type { AgentStatus, Show }

export class AgentRefused extends Error {}

export async function fetchAgent(): Promise<AgentStatus> {
  const response = await fetch('/api/agent')
  if (!response.ok) throw new Error(`the review server answered ${String(response.status)}`)
  return (await response.json()) as AgentStatus
}

async function post(url: string, body: unknown): Promise<Delivery> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (response.ok) return (await response.json()) as Delivery
  const detail = ((await response.json().catch(() => ({}))) as { detail?: unknown }).detail
  throw new AgentRefused(typeof detail === 'string' ? detail : `the review server answered ${String(response.status)}`)
}

/** Enter the reviewer's question into the session, starting one when the review has none. */
export function ask(question: Question): Promise<Delivery> {
  return post('/api/agent/ask', question)
}

export function request(request: AgentRequest): Promise<Delivery> {
  return post('/api/agent/request', request)
}
