// The adapter around @pierre/diffs (design decision 5). Everything that knows the library's API or the markup it
// renders lives in this module and in overlay.ts, so the library can be upgraded or replaced in one place.
//
// The walkthrough shows a whole file with the change in place: the library's unified diff with every unchanged line
// expanded, on its virtualised component, lines not wrapped (design decision 5b, spike 2.6).

import {
  DEFAULT_THEMES,
  DIFFS_TAG_NAME,
  type FileDiffMetadata,
  type SelectedLineRange,
  getFiletypeFromFileName,
  parseDiffFromFile,
  preloadHighlighter,
  VirtualizedFile,
  VirtualizedFileDiff,
  Virtualizer,
} from '@pierre/diffs'
import { OVERLAY_CSS } from './overlayCss'
import { textBox } from './text'

export type Side = 'base' | 'head'
export type Layout = 'unified' | 'split'

export interface FileSides {
  path: string
  oldPath?: string | null
  base: string | null
  head: string | null
}

/** Lines the reviewer selected with the library's line selection. Each end names its side: in the unified view a
 * selection can start on a deleted line and end on an added one. */
export interface LineSelection {
  path: string
  startSide: Side
  startLine: number
  endSide: Side
  endLine: number
}

export interface Tick {
  /** Position along the scroll track, from 0 (top) to 1 (bottom). */
  position: number
  kind: 'added' | 'deleted' | 'modified'
}

// A deleted line sits between head lines in the whole-file view; its old number would read as a head number. With
// unchanged lines collapsed (browse mode) the numbers stay, as a diff reader expects.
const WHOLE_FILE_CSS = `
[data-gutter] [data-line-type="change-deletion"] [data-line-number-content] { visibility: hidden; }
${OVERLAY_CSS}
`

const librarySide = (side: Side) => (side === 'base' ? 'deletions' : 'additions')
const ourSide = (side: SelectedLineRange['side']): Side => (side === 'deletions' ? 'base' : 'head')

export class CodeView {
  readonly virtualizer = new Virtualizer()
  private instance: VirtualizedFileDiff | VirtualizedFile | undefined
  private container: HTMLElement | undefined
  private diff: FileDiffMetadata | undefined
  private layoutStyle: Layout = 'unified'
  private destroyed = false
  file: FileSides | undefined
  /** Called when the reviewer finishes selecting lines, and with null when the selection is cleared. */
  onSelect: (selection: LineSelection | null) => void = () => undefined

  constructor(
    readonly scroller: HTMLElement,
    private readonly content: HTMLElement,
    private readonly onRender: () => void,
  ) {
    this.virtualizer.setup(scroller, content)
  }

  /** Show a file, replacing the one shown. Resolves once its first rows are in the page. The walkthrough shows
   * every unchanged line; `expandAll: false` keeps unchanged regions collapsed, as browse mode does. */
  async show(file: FileSides, { expandAll = true }: { expandAll?: boolean } = {}): Promise<void> {
    // Rendering before the highlighter has loaded the file's language makes the virtualiser jump to the end of the
    // scroll container once highlighting arrives (seen with @pierre/diffs 1.6.4), so load it first.
    await preloadHighlighter({ themes: Object.values(DEFAULT_THEMES), langs: [getFiletypeFromFileName(file.path)] })
    // Destroyed while the highlighter loaded, as when the walkthrough rebuilds its view: a file shown now would sit
    // in the page beside the new view's, as a blank copy the height of the file.
    if (this.destroyed) return
    this.instance?.cleanUp()
    this.container?.remove()
    const container = document.createElement(DIFFS_TAG_NAME)
    this.content.append(container)
    const head = file.head === null ? null : { name: file.path, contents: file.head }
    const base = file.base === null ? null : { name: file.oldPath ?? file.path, contents: file.base }
    let rendered!: () => void
    const firstRender = new Promise<void>((resolve) => (rendered = resolve))
    const common = {
      overflow: 'scroll' as const,
      disableFileHeader: true,
      enableLineSelection: true,
      themeType: 'system' as const,
      unsafeCSS: expandAll ? WHOLE_FILE_CSS : OVERLAY_CSS,
      onLineSelectionEnd: (range: SelectedLineRange | null) => {
        this.onSelect(range === null ? null : selection(file, range))
      },
      onPostRender: () => {
        // Synchronously, in the library's post-render hook: a redraw deferred to the next frame leaves marks
        // up to a thousand pixels off for a few frames (spike 2.6).
        this.onRender()
        // The first renders can come before any row is in the page, while the highlighter loads.
        if (container.shadowRoot?.querySelector('[data-content] > [data-line]')) rendered()
      },
    }
    let instance: VirtualizedFileDiff | VirtualizedFile
    let diff: FileDiffMetadata | undefined
    if (head !== null && base !== null && file.head === file.base) {
      // A file the change did not touch: a diff of it has no hunks and shows nothing, so show the file itself.
      const single = new VirtualizedFile(common, this.virtualizer)
      single.render({ fileContainer: container, file: head })
      instance = single
    } else {
      diff = parseDiffFromFile(base, head)
      const whole = new VirtualizedFileDiff(
        { ...common, diffStyle: this.layoutStyle, expandUnchanged: expandAll },
        this.virtualizer,
      )
      whole.render({ fileContainer: container, fileDiff: diff })
      instance = whole
    }
    this.instance = instance
    this.container = container
    this.diff = diff
    this.file = file
    this.scroller.scrollTop = 0
    await firstRender
  }

  clearSelection(): void {
    this.instance?.setSelectedLines(null)
  }

  /** Reveal collapsed unchanged lines (browse mode). `hunkIndex` names the collapsed region before that hunk;
   * `up` reveals the region's first lines, `down` its last, `both` some of each (measured with 1.6.4). */
  expand(hunkIndex: number, direction: 'up' | 'down' | 'both', lines?: number): void {
    if (this.instance instanceof VirtualizedFileDiff) this.instance.expandHunk(hunkIndex, direction, lines)
  }

  get layout(): Layout {
    return this.layoutStyle
  }

  setLayout(layout: Layout): void {
    this.layoutStyle = layout
    if (!(this.instance instanceof VirtualizedFileDiff)) return
    this.instance.setOptions({ ...this.instance.options, diffStyle: layout })
    this.instance.rerender()
  }

  /** The shadow root the library renders into. */
  get root(): ShadowRoot | null {
    return this.container?.shadowRoot ?? null
  }

  /** Top and height of a line in the scroller's content, from the library's line metrics; known before the line is
   * rendered. */
  linePosition(side: Side, line: number): { top: number; height: number } | undefined {
    if (this.instance === undefined || this.container === undefined) return undefined
    const position =
      this.instance instanceof VirtualizedFileDiff
        ? this.instance.getLinePosition(line, librarySide(side))
        : this.instance.getLinePosition(line)
    if (position === undefined) return undefined
    return { top: this.virtualizer.getOffsetInScrollContainer(this.container) + position.top, height: position.height }
  }

  /** The rendered rows holding lines `start` to `end` of one side, in order. Rows outside the rendered window are
   * not in the page and are left out. */
  rows(side: Side, start: number, end: number): HTMLElement[] {
    const found: HTMLElement[] = []
    for (const code of this.codeElements(side)) {
      const content = code.querySelector(':scope > [data-content]')
      if (content === null) continue
      for (const row of content.children) {
        if (!(row instanceof HTMLElement) || !row.hasAttribute('data-line')) continue
        const line = this.lineOf(row, side, code)
        if (line !== undefined && line >= start && line <= end) found.push(row)
      }
    }
    return found
  }

  /** Line number of a rendered row on one side, or undefined when the row does not show a line of that side. */
  lineOf(row: HTMLElement, side: Side, code: Element): number | undefined {
    const type = row.dataset.lineType ?? ''
    if (this.instance instanceof VirtualizedFile) return Number(row.dataset.line) // unchanged: same on both sides
    if (code.hasAttribute('data-deletions')) return side === 'base' ? Number(row.dataset.line) : undefined
    if (code.hasAttribute('data-additions')) return side === 'head' ? Number(row.dataset.line) : undefined
    // Unified: a deleted row carries its base number; other rows carry the head number and, for context, the base
    // number as the alternative.
    if (type === 'change-deletion') return side === 'base' ? Number(row.dataset.line) : undefined
    if (side === 'head') return Number(row.dataset.line)
    return type.startsWith('context') && row.dataset.altLine !== undefined ? Number(row.dataset.altLine) : undefined
  }

  /** The code elements that can hold rows of `side`: one in unified layout, the side's column in split layout. */
  codeElements(side?: Side): HTMLElement[] {
    const codes = [...(this.root?.querySelectorAll<HTMLElement>('code[data-code]') ?? [])]
    if (side === undefined || codes.length < 2) return codes
    return codes.filter((code) => code.hasAttribute(side === 'base' ? 'data-deletions' : 'data-additions'))
  }

  /** Scroll the code sideways so that columns of a rendered line are in view (lines do not wrap, so a target may be
   * far to the right). Does nothing when they are already in view. */
  revealColumns(side: Side, line: number, startCol: number, endCol: number | null): void {
    const row = this.rows(side, line, line)[0]
    const code = row?.closest('code')
    if (row === undefined || code == null) return
    const target = textBox(row, startCol, endCol, null)
    if (target === null) return
    const bounds = code.getBoundingClientRect()
    const gutter = code.querySelector(':scope > [data-gutter]')?.getBoundingClientRect().width ?? 0
    const left = bounds.left + code.clientLeft + gutter
    const right = bounds.left + code.clientLeft + code.clientWidth
    if (target.left >= left && target.right <= right) return
    const margin = Math.min(48, (right - left) / 4)
    code.scrollLeft += target.left - left - margin
  }

  /** Change positions for the marks beside the scroll track, from line metrics, before anything is rendered. */
  ticks(): Tick[] {
    if (!(this.instance instanceof VirtualizedFileDiff) || this.diff === undefined) return []
    const height = this.instance.getVirtualizedHeight()
    if (height <= 0) return []
    const ticks: Tick[] = []
    for (const hunk of this.diff.hunks) {
      for (const block of hunk.hunkContent) {
        if (block.type !== 'change') continue
        const position =
          block.additions > 0
            ? this.instance.getLinePosition(block.additionLineIndex + 1, 'additions')
            : this.instance.getLinePosition(block.deletionLineIndex + 1, 'deletions')
        if (position === undefined) continue
        const kind = block.additions === 0 ? 'deleted' : block.deletions === 0 ? 'added' : 'modified'
        ticks.push({ position: position.top / height, kind })
      }
    }
    return ticks
  }

  destroy(): void {
    this.destroyed = true
    this.instance?.cleanUp()
    this.container?.remove()
    this.virtualizer.cleanUp()
  }
}

export function selection(file: FileSides, range: SelectedLineRange): LineSelection {
  const start = { side: ourSide(range.side), line: range.start }
  const end = { side: ourSide(range.endSide ?? range.side), line: range.end }
  // Dragged upwards on one side: name the lines in reading order.
  const [first, last] = start.side === end.side && start.line > end.line ? [end, start] : [start, end]
  return { path: file.path, startSide: first.side, startLine: first.line, endSide: last.side, endLine: last.line }
}
