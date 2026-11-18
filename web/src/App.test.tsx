import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { FakeSocket } from './agent/fakeSocket'
import { App } from './App'

// The real terminal needs a browser's canvas; it is tested in terminal.browser.test.ts.
vi.mock('./agent/terminal', () => ({
  AgentTerminal: class {
    focus() {
      return undefined
    }
    dispose() {
      return undefined
    }
  },
}))

beforeEach(() => {
  FakeSocket.all = []
  vi.stubGlobal('WebSocket', FakeSocket)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const review = {
  id: 'abc',
  repo: '/repo',
  label: 'feature against main',
  base: '1111111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  head: '2222222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  branch: 'feature',
  style: 'default',
  voice: { enabled: false, provider: 'browser', name: null, speed: 1 },
}

function serve(routes: Record<string, Response>) {
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    const key = init?.method === undefined || init.method === 'GET' ? url : `${init.method} ${url}`
    return Promise.resolve(routes[key]?.clone() ?? new Response('', { status: 404 }))
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const json = (body: unknown) => new Response(JSON.stringify(body))

test('shows the target and both pinned commit ids', async () => {
  serve({ '/api/review': new Response(JSON.stringify(review)) })
  render(<App />)
  expect(await screen.findByText('feature against main')).toBeDefined()
  expect(screen.getByTitle(review.base).textContent).toBe('1111111111')
  expect(screen.getByTitle(review.head).textContent).toBe('2222222222')
})

test('says when the review has no walkthrough yet', async () => {
  serve({ '/api/review': new Response(JSON.stringify(review)) })
  render(<App />)
  expect(await screen.findByText('This review has no walkthrough yet.')).toBeDefined()
})

test('says when the review cannot be loaded', async () => {
  serve({ '/api/review': new Response('', { status: 403 }) })
  render(<App />)
  expect((await screen.findByRole('alert')).textContent).toContain('403')
})

test('says the review has no agent session yet', async () => {
  serve({ '/api/review': json(review), '/api/agent': json({ state: 'none' }) })
  render(<App />)
  expect(await screen.findByText(/No agent session yet/)).toBeDefined()
})

test('says why the session cannot be shown', async () => {
  const reason = 'This session was started by hand in a terminal.'
  serve({ '/api/review': json(review), '/api/agent': json({ state: 'not-shown', name: 'mine', reason }) })
  render(<App />)
  expect((await screen.findByRole('status')).textContent).toBe(reason)
  expect(screen.getByText('mine')).toBeDefined()
})

test('asks the agent for a walkthrough', async () => {
  const fetch = serve({
    '/api/review': json(review),
    '/api/agent': json({ state: 'none' }),
    'POST /api/agent/request': json({ started: true, session: 's' }),
  })
  render(<App />)
  fireEvent.click(await screen.findByText('Ask the agent for a walkthrough'))
  expect((await screen.findByRole('status')).textContent).toContain('appears here once the agent submits one')
  const call = fetch.mock.calls.find(([url]) => url === '/api/agent/request')
  expect(JSON.parse(call?.[1]?.body as string)).toEqual({ kind: 'walkthrough' })
})

test('fetches the plan and the agent again when the server says they changed', async () => {
  const fetch = serve({ '/api/review': json(review), '/api/agent': json({ state: 'none' }) })
  render(<App />)
  await screen.findByText('This review has no walkthrough yet.')
  const count = (url: string) => fetch.mock.calls.filter(([u]) => u === url).length
  const [socket] = FakeSocket.all
  expect(socket?.url).toMatch(/^ws:.*\/api\/events$/)
  const plans = count('/api/plan')
  const agents = count('/api/agent')
  socket?.receive(JSON.stringify({ type: 'plan' }))
  socket?.receive(JSON.stringify({ type: 'agent' }))
  await vi.waitFor(() => {
    expect(count('/api/plan')).toBe(plans + 1)
    expect(count('/api/agent')).toBe(agents + 1)
  })
})

test('continues a session that cannot be shown, on request', async () => {
  const reason = 'This session was started by hand in a terminal. Continue it here, or start a new session.'
  const fetch = serve({
    '/api/review': json(review),
    '/api/agent': json({ state: 'not-shown', name: 'by-hand', reason }),
    'POST /api/agent/continue': new Response(JSON.stringify({ detail: 'Session by-hand is still open in another terminal.' }), {
      status: 409,
    }),
  })
  render(<App />)
  fireEvent.click(await screen.findByText('Continue it here'))
  expect((await screen.findByRole('alert')).textContent).toBe('Session by-hand is still open in another terminal.')
  expect(fetch.mock.calls.filter(([url]) => url === '/api/agent/continue')).toHaveLength(1)
  expect(screen.getByText('Start a new session')).toBeDefined()
})

test('shows what the session is doing and that its display is shared', async () => {
  const status = { state: 'attachable', session: 's', name: 'worker', activity: 'waiting', shared: true }
  serve({ '/api/review': json(review), '/api/agent': json(status) })
  render(<App />)
  expect(await screen.findByText('waiting for you')).toBeDefined()
  expect(screen.getByRole('note').textContent).toContain('also open in another terminal')
})

test('offers a new session when the session has ended', async () => {
  serve({ '/api/review': json(review), '/api/agent': json({ state: 'ended', name: 'worker', reason: 'The session has stopped.' }) })
  render(<App />)
  expect(await screen.findByText('ended')).toBeDefined()
  expect(screen.getByText('Start a new session')).toBeDefined()
})

test('shows the narration style beside the request for a walkthrough', async () => {
  serve({ '/api/review': json(review), '/api/agent': json({ state: 'none' }) })
  render(<App />)
  expect(await screen.findByText('Narration style: default')).toBeDefined()
})

test('replaces the review session with another one on request', async () => {
  const fetch = serve({
    '/api/review': json(review),
    '/api/agent': json({ state: 'ended', session: 'old', name: 'old one', reason: 'The session has stopped.' }),
    '/api/agent/sessions': json([
      { session: 'old', name: 'old one', kind: 'background', running: true, cwd: '/r' },
      { session: 'new', name: 'other one', kind: 'background', running: true, cwd: '/r' },
    ]),
    'PUT /api/agent/session': json({ state: 'ended', session: 'new', name: 'other one', reason: 'stopped' }),
  })
  render(<App />)
  fireEvent.click(await screen.findByText('Replace session'))
  expect(screen.queryByText('Use old one')).toBeNull()
  fireEvent.click(await screen.findByText('Use other one'))
  await vi.waitFor(() => {
    const call = fetch.mock.calls.find(([url, init]) => url === '/api/agent/session' && init?.method === 'PUT')
    expect(JSON.parse(call?.[1]?.body as string)).toEqual({ session: 'new', replace: true })
  })
  expect(await screen.findByText('other one')).toBeDefined()
})

test('reports a moved branch and uncommitted changes, and keeps the pinned head', async () => {
  serve({
    '/api/review': json(review),
    '/api/agent': json({ state: 'none' }),
    '/api/target/status': json({
      moved: { branch: 'feature', tip: '3333333333cccccccccccccccccccccccccccccc', ahead: 2 },
      uncommitted: ['app.py', 'src/lib.py', 'tests/test_app.py'],
    }),
  })
  render(<App />)
  const notice = await screen.findByText(/is now 2 commits ahead/)
  expect(notice.textContent).toBe(
    'feature is now 2 commits ahead of the reviewed head. This review stays at 2222222; run xen in the repository to review the new head.',
  )
  expect(screen.getByText(/Uncommitted changes/).textContent).toBe(
    'Uncommitted changes to app.py, src/lib.py and tests/test_app.py are not included: the review shows committed changes only.',
  )
  expect(screen.getByTitle(review.head).textContent).toBe('2222222222')
})

test('says when the reviewed branch was rewritten or deleted, and nothing when all is as it was', async () => {
  serve({
    '/api/review': json(review),
    '/api/target/status': json({ moved: { branch: 'feature', tip: 'x', ahead: null }, uncommitted: [] }),
  })
  render(<App />)
  expect(await screen.findByText(/was rewritten and no longer contains the reviewed head/)).toBeDefined()
  cleanup()
  serve({ '/api/review': json(review), '/api/target/status': json({ moved: { branch: 'feature', tip: null, ahead: null }, uncommitted: [] }) })
  render(<App />)
  expect(await screen.findByText(/feature no longer exists/)).toBeDefined()
  cleanup()
  const fetch = serve({ '/api/review': json(review), '/api/target/status': json({ moved: null, uncommitted: [] }) })
  render(<App />)
  await screen.findByText('feature against main')
  await vi.waitFor(() => {
    expect(fetch.mock.calls.some(([url]) => url === '/api/target/status')).toBe(true)
  })
  expect(document.querySelector('.targetnotice')).toBeNull()
})
