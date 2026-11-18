// Messages from the review server to this viewer. Keeping the socket open is also what tells the server that a
// viewer is open; without one it ends itself after its idle period (spec: review-session).

import type { Show } from '../generated/types'

export type ServerEvent =
  | { type: 'plan' }
  | { type: 'agent' }
  | { type: 'categories' }
  | { type: 'questions' }
  | ({ type: 'show' } & Show)

const RETRY_MS = [500, 1000, 2000, 5000]

/** Listen until the returned function is called, reconnecting when the connection drops. `onOpen` runs on every
 * (re)connection, so state missed while disconnected can be fetched again. */
export function listen(onEvent: (event: ServerEvent) => void, onOpen: () => void = () => undefined): () => void {
  let socket: WebSocket | undefined
  let attempt = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  const connect = () => {
    socket = new WebSocket(new URL('/api/events', location.href.replace(/^http/, 'ws')))
    socket.onopen = () => {
      attempt = 0
      onOpen()
    }
    socket.onmessage = (message) => {
      if (typeof message.data === 'string') onEvent(JSON.parse(message.data) as ServerEvent)
    }
    socket.onclose = () => {
      if (stopped) return
      timer = setTimeout(connect, RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)])
      attempt += 1
    }
  }
  connect()
  return () => {
    stopped = true
    clearTimeout(timer)
    socket?.close()
  }
}
