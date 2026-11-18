import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AskPrompt, type AskAt } from '../agent/AskPrompt'
import { AskWalkthrough } from '../agent/AskWalkthrough'
import { CodeView, type FileSides, type Tick } from '../codeview/codeView'
import { Overlay } from '../codeview/overlay'
import type { ChangedFile, CodeTarget, Coverage, Plan, Show, VoiceInfo } from '../generated/types'
import { fetchChanges, fetchFile } from '../review'
import { type SectionSpot, VisualPane } from '../visual/VisualPane'
import { Icon, type IconName } from './icons'
import { hunkTarget, NotCovered } from './NotCovered'
import { NarrationMenu } from './NarrationMenu'
import { Outline } from './Outline'
import { Player, type PlayerState } from './player'
import { CodeStage } from './stage'
import { BrowserVoice, makeVoice, silentVoice, type Voice, voiceAvailable, type VoiceSetup } from './voice'

interface Engine {
  player: Player
  stage: CodeStage
  view: CodeView
}

/** Something the agent pointed at with `xen show`; `seq` tells two equal requests apart. */
export type Pointing = Show & { seq: number }

/** A place in the walkthrough, counted from 0. */
export interface Position {
  section: number
  step: number
}

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
  reviewId: string
  /** Voice settings from configuration; voice starts on when `enabled`. */
  voice: VoiceInfo
  /** Where the outline is drawn: the top of the right column (design decision 5b). */
  outlineSlot: HTMLElement | null
  onFile: (path: string) => void
  /** Where to stand when the walkthrough opens, as it was left; the start of the plan when null. */
  start?: Position | null
  /** Told where the walkthrough is, so it can be opened there again. */
  onPosition?: (position: Position) => void
}) {
  const { plan, pointing, opening, style } = props
  const scrollerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const engine = useRef<Engine | null>(null)
  const [initial] = useState(() => {
    const at = props.start
    return at != null && plan.sections[at.section]?.steps[at.step] !== undefined ? at : { section: 0, step: 0 }
  })
  const [state, setState] = useState<PlayerState>({ ...initial, status: 'idle' })
  const [file, setFile] = useState<FileSides | null>(null)
  const [ticks, setTicks] = useState<Tick[]>([])
  const [voiceOn, setVoiceOn] = useState(props.voice.enabled && voiceAvailable(props.voice.provider))
  const [speech, setSpeech] = useState<VoiceSetup>({ provider: props.voice.provider, name: props.voice.name, speed: props.voice.speed })
  const [voiceProblem, setVoiceProblem] = useState<string | null>(null)
  const offMachine = useOffMachine(speech, props.voice.offMachine)
  const [disclosed, setDisclosed] = useState(() => wasDisclosed(props.reviewId))
  const mustDisclose = voiceOn && offMachine !== null && !disclosed
  const [askAt, setAskAt] = useState<AskAt | null>(null)
  const [visualSpot, setVisualSpot] = useState<SectionSpot | null>(null)
  // Sections played to their end, for the outline's "done".
  const [done, setDone] = useState<ReadonlySet<number>>(new Set())
  const [changes, setChanges] = useState<ChangedFile[] | null>(null)
  const [explained, setExplained] = useState(false)
  const voiceRef = useRef<Voice>(silentVoice)
  const onPositionRef = useRef(props.onPosition)
  const onFileRef = useRef(props.onFile)
  useEffect(() => {
    onFileRef.current = props.onFile
    onPositionRef.current = props.onPosition
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
    const player = new Player(plan, stage, silentVoice, (next) => {
      setState(next)
      onPositionRef.current?.({ section: next.section, step: next.step })
      if (next.status === 'ended') setDone((previous) => new Set(previous).add(next.section))
    })
    engine.current = { player, stage, view }
    player.setVoice(voiceRef.current)
    const resize = new ResizeObserver(() => {
      overlay.redraw()
    })
    resize.observe(scroller)
    // Scrolling the code or clicking in it pauses playback at the current step; resume goes back to its target
    // (spec: walkthrough-narration, "Reviewer controls"). Only input events count: our own eased scroll fires none.
    const wander = () => {
      player.pause()
    }
    const scrollKeys = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '])
    const keyScroll = (event: KeyboardEvent) => {
      if (scrollKeys.has(event.key)) player.pause()
    }
    scroller.addEventListener('wheel', wander, { passive: true })
    scroller.addEventListener('touchmove', wander, { passive: true })
    scroller.addEventListener('pointerdown', wander)
    scroller.addEventListener('keydown', keyScroll)
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
    const where = plan.sections[initial.section]?.steps[initial.step] === undefined ? { section: 0, step: 0 } : initial
    player.moveTo(where.section, where.step)
    const first = plan.sections[where.section]?.steps[where.step]?.target ?? plan.sections[0].steps[0].target
    if ('path' in first) {
      void stage.showFile(first.path, new AbortController().signal)
    }
    return () => {
      player.stop()
      scroller.removeEventListener('wheel', wander)
      scroller.removeEventListener('touchmove', wander)
      scroller.removeEventListener('pointerdown', wander)
      scroller.removeEventListener('keydown', keyScroll)
      resize.disconnect()
      view.destroy()
      engine.current = null
    }
  }, [plan, initial])

  // Voice off, or not yet disclosed when it sends text off the machine: captions at reading pace.
  const voice: Voice = useMemo(
    () =>
      voiceOn && !mustDisclose
        ? makeVoice(speech, (reason) => {
            setVoiceProblem(reason)
          })
        : silentVoice,
    [voiceOn, mustDisclose, speech],
  )
  useEffect(() => {
    voiceRef.current = voice
    engine.current?.player.setVoice(voice)
  }, [voice])

  useEffect(() => {
    let live = true
    fetchChanges().then(
      (found) => {
        if (live) setChanges(found)
      },
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [])

  // Keyboard equivalents of the transport (design decision 5b). Keys typed into a field, the agent's terminal or a
  // control that uses them itself are left alone.
  const keysRef = useRef<(event: KeyboardEvent) => void>(() => undefined)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      keysRef.current(event)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [])

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
  const playOrPause = () => {
    const p = player()
    if (p === undefined) return
    if (state.status === 'playing') p.pause()
    else if (state.status === 'paused') p.resume()
    else p.play(state.section, state.status === 'ended' ? 0 : state.step)
  }
  const hasPrevious = state.step > 0
  const hasNext = state.step < steps.length - 1
  useEffect(() => {
    keysRef.current = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target?.closest('input, textarea, select, [contenteditable="true"], .agent, [role="separator"]')) return
      const onControl = target?.closest('button, a, summary') != null
      const inCode = target?.closest('.scroller') != null
      const p = player()
      if (p === undefined) return
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
      if ((key === ' ' && !onControl && !inCode) || key === 'k') playOrPause()
      else if ((key === 'ArrowLeft' && !inCode) || key === 'j') {
        if (hasPrevious) p.previous()
      } else if ((key === 'ArrowRight' && !inCode) || key === 'l') {
        if (hasNext) p.next()
      } else if (key === 'r') {
        if (state.status !== 'idle') p.replay()
      } else if (key === 'c') engine.current?.stage.hideCaption()
      else return
      event.preventDefault()
    }
  })

  return (
    <section className="stage">
      {props.outlineSlot !== null &&
        createPortal(
          <>
            <Outline
              plan={plan}
              progress={state}
              done={done}
              changes={changes}
              onPlay={(i, j) => {
                player()?.play(i, j)
              }}
            />
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
            <button
              type="button"
              className="explanation"
              aria-expanded={explained}
              title={explained ? 'Show one line' : 'Show the whole explanation'}
              onClick={() => {
                setExplained(!explained)
              }}
            >
              {section?.explanation}
            </button>
          </div>
          <div className="transport">
            <Control icon="previous" label="Previous step" keys="← or J" disabled={!hasPrevious} onClick={() => player()?.previous()} />
            <Control
              icon={playing ? 'pause' : 'play'}
              label={playing ? 'Pause' : state.status === 'paused' ? 'Resume' : 'Play'}
              keys="Space or K"
              primary
              onClick={playOrPause}
            />
            <Control icon="next" label="Next step" keys="→ or L" disabled={!hasNext} onClick={() => player()?.next()} />
            <Control icon="replay" label="Replay step" keys="R" disabled={state.status === 'idle'} onClick={() => player()?.replay()} />
            <Control icon="caption" label="Hide caption" keys="C" onClick={() => engine.current?.stage.hideCaption()} />
            <NarrationMenu
              voiceOn={voiceOn}
              available={voiceAvailable(speech.provider)}
              onVoice={setVoiceOn}
              speech={speech}
              onSpeech={setSpeech}
              style={style}
              narratedWith={plan.style?.name ?? null}
            />
          </div>
        </div>
        {mustDisclose && (
          <div className="voicenotice" role="alertdialog" aria-label="Voice sends text off this machine">
            <p>
              Narration is spoken by {offMachine}, which sends the text of each step off this machine.
            </p>
            <button
              type="button"
              onClick={() => {
                rememberDisclosed(props.reviewId)
                setDisclosed(true)
              }}
            >
              Speak it
            </button>
            <button
              type="button"
              onClick={() => {
                setVoiceOn(false)
              }}
            >
              Keep voice off
            </button>
          </div>
        )}
        {voiceProblem !== null && (
          <div className="voicenotice" role="alert">
            <p>The voice failed: {voiceProblem}. Playing with captions only.</p>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => {
                setVoiceProblem(null)
              }}
            >
              ×
            </button>
          </div>
        )}
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

function Control(props: {
  icon: IconName
  label: string
  /** The keyboard equivalent, shown in the tooltip. */
  keys?: string
  primary?: boolean
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className={props.primary === true ? 'icon primary' : 'icon'}
      aria-label={props.label}
      aria-keyshortcuts={props.keys?.replace(' or ', ' ').replace('←', 'ArrowLeft').replace('→', 'ArrowRight')}
      title={props.keys === undefined ? props.label : `${props.label} (${props.keys})`}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      <Icon name={props.icon} />
    </button>
  )
}

const DISCLOSED = 'xenagos.voice-disclosed.'

function wasDisclosed(review: string): boolean {
  try {
    return localStorage.getItem(DISCLOSED + review) === 'yes'
  } catch {
    return false
  }
}

function rememberDisclosed(review: string): void {
  try {
    localStorage.setItem(DISCLOSED + review, 'yes')
  } catch {
    // No storage: the notice comes back on the next load, which errs on the side of saying it.
  }
}

/** Who sends narration off the machine, for the disclosure, or null when the voice stays on it: a command the user
 * marked `off_machine`, or a browser voice the browser itself says is not local. Browser voices load late. */
function useOffMachine(speech: VoiceSetup, commandOffMachine: boolean): string | null {
  // Only a trigger to look again: browsers list their voices some time after the page loads.
  const [, setVoicesSeen] = useState(0)
  useEffect(() => {
    if (speech.provider !== 'browser' || !BrowserVoice.available()) return
    const changed = () => {
      setVoicesSeen((n) => n + 1)
    }
    speechSynthesis.addEventListener('voiceschanged', changed)
    return () => {
      speechSynthesis.removeEventListener('voiceschanged', changed)
    }
  }, [speech.provider])
  if (speech.provider === 'command') return commandOffMachine ? 'the configured voice command' : null
  const chosen = BrowserVoice.pick(speech.name)
  return chosen !== null && !chosen.localService ? `the browser voice "${chosen.name}"` : null
}
