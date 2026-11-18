import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AskPrompt, type AskAt } from '../agent/AskPrompt'
import { AskWalkthrough } from '../agent/AskWalkthrough'
import { CodeView, type FileSides, type Tick } from '../codeview/codeView'
import { Overlay } from '../codeview/overlay'
import type { CodeTarget, Coverage, Plan, Show } from '../generated/types'
import { fetchFile } from '../review'
import { type SectionSpot, VisualPane } from '../visual/VisualPane'
import { Icon, type IconName } from './icons'
import { hunkTarget, NotCovered } from './NotCovered'
import { Player, type PlayerState } from './player'
import { CodeStage } from './stage'
import { BrowserVoice, silentVoice } from './voice'

interface Engine {
  player: Player
  stage: CodeStage
  view: CodeView
}

/** Something the agent pointed at with `xen show`; `seq` tells two equal requests apart. */
export type Pointing = Show & { seq: number }

/** A file the reviewer chose in the explorer. */
export interface Opening {
  path: string
  seq: number
}

export function Walkthrough(props: {
  plan: Plan
  pointing: Pointing | null
  opening: Opening | null
  /** What the plan leaves out; null until loaded. */
  coverage: Coverage | null
  style: string
  /** Whether voice starts on (configuration: voice.enabled). */
  voice: boolean
  /** Where the outline is drawn: the top of the right column (design decision 5b). */
  outlineSlot: HTMLElement | null
  onFile: (path: string) => void
}) {
  const { plan, pointing, opening, style } = props
  const scrollerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const engine = useRef<Engine | null>(null)
  const [state, setState] = useState<PlayerState>({ section: 0, step: 0, status: 'idle' })
  const [file, setFile] = useState<FileSides | null>(null)
  const [ticks, setTicks] = useState<Tick[]>([])
  const [voiceOn, setVoiceOn] = useState(props.voice && BrowserVoice.available())
  const [askAt, setAskAt] = useState<AskAt | null>(null)
  const [visualSpot, setVisualSpot] = useState<SectionSpot | null>(null)
  const onFileRef = useRef(props.onFile)
  useEffect(() => {
    onFileRef.current = props.onFile
  })

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
      onFileRef.current(shown.path)
    })
    stage.onVisual = (target, form) => {
      setVisualSpot(target === null ? null : { visual: target.visual, element: target.element, form })
    }
    const player = new Player(plan, stage, silentVoice, setState)
    engine.current = { player, stage, view }
    const resize = new ResizeObserver(() => {
      overlay.redraw()
    })
    resize.observe(scroller)
    // The prompt opens under the selection's last line, where the reviewer is looking.
    view.onSelect = (selection) => {
      if (selection === null) return
      const row = view.rows(selection.endSide, selection.endLine, selection.endLine)[0]
      const bounds = (row ?? scroller).getBoundingClientRect()
      const code = scroller.getBoundingClientRect()
      // Asking pauses playback at the step the reviewer is on, before they start typing (spec: agent-link).
      player.pause()
      setAskAt({
        selection: { kind: 'code', ...selection },
        x: code.left + Math.min(code.width / 2, 220),
        y: row ? bounds.bottom : bounds.top + 80,
      })
    }
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

  // Showing code out of turn (the agent's `xen show`, a visual's link): playback pauses and the target is shown
  // without a caption. A newer request replaces an unfinished one.
  const pointer = useRef<AbortController | null>(null)
  // `path` is the file to open, which differs from the target's path for the base side of a renamed file.
  const pointAt = (target: CodeTarget | null, form: 'lines' | 'box' | 'circle', path = target?.path) => {
    const current = engine.current
    if (current === null || path === undefined) return
    current.player.pause()
    pointer.current?.abort(new DOMException('replaced', 'AbortError'))
    const controller = new AbortController()
    pointer.current = controller
    const point = async () => {
      await current.stage.caption(null, controller.signal)
      current.stage.spotlight(null, form)
      await current.stage.showFile(path, controller.signal)
      if (target === null) return
      await current.stage.bringIntoView(target, controller.signal)
      current.stage.spotlight(target, form)
    }
    point().catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) throw error
    })
  }
  const pointAtRef = useRef<(show: Show) => void>(() => undefined)
  useEffect(() => {
    pointAtRef.current = (show: Show) => {
      const form = show.form ?? 'lines'
      const target = show.target
      if ('path' in target) {
        pointAt(target, form)
        return
      }
      engine.current?.player.pause()
      setVisualSpot({ visual: target.visual, element: target.element, form })
    }
  })

  useEffect(() => {
    if (pointing !== null) pointAtRef.current(pointing)
  }, [pointing])

  // A file chosen in the explorer opens at its top; playback pauses (spec: repository-explorer).
  const openRef = useRef<(path: string) => void>(() => undefined)
  useEffect(() => {
    openRef.current = (path: string) => {
      pointAt(null, 'lines', path)
    }
  })
  useEffect(() => {
    if (opening !== null) openRef.current(opening.path)
  }, [opening])

  const player = () => engine.current?.player
  const section = plan.sections[state.section]
  const steps = section?.steps ?? []
  const playing = state.status === 'playing'

  return (
    <section className="stage">
      {props.outlineSlot !== null &&
        createPortal(
          <>
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
            {props.coverage !== null && (
              <NotCovered
                coverage={props.coverage}
                current={file?.path ?? null}
                onOpen={(uncovered, hunk) => {
                  pointAt(hunkTarget(uncovered, hunk), 'lines', uncovered.path)
                }}
              />
            )}
            <AskWalkthrough again style={style} narratedWith={plan.style?.name ?? null} />
          </>,
          props.outlineSlot,
        )}
        <div className="stagebar">
          <div className="heading">
            <h2>{section?.title}</h2>
            <span className="position">
              Section {state.section + 1} of {plan.sections.length} · Step {state.step + 1} of {steps.length}
            </span>
            <p className="explanation" title={section?.explanation}>
              {section?.explanation}
            </p>
          </div>
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
        {section?.visuals !== undefined && section.visuals.length > 0 && (
          <VisualPane
            key={state.section}
            visuals={section.visuals}
            spot={visualSpot}
            onLink={(visual, element) => {
              const link = visual.elements?.find((e) => e.id === element)?.link
              if (link != null) pointAt(link, 'lines')
            }}
            onSelect={(visual, element, box) => {
              engine.current?.player.pause()
              setAskAt({
                selection: { kind: 'element', visual: visual.id, element },
                x: (box.left + box.right) / 2,
                y: box.bottom,
              })
            }}
          />
        )}
        <div className="filebar">
          {file === null ? ' ' : <FileHeading file={file} changes={ticks.length} />}
        </div>
        {askAt !== null && (
          <AskPrompt
            key={JSON.stringify(askAt.selection)}
            at={askAt}
            position={{ section: state.section + 1, step: state.step + 1 }}
            onAsking={() => {
              engine.current?.player.pause()
            }}
            onClose={() => {
              if (askAt.selection.kind === 'code') engine.current?.view.clearSelection()
              setAskAt(null)
            }}
          />
        )}
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
  )
}

function FileHeading({ file, changes }: { file: FileSides; changes: number }) {
  const text = file.head ?? file.base ?? ''
  const lines = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
  const what = file.head === null ? 'deleted file' : file.base === null ? 'new file' : 'whole file'
  return (
    <>
      <span className="filepath">{file.path}</span>
      <span className="filefacts">
        {what} · {lines} line{lines === 1 ? '' : 's'}
        {changes > 0 && ` · ${String(changes)} change${changes === 1 ? '' : 's'}`}
      </span>
    </>
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
