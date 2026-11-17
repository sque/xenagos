// Runs in headless Chromium. Task 6.3 (whole-file view) and task 6.6, the overlay regression check: the measured
// distance between each drawn mark and the text it targets, through scroll, resize, layout switch and expansion,
// as in spikes 1.2 and 2.6. The expected positions are measured here independently of overlay.ts.

import { afterEach, describe, expect, test } from 'vitest'
import { CodeView, type FileSides, type Side, selection } from './codeView'
import { type Mark, Overlay } from './overlay'

const TOLERANCE = 0.5 // px; the spikes measured 0.02
const PAD = { lines: 0, box: 3, circle: 10 }

// base: 3000 lines. head: two lines added after line 10, base line 1800 deleted, base line 2950 replaced by a long
// line with TARGET far to the right. Head numbering: base 11..1799 -> head 13..1801, base 1801..2949 -> 1802..2950,
// the long line is head 2951.
const BASE = Array.from({ length: 3000 }, (_, i) => `const value${String(i + 1)} = compute(${String(i + 1)}) // line`)
const LONG = `const far = "${'x'.repeat(300)}TARGET"`
const HEAD = [...BASE.slice(0, 10), 'const added1 = 1', 'const added2 = 2', ...BASE.slice(10, 1799)]
HEAD.push(...BASE.slice(1800, 2949), LONG, ...BASE.slice(2950))
const FILE: FileSides = { path: 'big.ts', base: BASE.join('\n') + '\n', head: HEAD.join('\n') + '\n' }
const TARGET_COL = LONG.indexOf('TARGET') + 1

interface Setup {
  scroller: HTMLElement
  view: CodeView
  overlay: Overlay
}

let current: Setup | undefined

afterEach(() => {
  current?.view.destroy()
  current = undefined
  document.body.replaceChildren()
})

async function setup(file: FileSides = FILE, expandAll = true): Promise<Setup> {
  const scroller = document.createElement('div')
  scroller.style.cssText = 'height:600px;width:900px;overflow:auto;position:relative'
  const content = document.createElement('div')
  scroller.append(content)
  document.body.append(scroller)
  const holder: { overlay?: Overlay } = {}
  const view = new CodeView(scroller, content, () => holder.overlay?.onRender())
  const overlay = new Overlay(view)
  holder.overlay = overlay
  await view.show(file, { expandAll })
  await settled()
  current = { scroller, view, overlay }
  return current
}

/** Wait until the frame has been rendered and painted. */
function settled(frames = 2): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number) => {
      if (left === 0) {
        setTimeout(resolve, 0)
        return
      }
      requestAnimationFrame(() => {
        step(left - 1)
      })
    }
    step(frames)
  })
}

async function scrollToLine(s: Setup, side: Side, line: number, offset = 150): Promise<void> {
  const position = s.view.linePosition(side, line)
  if (position === undefined) throw new Error(`no position for ${side} ${String(line)}`)
  s.scroller.scrollTop = position.top - offset
  await settled()
}

// --- independent measurement of the target ---

function rowFor(view: CodeView, side: Side, line: number): HTMLElement | null {
  const root = view.root
  if (root === null) return null
  const split = root.querySelectorAll('code[data-code]').length > 1
  if (split) {
    const column = side === 'base' ? 'data-deletions' : 'data-additions'
    return root.querySelector(`code[${column}] [data-content] > [data-line="${String(line)}"]`)
  }
  const selector =
    side === 'head'
      ? `[data-content] > [data-line="${String(line)}"]:not([data-line-type="change-deletion"])`
      : `[data-content] > [data-line-type="change-deletion"][data-line="${String(line)}"],` +
        ` [data-content] > [data-line-type^="context"][data-alt-line="${String(line)}"]`
  return root.querySelector(selector)
}

function charsRect(row: HTMLElement, from: number, to: number | null): DOMRect {
  const nodes: Text[] = []
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) nodes.push(n as Text)
  const text = nodes.map((n) => n.data).join('').replace(/\n$/, '')
  const end = to ?? text.length
  const locate = (index: number): [Text, number] => {
    let offset = 0
    for (const node of nodes) {
      if (index <= offset + node.data.length) return [node, index - offset]
      offset += node.data.length
    }
    throw new Error('column outside the line')
  }
  const range = document.createRange()
  range.setStart(...locate(from - 1))
  range.setEnd(...locate(end))
  return range.getBoundingClientRect()
}

/** Where the mark must be, from the rendered rows, or null when no row of the target is rendered. */
function expected(view: CodeView, mark: Mark): { left: number; top: number; right: number; bottom: number } | null {
  const rows: { line: number; row: HTMLElement }[] = []
  for (let line = mark.startLine; line <= mark.endLine; line++) {
    const row = rowFor(view, mark.side, line)
    if (row !== null) rows.push({ line, row })
  }
  const first = rows[0]
  const last = rows[rows.length - 1]
  if (first === undefined || last === undefined) return null
  const pad = PAD[mark.form]
  const top = first.row.getBoundingClientRect().top - (first.line === mark.startLine ? pad : 0)
  const bottom = last.row.getBoundingClientRect().bottom + (last.line === mark.endLine ? pad : 0)
  if (mark.form === 'lines') {
    const right = Math.max(...rows.map((r) => r.row.getBoundingClientRect().right))
    return { left: first.row.getBoundingClientRect().left, top, right, bottom }
  }
  const boxes = rows.map(({ line, row }) =>
    charsRect(
      row,
      line === mark.startLine && mark.startCol != null ? mark.startCol : 1,
      line === mark.endLine && mark.endCol != null ? mark.endCol : null,
    ),
  )
  return {
    left: Math.min(...boxes.map((b) => b.left)) - pad,
    top,
    right: Math.max(...boxes.map((b) => b.right)) + pad,
    bottom,
  }
}

/** Largest distance, in px, between the drawn mark's edges and where they must be. 0 when the target is not
 * rendered and nothing is drawn; Infinity when one is drawn and the other is not. */
function offset(s: Setup, mark: Mark): number {
  const want = expected(s.view, mark)
  const drawn = s.overlay.markElement()?.getBoundingClientRect() ?? null
  if (want === null || drawn === null) return want === null && drawn === null ? 0 : Infinity
  return Math.max(
    Math.abs(drawn.left - want.left),
    Math.abs(drawn.top - want.top),
    Math.abs(drawn.right - want.right),
    Math.abs(drawn.bottom - want.bottom),
  )
}

const MARKS: Record<string, Mark> = {
  'added block, lines': { side: 'head', startLine: 11, endLine: 12, form: 'lines' },
  'deleted line, circle': { side: 'base', startLine: 1800, endLine: 1800, form: 'circle' },
  'unchanged code at base, box': { side: 'base', startLine: 5, endLine: 6, form: 'box' },
  'far span, box': { side: 'head', startLine: 2951, endLine: 2951, startCol: TARGET_COL, endCol: TARGET_COL + 5, form: 'box' },
  'span over two lines, circle': { side: 'head', startLine: 1500, endLine: 1501, startCol: 7, endCol: 12, form: 'circle' },
  '300-line box across the window': { side: 'head', startLine: 2300, endLine: 2600, form: 'box' },
}

describe('whole-file view (task 6.3)', () => {
  test('shows the change in place: added lines, a deleted line between head lines, unchanged lines', async () => {
    const s = await setup()
    expect(rowFor(s.view, 'head', 11)?.dataset.lineType).toBe('change-addition')
    expect(rowFor(s.view, 'head', 13)?.dataset.altLine).toBe('11')
    await scrollToLine(s, 'base', 1800)
    const deleted = rowFor(s.view, 'base', 1800)
    expect(deleted?.dataset.lineType).toBe('change-deletion')
    expect(deleted?.textContent).toContain('compute(1800)')
    const before = rowFor(s.view, 'head', 1801)?.getBoundingClientRect()
    const after = rowFor(s.view, 'head', 1802)?.getBoundingClientRect()
    const between = deleted?.getBoundingClientRect()
    expect(before && between && after && before.bottom <= between.top && between.bottom <= after.top).toBe(true)
  })

  test('shows a deleted line without a line number', async () => {
    const s = await setup()
    await scrollToLine(s, 'base', 1800)
    const gutter = s.view.root?.querySelector('[data-gutter] [data-line-type="change-deletion"] [data-line-number-content]')
    expect(gutter).not.toBeNull()
    expect(gutter && getComputedStyle(gutter).visibility).toBe('hidden')
    const numbered = s.view.root?.querySelector('[data-gutter] [data-line-type="context"] [data-line-number-content]')
    expect(numbered && getComputedStyle(numbered).visibility).toBe('visible')
  })

  test('does not wrap long lines and scrolls sideways to a far target', async () => {
    const s = await setup()
    await scrollToLine(s, 'head', 2951)
    const row = rowFor(s.view, 'head', 2951)
    expect(row?.getBoundingClientRect().height).toBe(rowFor(s.view, 'head', 2950)?.getBoundingClientRect().height)
    const code = row?.closest('code')
    const visibleRight = () => (code ? code.getBoundingClientRect().left + code.clientWidth : 0)
    expect(row && charsRect(row, TARGET_COL, TARGET_COL + 5).left).toBeGreaterThan(visibleRight())
    s.view.revealColumns('head', 2951, TARGET_COL, TARGET_COL + 5)
    await settled()
    const target = row ? charsRect(row, TARGET_COL, TARGET_COL + 5) : null
    expect(target && target.right).toBeLessThanOrEqual(visibleRight())
    const gutter = code?.querySelector(':scope > [data-gutter]')?.getBoundingClientRect()
    expect(target && gutter && target.left).toBeGreaterThanOrEqual(gutter?.right ?? Infinity)
  })

  test('marks each change beside the scroll track, from line metrics', async () => {
    const s = await setup()
    const ticks = s.view.ticks()
    expect(ticks.map((t) => t.kind)).toEqual(['added', 'deleted', 'modified'])
    const height = s.scroller.scrollHeight
    const expectedTop = [s.view.linePosition('head', 11), s.view.linePosition('base', 1800), s.view.linePosition('head', 2951)]
    ticks.forEach((tick, i) => {
      expect(Math.abs(tick.position * height - (expectedTop[i]?.top ?? 0))).toBeLessThan(height * 0.01)
    })
  })

  test('shows a file the change did not touch', async () => {
    const same = BASE.slice(0, 50).join('\n') + '\n'
    const s = await setup({ path: 'same.ts', base: same, head: same })
    expect(rowFor(s.view, 'head', 1)?.textContent).toContain('compute(1)')
    expect(s.view.rows('base', 20, 20)[0]).toBe(s.view.rows('head', 20, 20)[0])
    expect(s.view.rows('head', 20, 20)[0]?.textContent).toContain('compute(20)')
  })
})

describe('overlay regression check (task 6.6)', () => {
  for (const [name, mark] of Object.entries(MARKS)) {
    test(`${name}: follows its text through scrolling, resize and layout switch`, async () => {
      const s = await setup()
      s.overlay.setMark(mark)
      const check = (state: string) => {
        expect(offset(s, mark), state).toBeLessThan(TOLERANCE)
      }
      check('at the top')

      await scrollToLine(s, mark.side, mark.startLine)
      if (mark.startCol != null) s.view.revealColumns(mark.side, mark.startLine, mark.startCol, mark.endCol ?? null)
      await settled()
      check('after a jump')
      expect(s.overlay.markElement(), 'drawn after a jump').not.toBeNull()

      // An eased scroll away and back, checked on every frame.
      const home = s.scroller.scrollTop
      const away = Math.max(0, home - 1500)
      for (const [from, to] of [[home, away], [away, home]] as const) {
        for (let frame = 1; frame <= 36; frame++) {
          const t = frame / 36
          const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
          s.scroller.scrollTop = from + (to - from) * eased
          await settled(1)
          check(`eased scroll frame ${String(frame)}`)
        }
      }

      s.scroller.style.width = '700px'
      s.scroller.style.height = '450px'
      await settled(3)
      s.overlay.redraw() // the view redraws on resize; done here directly
      check('after resize')

      s.view.setLayout('split')
      await settled(3)
      await scrollToLine(s, mark.side, mark.startLine)
      if (mark.startCol != null) s.view.revealColumns(mark.side, mark.startLine, mark.startCol, mark.endCol ?? null)
      await settled()
      check('in split layout')
      s.view.setLayout('unified')
      await settled(3)
      check('back in unified layout')
    })
  }

  test('a box crossing the rendered window is clamped with an open edge', async () => {
    const s = await setup()
    const mark = MARKS['300-line box across the window'] as Mark
    s.overlay.setMark(mark)
    await scrollToLine(s, 'head', 2300, 400)
    const drawn = s.overlay.markElement()
    expect(drawn).not.toBeNull()
    expect(drawn?.dataset.openBottom).toBe('')
    expect(drawn?.dataset.openTop).toBeUndefined()
    expect(offset(s, mark)).toBeLessThan(TOLERANCE)
  })

  test('follows its text after a collapsed region is expanded', async () => {
    const s = await setup(FILE, false)
    const mark: Mark = { side: 'head', startLine: 20, endLine: 21, startCol: 7, endCol: 13, form: 'box' }
    s.overlay.setMark(mark)
    expect(rowFor(s.view, 'head', 20)).toBeNull()
    expect(s.overlay.markElement()).toBeNull()
    s.view.expand(1, 'up', 30) // the region between the first and second hunks, from its top
    await settled(3)
    expect(rowFor(s.view, 'head', 20)).not.toBeNull()
    expect(offset(s, mark)).toBeLessThan(TOLERANCE)
  })

  test('fails when the redraw after each library render is disabled', async () => {
    const s = await setup()
    const mark = MARKS['deleted line, circle'] as Mark
    s.overlay.setMark(mark)
    await scrollToLine(s, 'base', 1800)
    expect(offset(s, mark)).toBeLessThan(TOLERANCE)
    s.overlay.redrawAfterRender = false
    let worst = 0
    for (let frame = 1; frame <= 20; frame++) {
      s.scroller.scrollTop -= 60
      await settled(1)
      worst = Math.max(worst, offset(s, mark))
    }
    expect(worst).toBeGreaterThan(5)
  })
})

test('a selection names its file, sides and lines in reading order', () => {
  const file = { path: 'app.py', oldPath: 'old.py', base: 'a\n', head: 'b\n' }
  expect(selection(file, { start: 12, side: 'additions', end: 10, endSide: 'additions' })).toEqual({
    path: 'app.py',
    startSide: 'head',
    startLine: 10,
    endSide: 'head',
    endLine: 12,
  })
  expect(selection(file, { start: 4, side: 'deletions', end: 6, endSide: 'additions' })).toEqual({
    path: 'app.py',
    startSide: 'base',
    startLine: 4,
    endSide: 'head',
    endLine: 6,
  })
  expect(selection(file, { start: 3, end: 3 })).toMatchObject({ startSide: 'head', endSide: 'head' })
})
