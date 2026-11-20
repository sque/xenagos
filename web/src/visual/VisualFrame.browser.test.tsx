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

const wide = `<pre class="mermaid">graph LR
  a[Collect the batch] --> b[Validate each row] --> c[Normalise the names] --> d[Resolve duplicates]
  d --> e[Write the records] --> f[Notify the owners] --> g[Archive the input] --> h[Report the totals]</pre>`

/** Script for a visual: posts `xenagos.view()` as `probe` once the frame is ready, then runs `then` (frame code). */
function probeView(then = '') {
  return `<script>
    const view = (name, extra) => parent.postMessage({ probe: name, view: xenagos.view(), ...extra }, '*')
    const press = (which) => document.querySelector('[data-xen-zoom="' + which + '"]').click()
    window.addEventListener('xenagos:ready', () => { ${then} })
  </script>`
}

test('a wide Mermaid diagram opens fitted, and the buttons zoom in, out and back to fit', async () => {
  const seen = messages()
  show({
    id: 'zoom',
    html:
      wide +
      probeView(`
      const stage = document.querySelector('.xen-stage').getBoundingClientRect()
      const inside = stage.left >= -0.5 && stage.top >= -0.5 && stage.right <= innerWidth + 0.5 && stage.bottom <= innerHeight + 0.5
      view('start', { inside })
      for (const which of ['in', 'out', 'in', 'fit']) { press(which); view(which) }`),
    elements: [],
  })
  await vi.waitFor(() => { expect(seen.data.filter((d) => d.probe === 'fit')).toHaveLength(1); }, { timeout: 8000 })
  const get = (name: string) => seen.data.find((d) => d.probe === name) as { view: { scale: number }; inside?: boolean }
  const fit = get('start').view.scale
  expect(fit).toBeLessThan(1)
  expect(get('start').inside).toBe(true)
  const scales = ['in', 'out', 'in', 'fit'].map((name) => get(name).view.scale)
  const want = [fit * 1.25, fit, fit * 1.25, fit]
  scales.forEach((scale, i) => { expect(Math.abs(scale - (want[i] as number))).toBeLessThan(0.001); })
  seen.stop()
})

// One node: even two nodes (360 wide as LR, 152 high as TD) do not fit the 300 x 150 test frame.
test('a diagram smaller than its pane stays at natural size', async () => {
  const seen = messages()
  show({
    id: 'small',
    html: `<pre class="mermaid">graph LR
  a[One]</pre>` + probeView(`view('start')`),
    elements: [],
  })
  await vi.waitFor(() => { expect(seen.data.find((d) => d.probe === 'start')).toBeDefined(); }, { timeout: 8000 })
  expect((seen.data.find((d) => d.probe === 'start') as { view: { scale: number } }).view.scale).toBe(1)
  seen.stop()
})

test('a resized frame refits until the reviewer zooms', async () => {
  const seen = messages()
  show({
    id: 'resize',
    html:
      wide +
      probeView(`
      view('start')
      window.addEventListener('message', (event) => {
        if (event.data && event.data.step === 'zoom') { press('in'); view('zoomed') }
        if (event.data && event.data.step === 'report') view(event.data.name)
      })
      parent.postMessage({ probe: 'armed' }, '*')`),
    elements: [],
  })
  await vi.waitFor(() => { expect(seen.data.find((d) => d.probe === 'armed')).toBeDefined(); }, { timeout: 8000 })
  const frame = document.querySelector('iframe.visualframe') as HTMLIFrameElement
  const scale = (name: string) => (seen.data.find((d) => d.probe === name) as { view: { scale: number } }).view.scale
  const settle = () => new Promise((resolve) => setTimeout(resolve, 150))
  const ask = (step: string, name?: string) => frame.contentWindow?.postMessage({ step, name }, '*')
  const start = scale('start')
  frame.style.width = '600px'
  frame.style.height = '300px'
  await settle()
  ask('report', 'refit')
  await vi.waitFor(() => { expect(seen.data.find((d) => d.probe === 'refit')).toBeDefined(); })
  expect(scale('refit')).toBeGreaterThan(start)
  expect(scale('refit')).toBeLessThanOrEqual(1)
  ask('zoom')
  await vi.waitFor(() => { expect(seen.data.find((d) => d.probe === 'zoomed')).toBeDefined(); })
  frame.style.width = '300px'
  frame.style.height = '150px'
  await settle()
  ask('report', 'after')
  await vi.waitFor(() => { expect(seen.data.find((d) => d.probe === 'after')).toBeDefined(); })
  expect(scale('after')).toBeCloseTo(scale('zoomed'), 3)
  seen.stop()
})

test('a spotlight on a node out of view centres it, keeping the zoom', async () => {
  const seen = messages()
  const visual: Visual = {
    id: 'reveal',
    html:
      `<pre class="mermaid">graph LR
  first[First step] --> second[Second step] --> third[Third step] --> fourth[Fourth step] --> far[Far step]</pre>` +
      probeView(`
      for (let i = 0; i < 3; i++) press('in')
      window.addEventListener('message', (event) => {
        if (!event.data || event.data.type !== 'spotlight' || !event.data.element) return
        requestAnimationFrame(() => {
          const box = document.querySelector('g[id*="flowchart-far-"]').getBoundingClientRect()
          const inside = box.left >= -0.5 && box.top >= -0.5 && box.right <= innerWidth + 0.5 && box.bottom <= innerHeight + 0.5
          view('revealed', { inside })
        })
      })
      view('zoomed')`),
    elements: [{ id: 'far', link: linked }],
  }
  const { rerender } = render(<VisualFrame visual={visual} spot={null} onLink={vi.fn()} onSelect={vi.fn()} />)
  await vi.waitFor(() => { expect(seen.data.find((d) => d.probe === 'zoomed')).toBeDefined(); }, { timeout: 8000 })
  rerender(<VisualFrame visual={visual} spot={{ element: 'far', form: 'box' }} onLink={vi.fn()} onSelect={vi.fn()} />)
  await vi.waitFor(() => { expect(seen.data.find((d) => d.probe === 'revealed')).toBeDefined(); }, { timeout: 8000 })
  const get = (name: string) => seen.data.find((d) => d.probe === name) as { view: { scale: number }; inside?: boolean }
  expect(get('revealed').inside).toBe(true)
  expect(get('revealed').view.scale).toBe(get('zoomed').view.scale)
  seen.stop()
})

test('a visual that is not a diagram is left as it is', async () => {
  const seen = messages()
  show({
    id: 'plain',
    html: `<input type="range"><div style="height:600px">tall</div><script>
      window.addEventListener('xenagos:ready', () => {
        parent.postMessage({ probe: 'plain', view: xenagos.view(), wrapped: !!document.querySelector('.xen-viewport') }, '*')
      })
    </script>`,
    elements: [],
  })
  await vi.waitFor(() => { expect(seen.data.find((d) => d.probe === 'plain')).toBeDefined(); })
  expect(seen.data.find((d) => d.probe === 'plain')).toMatchObject({ view: null, wrapped: false })
  seen.stop()
})

test('a body that is only an svg is zoomable, and an svg beside other elements is left as it is', async () => {
  const seen = messages()
  const report = (name: string) => `<script>
    window.addEventListener('xenagos:ready', () => {
      const stage = document.querySelector('.xen-stage')
      const box = stage ? stage.getBoundingClientRect() : null
      parent.postMessage({
        probe: '${name}',
        view: xenagos.view(),
        inside: !!box && box.left >= -0.5 && box.top >= -0.5 && box.right <= innerWidth + 0.5 && box.bottom <= innerHeight + 0.5,
        buttons: [...document.querySelectorAll('.xen-zoom > button')].map((b) => b.getAttribute('data-xen-zoom') + ':' + b.getAttribute('aria-label')),
      }, '*')
    })
  </script>`
  const drawing = '<svg viewBox="0 0 900 300" width="900" height="300"><rect width="900" height="300" fill="teal"/></svg>'
  show({ id: 'lone', html: `${drawing}${report('lone')}`, elements: [] })
  show({ id: 'mixed', html: `<p>Text</p>${drawing}${report('mixed')}`, elements: [] })
  await vi.waitFor(() => {
    expect(seen.data.find((d) => d.probe === 'lone')).toBeDefined()
    expect(seen.data.find((d) => d.probe === 'mixed')).toBeDefined()
  })
  const lone = seen.data.find((d) => d.probe === 'lone') as { view: { scale: number }; inside: boolean; buttons: string[] }
  expect(lone.view.scale).toBeLessThan(1)
  expect(lone.inside).toBe(true)
  expect(lone.buttons).toEqual(['out:Zoom out', 'fit:Fit', 'in:Zoom in'])
  expect(seen.data.find((d) => d.probe === 'mixed')).toMatchObject({ view: null, buttons: [] })
  seen.stop()
})

test('a lone svg with only a viewBox, or a percentage width, opens fitted with a stage that has size', async () => {
  const seen = messages()
  const report = (name: string) => `<script>
    window.addEventListener('xenagos:ready', () => {
      const stage = document.querySelector('.xen-stage')
      const box = stage ? stage.getBoundingClientRect() : null
      parent.postMessage({ probe: '${name}', view: xenagos.view(), w: box ? box.width : 0, h: box ? box.height : 0,
        inside: !!box && box.left >= -0.5 && box.top >= -0.5 && box.right <= innerWidth + 0.5 && box.bottom <= innerHeight + 0.5 }, '*')
    })
  </script>`
  const rect = '<rect width="900" height="300" fill="teal"/>'
  show({ id: 'vb', html: `<svg viewBox="0 0 900 300">${rect}</svg>${report('vb')}`, elements: [] })
  show({ id: 'pct', html: `<svg width="100%" viewBox="0 0 900 300">${rect}</svg>${report('pct')}`, elements: [] })
  await vi.waitFor(() => {
    expect(seen.data.find((d) => d.probe === 'vb')).toBeDefined()
    expect(seen.data.find((d) => d.probe === 'pct')).toBeDefined()
  })
  for (const name of ['vb', 'pct']) {
    const got = seen.data.find((d) => d.probe === name) as { view: { scale: number } | null; w: number; h: number; inside: boolean }
    expect(got.view).not.toBeNull()
    expect(got.w).toBeGreaterThan(10)
    expect(got.h).toBeGreaterThan(10)
    expect(got.inside).toBe(true)
  }
  seen.stop()
})

test('a lone svg in a frame that is laid out only later still opens fitted with zoom', async () => {
  const seen = messages()
  const report = `<script>
    window.addEventListener('xenagos:ready', () => parent.postMessage({ probe: 'late', view: xenagos.view() }, '*'))
  </script>`
  const visual = { id: 'late', html: `<svg viewBox="0 0 900 300"><rect width="900" height="300" fill="teal"/></svg>${report}`, elements: [] }
  render(
    <div data-testid="pane" style={{ display: 'none' }}>
      <VisualFrame visual={visual} spot={null} onLink={vi.fn()} onSelect={vi.fn()} />
    </div>,
  )
  await new Promise((resolve) => setTimeout(resolve, 400))
  screen.getByTestId('pane').style.display = 'block'
  await vi.waitFor(() => {
    expect(seen.data.find((d) => d.probe === 'late')).toBeDefined()
  })
  expect((seen.data.find((d) => d.probe === 'late') as { view: unknown }).view).not.toBeNull()
  seen.stop()
})

test('a diagram mixed with text or controls is left as it is, and Mermaid keeps its own sizing', async () => {
  const seen = messages()
  const report = (name: string) => `<script>
    window.addEventListener('xenagos:ready', () => {
      const svg = document.querySelector('.mermaid svg')
      parent.postMessage({ probe: '${name}', view: xenagos.view(), wrapped: !!document.querySelector('.xen-viewport'),
        maxWidth: svg ? svg.style.maxWidth : null }, '*')
    })
  </script>`
  const small = `<pre class="mermaid">graph LR
  a[One]</pre>`
  show({ id: 'text', html: `<h2>Title</h2>${small}<p>After</p>${report('text')}`, elements: [] })
  show({ id: 'input', html: `${small}<input type="range">${report('input')}`, elements: [] })
  await vi.waitFor(() => {
    expect(seen.data.find((d) => d.probe === 'text')).toBeDefined()
    expect(seen.data.find((d) => d.probe === 'input')).toBeDefined()
  }, { timeout: 8000 })
  expect(seen.data.find((d) => d.probe === 'text')).toMatchObject({ view: null, wrapped: false })
  expect((seen.data.find((d) => d.probe === 'text') as { maxWidth: string }).maxWidth).not.toBe('')
  expect(seen.data.find((d) => d.probe === 'input')).toMatchObject({ view: null, wrapped: false })
  seen.stop()
})

const node = `const node = document.querySelector('g[id*="flowchart-a-"]')
    const click = (extra) => node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...extra }))
    const viewport = document.querySelector('.xen-viewport')
    const pointer = (type, x, y) => viewport.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, clientX: x, clientY: y }))`

test('dragging moves the diagram, and a drag over a node does not open its code', async () => {
  const seen = messages()
  const { onLink } = show({
    id: 'drag',
    html:
      wide +
      probeView(`
    ${node}
    view('start')
    pointer('pointerdown', 50, 50)
    pointer('pointermove', 150, 90)
    pointer('pointerup', 150, 90)
    click()
    view('dragged')
    press('in')
    window.addEventListener('message', (event) => { if (event.data && event.data.step === 'click') click() })
    parent.postMessage({ probe: 'swallowed' }, '*')`),
    elements: [{ id: 'a', link: linked }],
  })
  await vi.waitFor(() => { expect(seen.data.find((d) => d.probe === 'swallowed')).toBeDefined(); }, { timeout: 8000 })
  const get = (name: string) => (seen.data.find((d) => d.probe === name) as { view: { x: number; y: number } }).view
  expect(get('dragged').x - get('start').x).toBeCloseTo(100, 3)
  expect(get('dragged').y - get('start').y).toBeCloseTo(40, 3)
  await new Promise((resolve) => setTimeout(resolve, 100))
  expect(onLink).not.toHaveBeenCalled()
  const frame = document.querySelector('iframe.visualframe') as HTMLIFrameElement
  frame.contentWindow?.postMessage({ step: 'click' }, '*')
  await vi.waitFor(() => { expect(onLink).toHaveBeenCalledTimes(1); })
  expect(onLink.mock.calls[0]?.[0]).toBe('a')
  seen.stop()
})

test('Ctrl and the wheel zoom around the pointer; the wheel alone moves', async () => {
  const seen = messages()
  show({
    id: 'wheel',
    html:
      wide +
      probeView(`
    const viewport = document.querySelector('.xen-viewport')
    const wheel = (extra) => viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ...extra }))
    view('start')
    wheel({ deltaY: -100, ctrlKey: true, clientX: 120, clientY: 60 })
    view('zoomed')
    wheel({ deltaX: 20, deltaY: 50 })
    view('moved')
    parent.postMessage({ probe: 'done' }, '*')`),
    elements: [],
  })
  await vi.waitFor(() => { expect(seen.data.find((d) => d.probe === 'done')).toBeDefined(); }, { timeout: 8000 })
  type V = { scale: number; x: number; y: number }
  const get = (name: string) => (seen.data.find((d) => d.probe === name) as { view: V }).view
  const [start, zoomed, moved] = [get('start'), get('zoomed'), get('moved')]
  expect(zoomed.scale).toBeCloseTo(Math.min(8, start.scale * Math.exp(1)), 5)
  expect(Math.abs((120 - start.x) / start.scale - (120 - zoomed.x) / zoomed.scale)).toBeLessThan(0.5)
  expect(Math.abs((60 - start.y) / start.scale - (60 - zoomed.y) / zoomed.scale)).toBeLessThan(0.5)
  expect(moved.x).toBeCloseTo(zoomed.x - 20, 5)
  expect(moved.y).toBeCloseTo(zoomed.y - 50, 5)
  expect(moved.scale).toBe(zoomed.scale)
  seen.stop()
})

test('Shift+click after zooming selects the node with its drawn box', async () => {
  const seen = messages()
  const { onSelect } = show({
    id: 'shift',
    html:
      // The middle node, so that its zoomed box stays inside the 300 x 150 frame (the viewer clamps boxes to it).
      `<pre class="mermaid">graph LR
  x[Before] --> a[Middle] --> y[After]</pre>` +
      probeView(`
    ${node}
    press('in')
    const drawn = node.getBoundingClientRect()
    click({ shiftKey: true })
    parent.postMessage({ probe: 'drawn', width: drawn.width }, '*')`),
    elements: [{ id: 'a', link: linked }],
  })
  await vi.waitFor(() => { expect(seen.data.find((d) => d.probe === 'drawn')).toBeDefined(); }, { timeout: 8000 })
  await vi.waitFor(() => { expect(onSelect).toHaveBeenCalledTimes(1); })
  const width = (seen.data.find((d) => d.probe === 'drawn') as { width: number }).width
  const [id, box] = onSelect.mock.calls[0] as [string, { left: number; right: number }]
  expect(id).toBe('a')
  expect(Math.abs(box.right - box.left - width)).toBeLessThan(0.5)
  seen.stop()
})
