// Task 6.4: the repository explorer's marks, views and following, in real Chromium inside the whole viewer.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import { FakeSocket } from '../agent/fakeSocket'
import { App } from '../App'
import type { ChangedEntry, Plan, RepositoryTree } from '../generated/types'
import '../index.css'

const review = { id: 'r', repo: '/r', label: 'feature against main', base: 'b'.repeat(40), head: 'h'.repeat(40), branch: 'feature', style: 'default', voice: { enabled: false, provider: 'browser', name: null, speed: 1 } }
const text = (name: string) => Array.from({ length: 30 }, (_, i) => `${name}_${String(i + 1)} = ${String(i)}`).join('\n') + '\n'
const entry = (path: string, status: ChangedEntry['status'], extra: Partial<ChangedEntry> = {}): ChangedEntry => ({
  path,
  oldPath: null,
  status,
  binary: false,
  category: 'code',
  covered: 'all',
  ...extra,
})
const tree: RepositoryTree = {
  files: [
    'README.md',
    'lib/util/helpers.py',
    'lib/util/other.py',
    'scheduler/batch.py',
    'scheduler/errors.py',
    'scheduler/legacy_retry.py',
    'scheduler/queue.py',
    'scheduler/settings.py',
    'tests/test_batch.py',
    'uv.lock',
  ],
  changed: [
    entry('scheduler/batch.py', 'modified'),
    entry('scheduler/errors.py', 'added'),
    entry('scheduler/legacy_retry.py', 'deleted', { covered: 'none' }),
    entry('scheduler/settings.py', 'modified', { covered: 'none' }),
    entry('tests/test_batch.py', 'modified'),
    entry('uv.lock', 'modified', { category: 'generated' }),
  ],
  visited: ['lib/util/helpers.py', 'scheduler/batch.py'],
}
const plan: Plan = {
  orientation: { problem: 'A loop stops on the first error.', source: 'inferred' },
  sections: [
    {
      title: 'Fail the batch, not the loop',
      role: 'core',
      explanation: 'An error ends only its batch.',
      hunks: ['scheduler/batch.py:h1', 'scheduler/errors.py:h1', 'tests/test_batch.py:h1', 'uv.lock:h1'],
      steps: [
        { narration: 'The call is wrapped here.', form: 'lines', target: { path: 'scheduler/batch.py', startLine: 5, endLine: 5 } },
        { narration: 'This helper is unchanged.', form: 'lines', target: { path: 'lib/util/helpers.py', startLine: 3, endLine: 3 } },
      ],
      visuals: [],
    },
  ],
}
const file = (path: string, status: string) => ({ path, oldPath: null, status, binary: false, base: text(path), head: text(path) })
const routes: Record<string, unknown> = {
  '/api/review': review,
  '/api/plan': plan,
  '/api/coverage': { hunks: 0, files: 0, categories: [] },
  '/api/tree': tree,
  '/api/agent': { state: 'none' },
  '/api/file?path=scheduler%2Fbatch.py': file('scheduler/batch.py', 'modified'),
  '/api/file?path=scheduler%2Ferrors.py': { ...file('scheduler/errors.py', 'added'), base: null },
  '/api/file?path=lib%2Futil%2Fhelpers.py': file('lib/util/helpers.py', 'unchanged'),
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

const row = (path: string) => document.querySelector<HTMLElement>(`.tree li[data-path="${path}"]`)
const button = (path: string) => {
  const found = row(path)?.querySelector<HTMLButtonElement>(':scope > button')
  if (found == null) throw new Error(`no row for ${path}`)
  return found
}
const colour = (variable: string) => {
  const probe = document.createElement('span')
  probe.style.color = `var(${variable})`
  document.body.append(probe)
  const value = getComputedStyle(probe).color
  probe.remove()
  return value
}

async function open() {
  await page.viewport(1440, 900)
  render(<App />)
  await vi.waitFor(() => {
    expect(row('scheduler/batch.py')?.getAttribute('aria-current')).toBe('true')
  })
}

test('marks changed, deleted, generated and visited files, and folders holding changes', async () => {
  await open()
  const name = (path: string) => button(path).querySelector('.name') as HTMLElement
  const letter = (path: string) => button(path).querySelector('.letter')?.textContent
  expect([letter('scheduler/batch.py'), letter('scheduler/errors.py'), letter('scheduler/legacy_retry.py')]).toEqual(['M', 'A', 'D'])
  expect(getComputedStyle(name('scheduler/batch.py')).color).toBe(colour('--tick-modified'))
  expect(getComputedStyle(name('scheduler/errors.py')).color).toBe(colour('--tick-added'))
  const deleted = getComputedStyle(name('scheduler/legacy_retry.py'))
  expect([deleted.color, deleted.textDecorationLine]).toEqual([colour('--tick-deleted'), 'line-through'])
  // Generated: labelled and dimmed.
  expect(button('uv.lock').textContent).toContain('generated')
  expect(Number(getComputedStyle(name('uv.lock')).opacity)).toBeLessThan(1)
  // Visited and unchanged: labelled, no change letter. The current file says so.
  expect(button('lib/util/helpers.py').textContent).toContain('visited')
  expect(letter('lib/util/helpers.py')).toBeUndefined()
  expect(button('scheduler/batch.py').textContent).toContain('you are here')
  // A folder holding changes is marked, also when collapsed.
  expect(button('scheduler').querySelector('.changedot')).not.toBeNull()
  expect(button('lib/util').querySelector('.changedot')).toBeNull()
  fireEvent.click(button('scheduler'))
  expect(button('scheduler').getAttribute('aria-expanded')).toBe('false')
  expect(row('scheduler/errors.py')).toBeNull()
  expect(button('scheduler').querySelector('.changedot')).not.toBeNull()
  // Changed files no section covers are listed by name.
  expect(document.querySelector('.treelegend .uncovered')?.textContent).toBe(
    'Changed but not in this walkthrough: legacy_retry.py, settings.py',
  )
})

test('narrow view by default with hidden counts; whole view on request', async () => {
  await open()
  expect(row('README.md')).toBeNull()
  expect(row('scheduler/queue.py')).toBeNull()
  expect(button('scheduler').querySelector('.more')?.textContent).toBe('1 more')
  expect(button('lib/util').querySelector('.more')?.textContent).toBe('1 more')
  expect(document.querySelector('.treefoot')?.textContent).toBe('3 unchanged files hidden · show all')
  fireEvent.click(screen.getByRole('button', { name: 'All' }))
  expect(row('README.md')).not.toBeNull()
  expect(row('scheduler/queue.py')).not.toBeNull()
  expect(button('scheduler').querySelector('.more')).toBeNull()
  expect(document.querySelector('.treefoot')?.textContent).toBe('10 files · changed and visited only')
})

test('follows the narrator into a collapsed folder', async () => {
  await open()
  fireEvent.click(button('lib/util'))
  expect(row('lib/util/helpers.py')).toBeNull()
  fireEvent.click(screen.getByText('This helper is unchanged.'))
  await vi.waitFor(() => {
    expect(row('lib/util/helpers.py')?.getAttribute('aria-current')).toBe('true')
  })
  expect(button('lib/util').getAttribute('aria-expanded')).toBe('true')
  expect(row('scheduler/batch.py')?.getAttribute('aria-current')).toBeNull()
})

test('choosing a file pauses playback, and resume returns to the step', async () => {
  await open()
  fireEvent.click(screen.getByRole('button', { name: 'Play' }))
  await screen.findByRole('button', { name: 'Pause' })
  fireEvent.click(button('scheduler/errors.py'))
  await screen.findByRole('button', { name: 'Resume' })
  await vi.waitFor(() => {
    expect(document.querySelector('.filebar .filepath')?.textContent).toBe('scheduler/errors.py')
    expect(row('scheduler/errors.py')?.getAttribute('aria-current')).toBe('true')
  })
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
  await vi.waitFor(() => {
    expect(document.querySelector('.filebar .filepath')?.textContent).toBe('scheduler/batch.py')
  })
})
