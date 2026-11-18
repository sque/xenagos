// Tasks 4.3 to 4.6: browse mode in real Chromium inside the whole viewer, against a fake review server.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { FakeSocket } from '../agent/fakeSocket'
import { App } from '../App'
import type { ChangedFile, CommitInfo } from '../generated/types'
import '../index.css'

const review = { id: 'browse', repo: '/r', label: 'feature against main', base: 'b'.repeat(40), head: 'h'.repeat(40), branch: 'feature', style: 'default', voice: { enabled: false, provider: 'browser', name: null, speed: 1, offMachine: false } }
const numbered = (n: number, name: string) => Array.from({ length: n }, (_, i) => `${name}${String(i + 1)} = ${String(i + 1)}`).join('\n') + '\n'
const batchBase = numbered(400, 'a')
const batchHead = batchBase.replace('a20 = 20\n', 'a20 = 2\na20b = 0\n').replace('a320 = 320\n', 'a320 = 3\n')
const lockHead = numbered(4000, 'pkg')

const file = (path: string, status: ChangedFile['status'], category: ChangedFile['category'], added: number, removed: number, extra: Partial<ChangedFile> = {}): ChangedFile => ({
  path,
  oldPath: null,
  status,
  binary: false,
  hunks: [],
  added,
  removed,
  category,
  ...extra,
})
const combined: ChangedFile[] = [
  file('scheduler/batch.py', 'modified', 'code', 3, 2),
  file('scheduler/errors.py', 'added', 'code', 2, 0),
  file('scheduler/retry.py', 'renamed', 'code', 0, 0, { oldPath: 'scheduler/legacy_retry.py' }),
  file('old.py', 'deleted', 'code', 0, 1),
  file('logo.png', 'modified', 'code', 0, 0, { binary: true }),
  file('tests/test_batch.py', 'modified', 'tests', 1, 1),
  file('uv.lock', 'modified', 'generated', 4000, 0),
  file('scheduler/batch_pb2.py', 'added', 'generated', 12, 0),
]
const commits: CommitInfo[] = [
  { id: '1'.repeat(40), subject: 'Wrap the handler', message: 'Wrap the handler', author: 'Ann', date: '2026-11-10T10:00:00+00:00' },
  { id: '2'.repeat(40), subject: 'Lock the new dependency', message: 'Lock the new dependency\n\nThe timeout helper needs it.', author: 'Ann', date: '2026-11-11T10:00:00+00:00' },
  { id: '3'.repeat(40), subject: 'Tidy', message: 'Tidy', author: 'Ann', date: '2026-11-12T10:00:00+00:00' },
]
const sides = (path: string, status: string, base: string | null, head: string | null) => ({ path, oldPath: null, status, binary: false, base, head })
let routes: Record<string, () => Response>
const calls = () => (fetch as unknown as { mock: { calls: [string, RequestInit | undefined][] } }).mock.calls

beforeEach(() => {
  history.replaceState(null, '', location.pathname)
  FakeSocket.all = []
  vi.stubGlobal('WebSocket', FakeSocket)
  let changes = combined
  routes = {
    '/api/review': () => Response.json(review),
    '/api/plan': () => new Response('', { status: 404 }),
    '/api/agent': () => Response.json({ state: 'none' }),
    '/api/commits': () => Response.json(commits),
    '/api/changes': () => Response.json(changes),
    [`/api/changes?commit=${'2'.repeat(40)}`]: () =>
      Response.json([file('tests/test_batch.py', 'modified', 'tests', 1, 1), file('uv.lock', 'modified', 'generated', 4000, 0)]),
    '/api/file?path=scheduler%2Fbatch.py': () => Response.json(sides('scheduler/batch.py', 'modified', batchBase, batchHead)),
    '/api/file?path=scheduler%2Ferrors.py': () => Response.json(sides('scheduler/errors.py', 'added', null, 'class Failed:\n    pass\n')),
    '/api/file?path=uv.lock': () => Response.json(sides('uv.lock', 'modified', '', lockHead)),
    [`/api/file?path=tests%2Ftest_batch.py&commit=${'2'.repeat(40)}`]: () =>
      Response.json(sides('tests/test_batch.py', 'modified', 'def test(): pass\n', 'def test(): assert True\n')),
    'PUT /api/categories': () => {
      changes = combined.map((f) => (f.path === 'uv.lock' ? { ...f, category: 'code' } : f))
      return Response.json({ 'uv.lock': 'code' })
    },
  }
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const route = routes[init?.method !== undefined && init.method !== 'GET' ? `${init.method} ${url}` : url]
      return Promise.resolve(route?.() ?? new Response('', { status: 404 }))
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const group = (name: string) => screen.getByRole('region', { name })
const row = (path: string) => document.querySelector<HTMLElement>(`.browsefiles li[data-path="${path}"]`)
const choose = (path: string) => {
  const button = row(path)?.querySelector('button')
  if (button == null) throw new Error(`no row for ${path}`)
  fireEvent.click(button)
}
const shadow = () => document.querySelector('.browse .codepanel diffs-container')?.shadowRoot ?? null
const separators = () => [...(shadow()?.querySelectorAll('[data-content] [data-separator]') ?? [])].map((s) => s.textContent)
const heading = () => document.querySelector('.filehead')?.textContent ?? ''

async function open() {
  await page.viewport(1440, 900)
  render(<App />)
  await vi.waitFor(() => {
    expect(row('scheduler/batch.py')?.getAttribute('aria-current')).toBe('true')
    expect(shadow()?.querySelector('[data-line]')).toBeTruthy()
  })
}

test('files grouped by category with counts, folders inside each group, generated diffs not rendered until opened', async () => {
  await open()
  expect(screen.getByRole('button', { name: 'Browse' }).getAttribute('aria-pressed')).toBe('true')
  expect(group('Code').querySelector('h3')?.textContent).toBe('Code · 5 files+5 −3')
  expect(group('Tests').querySelector('h3')?.textContent).toBe('Tests · 1 file+1 −1')
  expect(group('Generated').querySelector('h3')?.textContent).toBe('Generated · 2 files+4012 −0')
  // A folder holding files of two categories appears in both, with only that category's files.
  expect(within(group('Generated')).getByRole('button', { name: /^scheduler\// }).parentElement?.querySelector('li')?.getAttribute('data-path')).toBe(
    'scheduler/batch_pb2.py',
  )
  // One scheduler folder in Code holding its three files, not a flat list of paths.
  const folder = within(group('Code')).getByRole('button', { name: /^scheduler\// })
  expect([...(folder.parentElement?.querySelectorAll(':scope > ul > li') ?? [])].map((li) => li.getAttribute('data-path'))).toEqual([
    'scheduler/batch.py',
    'scheduler/errors.py',
    'scheduler/retry.py',
  ])
  expect(row('uv.lock')?.textContent).toContain('collapsed')
  // The lock file's 4,000 lines are not rendered until the reviewer opens them.
  choose('uv.lock')
  expect(await screen.findByText(/Its diff is not shown until you open it/)).toBeDefined()
  expect(shadow()).toBeNull()
  expect(calls().some(([url]) => url === '/api/file?path=uv.lock')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Show the diff' }))
  await vi.waitFor(() => {
    expect(shadow()?.querySelector('[data-line]')).toBeTruthy()
  })
  expect(row('uv.lock')?.textContent).not.toContain('collapsed')
})

test('a file moved to another category stays there', async () => {
  await open()
  await userEvent.dragAndDrop(row('uv.lock')?.querySelector('button') as Element, group('Code').querySelector('h3') as Element)
  await vi.waitFor(() => {
    expect(row('uv.lock')?.closest('section')?.getAttribute('data-category')).toBe('code')
  })
  const put = calls().find(([url, init]) => url === '/api/categories' && init?.method === 'PUT')
  expect(JSON.parse(put?.[1]?.body as string)).toEqual({ path: 'uv.lock', category: 'code' })
})

test('unified and side by side, and labels for added, renamed, deleted and binary files', async () => {
  await open()
  expect(shadow()?.querySelectorAll('code[data-code]')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Side by side' }))
  await vi.waitFor(() => {
    expect(shadow()?.querySelector('code[data-deletions]')).toBeTruthy()
    expect(shadow()?.querySelector('code[data-additions]')).toBeTruthy()
  })
  expect(heading()).toContain('scheduler/batch.py')
  expect(localStorage.getItem('xenagos.browse-layout')).toBe('split')
  fireEvent.click(screen.getByRole('button', { name: 'Unified' }))
  await vi.waitFor(() => {
    expect(shadow()?.querySelectorAll('code[data-code]')).toHaveLength(1)
  })
  choose('scheduler/errors.py')
  await vi.waitFor(() => {
    expect(heading()).toContain('scheduler/errors.pyadded')
  })
  choose('scheduler/retry.py')
  expect(heading()).toContain('scheduler/legacy_retry.py → scheduler/retry.pyrenamed')
  choose('old.py')
  expect(heading()).toContain('old.pydeleted')
  choose('logo.png')
  expect(heading()).toContain('logo.pngbinary')
  expect(screen.getByText('Binary file modified; its content is not shown.')).toBeDefined()
})

test('a file with two distant hunks expands in steps and in full, and collapses back', async () => {
  await open()
  expect(separators()).toEqual(['15 unmodified lines', '291 unmodified linesExpand all', '76 unmodified lines'])
  // Rows are numbered by the file; the deleted line keeps its own number in browse mode.
  const deleted = shadow()?.querySelector<HTMLElement>('[data-gutter] [data-line-type="change-deletion"] [data-line-number-content]')
  expect(deleted && getComputedStyle(deleted).visibility).toBe('visible')
  const middle = shadow()?.querySelector('[data-gutter] [data-expand-index="1"] [data-expand-up]')
  if (!(middle instanceof HTMLElement)) throw new Error('no expand control')
  // Lines of the fold between the hunks (head lines 26 to 316) appear in steps, not all at once.
  const folded = () =>
    [...(shadow()?.querySelectorAll<HTMLElement>('[data-content] > [data-line]') ?? [])].filter((r) => {
      const line = Number(r.dataset.line)
      return line >= 26 && line <= 316
    }).length
  expect(folded()).toBe(0)
  fireEvent.click(middle)
  await vi.waitFor(() => {
    expect(folded()).toBeGreaterThan(0)
  })
  expect(folded()).toBeLessThan(291)
  fireEvent.click(screen.getByRole('button', { name: 'Expand full file' }))
  await vi.waitFor(() => {
    expect(separators()).toEqual([])
    expect(shadow()?.querySelector('[data-line="1"]')).toBeTruthy()
  })
  // Both hunks keep their marking in the full file.
  const scroller = document.querySelector<HTMLElement>('.browse .scroller')
  if (scroller === null) throw new Error('no scroller')
  scroller.scrollTop = scroller.scrollHeight
  await vi.waitFor(() => {
    expect(shadow()?.querySelector('[data-line="401"]')).toBeTruthy()
    expect([...(shadow()?.querySelectorAll('[data-line-type="change-addition"]') ?? [])].some((r) => r.textContent.includes('a320 = 3'))).toBe(true)
  })
  scroller.scrollTop = 0
  await vi.waitFor(() => {
    expect([...(shadow()?.querySelectorAll('[data-line-type="change-addition"]') ?? [])].some((r) => r.textContent.includes('a20b = 0'))).toBe(true)
  })
  fireEvent.click(screen.getByRole('button', { name: 'Collapse to changes' }))
  await vi.waitFor(() => {
    expect(separators()).toHaveLength(3)
  })
})

test('one commit of three, under its message', async () => {
  await open()
  const showing = screen.getByLabelText('Showing')
  expect([...showing.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
    'All 3 commits together',
    '1. Wrap the handler (1111111)',
    '2. Lock the new dependency (2222222)',
    '3. Tidy (3333333)',
  ])
  fireEvent.change(showing, { target: { value: '2'.repeat(40) } })
  await vi.waitFor(() => {
    expect(row('scheduler/batch.py')).toBeNull()
    expect(row('tests/test_batch.py')?.getAttribute('aria-current')).toBe('true')
  })
  const banner = document.querySelector('.commitbanner')
  expect(banner?.querySelector('.subject')?.textContent).toBe('Lock the new dependency 2222222')
  expect(banner?.querySelector('.body')?.textContent).toBe('The timeout helper needs it.')
  await vi.waitFor(() => {
    expect([...(shadow()?.querySelectorAll('[data-content] [data-line-type="change-addition"]') ?? [])].map((r) => r.textContent)).toEqual([
      'def test(): assert True',
    ])
  })
  fireEvent.change(showing, { target: { value: '' } })
  await vi.waitFor(() => {
    expect(row('scheduler/batch.py')).not.toBeNull()
  })
  expect(document.querySelector('.commitbanner')).toBeNull()
})
