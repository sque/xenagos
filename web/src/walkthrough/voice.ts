// Speaking a step (spec: walkthrough-narration, "Voice is pluggable", "Voice is optional and disclosed"; design
// decision 6). One interface, two providers: `browser`, the browser's own speech, and `command`, audio the review
// server makes with the user's configured program and caches. A voice that fails falls back to captions at reading
// pace and reports the failure once. Voice off is the silent pace.

import { wait } from './motion'

export interface Voice {
  /** Resolves when the text has been spoken, or for a silent voice, after a reading-length time. */
  speak(text: string, signal: AbortSignal): Promise<void>
  /** Start making the audio for text that is spoken next, so it is ready in time. */
  prepare?(text: string): void
}

/** The voice to use: provider from configuration; voice name and speed from configuration or the narration menu. */
export interface VoiceSetup {
  provider: 'browser' | 'command'
  name: string | null
  speed: number
}

/** Told once per voice when it fails; playback goes on with captions. */
export type VoiceFailure = (reason: string) => void

/** Time to read a caption: about 190 words a minute, at least two seconds. */
export function readingTime(text: string): number {
  const words = text.trim().split(/\s+/).length
  return Math.max(2000, Math.round((words / 190) * 60_000))
}

export const silentVoice: Voice = {
  speak: (text, signal) => wait(readingTime(text), signal),
}

export function makeVoice(setup: VoiceSetup, onFail: VoiceFailure): Voice {
  return setup.provider === 'command'
    ? new CommandVoice(setup.name, setup.speed, onFail)
    : new BrowserVoice(setup.speed, setup.name, onFail)
}

/** Whether the provider can speak in this browser at all. */
export function voiceAvailable(provider: VoiceSetup['provider']): boolean {
  return provider === 'command' || BrowserVoice.available()
}

/** Base for the providers: report the first failure, then speak silently. */
abstract class FallibleVoice implements Voice {
  failed = false

  constructor(private readonly onFail: VoiceFailure) {}

  protected fail(reason: string): void {
    if (this.failed) return
    this.failed = true
    this.onFail(reason)
  }

  speak(text: string, signal: AbortSignal): Promise<void> {
    if (this.failed) return silentVoice.speak(text, signal)
    return this.say(text, signal).catch((error: unknown) => {
      if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error
      this.fail(error instanceof Error ? error.message : String(error))
      return silentVoice.speak(text, signal)
    })
  }

  protected abstract say(text: string, signal: AbortSignal): Promise<void>
}

/** The browser's built-in speech. */
export class BrowserVoice extends FallibleVoice {
  constructor(
    private readonly rate = 1,
    private readonly name: string | null = null,
    onFail: VoiceFailure = () => undefined,
  ) {
    super(onFail)
  }

  static available(): boolean {
    return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined'
  }

  /** The browser voice for a configured name: exact, then by prefix; otherwise the browser's default. */
  static pick(name: string | null): SpeechSynthesisVoice | null {
    if (!BrowserVoice.available()) return null
    const voices = speechSynthesis.getVoices()
    if (name !== null) {
      const wanted = name.toLowerCase()
      const found =
        voices.find((v) => v.name.toLowerCase() === wanted) ?? voices.find((v) => v.name.toLowerCase().startsWith(wanted))
      if (found !== undefined) return found
    }
    return voices.find((v) => v.default) ?? voices[0] ?? null
  }

  protected say(text: string, signal: AbortSignal): Promise<void> {
    if (!BrowserVoice.available()) return Promise.reject(new Error('this browser has no speech'))
    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = this.rate
      const voice = BrowserVoice.pick(this.name)
      if (voice !== null) utterance.voice = voice
      const stop = () => {
        speechSynthesis.cancel()
        reject(signal.reason as Error)
      }
      signal.addEventListener('abort', stop, { once: true })
      utterance.onend = () => {
        signal.removeEventListener('abort', stop)
        resolve()
      }
      utterance.onerror = (event) => {
        signal.removeEventListener('abort', stop)
        if (event.error === 'interrupted' || event.error === 'canceled') return
        reject(new Error(`the browser's speech failed (${event.error})`))
      }
      speechSynthesis.cancel()
      speechSynthesis.speak(utterance)
    })
  }
}

const PREPARED = 4

/** Audio made by the review server with the configured command (`POST /api/voice`), which caches it. */
export class CommandVoice extends FallibleVoice {
  private readonly made = new Map<string, Promise<Blob>>()

  constructor(
    private readonly name: string | null,
    private readonly speed: number,
    onFail: VoiceFailure = () => undefined,
    private readonly makeAudio: (text: string, name: string | null, speed: number) => Promise<Blob> = fetchAudio,
  ) {
    super(onFail)
  }

  prepare(text: string): void {
    if (!this.failed) this.audio(text).catch(() => undefined)
  }

  private audio(text: string): Promise<Blob> {
    let pending = this.made.get(text)
    if (pending === undefined) {
      pending = this.makeAudio(text, this.name, this.speed)
      pending.catch(() => this.made.delete(text))
      this.made.set(text, pending)
      for (const old of [...this.made.keys()].slice(0, Math.max(0, this.made.size - PREPARED))) this.made.delete(old)
    }
    return pending
  }

  protected async say(text: string, signal: AbortSignal): Promise<void> {
    const blob = await this.audio(text)
    signal.throwIfAborted()
    const url = URL.createObjectURL(blob)
    const player = new Audio(url)
    try {
      await new Promise<void>((resolve, reject) => {
        const stop = () => {
          player.pause()
          reject(signal.reason as Error)
        }
        signal.addEventListener('abort', stop, { once: true })
        player.onended = () => {
          signal.removeEventListener('abort', stop)
          resolve()
        }
        player.onerror = () => {
          signal.removeEventListener('abort', stop)
          reject(new Error(`the browser could not play the voice's audio (${blob.type || 'unknown format'})`))
        }
        player.play().catch((error: unknown) => {
          signal.removeEventListener('abort', stop)
          reject(error instanceof Error ? error : new Error(String(error)))
        })
      })
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

async function fetchAudio(text: string, name: string | null, speed: number): Promise<Blob> {
  const response = await fetch('/api/voice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice: name, speed }),
  })
  if (!response.ok) {
    let detail = `the review server answered ${String(response.status)}`
    try {
      const body = (await response.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      // not JSON: keep the status
    }
    throw new Error(detail)
  }
  return response.blob()
}
