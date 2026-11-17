// Measuring characters in a rendered row.

/** Client rectangle of the characters `from` to `to` (1-based, inclusive; `to` null for the end of the line). For
 * an empty line, a zero-width box at the row's start when `fallback` is given. */
export function textBox(row: HTMLElement, from: number, to: number | null, fallback: HTMLElement | null): DOMRect | null {
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let offset = 0
  let started = false
  let last: Text | null = null
  for (let node = walker.nextNode() as Text | null; node !== null; node = walker.nextNode() as Text | null) {
    const length = node.data.length
    if (!started && from - 1 < offset + length) {
      range.setStart(node, from - 1 - offset)
      started = true
    }
    if (started && to !== null && to <= offset + length) {
      range.setEnd(node, to - offset)
      return range.getBoundingClientRect()
    }
    offset += length
    last = node
  }
  if (!started || last === null) {
    if (fallback === null) return null
    const rect = fallback.getBoundingClientRect()
    return new DOMRect(rect.left, rect.top, 0, rect.height)
  }
  range.setEnd(last, last.data.endsWith('\n') ? last.data.length - 1 : last.data.length)
  return range.getBoundingClientRect()
}
