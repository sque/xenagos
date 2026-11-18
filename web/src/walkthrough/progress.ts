// Pure helpers for the outline and its progress marks (spec: walkthrough-narration, "Outline of sections and steps").

import type { ChangedFile, CodeTarget, VisualTarget } from '../generated/types'

/** A step's line in the outline: the first sentence of its narration. */
export function stepLabel(narration: string): string {
  const match = /^.*?[.!?](?=\s|$)/s.exec(narration.trim())
  return (match?.[0] ?? narration).trim()
}

const overlaps = (start: number, end: number, from: number, count: number) =>
  count > 0 && start <= from + count - 1 && end >= from

/** Whether a step points at code the change did not touch: a file the change leaves alone, or lines of a changed
 * file outside every hunk on the targeted side. A step on a visual element is not about code. */
export function targetsUnchangedCode(target: CodeTarget | VisualTarget, changes: ChangedFile[]): boolean {
  if (!('path' in target)) return false
  const side = target.side ?? 'head'
  const change = changes.find((c) => (side === 'base' ? (c.oldPath ?? c.path) : c.path) === target.path)
  if (change === undefined) return true
  return !change.hunks.some((h) =>
    side === 'head'
      ? overlaps(target.startLine, target.endLine, h.headStart, h.headCount)
      : overlaps(target.startLine, target.endLine, h.baseStart, h.baseCount),
  )
}

export type StepState = 'done' | 'current' | 'upcoming'

export interface Progress {
  section: number
  step: number
  status: 'idle' | 'playing' | 'paused' | 'ended'
}

/** Done, current or upcoming, for a step of the section on screen. */
export function stepState(index: number, progress: Progress, sectionDone: boolean): StepState {
  if (progress.status === 'ended' || (progress.status === 'idle' && sectionDone)) return 'done'
  // Idle: not started, or opened again where the reviewer left it.
  if (progress.status === 'idle') return index < progress.step ? 'done' : 'upcoming'
  return index < progress.step ? 'done' : index === progress.step ? 'current' : 'upcoming'
}

export const SOURCE: Record<string, string> = {
  'commit-messages': 'from commit messages',
  document: 'from a document',
  inferred: 'inferred from the code',
}
