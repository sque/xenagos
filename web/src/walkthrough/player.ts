// Plays a section's steps (spec: walkthrough-narration; design decision 5a). Framework-free: it drives a Stage
// (code view, spotlight, caption) and a Voice, and reports its state.
//
// A change of step runs as: caption closes, spotlight off, the target's file opens if it is another one, the code
// scrolls to the target, spotlight on, caption opens, voice speaks. Playback pauses between steps and stops at the
// end of the section.
//
// Next, previous and replay keep playing while the walkthrough plays. Otherwise they step by hand: the step is shown
// and spoken, and the player stops on it, until play is pressed.

import type { CodeTarget, Plan, Step, VisualTarget } from '../generated/types'
import { wait } from './motion'
import type { Voice } from './voice'

type Form = Step['form']

export interface Stage {
  showFile(path: string, signal: AbortSignal): Promise<void>
  bringIntoView(target: CodeTarget, signal: AbortSignal): Promise<void>
  spotlight(target: CodeTarget | null, form: Form): void
  /** Spotlight an element of the section's visual, or nothing. */
  visual(target: VisualTarget | null, form: Form): void
  caption(text: string | null, signal: AbortSignal): Promise<void>
}

export type Status = 'idle' | 'playing' | 'paused' | 'ended'

export interface PlayerState {
  section: number
  step: number
  status: Status
}

export const PAUSE_BETWEEN_STEPS = 700

export class Player {
  private state: PlayerState = { section: 0, step: 0, status: 'idle' }
  private controller: AbortController | undefined
  /** The running step was asked for by hand: the player stops once it has been shown. */
  private byHand = false
  /** The paused step was shown to its end, so play goes on from the step after it. */
  private shown = false

  constructor(
    private readonly plan: Plan,
    private readonly stage: Stage,
    private voice: Voice,
    private readonly onChange: (state: PlayerState) => void,
    private readonly pause_ms = PAUSE_BETWEEN_STEPS,
  ) {}

  get current(): PlayerState {
    return this.state
  }

  setVoice(voice: Voice): void {
    this.voice = voice
    if (this.state.status !== 'playing') this.warm(this.state.section, this.state.step)
  }

  /** Have the voice make a step's audio ahead of time, so speaking it starts at once (a voice that makes audio on a
   * server takes seconds for a step it has not made before). */
  private warm(section: number, step: number): void {
    const narration = this.plan.sections[section]?.steps[step]?.narration
    if (narration !== undefined) this.voice.prepare?.(narration)
  }

  /** Play a section from a step, replacing whatever was playing. */
  play(section: number, step = 0): void {
    this.start(section, step, false)
  }

  private start(section: number, step: number, byHand: boolean): void {
    const steps = this.plan.sections[section]?.steps
    if (steps === undefined || step < 0 || step >= steps.length) return
    this.controller?.abort(new DOMException('replaced', 'AbortError'))
    const controller = new AbortController()
    this.controller = controller
    this.byHand = byHand
    this.shown = false
    this.run(section, step, controller.signal, byHand).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) throw error
    })
  }

  /** Go to a step of the current section: playing on while the walkthrough plays, otherwise by hand. */
  private go(step: number): void {
    const playing = this.state.status === 'playing' && !this.byHand
    this.start(this.state.section, step, !playing)
  }

  /** Stand at a step without playing it, as when the walkthrough is opened again where it was left. */
  moveTo(section: number, step: number): void {
    if (this.plan.sections[section]?.steps[step] === undefined) return
    this.controller?.abort(new DOMException('moved', 'AbortError'))
    this.shown = false
    this.set({ section, step, status: 'idle' })
    this.warm(section, step)
  }

  pause(): void {
    if (this.state.status !== 'playing') return
    this.controller?.abort(new DOMException('paused', 'AbortError'))
    this.set({ ...this.state, status: 'paused' })
  }

  /** Play on from the paused point: the paused step again, or the one after it once it was shown to its end. */
  resume(): void {
    if (this.state.status !== 'paused') return
    const { section, step } = this.state
    const after = this.shown && this.plan.sections[section]?.steps[step + 1] !== undefined
    this.play(section, after ? step + 1 : step)
  }

  next(): void {
    this.go(this.state.step + 1)
  }

  previous(): void {
    this.go(this.state.step - 1)
  }

  replay(): void {
    this.go(this.state.step)
  }

  stop(): void {
    this.controller?.abort(new DOMException('stopped', 'AbortError'))
  }

  private set(state: PlayerState): void {
    this.state = state
    this.onChange(state)
  }

  private async run(section: number, first: number, signal: AbortSignal, byHand: boolean): Promise<void> {
    const steps = this.plan.sections[section]?.steps ?? []
    for (let index = first; index < steps.length; index++) {
      const step = steps[index]
      if (step === undefined) break
      this.set({ section, step: index, status: 'playing' })
      await this.stage.caption(null, signal)
      this.stage.spotlight(null, step.form)
      this.stage.visual(null, step.form)
      const target = step.target
      if ('path' in target) {
        await this.stage.showFile(target.path, signal)
        await this.stage.bringIntoView(target, signal)
        this.stage.spotlight(target, step.form)
      } else {
        this.stage.visual(target, step.form)
      }
      await this.stage.caption(step.narration, signal)
      const following = steps[index + 1]
      if (following !== undefined && !byHand) this.voice.prepare?.(following.narration)
      await this.voice.speak(step.narration, signal)
      if (byHand && following !== undefined) {
        this.shown = true
        this.set({ section, step: index, status: 'paused' })
        return
      }
      if (index < steps.length - 1) await wait(this.pause_ms, signal)
    }
    this.set({ section, step: this.state.step, status: 'ended' })
    this.warm(section + 1, 0)
  }
}
