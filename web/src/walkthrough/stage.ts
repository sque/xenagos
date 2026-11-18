// The Stage the player drives, built on the code view and its overlay.

import type { CodeView, FileSides } from '../codeview/codeView'
import type { Form, Overlay } from '../codeview/overlay'
import type { CodeTarget, VisualTarget } from '../generated/types'
import { animateScroll, reducedMotion, wait } from './motion'
import type { Stage } from './player'

const FADE_MS = 150
/** Where a target that fits is placed: its middle at this fraction of the visible height. */
const TARGET_AT = 0.4

export class CodeStage implements Stage {
  private captionText: string | null = null
  /** Shows a spotlight on an element of the section's visual; set by the walkthrough, which owns the visual pane. */
  onVisual: (target: VisualTarget | null, form: Form) => void = () => undefined

  constructor(
    private readonly view: CodeView,
    private readonly overlay: Overlay,
    private readonly loadFile: (path: string) => Promise<FileSides>,
    /** The element faded out and in when another file opens. */
    private readonly panel: HTMLElement,
    private readonly onFile: (file: FileSides) => void,
  ) {}

  async showFile(path: string, signal: AbortSignal): Promise<void> {
    if (this.view.file?.path === path) return
    const file = await this.loadFile(path)
    signal.throwIfAborted()
    const fade = reducedMotion() ? 0 : FADE_MS
    this.panel.style.transition = `opacity ${String(fade)}ms ease`
    this.panel.style.opacity = '0'
    try {
      await wait(fade, signal)
    } catch (error) {
      // Stopped before the new file is shown, as when the reviewer steps back at once: the shown file stays, and
      // must not stay faded out.
      this.panel.style.opacity = '1'
      throw error
    }
    await this.view.show(file)
    this.onFile(file)
    this.panel.style.opacity = '1'
    await wait(fade, signal)
  }

  async bringIntoView(target: CodeTarget, signal: AbortSignal): Promise<void> {
    const side = target.side ?? 'head'
    const start = this.view.linePosition(side, target.startLine)
    const end = this.view.linePosition(side, target.endLine)
    if (start === undefined || end === undefined) return
    const scroller = this.view.scroller
    const visible = scroller.clientHeight
    const height = end.top + end.height - start.top
    const top = height < visible * 0.8 ? start.top + height / 2 - visible * TARGET_AT : start.top - visible * 0.15
    const max = scroller.scrollHeight - visible
    await animateScroll(scroller, Math.max(0, Math.min(top, max)), signal)
    if (target.startCol != null) {
      this.view.revealColumns(side, target.startLine, target.startCol, target.endCol ?? null)
    }
  }

  spotlight(target: CodeTarget | null, form: Form): void {
    this.overlay.setMark(
      target === null
        ? null
        : {
            side: target.side ?? 'head',
            startLine: target.startLine,
            endLine: target.endLine,
            startCol: target.startCol ?? null,
            endCol: target.endCol ?? null,
            form,
          },
    )
  }

  visual(target: VisualTarget | null, form: Form): void {
    this.onVisual(target, form)
  }

  async caption(text: string | null, signal: AbortSignal): Promise<void> {
    const fade = reducedMotion() ? 0 : FADE_MS
    if (text === null) {
      if (this.captionText === null) return
      this.overlay.setCaption(this.captionText, false)
      this.captionText = null
      await wait(fade, signal)
      this.overlay.setCaption(null)
      return
    }
    this.captionText = text
    this.overlay.setCaption(text, false)
    await nextFrame()
    this.overlay.setCaption(text, true)
    await wait(fade, signal)
  }

  /** Hide the current caption until the next step; playback continues. */
  hideCaption(): void {
    if (this.captionText !== null) this.overlay.setCaption(this.captionText, false)
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve()
    })
  })
}
