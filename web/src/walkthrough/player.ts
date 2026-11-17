// Plays a section's steps (spec: walkthrough-narration; design decision 5a). Framework-free: it drives a Stage
// (code view, spotlight, caption) and a Voice, and reports its state.
//
// A change of step runs as: caption closes, spotlight off, the target's file opens if it is another one, the code
// scrolls to the target, spotlight on, caption opens, voice speaks. Playback pauses between steps and stops at the
// end of the section.

import type { CodeTarget, Plan, Step } from '../generated/types'
import { wait } from './motion'
import type { Voice } from './voice'

type Form = Step['form']

export interface Stage {
  showFile(path: string, signal: AbortSignal): Promise<void>
  bringIntoView(target: CodeTarget, signal: AbortSignal): Promise<void>
  spotlight(target: CodeTarget | null, form: Form): void
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
  }

  /** Play a section from a step, replacing whatever was playing. */
  play(section: number, step = 0): void {
    const steps = this.plan.sections[section]?.steps
    if (steps === undefined || step < 0 || step >= steps.length) return
    this.controller?.abort(new DOMException('replaced', 'AbortError'))
    const controller = new AbortController()
    this.controller = controller
    this.run(section, step, controller.signal).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) throw error
    })
  }

  pause(): void {
    if (this.state.status !== 'playing') return
    this.controller?.abort(new DOMException('paused', 'AbortError'))
    this.set({ ...this.state, status: 'paused' })
  }

  resume(): void {
    if (this.state.status === 'paused') this.play(this.state.section, this.state.step)
  }

  next(): void {
    this.play(this.state.section, this.state.step + 1)
  }

  previous(): void {
    this.play(this.state.section, this.state.step - 1)
  }

  replay(): void {
    this.play(this.state.section, this.state.step)
  }

  stop(): void {
    this.controller?.abort(new DOMException('stopped', 'AbortError'))
  }

  private set(state: PlayerState): void {
    this.state = state
    this.onChange(state)
  }

  private async run(section: number, first: number, signal: AbortSignal): Promise<void> {
    const steps = this.plan.sections[section]?.steps ?? []
    for (let index = first; index < steps.length; index++) {
      const step = steps[index]
      if (step === undefined) break
      this.set({ section, step: index, status: 'playing' })
      await this.stage.caption(null, signal)
      this.stage.spotlight(null, step.form)
      const target = step.target
      if ('path' in target) {
        await this.stage.showFile(target.path, signal)
        await this.stage.bringIntoView(target, signal)
        this.stage.spotlight(target, step.form)
      }
      // A step on a visual element is shown by the visual (task 6.11); until then it is narrated without a mark.
      await this.stage.caption(step.narration, signal)
      await this.voice.speak(step.narration, signal)
      if (index < steps.length - 1) await wait(this.pause_ms, signal)
    }
    this.set({ section, step: this.state.step, status: 'ended' })
  }
}
