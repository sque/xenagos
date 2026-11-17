import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { FakeSocket } from './fakeSocket'
import { AgentTerminal, type TerminalEnd } from './terminal'

let host: HTMLDivElement

beforeEach(() => {
  FakeSocket.all = []
  vi.stubGlobal('WebSocket', FakeSocket)
  host = document.createElement('div')
  host.style.cssText = 'position: fixed; left: 0; top: 0; width: 640px; height: 360px;'
  document.body.append(host)
})

afterEach(() => {
  vi.unstubAllGlobals()
  host.remove()
})

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))

function rows(): string {
  return host.querySelector('.xterm-rows')?.textContent ?? ''
}

test('shows the session output and sends keys and size', async () => {
  const ends: TerminalEnd[] = []
  const terminal = new AgentTerminal(host, (end) => ends.push(end))
  const [socket] = FakeSocket.all
  if (socket === undefined) throw new Error('no socket')
  const url = new URL(socket.url)
  expect(url.pathname).toBe('/api/agent/terminal')
  const cols = Number(url.searchParams.get('cols'))
  expect(cols).toBeGreaterThan(40)
  socket.open()
  expect(socket.sent).toEqual([{ type: 'resize', cols, rows: Number(url.searchParams.get('rows')) }])

  socket.receive(new TextEncoder().encode('\x1b[1mClaude Code\x1b[0m ready\r\n').buffer)
  await vi.waitFor(() => {
    expect(rows()).toContain('Claude Code ready')
  })

  terminal.focus()
  host.querySelector('textarea')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', bubbles: true }))
  const typed = host.querySelector('textarea')
  if (typed === null) throw new Error('no input element')
  typed.value = 'y'
  typed.dispatchEvent(new InputEvent('input', { data: 'y', inputType: 'insertText', bubbles: true }))
  await vi.waitFor(() => {
    expect(socket.sent).toContainEqual({ type: 'input', data: 'y' })
  })

  host.style.width = '900px'
  await frame()
  await vi.waitFor(() => {
    const resize = socket.sent.filter((m) => (m as { type: string }).type === 'resize')
    expect((resize.at(-1) as { cols: number }).cols).toBeGreaterThan(cols)
  })

  socket.receive(JSON.stringify({ type: 'exit' }))
  expect(ends).toEqual([{ kind: 'exit' }])
  terminal.dispose()
})

test('reports why a session cannot be shown', () => {
  const ends: TerminalEnd[] = []
  const terminal = new AgentTerminal(host, (end) => ends.push(end))
  FakeSocket.all[0]?.receive(JSON.stringify({ type: 'unavailable', reason: 'The session has stopped.' }))
  expect(ends).toEqual([{ kind: 'unavailable', reason: 'The session has stopped.' }])
  terminal.dispose()
})

test('reports a lost connection once', () => {
  const ends: TerminalEnd[] = []
  const terminal = new AgentTerminal(host, (end) => ends.push(end))
  FakeSocket.all[0]?.close()
  terminal.dispose()
  expect(ends).toEqual([{ kind: 'lost' }])
})
