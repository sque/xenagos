import { expect, test } from 'vitest'
import type { ChangedFile } from '../generated/types'
import { stepLabel, stepState, targetsUnchangedCode } from './progress'

test('a step is labelled by its first sentence', () => {
  expect(stepLabel('Start with the old greeting. It is the same text whatever was built.')).toBe('Start with the old greeting.')
  expect(stepLabel('Version 1.2 is read here, not in the loop')).toBe('Version 1.2 is read here, not in the loop')
  expect(stepLabel('Why? Because the loop ends.')).toBe('Why?')
})

const changes: ChangedFile[] = [
  {
    path: 'batch.py',
    oldPath: null,
    status: 'modified',
    binary: false,
    hunks: [
      { id: 'batch.py:h1', baseStart: 10, baseCount: 1, headStart: 10, headCount: 5 },
      { id: 'batch.py:h2', baseStart: 40, baseCount: 2, headStart: 43, headCount: 0 },
    ],
  },
  { path: 'new_name.py', oldPath: 'old_name.py', status: 'renamed', binary: false, hunks: [{ id: 'new_name.py:h1', baseStart: 0, baseCount: 0, headStart: 0, headCount: 0 }] },
]

test('a step on code the change did not touch is told apart', () => {
  const at = (path: string, startLine: number, endLine: number, side: 'base' | 'head' = 'head') => ({ path, side, startLine, endLine })
  expect(targetsUnchangedCode(at('queue.py', 1, 3), changes)).toBe(true)
  expect(targetsUnchangedCode(at('batch.py', 12, 20), changes)).toBe(false)
  expect(targetsUnchangedCode(at('batch.py', 20, 30), changes)).toBe(true)
  expect(targetsUnchangedCode(at('batch.py', 41, 41, 'base'), changes)).toBe(false)
  expect(targetsUnchangedCode(at('batch.py', 43, 43), changes)).toBe(true)
  expect(targetsUnchangedCode(at('old_name.py', 1, 2, 'base'), changes)).toBe(true)
  expect(targetsUnchangedCode({ visual: 'v', element: 'e' }, changes)).toBe(false)
})

test('step states follow playback', () => {
  expect(stepState(0, { section: 0, step: 0, status: 'idle' }, false)).toBe('upcoming')
  expect(stepState(0, { section: 0, step: 1, status: 'playing' }, false)).toBe('done')
  expect(stepState(1, { section: 0, step: 1, status: 'paused' }, false)).toBe('current')
  expect(stepState(2, { section: 0, step: 1, status: 'playing' }, false)).toBe('upcoming')
  expect(stepState(2, { section: 0, step: 1, status: 'ended' }, false)).toBe('done')
  expect(stepState(2, { section: 0, step: 0, status: 'idle' }, true)).toBe('done')
})
