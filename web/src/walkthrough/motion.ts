// Our own eased scroll (design decision 5a): the virtualised view has no scroll-to-line, and native smooth
// scrolling took 1.7 s where this takes 0.6 s (spike 2.6).

export function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

/** Grows with distance and is capped near 600 ms; zero under reduced motion. */
export function scrollDuration(distance: number): number {
  if (reducedMotion()) return 0
  return Math.min(600, 180 + Math.abs(distance) * 0.12)
}

export function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason as Error)
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason as Error)
      },
      { once: true },
    )
  })
}

/** Scroll `element` vertically to `to`, eased. Resolves when done; rejects when `signal` aborts. */
export function animateScroll(element: HTMLElement, to: number, signal?: AbortSignal): Promise<void> {
  const from = element.scrollTop
  const duration = scrollDuration(to - from)
  if (duration === 0 || Math.abs(to - from) < 1) {
    element.scrollTop = to
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    const start = performance.now()
    const frame = (now: number) => {
      if (signal?.aborted) {
        reject(signal.reason as Error)
        return
      }
      const t = Math.min(1, (now - start) / duration)
      element.scrollTop = from + (to - from) * easeInOutCubic(t)
      if (t < 1) requestAnimationFrame(frame)
      else resolve()
    }
    requestAnimationFrame(frame)
  })
}
