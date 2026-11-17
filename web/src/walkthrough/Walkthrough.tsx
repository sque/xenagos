import { useEffect, useRef, useState } from 'react'
import { CodeView, type FileSides, type Tick } from '../codeview/codeView'
import { Overlay } from '../codeview/overlay'
import type { Plan } from '../generated/types'
import { fetchFile } from '../review'
import { Icon, type IconName } from './icons'
import { Player, type PlayerState } from './player'
import { CodeStage } from './stage'
import { BrowserVoice, silentVoice } from './voice'

interface Engine {
  player: Player
  stage: CodeStage
}

export function Walkthrough({ plan }: { plan: Plan }) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const engine = useRef<Engine | null>(null)
  const [state, setState] = useState<PlayerState>({ section: 0, step: 0, status: 'idle' })
  const [file, setFile] = useState<FileSides | null>(null)
  const [ticks, setTicks] = useState<Tick[]>([])
  const [voiceOn, setVoiceOn] = useState(BrowserVoice.available())

  useEffect(() => {
    const scroller = scrollerRef.current
    const content = contentRef.current
    const panel = panelRef.current
    if (scroller === null || content === null || panel === null) return
    const holder: { overlay?: Overlay } = {}
    const view = new CodeView(scroller, content, () => holder.overlay?.onRender())
    const overlay = new Overlay(view)
    holder.overlay = overlay
    const stage = new CodeStage(view, overlay, fetchFile, panel, (shown) => {
      setFile(shown)
      setTicks(view.ticks())
    })
    const player = new Player(plan, stage, silentVoice, setState)
    engine.current = { player, stage }
    const resize = new ResizeObserver(() => {
      overlay.redraw()
    })
    resize.observe(scroller)
    const first = plan.sections[0].steps[0].target
    if ('path' in first) {
      void stage.showFile(first.path, new AbortController().signal)
    }
    return () => {
      player.stop()
      resize.disconnect()
      view.destroy()
      engine.current = null
    }
  }, [plan])

  useEffect(() => {
    engine.current?.player.setVoice(voiceOn ? new BrowserVoice() : silentVoice)
  }, [voiceOn])

  const player = () => engine.current?.player
  const section = plan.sections[state.section]
  const steps = section?.steps ?? []
  const playing = state.status === 'playing'

  return (
    <div className="walkthrough">
      <nav className="outline" aria-label="Sections">
        <p className="orientation">{plan.orientation.problem}</p>
        <ol>
          {plan.sections.map((s, i) => (
            <li key={s.title} aria-current={i === state.section ? 'true' : undefined}>
              <button type="button" onClick={() => player()?.play(i)}>
                <span className="role">{s.role}</span> {s.title}
              </button>
              {i === state.section && (
                <ol className="steps">
                  {s.steps.map((step, j) => (
                    <li key={j} aria-current={j === state.step && state.status !== 'idle' ? 'step' : undefined}>
                      <button type="button" onClick={() => player()?.play(i, j)}>
                        {step.narration}
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <section className="stage">
        <div className="stagebar">
          <h2>{section?.title}</h2>
          <span className="position">
            Section {state.section + 1} of {plan.sections.length} · Step {state.step + 1} of {steps.length}
          </span>
          <div className="transport">
            <Control icon="previous" label="Previous step" disabled={state.step === 0} onClick={() => player()?.previous()} />
            {playing ? (
              <Control icon="pause" label="Pause" onClick={() => player()?.pause()} />
            ) : (
              <Control
                icon="play"
                label={state.status === 'paused' ? 'Resume' : 'Play'}
                onClick={() => {
                  const p = player()
                  if (p === undefined) return
                  if (state.status === 'paused') p.resume()
                  else p.play(state.section, state.status === 'ended' ? 0 : state.step)
                }}
              />
            )}
            <Control
              icon="next"
              label="Next step"
              disabled={state.step >= steps.length - 1}
              onClick={() => player()?.next()}
            />
            <Control icon="replay" label="Replay step" disabled={state.status === 'idle'} onClick={() => player()?.replay()} />
            <Control icon="caption" label="Hide caption" onClick={() => engine.current?.stage.hideCaption()} />
            <Control
              icon={voiceOn ? 'voiceOn' : 'voiceOff'}
              label={voiceOn ? 'Turn voice off' : 'Turn voice on'}
              disabled={!BrowserVoice.available()}
              onClick={() => {
                setVoiceOn(!voiceOn)
              }}
            />
          </div>
        </div>
        <div className="filebar">{file?.path ?? ' '}</div>
        <div className="codepanel" ref={panelRef}>
          <div className="scroller" ref={scrollerRef}>
            <div ref={contentRef} />
          </div>
          <div className="ticks" aria-hidden="true">
            {ticks.map((tick, i) => (
              <span key={i} className={`tick ${tick.kind}`} style={{ top: `${String(tick.position * 100)}%` }} />
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

function Control(props: { icon: IconName; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className="icon"
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      <Icon name={props.icon} />
    </button>
  )
}
