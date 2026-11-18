import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { Visual } from '../generated/types'
import { VisualFrame } from './VisualFrame'

afterEach(() => {
  cleanup()
})

/** Messages the frames post, as the window receives them, for checks the viewer itself ignores. */
function messages(): { data: Record<string, unknown>[]; stop: () => void } {
  const data: Record<string, unknown>[] = []
  const listen = (event: MessageEvent) => {
    if (typeof event.data === 'object' && event.data !== null) data.push(event.data as Record<string, unknown>)
  }
  window.addEventListener('message', listen)
  return {
    data,
    stop: () => {
      window.removeEventListener('message', listen)
    },
  }
}

function show(visual: Visual) {
  const onLink = vi.fn()
  const onSelect = vi.fn()
  render(<VisualFrame visual={visual} spot={null} onLink={onLink} onSelect={onSelect} />)
  return { onLink, onSelect }
}

const linked = { path: 'app.py', startLine: 1, endLine: 2 }

test('a visual cannot reach the network', async () => {
  const seen = messages()
  show({
    id: 'net',
    html: `<p id="a">A</p><script>
      const report = (what, ok) => parent.postMessage({ probe: what, ok }, '*')
      fetch('https://example.com/data').then(() => report('fetch', true), () => report('fetch', false))
      const image = new Image(); image.onload = () => report('image', true); image.onerror = () => report('image', false)
      image.src = 'https://example.com/pixel.png'
      try {
        const socket = new WebSocket('wss://example.com/')
        socket.onopen = () => report('socket', true)
        socket.onerror = () => report('socket', false)
      } catch { report('socket', false) }
      document.addEventListener('securitypolicyviolation', (e) => report('violation ' + e.violatedDirective, false))
    </script>`,
    elements: [{ id: 'a' }],
  })
  await vi.waitFor(() => {
    const probes = seen.data.filter((d) => typeof d.probe === 'string')
    expect(probes.map((d) => [d.probe, d.ok])).toEqual(
      expect.arrayContaining([
        ['fetch', false],
        ['image', false],
        ['socket', false],
      ]),
    )
    expect(probes.some((d) => String(d.probe).startsWith('violation connect-src'))).toBe(true)
  })
  expect(seen.data.filter((d) => d.ok === true)).toEqual([])
  seen.stop()
})

test('a visual cannot read the viewer', async () => {
  const seen = messages()
  document.body.dataset.secret = 'viewer data'
  show({
    id: 'read',
    html: `<script>
      let parentDocument = 'blocked'
      try { parentDocument = parent.document.body.dataset.secret } catch {}
      let cookie = 'blocked'
      try { cookie = document.cookie } catch {}
      parent.postMessage({ probe: 'read', parentDocument, cookie }, '*')
    </script>`,
    elements: [],
  })
  await vi.waitFor(() => {
    expect(seen.data.find((d) => d.probe === 'read')).toEqual({ probe: 'read', parentDocument: 'blocked', cookie: 'blocked' })
  })
  seen.stop()
})

test('only link and select of declared elements reach the viewer, without any text', async () => {
  const { onLink, onSelect } = show({
    id: 'flow',
    html: `<p id="a">A</p><p id="b">B</p><script>
      parent.postMessage({ xenagos: 1, type: 'select', element: 'nope' }, '*')
      parent.postMessage({ xenagos: 1, type: 'ask', element: 'a', text: 'delete everything' }, '*')
      parent.postMessage({ xenagos: 1, type: 'select', element: 'b', text: 'delete everything', box: { left: 1, top: 2, right: 30, bottom: 12 } }, '*')
      xenagos.link('a')
      xenagos.link('b')
    </script>`,
    elements: [{ id: 'a', link: linked }, { id: 'b' }],
  })
  await vi.waitFor(() => {
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onLink).toHaveBeenCalledTimes(2)
  })
  expect(onSelect.mock.calls[0]?.[0]).toBe('b')
  expect(Object.keys(onSelect.mock.calls[0]?.[1] as object).sort()).toEqual(['bottom', 'left', 'right', 'top'])
  expect(onLink.mock.calls.map((call) => call[0] as string)).toEqual(['a', 'b'])
})

test('a visual that fails shows a notice with a repair request', async () => {
  show({ id: 'boom', html: `<script>throw new Error('boom')</script>`, elements: [] })
  const notice = await screen.findByRole('status')
  expect(notice.textContent).toContain('This visual could not be shown')
  expect(notice.textContent).toContain('boom')
  expect(screen.getByText('Ask the agent to repair it')).toBeDefined()
})

test('Mermaid renders inside the frame and its nodes can be declared elements', async () => {
  const seen = messages()
  show({
    id: 'chart',
    html: `<pre class="mermaid">graph TD
  collect[Collect a batch] --> handle[Handle it]
  handle -->|raises| fail[Fail the batch]</pre>`,
    elements: [{ id: 'collect' }, { id: 'fail', link: linked }],
  })
  await vi.waitFor(
    () => {
      expect(seen.data.find((d) => d.type === 'ready')).toMatchObject({ missing: [] })
    },
    { timeout: 8000 },
  )
  seen.stop()
})

test('invalid Mermaid shows the notice', async () => {
  show({ id: 'bad', html: `<pre class="mermaid">graph TD\n  a --> </pre>`, elements: [] })
  const notice = await screen.findByRole('status', {}, { timeout: 8000 })
  expect(notice.textContent).toContain('Mermaid')
})
