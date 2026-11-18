// The walkthrough layout at the widths the task names (6.2), and below them, in real Chromium.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import { FakeSocket } from '../agent/fakeSocket'
import { App } from '../App'
import type { Plan } from '../generated/types'
import '../index.css'

const review = { id: 'r', repo: '/r', label: 'feature against main', base: 'b'.repeat(40), head: 'h'.repeat(40), branch: 'feature', style: 'default', voice: { enabled: false, provider: 'browser', name: null, speed: 1 } }
const text = Array.from({ length: 80 }, (_, i) => `line_${String(i + 1)} = ${String(i)}`).join('\n') + '\n'
const plan: Plan = {
  orientation: { problem: 'A long loop stops on the first error.', source: 'inferred' },
  sections: [
    {
      title: 'Keep the loop alive when one batch fails',
      role: 'core',
      explanation: 'An error now ends only the batch that caused it, and the loop goes on collecting the next one.',
      hunks: ['a.py:h1'],
      steps: [{ narration: 'Here the call is wrapped.', form: 'box', target: { path: 'a.py', startLine: 10, endLine: 12 } }],
      visuals: [],
    },
  ],
}
const routes: Record<string, unknown> = {
  '/api/review': review,
  '/api/plan': plan,
  '/api/agent': { state: 'none' },
  '/api/changes': [
    { path: 'a.py', oldPath: null, status: 'modified', binary: false, hunks: [] },
    { path: 'gone.py', oldPath: null, status: 'deleted', binary: false, hunks: [] },
  ],
  '/api/file?path=a.py': { path: 'a.py', oldPath: null, status: 'modified', binary: false, base: text, head: text.replace('line_11 = 10', 'line_11 = 99') },
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
  try {
    localStorage.removeItem('xenagos.outline-split')
  } catch {
    // no storage: nothing to reset
  }
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const box = (selector: string) => {
  const element = document.querySelector(selector)
  if (element === null) throw new Error(`no ${selector}`)
  return element.getBoundingClientRect()
}

async function showAt(width: number, height: number) {
  await page.viewport(width, height)
  render(<App />)
  await screen.findByRole('heading', { name: 'Keep the loop alive when one batch fails' })
  await vi.waitFor(() => {
    expect(document.querySelector('.filebar .filepath')?.textContent).toBe('a.py')
  })
}

const WIDTHS: [number, number][] = [
  [1280, 800],
  [1440, 900],
]
for (const [width, height] of WIDTHS) {
  test(`three columns side by side at ${String(width)} wide`, async () => {
    await showAt(width, height)
    const [explorer, middle, right] = [box('.explorer'), box('.middle'), box('.right')]
    expect(explorer.left).toBe(0)
    expect(Math.round(middle.left)).toBe(Math.round(explorer.right))
    expect(Math.round(right.left)).toBe(Math.round(middle.right))
    expect(Math.round(right.right)).toBe(width)
    expect(middle.width).toBeGreaterThan(width * 0.45)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
    // The header row keeps its controls inside the middle column.
    const transport = box('.transport')
    expect(transport.right).toBeLessThanOrEqual(middle.right)
    expect(box('.stagebar .heading').right).toBeLessThanOrEqual(transport.left)
    // Outline above the agent in the right column, with the divider between them.
    const [outline, divider, agent] = [box('.outline'), box('.divider'), box('.agentslot')]
    expect(outline.top).toBeLessThan(divider.top)
    expect(divider.bottom).toBeLessThanOrEqual(agent.top + 0.5)
    expect(screen.getByText('Here the call is wrapped.')).toBeDefined()
    expect(screen.getByText('No agent session yet.', { exact: false })).toBeDefined()
  })
}

test('the divider moves between outline and agent, by pointer and by keyboard', async () => {
  await showAt(1440, 900)
  const right = box('.right')
  const divider = document.querySelector<HTMLElement>('.divider')
  if (divider === null) throw new Error('no divider')
  const before = box('.outline').height
  fireEvent.pointerDown(divider, { pointerId: 1, clientY: box('.divider').top })
  window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientY: right.top + right.height * 0.25 }))
  window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }))
  await vi.waitFor(() => {
    expect(Math.abs(box('.outline').height - right.height * 0.25)).toBeLessThan(4)
  })
  expect(box('.outline').height).toBeLessThan(before)
  fireEvent.keyDown(divider, { key: 'ArrowDown' })
  await vi.waitFor(() => {
    expect(Math.abs(box('.outline').height - right.height * 0.3)).toBeLessThan(4)
  })
  expect(divider.getAttribute('aria-valuenow')).toBe('30')
})

test('below 1100 wide the explorer folds away and opens over the code on request', async () => {
  await showAt(900, 800)
  expect(getComputedStyle(document.querySelector('.explorer') as Element).display).toBe('none')
  expect(Math.round(box('.middle').left)).toBe(0)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(900)
  fireEvent.click(screen.getByText('Files'))
  await vi.waitFor(() => {
    expect(box('.explorer').width).toBeGreaterThan(200)
  })
  expect(screen.getByText('gone.py')).toBeDefined()
})

test('the outline names the style the walkthrough was narrated in and asks for new wording', async () => {
  routes['/api/plan'] = { ...plan, style: { name: 'default', hash: 'abc' } }
  routes['/api/review'] = { ...review, style: 'terse' }
  try {
    await showAt(1440, 900)
    expect(screen.getByText('Narrated in default · active style: terse')).toBeDefined()
    fireEvent.click(screen.getByText('Rewrite the narration'))
    await vi.waitFor(() => {
      const calls = (fetch as unknown as { mock: { calls: [string, RequestInit | undefined][] } }).mock.calls
      const call = calls.find(([url]) => url === '/api/agent/request')
      expect(JSON.parse(call?.[1]?.body as string)).toEqual({ kind: 'narration' })
    })
  } finally {
    routes['/api/plan'] = plan
    routes['/api/review'] = review
  }
})
