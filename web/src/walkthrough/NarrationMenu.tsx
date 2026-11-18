// The narration menu behind the speaker icon (spec: walkthrough-narration, "Voice and wording settings are together
// and distinct"; design decision 5b; mockup narration-menu): voice settings change how narration sounds, wording
// settings what is said. Voice and speed chosen here last for this page; configuration holds the lasting choice.

import { useEffect, useRef, useState } from 'react'
import { request } from '../agent/api'
import { Icon } from './icons'
import { BrowserVoice, type VoiceSetup } from './voice'

const SPEEDS = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

type Asked = { state: 'idle' | 'asking' | 'asked' } | { state: 'failed'; error: string }

export function NarrationMenu(props: {
  voiceOn: boolean
  available: boolean
  onVoice: (on: boolean) => void
  speech: VoiceSetup
  onSpeech: (speech: VoiceSetup) => void
  /** The active narration style: a rewrite asked for now uses it. */
  style: string
  /** The style the walkthrough on screen was narrated in. */
  narratedWith: string | null
}) {
  const { voiceOn, speech, style, narratedWith } = props
  const [open, setOpen] = useState(false)
  const [asked, setAsked] = useState<Asked>({ state: 'idle' })
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', escape)
    }
  }, [open])

  const rewrite = () => {
    setAsked({ state: 'asking' })
    request({ kind: 'narration' }).then(
      () => {
        setAsked({ state: 'asked' })
      },
      (error: unknown) => {
        setAsked({ state: 'failed', error: error instanceof Error ? error.message : String(error) })
      },
    )
  }

  return (
    <div className="narrationmenu" ref={root}>
      <button
        type="button"
        className="icon"
        aria-label="Narration"
        title="Narration: voice and wording"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open)
        }}
      >
        <Icon name={voiceOn ? 'voiceOn' : 'voiceOff'} />
      </button>
      {open && (
        <div className="menu" role="dialog" aria-label="Narration">
          <section aria-labelledby="menu-voice">
            <h3 id="menu-voice">Voice · how it sounds</h3>
            <div className="row">
              <span id="menu-speak">Speak the narration</span>
              <button
                type="button"
                className="switch"
                aria-labelledby="menu-speak"
                aria-pressed={voiceOn}
                disabled={!props.available}
                onClick={() => {
                  props.onVoice(!voiceOn)
                }}
              >
                {voiceOn ? 'On' : 'Off'}
              </button>
            </div>
            <label className="row">
              <span>Voice</span>
              <VoiceChoice speech={speech} onSpeech={props.onSpeech} />
            </label>
            <label className="row">
              <span>Speed</span>
              <select
                value={String(speech.speed)}
                onChange={(event) => {
                  props.onSpeech({ ...speech, speed: Number(event.target.value) })
                }}
              >
                {[...new Set([...SPEEDS, speech.speed])]
                  .sort((a, b) => a - b)
                  .map((speed) => (
                    <option key={speed} value={String(speed)}>
                      {speed.toFixed(2).replace(/0$/, '')}×
                    </option>
                  ))}
              </select>
            </label>
          </section>
          <section aria-labelledby="menu-wording">
            <h3 id="menu-wording">Wording · what is said</h3>
            <div className="row">
              <span>Narration style</span>
              <span className="value" title="Set narration.style in .xenagos/config.toml or ~/.config/xenagos/config.toml">
                {style}
              </span>
            </div>
            {narratedWith !== null && narratedWith !== style && (
              <p className="hint">This walkthrough was narrated in {narratedWith}.</p>
            )}
            <button type="button" className="link" disabled={asked.state === 'asking'} onClick={rewrite}>
              {narratedWith !== null && narratedWith !== style ? `Rewrite the narration in ${style}` : 'Rewrite the narration'}
            </button>
            {asked.state === 'asked' && (
              <p role="status" className="hint">
                Asked. The new wording appears once the agent submits narration that fits the style "{style}".
              </p>
            )}
            {asked.state === 'failed' && <p role="alert">{asked.error}</p>}
            <p className="hint">
              The style is set in the configuration (<code>narration.style</code>); a rewrite keeps every section and
              step and changes only the words.
            </p>
          </section>
        </div>
      )}
    </div>
  )
}

/** The browser's voices in the page's language, on-machine ones first; a command voice is named as configured. */
function VoiceChoice({ speech, onSpeech }: { speech: VoiceSetup; onSpeech: (speech: VoiceSetup) => void }) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => browserVoices())
  useEffect(() => {
    if (speech.provider !== 'browser' || !BrowserVoice.available()) return
    const changed = () => {
      setVoices(browserVoices())
    }
    speechSynthesis.addEventListener('voiceschanged', changed)
    return () => {
      speechSynthesis.removeEventListener('voiceschanged', changed)
    }
  }, [speech.provider])
  if (speech.provider === 'command') {
    return <span className="value">voice command{speech.name !== null ? ` · ${speech.name}` : ''}</span>
  }
  if (voices.length === 0) return <span className="value">this browser's default</span>
  const chosen = BrowserVoice.pick(speech.name)
  const listed = chosen === null || voices.some((voice) => voice.name === chosen.name) ? voices : [chosen, ...voices]
  return (
    <select
      value={chosen?.name ?? ''}
      onChange={(event) => {
        onSpeech({ ...speech, name: event.target.value })
      }}
    >
      {listed.map((voice) => (
        <option key={voice.voiceURI} value={voice.name}>
          {voice.localService ? 'this machine' : 'online'} · {voice.name}
        </option>
      ))}
    </select>
  )
}

function browserVoices(): SpeechSynthesisVoice[] {
  if (!BrowserVoice.available()) return []
  const language = (navigator.language || 'en').split('-')[0] ?? 'en'
  const all = speechSynthesis.getVoices()
  const mine = all.filter((voice) => voice.lang.toLowerCase().startsWith(language.toLowerCase()))
  return (mine.length > 0 ? mine : all).sort(
    (a, b) => Number(b.localService) - Number(a.localService) || a.name.localeCompare(b.name),
  )
}
