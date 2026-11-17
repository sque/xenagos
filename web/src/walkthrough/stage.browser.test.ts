// Task 6.7 in headless Chromium: what a step does to the code view.

import { afterEach, expect, test } from 'vitest'
import { CodeView, type FileSides } from '../codeview/codeView'
import { Overlay } from '../codeview/overlay'
import { CodeStage } from './stage'

const lines = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `const ${tag}${String(i + 1)} = ${String(i)}`)
const A = lines(400, 'a')
const B_BASE = lines(2000, 'b')
const B_HEAD = [...B_BASE.slice(0, 1500), 'const inserted = true', ...B_BASE.slice(1500)]
const FILES: Record<string, FileSides> = {
  'a.ts': { path: 'a.ts', base: A.join('\n') + '\n', head: A.join('\n') + '\n' }, // untouched by the change
  'b.ts': { path: 'b.ts', base: B_BASE.join('\n') + '\n', head: B_HEAD.join('\n') + '\n' },
}

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  document.body.replaceChildren()
})

function setup() {
  const panel = document.createElement('div')
  panel.style.cssText = 'position:relative;height:600px;width:1000px'
  const scroller = document.createElement('div')
  scroller.style.cssText = 'position:absolute;inset:0;overflow:auto'
  const content = document.createElement('div')
  scroller.append(content)
  panel.append(scroller)
  document.body.append(panel)
  const holder: { overlay?: Overlay } = {}
  const view = new CodeView(scroller, content, () => holder.overlay?.onRender())
  const overlay = new Overlay(view)
  holder.overlay = overlay
  const opened: string[] = []
  const stage = new CodeStage(view, overlay, (path) => Promise.resolve(FILES[path] as FileSides), panel, (f) => opened.push(f.path))
  cleanup = () => {
    view.destroy()
  }
  return { view, overlay, stage, scroller, opened, signal: new AbortController().signal }
}

const intersects = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

test('a step in a file not yet open opens it and brings a far target into view', async () => {
  const s = setup()
  await s.stage.showFile('a.ts', s.signal)
  await s.stage.showFile('b.ts', s.signal)
  expect(s.opened).toEqual(['a.ts', 'b.ts'])
  const target = { path: 'b.ts', startLine: 1501, endLine: 1501 }
  await s.stage.bringIntoView(target, s.signal)
  s.stage.spotlight(target, 'box')
  await s.stage.caption('I added one flag here.', s.signal)
  await new Promise((r) => setTimeout(r, 50))
  const mark = s.overlay.markElement()?.getBoundingClientRect()
  const caption = s.overlay.captionElement()?.getBoundingClientRect()
  const viewport = s.scroller.getBoundingClientRect()
  expect(mark).toBeDefined()
  expect(caption).toBeDefined()
  if (mark === undefined || caption === undefined) return
  expect(mark.top).toBeGreaterThanOrEqual(viewport.top)
  expect(mark.bottom).toBeLessThanOrEqual(viewport.bottom)
  expect(intersects(mark, caption)).toBe(false)
  expect(caption.top).toBeGreaterThanOrEqual(viewport.top)
  expect(caption.bottom).toBeLessThanOrEqual(viewport.bottom)
  expect(s.overlay.captionElement()?.hasAttribute('data-shown')).toBe(true)
})

test('a step on code the change did not touch is spotlighted', async () => {
  const s = setup()
  await s.stage.showFile('a.ts', s.signal)
  const target = { path: 'a.ts', side: 'base' as const, startLine: 300, endLine: 304 }
  await s.stage.bringIntoView(target, s.signal)
  s.stage.spotlight(target, 'lines')
  const mark = s.overlay.markElement()?.getBoundingClientRect()
  const rows = s.view.rows('base', 300, 304)
  expect(rows).toHaveLength(5)
  expect(mark && Math.abs(mark.top - (rows[0]?.getBoundingClientRect().top ?? 0))).toBeLessThan(0.5)
})

test('the caption sits beside a target at the bottom edge without covering it', async () => {
  const s = setup()
  await s.stage.showFile('b.ts', s.signal)
  s.scroller.scrollTop = (s.view.linePosition('head', 1501)?.top ?? 0) - 560
  await new Promise((r) => setTimeout(r, 100))
  const target = { path: 'b.ts', startLine: 1501, endLine: 1501, startCol: 1, endCol: 14 }
  s.stage.spotlight(target, 'box')
  await s.stage.caption('A caption long enough to need room. '.repeat(3), s.signal)
  const mark = s.overlay.markElement()?.getBoundingClientRect()
  const caption = s.overlay.captionElement()?.getBoundingClientRect()
  expect(mark && caption && intersects(mark, caption)).toBe(false)
})

test('hiding the caption keeps the spotlight', async () => {
  const s = setup()
  await s.stage.showFile('b.ts', s.signal)
  const target = { path: 'b.ts', startLine: 5, endLine: 6 }
  s.stage.spotlight(target, 'lines')
  await s.stage.caption('Look here.', s.signal)
  s.stage.hideCaption()
  expect(s.overlay.captionElement()?.hasAttribute('data-shown')).toBe(false)
  expect(s.overlay.markElement()).not.toBeNull()
  await s.stage.caption(null, s.signal)
  expect(s.overlay.captionElement()).toBeNull()
})
