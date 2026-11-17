import { describe, expect, test } from 'vitest'
import type { CodeTarget, Plan } from '../generated/types'
import { Player, type PlayerState, type Stage } from './player'
import type { Voice } from './voice'

const code = (path: string, startLine: number): CodeTarget => ({ path, startLine, endLine: startLine })

const PLAN: Plan = {
  orientation: { problem: 'p', source: 'inferred' },
  sections: [
    {
      title: 'One',
      role: 'core',
      explanation: 'e',
      hunks: [],
      steps: [
        { narration: 'first', form: 'lines', target: code('a.py', 1) },
        { narration: 'second', form: 'box', target: code('b.py', 9) },
        { narration: 'third', form: 'circle', target: { visual: 'v', element: 'x' } },
      ],
    },
  ],
}

/** Records every call; voice waits until released, so tests can act mid-step. */
function harness() {
  const log: string[] = []
  const states: PlayerState[] = []
  const pending: (() => void)[] = []
  const stage: Stage = {
    showFile: (path) => {
      log.push(`file ${path}`)
      return Promise.resolve()
    },
    bringIntoView: (t) => {
      log.push(`scroll ${String(t.startLine)}`)
      return Promise.resolve()
    },
    spotlight: (t, form) => {
      log.push(t === null ? 'spot off' : `spot ${form} ${String(t.startLine)}`)
    },
    caption: (text) => {
      log.push(text === null ? 'caption close' : `caption ${text}`)
      return Promise.resolve()
    },
  }
  const voice: Voice = {
    speak: (text, signal) =>
      new Promise((resolve, reject) => {
        log.push(`speak ${text}`)
        const done = () => {
          resolve()
        }
        pending.push(done)
        signal.addEventListener('abort', () => {
          pending.splice(pending.indexOf(done), 1)
          reject(signal.reason as Error)
        })
      }),
  }
  const player = new Player(PLAN, stage, voice, (s) => states.push(s), 0)
  const release = async () => {
    await flush()
    pending.shift()?.()
    await flush()
  }
  return { player, log, states, release }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 5))

describe('player', () => {
  test('runs close, spotlight off, file, scroll, spotlight, caption, voice for each step and stops at the end', async () => {
    const { player, log, states, release } = harness()
    player.play(0)
    await release()
    await release()
    await release()
    expect(log).toEqual([
      'caption close', 'spot off', 'file a.py', 'scroll 1', 'spot lines 1', 'caption first', 'speak first',
      'caption close', 'spot off', 'file b.py', 'scroll 9', 'spot box 9', 'caption second', 'speak second',
      'caption close', 'spot off', 'caption third', 'speak third',
    ])
    expect(states.at(-1)).toEqual({ section: 0, step: 2, status: 'ended' })
  })

  test('pause stops the voice and keeps the step; resume plays that step again', async () => {
    const { player, log, states, release } = harness()
    player.play(0)
    await flush()
    player.pause()
    expect(states.at(-1)).toEqual({ section: 0, step: 0, status: 'paused' })
    await flush()
    expect(log.filter((l) => l.startsWith('speak'))).toEqual(['speak first'])
    player.resume()
    await release()
    expect(log.filter((l) => l.startsWith('speak'))).toEqual(['speak first', 'speak first', 'speak second'])
  })

  test('next and previous move one step and keep playing', async () => {
    const { player, states } = harness()
    player.play(0)
    await flush()
    player.next()
    await flush()
    expect(states.at(-1)).toEqual({ section: 0, step: 1, status: 'playing' })
    player.previous()
    await flush()
    expect(states.at(-1)).toEqual({ section: 0, step: 0, status: 'playing' })
    player.previous()
    await flush()
    expect(states.at(-1)?.step).toBe(0)
  })

  test('replay starts the current step over', async () => {
    const { player, log } = harness()
    player.play(0, 1)
    await flush()
    player.replay()
    await flush()
    expect(log.filter((l) => l.startsWith('speak'))).toEqual(['speak second', 'speak second'])
  })
})
