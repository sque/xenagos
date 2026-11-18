// Task 6.9 in the whole viewer: a voice that sends text off the machine is disclosed before its first use in a
// review, and a failing voice is reported once while playback goes on with captions.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { FakeSocket } from '../agent/fakeSocket'
import { App } from '../App'
import type { Plan } from '../generated/types'
import '../index.css'

const lines = Array.from({ length: 40 }, (_, i) => `a_${String(i + 1)} = ${String(i)}`).join('\n') + '\n'
const plan: Plan = {
  orientation: { problem: 'A loop stops on the first error.', source: 'inferred' },
  sections: [
    {
      title: 'Keep the loop alive',
      role: 'core',
      explanation: 'An error ends only its batch.',
      hunks: [],
      steps: [
        { narration: 'The call is wrapped here.', form: 'lines', target: { path: 'a.py', startLine: 3, endLine: 3 } },
        { narration: 'The loop goes on.', form: 'lines', target: { path: 'a.py', startLine: 20, endLine: 20 } },
      ],
      visuals: [],
    },
  ],
}
let voiceAnswer: () => Response
const review = (offMachine: boolean) => ({
  id: `voice-${String(offMachine)}`,
  repo: '/r',
  label: 'feature against main',
  base: 'b'.repeat(40),
  head: 'h'.repeat(40),
  branch: 'feature',
  style: 'default',
  voice: { enabled: true, provider: 'command', name: null, speed: 1, offMachine },
})
let current = review(true)

beforeEach(() => {
  FakeSocket.all = []
  vi.stubGlobal('WebSocket', FakeSocket)
  localStorage.clear()
  const routes: Record<string, () => Response> = {
    '/api/review': () => Response.json(current),
    '/api/plan': () => Response.json(plan),
    '/api/coverage': () => Response.json({ hunks: 0, files: 0, categories: [] }),
    '/api/tree': () => Response.json({ files: ['a.py'], changed: [], visited: ['a.py'] }),
    '/api/changes': () => Response.json([]),
    '/api/agent': () => Response.json({ state: 'none' }),
    '/api/file?path=a.py': () => Response.json({ path: 'a.py', oldPath: null, status: 'unchanged', binary: false, base: lines, head: lines }),
    'POST /api/voice': () => voiceAnswer(),
  }
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const route = routes[init?.method === 'POST' ? `POST ${url}` : url]
      return Promise.resolve(route?.() ?? new Response('', { status: 404 }))
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const voiceCalls = () =>
  (fetch as unknown as { mock: { calls: [string, RequestInit | undefined][] } }).mock.calls.filter(([url]) => url === '/api/voice')

async function open() {
  await page.viewport(1440, 900)
  await userEvent.click(document.body)
  render(<App />)
  await screen.findByRole('heading', { name: 'Keep the loop alive' })
  await vi.waitFor(() => {
    expect(document.querySelector('.filebar .filepath')?.textContent).toBe('a.py')
  })
}

test('an off-machine voice is disclosed before first use and stays silent until accepted', async () => {
  current = review(true)
  voiceAnswer = () => new Response('', { status: 502 })
  await open()
  const notice = await screen.findByRole('alertdialog')
  expect(notice.textContent).toContain('Narration is spoken by the configured voice command, which sends the text')
  fireEvent.click(screen.getByRole('button', { name: 'Play' }))
  await screen.findByRole('button', { name: 'Pause' })
  await new Promise((resolve) => setTimeout(resolve, 300))
  expect(voiceCalls()).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: 'Speak it' }))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(localStorage.getItem('xenagos.voice-disclosed.voice-true')).toBe('yes')
  fireEvent.click(screen.getByRole('button', { name: 'Replay step' }))
  await vi.waitFor(() => {
    expect(voiceCalls().length).toBeGreaterThan(0)
  })
  const bodies = voiceCalls().map(([, init]) => JSON.parse(init?.body as string) as unknown)
  expect(bodies).toContainEqual({ text: 'The call is wrapped here.', voice: null, speed: 1 })
})

test('keeping voice off answers the disclosure, and a voice on the machine needs none', async () => {
  current = review(true)
  await open()
  fireEvent.click(await screen.findByRole('button', { name: 'Keep voice off' }))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Narration' }))
  expect(screen.getByRole('button', { name: 'Speak the narration' }).getAttribute('aria-pressed')).toBe('false')
  cleanup()
  current = review(false)
  await open()
  expect(screen.queryByRole('alertdialog')).toBeNull()
})

test('a failing voice is reported once, and the steps go on with captions', async () => {
  current = review(false)
  voiceAnswer = () => Response.json({ detail: 'the voice command failed with status 3: no model' }, { status: 502 })
  await open()
  fireEvent.click(screen.getByRole('button', { name: 'Play' }))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('The voice failed: the voice command failed with status 3: no model. Playing with captions only.')
  await vi.waitFor(
    () => {
      expect(document.querySelector('.stagebar .position')?.textContent).toBe('Section 1 of 1 · Step 2 of 2')
    },
    { timeout: 5000 },
  )
  expect(screen.getAllByRole('alert')).toHaveLength(1)
  // Step 2's audio was asked for ahead, then step 1's; once the voice failed, nothing more.
  expect(voiceCalls()).toHaveLength(2)
})
