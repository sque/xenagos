// Spotlight and caption drawn over the code (design decisions 5, 5a; spikes 1.2 and 2.6).
//
// One layer is appended to each `code[data-code]` element the library renders. Inside that element the layer moves
// with vertical and horizontal scrolling, so nothing is repositioned on scroll; it is redrawn after every library
// render (rows are recycled) and on resize. Nothing is ever inserted among the row elements: the library's line
// selection fails when it finds a child it did not make.
//
// A target outside the rendered window is not drawn. One that is partly rendered is drawn clamped to the rendered
// rows, with a dashed open edge.

import type { CodeView, Side } from './codeView'
import { textBox } from './text'

export type Form = 'lines' | 'box' | 'circle'

export interface Mark {
  side: Side
  startLine: number
  endLine: number
  startCol?: number | null
  endCol?: number | null
  form: Form
}

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

const PADDING: Record<Form, number> = { lines: 0, box: 3, circle: 10 }
const CAPTION_GAP = 8

export class Overlay {
  private mark: Mark | null = null
  private caption: { text: string; shown: boolean } | null = null
  // Kept across redraws and only moved, so the caption's fade is not restarted by every library render.
  private readonly markEl = document.createElement('div')
  private readonly captionEl = document.createElement('div')
  /** Turned off only by the regression check, to prove that the redraw after each library render is needed. */
  redrawAfterRender = true

  constructor(private readonly view: CodeView) {
    this.markEl.className = 'xen-mark'
    this.captionEl.className = 'xen-caption'
    this.captionEl.setAttribute('role', 'status')
  }

  setMark(mark: Mark | null): void {
    this.mark = mark
    this.redraw()
  }

  setCaption(text: string | null, shown = true): void {
    this.caption = text === null ? null : { text, shown }
    this.redraw()
  }

  /** Called synchronously from the library's post-render hook. */
  onRender(): void {
    if (this.redrawAfterRender) this.redraw()
  }

  /** The drawn mark, if the target is at least partly rendered. */
  markElement(): HTMLElement | null {
    return this.markEl.isConnected ? this.markEl : null
  }

  captionElement(): HTMLElement | null {
    return this.captionEl.isConnected ? this.captionEl : null
  }

  redraw(): void {
    const drawn = this.mark === null ? null : this.drawMark(this.mark)
    if (drawn === null) this.markEl.remove()
    const code = drawn?.code ?? (this.mark === null ? this.view.codeElements()[0] : undefined)
    // No caption without a file, or when the target is outside the rendered window.
    if (this.caption === null || code === undefined) {
      this.captionEl.remove()
      return
    }
    this.drawCaption(code, drawn?.box ?? null, this.caption)
  }

  private drawMark(mark: Mark): { code: HTMLElement; box: Box } | null {
    const rows = this.view.rows(mark.side, mark.startLine, mark.endLine)
    const first = rows[0]
    const last = rows[rows.length - 1]
    if (first === undefined || last === undefined) return null
    const code = first.closest('code')
    if (code === null) return null
    const origin = localOrigin(code)
    const firstLine = this.view.lineOf(first, mark.side, code)
    const lastLine = this.view.lineOf(last, mark.side, code)
    const openTop = firstLine !== mark.startLine
    const openBottom = lastLine !== mark.endLine

    const top = first.getBoundingClientRect().top
    const bottom = last.getBoundingClientRect().bottom
    const extents = rows
      .map((row, index) => {
        const line = this.view.lineOf(row, mark.side, code)
        const from = line === mark.startLine && mark.startCol != null ? mark.startCol : 1
        const to = line === mark.endLine && mark.endCol != null ? mark.endCol : null
        return textBox(row, from, to, index === 0 ? row : null)
      })
      .filter((box): box is DOMRect => box !== null)
    if (extents.length === 0) return null
    const textLeft = Math.min(...extents.map((box) => box.left))
    const textRight = Math.max(...extents.map((box) => box.right))
    // The lines form spans the whole rows; its caption is still placed by the text, not by the band's far end.
    const left = mark.form === 'lines' ? first.getBoundingClientRect().left : textLeft
    const right = mark.form === 'lines' ? Math.max(...rows.map((row) => row.getBoundingClientRect().right)) : textRight
    const pad = PADDING[mark.form]
    const box: Box = {
      left: left - origin.x - pad,
      top: top - origin.y - (openTop ? 0 : pad),
      right: right - origin.x + pad,
      bottom: bottom - origin.y + (openBottom ? 0 : pad),
    }
    const element = this.markEl
    element.dataset.form = mark.form
    toggle(element, 'data-open-top', openTop)
    toggle(element, 'data-open-bottom', openBottom)
    place(element, box)
    attach(element, layerFor(code))
    const anchor = mark.form === 'lines' ? { ...box, left: textLeft - origin.x, right: textRight - origin.x } : box
    return { code, box: anchor }
  }

  private drawCaption(code: HTMLElement, target: Box | null, caption: { text: string; shown: boolean }): void {
    const element = this.captionEl
    if (element.textContent !== caption.text) element.textContent = caption.text
    toggle(element, 'data-shown', caption.shown)
    element.style.width = ''
    element.style.height = ''
    attach(element, layerFor(code))
    // Fractional sizes rounded up: a width rounded down makes the last word wrap out of the box once it is fixed.
    const size = element.getBoundingClientRect()
    const width = Math.ceil(size.width)
    const height = Math.ceil(size.height)
    const origin = localOrigin(code)
    const panel = visibleArea(this.view.scroller, code, origin)
    const clampX = (x: number) => Math.max(panel.left, Math.min(x, panel.right - width))
    let chosen: Box | undefined
    if (target !== null) {
      // Below the target aligned right, right of the target, above it: the first that fits without covering it.
      const candidates: Box[] = [
        at(clampX(target.right - width), target.bottom + CAPTION_GAP, width, height),
        at(target.right + CAPTION_GAP, target.top, width, height),
        at(clampX(target.right - width), target.top - CAPTION_GAP - height, width, height),
      ]
      chosen = candidates.find((box) => inside(box, panel) && !overlaps(box, target))
    }
    chosen ??= at(panel.right - width - CAPTION_GAP, panel.top + CAPTION_GAP, width, height)
    place(element, chosen)
  }
}

function attach(element: HTMLElement, layer: HTMLElement): void {
  if (element.parentElement !== layer) layer.append(element)
}

function toggle(element: HTMLElement, attribute: string, on: boolean): void {
  element.toggleAttribute(attribute, on)
}

function layerFor(code: HTMLElement): HTMLElement {
  for (const child of code.children) {
    if (child instanceof HTMLElement && child.classList.contains('xen-layer')) return child
  }
  const layer = document.createElement('div')
  layer.className = 'xen-layer'
  code.append(layer)
  return layer
}

/** Client coordinates where the layer's coordinates start. The layer is a zero-size flex item at the end of the
 * code element, so it scrolls sideways with the code; marks are placed relative to it. */
function localOrigin(code: HTMLElement): { x: number; y: number } {
  const rect = layerFor(code).getBoundingClientRect()
  return { x: rect.left, y: rect.top }
}

/** The part of the code element visible in the scroller, right of the sticky line-number gutter, in layer
 * coordinates. */
function visibleArea(scroller: HTMLElement, code: HTMLElement, origin: { x: number; y: number }): Box {
  const outer = scroller.getBoundingClientRect()
  const inner = code.getBoundingClientRect()
  const gutter = code.querySelector(':scope > [data-gutter]')?.getBoundingClientRect().width ?? 0
  return {
    left: Math.max(outer.left, inner.left + gutter) - origin.x,
    top: Math.max(outer.top, inner.top) - origin.y,
    right: Math.min(outer.right, inner.left + code.clientWidth) - origin.x,
    bottom: Math.min(outer.bottom, inner.bottom) - origin.y,
  }
}

function at(left: number, top: number, width: number, height: number): Box {
  return { left, top, right: left + width, bottom: top + height }
}

function inside(box: Box, area: Box): boolean {
  return box.left >= area.left && box.right <= area.right && box.top >= area.top && box.bottom <= area.bottom
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

function place(element: HTMLElement, box: Box): void {
  element.style.left = `${String(box.left)}px`
  element.style.top = `${String(box.top)}px`
  element.style.width = `${String(box.right - box.left)}px`
  element.style.height = `${String(box.bottom - box.top)}px`
}
