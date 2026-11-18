// Task 6.10: the narration menu, in real Chromium inside the whole viewer.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { FakeSocket } from '../agent/fakeSocket'
import { App } from '../App'
import type { Plan } from '../generated/types'
import '../index.css'

const lines = Array.from({ length: 40 }, (_, i) => `a_${String(i + 1)} = ${String(i)}`).join('\n') + '\n'
const plan: Plan = {
  orientation: { problem: 'A loop stops on the first error.', source: 'inferred' },
  style: { name: 'default', hash: 'abc' },
  sections: [
    {
      title: 'Keep the loop alive',
      role: 'core',
      explanation: 'An error ends only its batch.',
      hunks: [],
      steps: [{ narration: 'The call is wrapped here.', form: 'lines', target: { path: 'a.py', startLine: 3, endLine: 3 } }],
      visuals: [],
    },
  ],
}
const review = {
  id: 'menu',
  repo: '/r',
  label: 'feature against main',
  base: 'b'.repeat(40),
  head: 'h'.repeat(40),
  branch: 'feature',
  style: 'terse',
  voice: { enabled: true, provider: 'command', name: 'Ava', speed: 1, offMachine: false },
}

beforeEach(() => {
  FakeSocket.all = []
  vi.stubGlobal('WebSocket', FakeSocket)
  const routes: Record<string, () => Response> = {
    '/api/review': () => Response.json(review),
    '/api/plan': () => Response.json(plan),
    '/api/coverage': () => Response.json({ hunks: 0, files: 0, categories: [] }),
    '/api/tree': () => Response.json({ files: ['a.py'], changed: [], visited: ['a.py'] }),
    '/api/changes': () => Response.json([]),
    '/api/agent': () => Response.json({ state: 'none' }),
    '/api/file?path=a.py': () => Response.json({ path: 'a.py', oldPath: null, status: 'unchanged', binary: false, base: lines, head: lines }),
    'POST /api/voice': () => new Response('', { status: 502 }),
    'POST /api/agent/request': () => Response.json({ started: false, session: 's' }),
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

const posted = (url: string) =>
  (fetch as unknown as { mock: { calls: [string, RequestInit | undefined][] } }).mock.calls
    .filter(([u]) => u === url)
    .map(([, init]) => JSON.parse(init?.body as string) as unknown)

test('one menu, two labelled groups: voice (speak, voice, speed) and wording (style, rewrite)', async () => {
  await page.viewport(1440, 900)
  await userEvent.click(document.body)
  render(<App />)
  await screen.findByRole('heading', { name: 'Keep the loop alive' })
  const opener = screen.getByRole('button', { name: 'Narration' })
  // Compact: the transport keeps to icons, the menu's button among them.
  expect(opener.closest('.transport')).not.toBeNull()
  expect(opener.textContent).toBe('')
  fireEvent.click(opener)
  const menu = screen.getByRole('dialog', { name: 'Narration' })
  const voice = within(menu).getByRole('region', { name: 'Voice · how it sounds' })
  const wording = within(menu).getByRole('region', { name: 'Wording · what is said' })
  expect(within(voice).getByRole('button', { name: 'Speak the narration' }).getAttribute('aria-pressed')).toBe('true')
  expect(voice.textContent).toContain('voice command · Ava')
  expect(within(voice).getByLabelText('Speed')).toBeDefined()
  // The style is under wording, not with the voice settings.
  expect(within(wording).getByText('Narration style').nextElementSibling?.textContent).toBe('terse')
  expect(voice.textContent).not.toContain('terse')
  expect(wording.textContent).toContain('This walkthrough was narrated in default.')

  // Speed changes how it sounds: the next audio is asked for at the new speed.
  fireEvent.change(within(voice).getByLabelText('Speed'), { target: { value: '1.25' } })
  fireEvent.click(screen.getByRole('button', { name: 'Play' }))
  await vi.waitFor(() => {
    expect(posted('/api/voice')).toContainEqual({ text: 'The call is wrapped here.', voice: 'Ava', speed: 1.25 })
  })

  // Rewriting the narration is a request to the agent, in the active style.
  fireEvent.click(within(wording).getByRole('button', { name: 'Rewrite the narration in terse' }))
  expect((await within(wording).findByRole('status')).textContent).toContain('fits the style "terse"')
  expect(posted('/api/agent/request')).toEqual([{ kind: 'narration' }])

  // Speaking off: the switch says so and the menu's icon changes.
  fireEvent.click(within(voice).getByRole('button', { name: 'Speak the narration' }))
  expect(within(voice).getByRole('button', { name: 'Speak the narration' }).textContent).toBe('Off')
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: 'Narration' })).toBeNull()
})
