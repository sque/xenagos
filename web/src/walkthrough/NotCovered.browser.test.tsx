// Task 6.13: the hunks a plan leaves out are listed in walkthrough mode with files and line counts, and each can be
// opened. Real Chromium, because opening scrolls the code view and draws the spotlight.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import { FakeSocket } from '../agent/fakeSocket'
import { App } from '../App'
import type { Coverage, Plan } from '../generated/types'
import '../index.css'

const review = { id: 'r', repo: '/r', label: 'feature against main', base: 'b'.repeat(40), head: 'h'.repeat(40), branch: 'feature', style: 'default', voice: { enabled: false, provider: 'browser', name: null, speed: 1 } }
const lines = (n: number, name: string) => Array.from({ length: n }, (_, i) => `${name}_${String(i + 1)} = ${String(i)}`).join('\n') + '\n'
const a = lines(40, 'a')
const b = lines(200, 'b')
// b.py: line 150 replaced by two lines (head 150-151), the only hunk the plan leaves out.
const bHead = b.replace('b_150 = 149\n', 'b_150 = 1490\nb_150b = 1491\n')
const plan: Plan = {
  orientation: { problem: 'A loop stops on the first error.', source: 'inferred' },
  sections: [
    {
      title: 'Keep the loop alive',
      role: 'core',
      explanation: 'An error ends only its batch.',
      hunks: ['a.py:h1'],
      steps: [{ narration: 'Here the call is wrapped.', form: 'box', target: { path: 'a.py', startLine: 10, endLine: 10 } }],
      visuals: [],
    },
  ],
}
const coverage: Coverage = {
  hunks: 1,
  files: 1,
  categories: [
    {
      category: 'code',
      added: 2,
      removed: 1,
      files: [
        {
          path: 'b.py',
          oldPath: null,
          status: 'modified',
          binary: false,
          category: 'code',
          partly: false,
          added: 2,
          removed: 1,
          hunks: [{ id: 'b.py:h1', baseStart: 150, baseCount: 1, headStart: 150, headCount: 2 }],
        },
      ],
    },
  ],
}
const routes: Record<string, unknown> = {
  '/api/review': review,
  '/api/plan': plan,
  '/api/coverage': coverage,
  '/api/agent': { state: 'none' },
  '/api/tree': { files: ['a.py', 'b.py'], changed: [], visited: ['a.py'] },
  '/api/file?path=a.py': { path: 'a.py', oldPath: null, status: 'modified', binary: false, base: a, head: a.replace('a_10 = 9', 'a_10 = 99') },
  '/api/file?path=b.py': { path: 'b.py', oldPath: null, status: 'modified', binary: false, base: b, head: bHead },
}

beforeEach(() => {
  FakeSocket.all = []
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(url in routes ? new Response(JSON.stringify(routes[url])) : new Response('', { status: 404 })),
    ),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const shadow = () => document.querySelector('.codepanel diffs-container')?.shadowRoot ?? null

test('lists the hunk the plan leaves out with its file and line counts, and opens it', async () => {
  await page.viewport(1440, 900)
  render(<App />)
  const list = await screen.findByRole('region', { name: 'Not covered' })
  expect(list.querySelector('h3')?.textContent).toBe('Not covered 1 change in 1 file')
  expect(within(list).getByText('Code').textContent).toBe('Code +2 −1')
  const button = within(list).getByText('b.py').closest('button')
  expect(button?.textContent).toBe('b.py+2 −1')
  await vi.waitFor(() => {
    expect(document.querySelector('.filebar .filepath')?.textContent).toBe('a.py')
  })

  if (button === null) throw new Error('no button for b.py')
  fireEvent.click(button)
  await vi.waitFor(
    () => {
      expect(document.querySelector('.filebar .filepath')?.textContent).toBe('b.py')
      expect(shadow()?.querySelector('.xen-mark')).toBeTruthy()
    },
    { timeout: 4000 },
  )
  // The spotlight covers the two added lines, and they are on screen.
  const rows = [...(shadow()?.querySelectorAll<HTMLElement>('[data-line-type="change-addition"]') ?? [])]
  const added = rows.filter((row) => row.textContent.includes('b_150'))
  expect(added).toHaveLength(2)
  const mark = shadow()?.querySelector('.xen-mark')?.getBoundingClientRect()
  const first = added[0]?.getBoundingClientRect()
  const last = added[1]?.getBoundingClientRect()
  expect(mark && first && Math.abs(mark.top - first.top)).toBeLessThan(0.5)
  expect(mark && last && Math.abs(mark.bottom - last.bottom)).toBeLessThan(0.5)
  const viewport = document.querySelector('.scroller')?.getBoundingClientRect()
  expect(viewport && mark && mark.top >= viewport.top && mark.bottom <= viewport.bottom).toBe(true)
  expect(button.closest('li')?.getAttribute('aria-current')).toBe('true')
})

test('says when every change is covered', async () => {
  routes['/api/coverage'] = { hunks: 0, files: 0, categories: [] }
  try {
    render(<App />)
    expect(await screen.findByText('Every change is covered by a section.')).toBeDefined()
  } finally {
    routes['/api/coverage'] = coverage
  }
})
