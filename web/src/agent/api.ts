// Requests about the review's agent session (spec: agent-link).

import type { AgentRequest, AgentStatus, Delivery, Question, SessionChoiceItem, Show } from '../generated/types'

export type { AgentStatus, SessionChoiceItem, Show }

export class AgentRefused extends Error {}

export async function fetchAgent(): Promise<AgentStatus> {
  const response = await fetch('/api/agent')
  if (!response.ok) throw new Error(`the review server answered ${String(response.status)}`)
  return (await response.json()) as AgentStatus
}

async function send<T>(url: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  if (response.ok) return (await response.json()) as T
  const detail = ((await response.json().catch(() => ({}))) as { detail?: unknown }).detail
  throw new AgentRefused(typeof detail === 'string' ? detail : `the review server answered ${String(response.status)}`)
}

/** Enter the reviewer's question into the session, starting one when the review has none. */
export function ask(question: Question): Promise<Delivery> {
  return send('/api/agent/ask', question)
}

export function request(request: AgentRequest): Promise<Delivery> {
  return send('/api/agent/request', request)
}

/** Continue the review's session in the background so the pane can show it, keeping its conversation. */
export function continueSession(): Promise<AgentStatus> {
  return send('/api/agent/continue')
}

/** Start a new session for the review, replacing the one it has. */
export function startSession(): Promise<AgentStatus> {
  return send('/api/agent/start')
}

/** Running background sessions that could become the review's agent. */
export async function fetchSessions(): Promise<SessionChoiceItem[]> {
  const response = await fetch('/api/agent/sessions')
  if (!response.ok) throw new AgentRefused(`the review server answered ${String(response.status)}`)
  return (await response.json()) as SessionChoiceItem[]
}

/** Make another session the review's agent, replacing the one it has (only on the reviewer's request). */
export function replaceSession(session: string): Promise<AgentStatus> {
  return send('/api/agent/session', { session, replace: true }, 'PUT')
}
