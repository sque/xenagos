// Task 6.9: the command voice in real Chromium, which plays the audio. Audio is made here instead of by the server.

import { beforeEach, expect, test, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { CommandVoice } from './voice'

/** A WAV file of silence. */
function wav(seconds: number): Blob {
  const rate = 8000
  const samples = Math.round(rate * seconds)
  const buffer = new ArrayBuffer(44 + samples)
  const view = new DataView(buffer)
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i))
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples, true)
  text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate, true)
  view.setUint16(32, 1, true)
  view.setUint16(34, 8, true)
  text(36, 'data')
  view.setUint32(40, samples, true)
  new Uint8Array(buffer, 44).fill(128)
  return new Blob([buffer], { type: 'audio/wav' })
}

// Chromium plays audio only after the person has interacted with the page; in the viewer, pressing Play is that.
beforeEach(async () => {
  await userEvent.click(document.body)
})

test('plays the audio to its end, and audio prepared ahead is made once', async () => {
  const make = vi.fn(() => Promise.resolve(wav(0.4)))
  const onFail = vi.fn()
  const voice = new CommandVoice('Ava', 1.25, onFail, make)
  voice.prepare('Second step.')
  const started = performance.now()
  await voice.speak('First step.', new AbortController().signal)
  expect(performance.now() - started).toBeGreaterThan(300)
  await voice.speak('Second step.', new AbortController().signal)
  expect(make.mock.calls).toEqual([
    ['Second step.', 'Ava', 1.25],
    ['First step.', 'Ava', 1.25],
  ])
  expect(onFail).not.toHaveBeenCalled()
})

test('stopping playback ends it at once', async () => {
  const voice = new CommandVoice(null, 1, () => undefined, () => Promise.resolve(wav(5)))
  const controller = new AbortController()
  const speaking = voice.speak('A long step.', controller.signal)
  setTimeout(() => {
    controller.abort(new DOMException('paused', 'AbortError'))
  }, 300)
  const started = performance.now()
  await expect(speaking).rejects.toMatchObject({ name: 'AbortError' })
  expect(performance.now() - started).toBeLessThan(1500)
})

test('a failing voice is reported once and playback goes on at reading pace', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout'] })
  try {
    const make = vi.fn(() => Promise.reject(new Error('the voice command failed with status 3: no model')))
    const onFail = vi.fn()
    const voice = new CommandVoice(null, 1, onFail, make)
    const first = voice.speak('First step.', new AbortController().signal)
    await vi.advanceTimersByTimeAsync(2000)
    await first
    const second = voice.speak('Second step.', new AbortController().signal)
    await vi.advanceTimersByTimeAsync(2000)
    await second
    expect(onFail.mock.calls).toEqual([['the voice command failed with status 3: no model']])
    expect(make).toHaveBeenCalledTimes(1)
  } finally {
    vi.useRealTimers()
  }
})

test('audio the browser cannot play is reported', async () => {
  const onFail = vi.fn()
  const voice = new CommandVoice(null, 1, onFail, () => Promise.resolve(new Blob(['FORM....AIFF'], { type: 'audio/aiff' })))
  const controller = new AbortController()
  const speaking = voice.speak('A step.', controller.signal)
  await vi.waitFor(() => {
    expect(onFail).toHaveBeenCalledTimes(1)
  })
  expect(String(onFail.mock.calls[0]?.[0])).toMatch(/could not play|not supported|no supported source/i)
  controller.abort(new DOMException('stopped', 'AbortError'))
  await expect(speaking).rejects.toMatchObject({ name: 'AbortError' })
})
