// Section visuals in the whole viewer (spec: section-visuals, "Section without a visual", "Collapse to read code")
// and code shown out of turn by the agent (spec: agent-link, "Answer that points"), in real Chromium.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import { FakeSocket } from '../agent/fakeSocket'
import { App } from '../App'
import type { Plan } from '../generated/types'
import '../index.css'

const review = { id: 'visual', repo: '/r', label: 'feature against main', base: 'b'.repeat(40), head: 'h'.repeat(40), branch: 'feature', style: 'default', voice: { enabled: false, provider: 'browser', name: null, speed: 1, offMachine: false } }
const lines = (n: number, name: string) => Array.from({ length: n }, (_, i) => `${name}_${String(i + 1)} = ${String(i)}`).join('\n') + '\n'
const plan: Plan = {
  orientation: { problem: 'A loop stops on the first error.', source: 'inferred' },
  sections: [
    {
      title: 'How one batch flows',
      role: 'core',
      explanation: 'A picture of one batch.',
      hunks: [],
      steps: [{ narration: 'Here is the flow.', form: 'lines', target: { path: 'a.py', startLine: 2, endLine: 2 } }],
      visuals: [{ id: 'flow', title: 'One batch', html: '<p id="collect">collect</p><p id="run">run</p>', elements: [{ id: 'collect' }, { id: 'run' }] }],
    },
    {
      title: 'Where errors stop',
      role: 'consequence',
      explanation: 'No picture here.',
      hunks: [],
      steps: [{ narration: 'Only code here.', form: 'lines', target: { path: 'a.py', startLine: 4, endLine: 4 } }],
      visuals: [],
    },
  ],
}
const routes: Record<string, unknown> = {
  '/api/review': review,
  '/api/plan': plan,
  '/api/coverage': { hunks: 0, files: 0, categories: [] },
  '/api/tree': { files: ['a.py', 'callers.py'], changed: [], visited: ['a.py'] },
  '/api/changes': [],
  '/api/agent': { state: 'none' },
  '/api/file?path=a.py': { path: 'a.py', oldPath: null, status: 'unchanged', binary: false, base: lines(30, 'a'), head: lines(30, 'a') },
  '/api/file?path=callers.py': { path: 'callers.py', oldPath: null, status: 'unchanged', binary: false, base: lines(300, 'c'), head: lines(300, 'c') },
}

beforeEach(() => {
  history.replaceState(null, '', location.pathname)
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

const height = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().height ?? 0
const shadow = () => document.querySelector('.codepanel diffs-container')?.shadowRoot ?? null

async function open() {
  await page.viewport(1440, 900)
  render(<App />)
  await screen.findByRole('heading', { name: 'How one batch flows' })
  await vi.waitFor(() => {
    expect(document.querySelector('.filebar .filepath')?.textContent).toBe('a.py')
  })
}

test('the visual sits above the code, collapses and opens again, and is gone in a section without one', async () => {
  await open()
  const pane = screen.getByRole('region', { name: 'Section visual' })
  expect(pane.getBoundingClientRect().bottom).toBeLessThanOrEqual(document.querySelector('.codepanel')?.getBoundingClientRect().top ?? 0)
  const withVisual = height('.codepanel')
  fireEvent.click(within(pane).getByRole('button', { name: 'Collapse' }))
  await vi.waitFor(() => {
    expect(height('.codepanel')).toBeGreaterThan(withVisual + 100)
  })
  expect(pane.querySelector('iframe')).toBeNull()
  fireEvent.click(within(pane).getByRole('button', { name: 'Show visual' }))
  await vi.waitFor(() => {
    expect(pane.querySelector('iframe')).not.toBeNull()
    expect(Math.abs(height('.codepanel') - withVisual)).toBeLessThan(2)
  })
  fireEvent.click(screen.getByText('Where errors stop'))
  await vi.waitFor(() => {
    expect(screen.queryByRole('region', { name: 'Section visual' })).toBeNull()
  })
  expect(height('.codepanel')).toBeGreaterThan(withVisual + 100)
})

test('code the agent points at opens and is spotlighted, and playback pauses', async () => {
  await open()
  fireEvent.click(screen.getByRole('button', { name: 'Play' }))
  await screen.findByRole('button', { name: 'Pause' })
  const [socket] = FakeSocket.all
  socket?.receive(JSON.stringify({ type: 'show', target: { path: 'callers.py', side: 'head', startLine: 250, endLine: 252 }, form: 'box' }))
  await vi.waitFor(() => {
    expect(document.querySelector('.filebar .filepath')?.textContent).toBe('callers.py')
    const mark = shadow()?.querySelector<HTMLElement>('.xen-mark')
    expect(mark?.dataset.form).toBe('box')
    const row = shadow()?.querySelector('[data-content] > [data-line="250"]')
    const view = document.querySelector('.scroller')?.getBoundingClientRect()
    const box = mark?.getBoundingClientRect()
    expect(row).toBeTruthy()
    expect(box && view && box.top >= view.top && box.bottom <= view.bottom).toBe(true)
  }, { timeout: 4000 })
  expect(screen.getByRole('button', { name: 'Resume' })).toBeDefined()
})
