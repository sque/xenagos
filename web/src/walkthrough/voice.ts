// Speaking a step. The full voice interface (providers, cache, disclosure) is task 6.9; this is the browser's own
// speech, which stays on the machine, and a silent pace for when voice is off or fails.

import { wait } from './motion'

export interface Voice {
  /** Resolves when the text has been spoken, or for a silent voice, after a reading-length time. */
  speak(text: string, signal: AbortSignal): Promise<void>
}

/** Time to read a caption: about 190 words a minute, at least two seconds. */
export function readingTime(text: string): number {
  const words = text.trim().split(/\s+/).length
  return Math.max(2000, Math.round((words / 190) * 60_000))
}

export const silentVoice: Voice = {
  speak: (text, signal) => wait(readingTime(text), signal),
}

export class BrowserVoice implements Voice {
  failed = false

  constructor(private readonly rate = 1) {}

  static available(): boolean {
    return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined'
  }

  speak(text: string, signal: AbortSignal): Promise<void> {
    if (this.failed || !BrowserVoice.available()) return silentVoice.speak(text, signal)
    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = this.rate
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
        // Fall back to captions alone; reported once by the viewer (task 6.9).
        this.failed = true
        silentVoice.speak(text, signal).then(resolve, reject)
      }
      speechSynthesis.cancel()
      speechSynthesis.speak(utterance)
    })
  }
}
