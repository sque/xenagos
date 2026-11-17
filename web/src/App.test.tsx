import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { App } from './App'

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
}

function serve(routes: Record<string, Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => Promise.resolve(routes[url]?.clone() ?? new Response('', { status: 404 }))),
  )
}

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
