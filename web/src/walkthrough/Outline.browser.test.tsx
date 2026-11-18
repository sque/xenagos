// Tasks 6.5 and 6.8: the header row, the outline, the transport and its keyboard equivalents, and pausing when the
// reviewer wanders off, in real Chromium inside the whole viewer.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import { FakeSocket } from '../agent/fakeSocket'
import { App } from '../App'
import type { Plan } from '../generated/types'
import '../index.css'

const review = { id: 'r', repo: '/r', label: 'feature against main', base: 'b'.repeat(40), head: 'h'.repeat(40), branch: 'feature', style: 'default', voice: { enabled: false, provider: 'browser', name: null, speed: 1 } }
const lines = (n: number, name: string) => Array.from({ length: n }, (_, i) => `${name}_${String(i + 1)} = ${String(i)}`).join('\n') + '\n'
const a = lines(200, 'a')
const q = lines(40, 'q')
const explanation =
  'An error or a timeout now ends only the batch that caused it, and the loop goes on collecting the next batch, so one slow handler no longer holds up every caller that queued work behind it.'
const plan: Plan = {
  orientation: { problem: 'One failing batch stops the whole loop.', source: 'inferred' },
  sections: [
    {
      title: 'Fail the batch, not the loop',
      role: 'core',
      explanation,
      hunks: ['a.py:h1'],
      steps: [
        { narration: 'The call is wrapped here. It used to be bare.', form: 'lines', target: { path: 'a.py', startLine: 10, endLine: 12 } },
        { narration: 'The queue is untouched. It still hands out batches.', form: 'lines', target: { path: 'q.py', startLine: 3, endLine: 4 } },
        { narration: 'Collecting stays as it was. Nothing here changed.', form: 'lines', target: { path: 'a.py', startLine: 150, endLine: 152 } },
      ],
      visuals: [],
    },
    {
      title: 'Tests for both paths',
      role: 'support',
      explanation: 'Two tests pin the new behaviour.',
      hunks: [],
      steps: [{ narration: 'Back to the wrapped call.', form: 'box', target: { path: 'a.py', startLine: 11, endLine: 11 } }],
      visuals: [],
    },
  ],
}
const routes: Record<string, unknown> = {
  '/api/review': review,
  '/api/plan': plan,
  '/api/coverage': { hunks: 0, files: 0, categories: [] },
  '/api/tree': { files: ['a.py', 'q.py'], changed: [], visited: ['a.py', 'q.py'] },
  '/api/changes': [
    { path: 'a.py', oldPath: null, status: 'modified', binary: false, hunks: [{ id: 'a.py:h1', baseStart: 10, baseCount: 3, headStart: 10, headCount: 3 }] },
  ],
  '/api/agent': { state: 'none' },
  '/api/file?path=a.py': { path: 'a.py', oldPath: null, status: 'modified', binary: false, base: a, head: a.replace('a_11 = 10', 'a_11 = 99') },
  '/api/file?path=q.py': { path: 'q.py', oldPath: null, status: 'unchanged', binary: false, base: q, head: q },
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

const outline = () => screen.getByRole('navigation', { name: 'Walkthrough' })
const steps = () => [...outline().querySelectorAll<HTMLElement>('.steps > li')]
const states = () => steps().map((li) => li.className)
const position = () => document.querySelector('.stagebar .position')?.textContent
const filePath = () => document.querySelector('.filebar .filepath')?.textContent
const shadow = () => document.querySelector('.codepanel diffs-container')?.shadowRoot ?? null
const key = (k: string, target: Element = document.body) => fireEvent.keyDown(target, { key: k })

async function open() {
  await page.viewport(1440, 900)
  render(<App />)
  await screen.findByRole('heading', { name: 'Fail the batch, not the loop' })
  await vi.waitFor(() => {
    expect(filePath()).toBe('a.py')
  })
}

test('header row: title, positions, one-line explanation opened in full on request', async () => {
  await open()
  expect(position()).toBe('Section 1 of 2 · Step 1 of 3')
  const text = document.querySelector<HTMLElement>('.stagebar .explanation')
  if (text === null) throw new Error('no explanation')
  const oneLine = text.getBoundingClientRect().height
  expect(getComputedStyle(text).textOverflow).toBe('ellipsis')
  expect(text.scrollWidth).toBeGreaterThan(text.clientWidth)
  fireEvent.click(text)
  expect(text.getAttribute('aria-expanded')).toBe('true')
  expect(text.getBoundingClientRect().height).toBeGreaterThan(oneLine * 1.5)
  expect(text.scrollWidth).toBeLessThanOrEqual(text.clientWidth)
  expect(text.textContent).toBe(explanation)
})

test('outline: problem, sections with roles, current section steps with states and unchanged marks', async () => {
  await open()
  const nav = outline()
  expect(within(nav).getByText('The problem').closest('summary')?.textContent).toBe('The probleminferred from the code')
  expect(within(nav).getByText('One failing batch stops the whole loop.')).toBeDefined()
  const sections = [...nav.querySelectorAll('.sections > li > button')].map((b) => b.textContent)
  expect(sections).toEqual(['1Fail the batch, not the loopcore', '2Tests for both pathssupport'])
  expect(steps().map((li) => li.querySelector('.title')?.textContent)).toEqual([
    'The call is wrapped here.',
    'The queue is untouched.',
    'Collecting stays as it was.',
  ])
  expect(steps().map((li) => li.querySelector('.note:not(.now)')?.textContent ?? '')).toEqual(['', 'unchanged', 'unchanged'])
  expect(states()).toEqual(['upcoming', 'upcoming', 'upcoming'])

  // Choosing the third step goes to its target with spotlight and caption.
  fireEvent.click(within(nav).getByText('Collecting stays as it was.'))
  await vi.waitFor(() => {
    expect(states()).toEqual(['done', 'done', 'current'])
    expect(document.querySelector('.codepanel diffs-container')?.shadowRoot?.querySelector('.xen-caption')?.textContent).toContain(
      'Collecting stays as it was.',
    )
  })
  expect(position()).toBe('Section 1 of 2 · Step 3 of 3')
  expect(steps()[2]?.getAttribute('aria-current')).toBe('step')
  const mark = shadow()?.querySelector('.xen-mark')?.getBoundingClientRect()
  const view = document.querySelector('.scroller')?.getBoundingClientRect()
  expect(mark && view && mark.top >= view.top && mark.bottom <= view.bottom).toBe(true)

  // The last step ends the section; once the reviewer moves on, the outline says it is done.
  await vi.waitFor(
    () => {
      expect(states()).toEqual(['done', 'done', 'done'])
    },
    { timeout: 5000 },
  )
  fireEvent.click(within(nav).getByText('Tests for both paths'))
  await vi.waitFor(() => {
    expect(position()).toBe('Section 2 of 2 · Step 1 of 1')
  })
  expect([...nav.querySelectorAll('.sections > li > button .note')].map((n) => n.textContent)).toEqual(['done', 'support'])
  expect(steps()).toHaveLength(1)
})

test('transport and keyboard: next, previous, play and pause, replay; keys in a text field are left alone', async () => {
  await open()
  const label = () => document.querySelector('.transport .icon.primary')?.getAttribute('aria-label')
  expect(label()).toBe('Play')
  key(' ')
  await vi.waitFor(() => {
    expect(label()).toBe('Pause')
  })
  key('k')
  await vi.waitFor(() => {
    expect(label()).toBe('Resume')
  })
  key('ArrowRight')
  await vi.waitFor(() => {
    expect(position()).toBe('Section 1 of 2 · Step 2 of 3')
    expect(filePath()).toBe('q.py')
    expect(shadow()?.querySelector('.xen-caption[data-shown]')?.textContent).toContain('The queue is untouched.')
  })
  // The caption's text stays inside its box: a width rounded down once let this caption's last word fall out.
  const caption = shadow()?.querySelector<HTMLElement>('.xen-caption')
  expect(caption && caption.scrollHeight <= caption.clientHeight).toBe(true)
  key('l')
  await vi.waitFor(() => {
    expect(position()).toBe('Section 1 of 2 · Step 3 of 3')
  })
  key('j')
  key('ArrowLeft')
  await vi.waitFor(() => {
    expect(position()).toBe('Section 1 of 2 · Step 1 of 3')
    expect(filePath()).toBe('a.py')
  })
  key('r')
  await vi.waitFor(() => {
    expect(label()).toBe('Pause')
  })
  const field = document.createElement('textarea')
  document.body.append(field)
  try {
    key('ArrowRight', field)
    key(' ', field)
    expect(position()).toBe('Section 1 of 2 · Step 1 of 3')
    expect(label()).toBe('Pause')
  } finally {
    field.remove()
  }
  const next = screen.getByRole('button', { name: 'Next step' })
  expect(next.getAttribute('title')).toBe('Next step (→ or L)')
  fireEvent.click(next)
  await vi.waitFor(() => {
    expect(position()).toBe('Section 1 of 2 · Step 2 of 3')
  })
  expect(screen.getByRole('button', { name: 'Previous step' }).hasAttribute('disabled')).toBe(false)
})

test('scrolling or clicking in the code pauses at the step, and resume returns to its target', async () => {
  await open()
  fireEvent.click(within(outline()).getByText('Collecting stays as it was.'))
  await screen.findByRole('button', { name: 'Pause' })
  await vi.waitFor(() => {
    expect(shadow()?.querySelector('.xen-mark')).toBeTruthy()
  })
  const scroller = document.querySelector<HTMLElement>('.scroller')
  if (scroller === null) throw new Error('no scroller')
  fireEvent.wheel(scroller, { deltaY: -400 })
  await screen.findByRole('button', { name: 'Resume' })
  expect(position()).toBe('Section 1 of 2 · Step 3 of 3')
  scroller.scrollTop = 0
  await vi.waitFor(() => {
    expect(shadow()?.querySelector('.xen-mark')).toBeFalsy()
  })
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
  await vi.waitFor(() => {
    const mark = shadow()?.querySelector('.xen-mark')?.getBoundingClientRect()
    const view = scroller.getBoundingClientRect()
    expect(mark && mark.top >= view.top && mark.bottom <= view.bottom).toBe(true)
  })
  expect(screen.getByRole('button', { name: 'Pause' })).toBeDefined()
  fireEvent.pointerDown(scroller)
  await screen.findByRole('button', { name: 'Resume' })
  expect(states()).toEqual(['done', 'done', 'current'])
})

test('stepping back while the next file fades in leaves the shown file visible', async () => {
  await open()
  key('l')
  await new Promise((resolve) => setTimeout(resolve, 60))
  key('j')
  await vi.waitFor(() => {
    expect(position()).toBe('Section 1 of 2 · Step 1 of 3')
    expect(shadow()?.querySelector('.xen-caption[data-shown]')?.textContent).toContain('The call is wrapped here.')
  })
  expect(filePath()).toBe('a.py')
  expect(document.querySelector<HTMLElement>('.codepanel')?.style.opacity).toBe('1')
})

test('after browsing, the walkthrough opens again at the step it was on', async () => {
  await open()
  fireEvent.click(within(outline()).getByText('Collecting stays as it was.'))
  await vi.waitFor(() => {
    expect(position()).toBe('Section 1 of 2 · Step 3 of 3')
  })
  fireEvent.click(screen.getByRole('button', { name: 'Browse' }))
  await vi.waitFor(() => {
    expect(document.querySelector('.stagebar')).toBeNull()
  })
  fireEvent.click(screen.getByRole('button', { name: 'Walkthrough' }))
  await vi.waitFor(() => {
    expect(position()).toBe('Section 1 of 2 · Step 3 of 3')
    expect(filePath()).toBe('a.py')
  })
  expect(states()).toEqual(['done', 'done', 'upcoming'])
  expect(document.querySelector('.transport .icon.primary')?.getAttribute('aria-label')).toBe('Play')
})
