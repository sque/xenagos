import { afterEach, expect, test, vi } from 'vitest'
import { animateScroll, scrollDuration } from './motion'

afterEach(() => {
  vi.unstubAllGlobals()
})

const prefers = (reduce: boolean) => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query.includes('reduce') }))
}

test('scroll duration grows with distance and is capped near 600 ms', () => {
  prefers(false)
  expect(scrollDuration(100)).toBeLessThan(scrollDuration(1000))
  expect(scrollDuration(100_000)).toBe(600)
})

test('under reduced motion every scroll is immediate', async () => {
  prefers(true)
  expect(scrollDuration(5000)).toBe(0)
  const element = { scrollTop: 0 } as HTMLElement
  await animateScroll(element, 4200)
  expect(element.scrollTop).toBe(4200)
})
