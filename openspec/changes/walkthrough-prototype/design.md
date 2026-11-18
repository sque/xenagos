# Design

## Context

New repository, no code. See proposal.md for motivation. Constraints that shape the approach:

- The agent is Claude Code, used through its command line: background sessions, `claude attach`, `claude agents`.
- The plan format, its validation and the viewer that renders it must agree exactly; they change together.
- The user's checkouts are live working copies and must not be disturbed (spec `review-target`).
- Claude Code background sessions can be shown in any terminal with `claude attach` and keep running when no
  terminal shows them.

## Goals / Non-Goals

**Goals:**

- One install, one command (`xen`), one local process serving the viewer.
- One kind of agent: a real Claude Code session, whether it existed before the review or xenagos started it.
- Narration style enforced where the plan is accepted, independent of which voice speaks it.

**Non-Goals:**

- Hosting, accounts, multi-user sessions.
- Go-to-definition or other language-server features in the viewer.
- Supporting agents other than Claude Code in this change.
- Windows. The server relies on pseudo-terminals; macOS and Linux are the targets.
- Browsers other than Chromium-based ones are untested (spike 1.2).

## Decisions

### 1. Python server, TypeScript viewer

The server is Python (managed with uv, strict type checking on), the viewer is TypeScript. The maintainer reads and
audits Python fluently, which matters more here than a single toolchain; pseudo-terminal handling is in the standard
library, and local neural voices are Python-native.

The plan schema is defined once, as Pydantic models in the server. A build step exports JSON Schema and generates the
viewer's TypeScript types from it; a check fails the build when the generated types are stale. Anchor and narration
validation run only in the server. The released package bundles the built viewer, so users need Python only; Node is
a development-time dependency.

Stack (chosen by the author, 2026-11-17): the server uses FastAPI on uvicorn, so the Pydantic plan models double as
request types and WebSockets come built in; the viewer uses React with Vite, since `@pierre/diffs` ships React
bindings. The diff view stays behind the adapter module (decision 5) so the overlay keeps direct control of the
library's virtualised component.

Alternatives: TypeScript end to end (one toolchain and direct type sharing, but a backend the maintainer reads less
easily); Rust server (single binary, but the server's work is calling git, serving files and
relaying messages, so there is no performance to win). The server stays behind an HTTP and WebSocket contract so
either could replace it without touching the viewer.

### 2. Reading code without a checkout

Diffs and file contents come from the repository's object store through the git command line (`git diff`, `git show
<rev>:<path>`), so browsing never needs a checkout. When the agent needs a filesystem at a head that is not what the
user has checked out, xenagos makes a private local clone at that commit under its data directory
(`${XDG_DATA_HOME:-~/.local/share}/xenagos/checkouts/`). A session running there does not see uncommitted project
instructions, local settings or memory that Claude Code keys to the original path; the viewer says so. `xen clean`
removes the data and private clone of reviews that are not running.

Alternative: `git worktree add`. Rejected because it writes worktree records into the user's repository and shares its
object store and refs with it.

### 3. Plan as a validated JSON document

The agent writes one JSON document: orientation, sections (title, role, explanation, claimed hunks, steps, visuals).
A hunk is named `<path>:h<n>` from the pinned diff. It is one contiguous changed region, so hunks come from a diff with
no context lines; the diff options that change how git splits a diff (algorithm `histogram`, rename detection,
inter-hunk context, external diff, text conversion) are fixed in `xenagos.diff`, so the user's git configuration
cannot rename hunks. A file change with no text hunk (binary, mode or rename only) is one whole-file hunk `h1`. A step has `narration`, `form` (`lines`, `box` or `circle`) and a
target: either code, `{path, side, startLine, endLine, startCol?, endCol?}` with an optional `expect` string that must
occur in that range (it catches a range that is valid but points at the wrong code), or a visual element,
`{visual, element}`. A visual carries its HTML and the list of element ids it declares; targets, links and selection
signals are checked against that list. The server validates against the pinned revisions and computes the not-covered list; a rejected plan returns the
failing items to the agent. The schema is defined in the server; the viewer's types are generated from it (decision 1).

The agent learns the format and the narration style from an authoring guide the server prints (`xen guide`), as Codiff
does, so the guide versions with the validator.

### 4. One process per review, no always-running service

Each review is served by its own server process on a free loopback port. There is no daemon.

- **Started by a person:** `xen [target]` in a repository runs the server in the foreground and opens the browser.
- **Started by an agent:** the agent runs `xen open`, which spawns the same server detached; it ends itself when idle.
- **Registry:** each running server writes `<state dir>/reviews/<review id>.json` (mode 0600) with repository, base,
  head, port, secret and process id, and removes it on exit. The review id is derived from repository path, base and
  head, so opening the same target finds the running server instead of starting another. `xen list` and `xen stop`
  read this directory; entries whose process is gone are cleaned up.
- **State:** the review's data directory (decision 9) is separate from the registry entry and outlives the process.

Alternative: one always-running service that hosts every review. It gives one address and one place to list reviews,
but needs install-time service management, version skew handling between service and command, and one crash takes
down every review. Nothing in the specs needs it.

### 4a. The agent is a Claude Code background session in a terminal pane

The chat is not re-drawn. The review server opens a pseudo-terminal running `claude attach <session>` and the viewer
shows it with a browser terminal emulator over a WebSocket (bytes out, keystrokes and resize in). This gives Claude
Code's own interface, permission prompts and behaviour, and the session loads project instructions because it runs in
the repository. One attach process per connected viewer; closing the viewer ends the attach process, not the session.

- **Which session:** the session that ran `xen open` (it identifies itself through the `CLAUDE_CODE_SESSION_ID`
  environment variable Claude Code sets for the commands it runs), or the one named with `xen --session`, or one
  xenagos starts on first need with `claude --bg -n <name> --permission-mode <mode> <prompt>` in the repository,
  taking the id from that command's output. Name and mode come from configuration.
- **Only background sessions can be shown.** `claude attach` refuses a session started as a plain interactive
  `claude` (spike 2.2). Such a session can still open a review and author the walkthrough. On the user's choice the
  pane continues it with `claude --resume <id> --bg -n <name> <prompt>`, which keeps the id and the conversation once
  the original process has exited (spike 2.5). If Claude Code answers that the session "is open in another Claude
  Code process, so this started a copy as <id>", xenagos stops and removes that copy and asks the user to close the
  original. The continue command needs a prompt, so it adds one short turn; the name must be passed again or it is
  replaced by a generated one.
- **Reviewer to agent:** the selection prompt writes the reviewer's text and a one-line selection reference into the
  attach pseudo-terminal as a paste, then Enter. A busy session queues it by itself (spike 2.1). Control characters,
  including the paste terminator, are stripped first, and the reference is built by the server from validated values.
  The only other things xenagos writes are the fixed requests the spec lists (write the walkthrough, rewrite the
  narration, repair a visual), each a one-line message naming the review and the `xen` command to start from.
- **Agent to viewer:** the `xen` command, run by the agent like any other command: `xen open`, `xen guide`,
  `xen plan submit <file>`, `xen plan get [--without-narration]`, `xen narration submit <file>`,
  `xen show <path>:<start>[-<end>][:<startCol>-<endCol>] [--side base|head] [--form lines|box|circle]`, `xen step add`, `xen visual add`.
  A command finds its review by matching `CLAUDE_CODE_SESSION_ID` against the session recorded in each registry
  entry; `--review <id>` names one explicitly, and an ambiguous or missing match is an error listing the open
  reviews. A command for a review whose server has ended starts the server again from the saved state. A Claude Code skill shipped with
  xenagos teaches the session these commands. xenagos adds no permission rule for them; the user approves `xen`
  once or adds a rule themselves.
- **State:** working, idle, waiting for the reviewer or ended, read from `claude agents --json`.
- **Display size:** Claude Code keeps one display size per session, set by the last terminal that resized it. The
  viewer checks whether another terminal has the session open and shows the notice the spec requires.
- **Never resumed automatically:** resuming a session that is still running starts a copy, so continuing, starting
  or replacing a review's session is always the user's action. `claude attach` on a stopped background session starts
  it again, so the pane attaches only to a session whose process runs.
- **Nothing is typed into a session that waits for an answer.** While a permission prompt is open, the Enter that
  submits a pasted question would answer the prompt with its highlighted choice, usually "Yes". The server reads
  `waiting` from `claude agents --json` and refuses the question, and the prompt in the viewer says to answer in the
  pane first. Seen in the build's live check.
- **Measured in the build (Claude Code 2.1.323 to 2.1.326):** `claude attach` takes the short id that `claude --bg`
  prints (`backgrounded · <id> · <name>`), not the full session id. `claude --bg` refuses a folder that was never
  trusted in Claude Code, and trust of a parent folder does not count; xenagos passes the message on. Commands run by
  xenagos drop the variables Claude Code sets for a session's commands (`CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, ...),
  so a server started by `xen open` from inside a session does not start or attach as a child of that session. The
  attach program runs on a pseudo-terminal that is its controlling terminal (`xenagos.ttyexec`), or it never hears
  of a resize.

Alternatives considered: a session started through the Agent SDK with the chat drawn by the viewer (spike 1.3 showed
it works, but it means rebuilding Claude Code's interface and a separate permission model); an MCP server whose tool
waits for the reviewer (spike 1.1 showed it works, but the reviewer then watches two windows, and it is not needed
once the viewer can type into the session); forking the authoring session (a copy with the author's context, but two
sessions then edit the same files and decisions made in review never reach the original).

### 5. Viewer

`@pierre/diffs`, pinned to an exact version, for diffs and full files, behind an adapter module so the library can be
replaced. All three spotlight forms (lines, box, circle) are drawn on an overlay layer positioned from the rendered line
and character rectangles; this is not a library feature and is the first spike. (The first draft used the library's
line selection for the lines form; it is drawn on the overlay instead so that the reviewer's own line selection,
used for questions, stays free.)

Found while building it (2026-11-17, `@pierre/diffs` 1.6.4, `web/src/codeview/`):

- The file container must be the library's `<diffs-container>` element; in a plain element its styles do not apply.
- The overlay layer is a zero-size flex item appended to `code[data-code]`, positioned relative, with marks inside it.
  The code element itself must not be made a positioned box: the virtualiser measures offsets through it and then
  renders the wrong window.
- The highlighter is preloaded for the file's language before the first render. Rendering before it has loaded makes
  the virtualiser jump to the end of the scroll container once highlighting arrives.
- A file the change did not touch gives a diff with no hunks, which renders nothing; it is shown with the library's
  virtualised single-file component instead.
- `expandHunk(i, direction)` names the collapsed region before hunk `i`; `up` reveals its first lines, `down` its last.

### 5b. Walkthrough layout (approved from mockups, 2026-11-13)

Two layouts were drawn. "A" kept the diff as the reading surface with a section list on the left. "B" treats
walkthrough mode as an author driving an editor, and was chosen by the author.

| Column | Content |
|---|---|
| Left | Repository explorer, full height (spec `repository-explorer`). |
| Middle | One-row header (section, position, one-line explanation, icon transport, narration menu); then the section's visual when it has one; then the code view. |
| Right | Outline of sections and steps on top, agent terminal below, with a draggable divider. |

- **Whole file with the change in place** is the library's unified diff with all unchanged context expanded, which
  gives continuous line numbers, added lines marked and deleted lines inline. Browse mode keeps hunks with expansion.
- **One component for every file size**: the library's virtualised diff (`VirtualizedFileDiff` with a `Virtualizer`),
  unified, all context expanded, lines not wrapped. Spike 2.6 measured spotlights, scrolling and change ticks on a
  3,000-line file with it; the details the build must follow are listed there.
- **Lines do not wrap in the walkthrough code view** in this change. With wrapping the library's height estimates are
  wrong until rows are measured, so a jump lands hundreds of pixels off and tick positions move (spike 2.6). A long
  line is brought into view by scrolling the code horizontally to the target.
- **Selecting lines to ask about** uses the library's line selection, not the browser's text selection: a text
  selection dragged across recycled rows is truncated and is lost when scrolled away (spike 2.6).
- **Change positions** are drawn as ticks beside the scroll track, computed from the library's line metrics before
  anything is rendered (exact in spike 2.6). There are no "previous
  change / next change" buttons in walkthrough mode: they would compete with step navigation, and the ticks and the
  explorer already answer "where else did this file change". Browse mode is the place for change-by-change reading.
- **Explorer data**: the file list at the head from git, the change status per path from the diff, deleted paths
  added back, visited paths and covered hunks from the plan (`GET /api/tree`). As built: the narrow view also keeps
  the file on screen, so a file the agent points at with `xen show` is never hidden; a chain of folders that each
  hold one folder is drawn as one row (`server/src/xenagos/`); only changed files get a category, so an unchanged
  lock file is not dimmed; changed files no section covers are listed by name under the tree, as in the mockup.
- **What "A" had that "B" drops**: a section's hunks shown together as one block. The outline's steps replace it.
  A "section diff" toggle in the code header is a possible later addition.
- **Transport** is icons only: previous step, pause or resume, next step, replay. Previous and next duplicate
  choosing a step in the outline on purpose: one is for stepping through, the other for jumping.
- **Narration menu** behind a speaker icon: voice group (speak, voice, speed) and wording group (style, rewrite).
- **One colour for the narrator** was drawn and not chosen (`mockups/c-narrator-colour-not-chosen`): amber for the
  file the narrator is in, the current step, the sketch and the caption, blue for the reviewer's own selection and
  controls. The author found it too much; it also sits close to the customary amber of the modified mark.
- **Visual** sits above the code and is collapsible and enlargeable. Collapsing it automatically when a step moves
  far from it is not in this change.

### 5a. Caption and step transitions

The caption is drawn in the same overlay layer as the spotlight (spike 1.2), never as a row inside the diff. An inline
row was tried in the mockups and rejected: it pushes the code down and up at every step, so the diff jumps while it
also scrolls. Placement is tried in order: below the target aligned right, right of the target, above the target;
the first that fits in the code panel without covering the target wins.

A step change runs as a sequence: caption fades out (about 150 ms), spotlight off, smooth scroll with easing to the
next target (duration grows with distance and is capped near 600 ms; a target in another file is a cross-fade of the
file view), spotlight on, caption fades in, voice starts. The scroll is our own eased animation of the scroll
position, taken from the library's line metrics; the library has no scroll-to-line on this component. A 600 ms scroll
across 1,500 lines showed no empty frame (spike 2.6). With `prefers-reduced-motion` every part is immediate.

### 6. Narration style and voice are both configuration

A style is a small directory: `style.md`, prose describing the narrator's voice with worked examples, and
`limits.toml`, the checks run on submit (maximum sentences and words per step, patterns that must not appear such as
line numbers or file paths). Lookup order: `.xenagos/styles/<name>/` in the reviewed repository, then
`~/.config/xenagos/styles/<name>/`, then the built-in default. The active style name is set in `.xenagos/config.toml`
in the repository or `~/.config/xenagos/config.toml`, repository first. Styles are read each time a guide is printed
or a plan is submitted, so an edit applies to the next generation with nothing rebuilt or restarted.

The authoring guide (`xen guide`) is composed at request time from the fixed format rules plus the active style's
`style.md`. The only style-independent check is that narration is plain text without markup, because the voice and the
caption both need that. A plan records the style name and a hash of the style it was narrated with.

Re-narration is a fixed request typed into the session; the agent fetches the plan with
`xen plan get --without-narration` and the current guide, and answers with `xen narration submit`, which accepts only
narration text per existing step. The server rejects any other change.

Voice is a separate interface: text, voice name and speed in; audio out, with word timings when the provider has them.
Shipped providers: `browser` (the browser's built-in speech, on the machine, default) and `command` (a shell command
that reads text on standard input and writes an audio file; covers macOS `say` and local neural voices). Provider,
voice and speed are set in the same configuration files. Cloud providers implement the same interface later. Audio
from non-browser providers is cached per step by a hash of text, provider, voice and speed.

As built (task 6.9): `voice.command` is the program and its arguments as a TOML list, run without a shell, with
`{output}` (required), `{voice}`, `{speed}` and `{rate}` (words a minute, 175 at speed 1, for `say -r`) filled in;
the narration arrives on standard input. The server (`POST /api/voice`) sniffs the format of what was written and
serves WAV, MP3, Ogg, FLAC or MP4; AIFF, the default of macOS `say`, is refused with a hint because Chromium cannot
play it (`say -o {output} --data-format=LEI16@22050` writes WAV). The cache key also includes the command. The viewer
asks for the next step's audio while the current one plays. A voice that fails is reported once and the rest plays
with captions at reading pace. Disclosure: the user marks a command that sends text away with `voice.off_machine`;
for the `browser` provider the browser's own `localService` flag on the chosen voice decides. The viewer asks once
per review (remembered in the browser) and stays silent until the reviewer accepts. Chromium plays audio only after
the reviewer has interacted with the page; pressing Play is such an interaction.

### 7. Visuals

A visual is agent-authored HTML shown in a sandboxed frame with scripts allowed and no network, same-origin access or
navigation. It talks to the viewer only by posting `link` (open a code location) and `select` (reviewer selected an
element) messages, and receives `spotlight` (mark an element). The frame is served with a content security policy that allows no
connections, since the sandbox alone does not stop requests. Mermaid is available inside the frame as a bundled
helper; nothing requires it.

As built: the frame is an `srcdoc` iframe with `sandbox="allow-scripts"`. Its document starts with a content
security policy that allows inline scripts and the viewer's `/visual-assets/` only, and no connections; the viewer
page's own policy (`frame-src 'none'`) stops a visual from navigating its frame anywhere, which the frame's policy
cannot do. A helper inside the frame finds declared elements by id, `data-element`, or Mermaid node, posts `link` on
click (when the element is linked) and `select` on Shift+click or for unlinked elements, draws `spotlight` marks,
and reports `ready` or `error`. The viewer accepts messages only from that frame and only for declared elements; any
other field, text included, is dropped. No `ready` within eight seconds, or an error, replaces the visual with a
notice and a repair request. Mermaid 12.3.0's standalone bundle (5.5 MB) is served at `/visual-assets/` without the
secret, since the opaque frame sends no cookie and `Origin: null`; only library files are there.

### 8. File categories

Order of rules: reviewer override for this review; `linguist-generated` in `.gitattributes`; known lock file names;
test path and file name patterns; otherwise Code.

### 8a. Configuration and file locations

| What | Where |
|---|---|
| User configuration, user styles | `${XDG_CONFIG_HOME:-~/.config}/xenagos/` (`config.toml`, `styles/`) |
| Repository configuration, repository styles | `.xenagos/` in the repository |
| Review data, private clones | `${XDG_DATA_HOME:-~/.local/share}/xenagos/` |
| Records of running reviews | `${XDG_STATE_HOME:-~/.local/state}/xenagos/reviews/` |
| Audio cache | `${XDG_CACHE_HOME:-~/.cache}/xenagos/` |

Settings are merged key by key, repository over user over built-in, and validated against one schema; an unknown key
is an error. `idle_minutes` defaults to 30 and `unopened_hours` to 24. Settings in this change: `agent_open` (`window` or `link`), `session.name` (template), `session.permission_mode`, `narration.style`, `voice.provider`,
`voice.name`, `voice.speed`, `voice.enabled`, `voice.command`, `voice.off_machine`, `idle_minutes`, `unopened_hours`.
`voice.command` is required when `voice.provider` is `command`; that is checked on the merged settings, so a
repository can choose the provider while the user's file holds the command.

### 9. State and access

Each review has a data directory under the data home, keyed by review id: pinned revisions, plan, category overrides,
progress, the questions asked with their selections, audio cache. Answers are not stored by xenagos; they are in the
session's conversation.

The server binds to 127.0.0.1 only. The secret is random per process and is carried in the address the browser is
opened with. The first request exchanges it for a cookie named after the review id (cookies are shared across ports
on one host, so the name keeps reviews apart) and redirects to an address without it. The secret stays valid for the
life of the process, so a second tab or a link given by an agent works. The server also checks the `Host` and `Origin` headers, which stops a web page on another
site from reaching it through the browser. Agent-side calls send the secret read from the registry file.

## Risks / Trade-offs

- [Typing into the session through the pseudo-terminal depends on Claude Code's input handling, which is not a
  documented interface] → Measured in spike 2.1 on one version; kept as an end-to-end check run against the installed
  Claude Code.
- [The overlay's attachment point inside `@pierre/diffs` is undocumented and may move on an upgrade] → Exact version
  pin, the adapter module, and the measured overlay check from spike 1.2 kept as a regression test.
- [The agent answers in the pane but does not point in the viewer] → The skill states when to use `xen show`; check on
  the end-to-end run.
- [`@pierre/diffs` changes its API] → Exact pin and the adapter module.
- [Browser voices sound flat] → The `command` provider is in the first version so a local neural voice can be tried
  without code changes.
- [Style limits reject good narration or pass bad narration] → Limits live in the style's `limits.toml` and can be
  changed or emptied by the user; the style's prose carries the rest.

## Spike Results

Run on 2026-11-13 with Claude Code 2.1.323. Throwaway code, not kept in the repository.

- **1.1 Attached wait: works.** A stdio MCP tool that returns after 300 seconds was called from an interactive
  session. At 120 seconds Claude Code moved the call to a background task and the agent ended its turn, saying it
  would continue when the result came. At 300 seconds the result arrived as a notification, the session woke with no
  user input, and the agent used the returned value. In a headless run (`claude -p`) a 150-second call returned as an
  ordinary tool result with no backgrounding. Not tested: waits longer than five minutes (the documented idle limit
  for stdio servers is 30 minutes), and a second wait in the same session.
- **1.3 Standalone session: works.** Python Agent SDK 0.2.181 started a session with an in-process tool and a working
  directory; the agent read a file in that directory and called the tool with the right content. The tool was listed
  as deferred, so the agent spent one turn loading it before the call. A five-turn trivial run cost about $0.30.
- **1.2 Overlay: works.** On `@pierre/diffs` 1.6.4, line highlight, box and circle stayed within 0.02 px of their
  target text across eleven states (scroll, unified to split and back, resize, hunk expansion, full expansion, line
  wrap, a far target), measured in headless Chromium for the diff view and the full-file view. What the build needs:
  - The library renders into an open shadow root. Rows are `div[data-line][data-line-type]`; in unified layout a
    deleted row carries the old line number, so rows are found by number and type together.
  - The overlay is one layer appended to each `code[data-code]` element, so page and horizontal scroll need no
    repositioning. It is redrawn after every library render and on resize; a layout switch replaces the code elements
    and removes the layer, so it is re-attached then.
  - Nothing may be inserted among the row elements: the library's line selection throws if it finds an extra child.
  - Collapsed context is not in the page until expanded, so a step targeting it expands that region first.
  - Known gaps: a circle on a span that wraps to two lines draws one oversized ellipse; in split layout the library's
    own line highlight on the added side also marks the paired deleted row; the attachment point is undocumented and
    may move on a library upgrade (a layer beside the code block inside the shadow root survived re-renders and is the
    fallback).
  - Not tested: Firefox and Safari, the library's virtualised diff component, browser zoom.

Second round, same day, same Claude Code version:

- **2.1 Typing into a session: works.** Through a pseudo-terminal running `claude attach`, a pasted question followed
  by Enter was submitted and answered. A second question sent while the session was running a 20-second command was
  queued by Claude Code and answered after the first.
- **2.2 Plain interactive sessions cannot be attached.** `claude attach` with the id or the name of a session started
  as plain `claude` answers "No job matching". Only sessions started in the background appear in `claude agents`.
- **2.3 A session knows its id.** `CLAUDE_CODE_SESSION_ID` is set in the environment of commands run by both a
  background and a plain interactive session. Not checked: whether it is set for other kinds of child process.

- **2.4 Questions through a Monitor: works in every kind of session, with reduced authority.** A session was asked
  to run Claude Code's Monitor tool on a command that prints one line per reviewer question. Tested in a plain
  interactive session and in a background session:
  - idle session: woke and answered within about 12 seconds;
  - busy session (running a 30-second command): answered within about 10 seconds;
  - the event reaches the agent marked as an automated notification, not as user input;
  - a line asking for a file to be created was declined by both sessions ("awaiting confirmation from user") until the
    user typed a standing instruction in the session itself, after which both carried it out;
  - the Monitor reported a 1800-second timeout, so it has to be started again for longer reviews. Not tested: a
    persistent Monitor, and behaviour after the timeout.

- **2.5 Continuing a plain session in the background: works.** A plain interactive session was told a word to
  remember and then closed. `claude --resume <id> --bg` continued it under the same id; `claude attach` then showed
  its earlier conversation and it answered with the remembered word. Run while the plain session was still open, the
  same command printed "session <id> is open in another Claude Code process, so this started a copy as <new id>" and
  left a second session, which had to be stopped and removed. The continued session lost its name unless one was
  passed again.

Decision after these spikes: one way of talking to the agent, the terminal pane (decision 4a). The Monitor route
(2.4) is recorded as a working alternative and is not built.

- **2.6 Spotlights on the virtualised whole-file view: works without line wrapping.** `@pierre/diffs` 1.6.4,
  `VirtualizedFileDiff` with `diffStyle: unified`, `expandUnchanged: true`, `overflow: scroll`, on a generated
  3,000-line file with four hunks (one deletions-only). About 100 to 200 rows are in the page at a time. Headless
  Chromium, development build.
  - Nineteen targets (line, box, circle; in the first window, near lines 1,800 and 2,950, on deleted lines, on
    unchanged lines) stayed within 0.02 px after a jump, a 600 ms eased scroll (every frame), a native smooth scroll,
    scrolling away and back, a resize, and a slow scroll across window changes. Boxes of 60 and 300 lines that cross
    the edge of the rendered window also passed.
  - The overlay layer on `code[data-code]` is never removed by the virtualiser. `onPostRender('update')` fires once
    per window change, and the redraw must happen synchronously inside it: deferring it to the next animation frame
    gave marks up to 1,000 px off for a few frames.
  - A target outside the rendered window is not drawn; one partly inside is drawn clamped to the rendered rows with an
    open edge.
  - Scroll to a line: `getLinePosition(line, side)` plus setting the scroll position. Eased over 600 ms across 1,500
    lines: no empty frame, worst frame 33 ms. Native smooth scrolling took 1.7 s for the same distance.
  - Tick positions computed from line metrics before rendering matched the real positions exactly for all four hunks.
  - With line wrapping on (a quarter of rows wrapped): a jump landed 680 to 1,140 px off until repeated, the total
    height grew by a fifth as rows were measured, ticks moved, an eased scroll ended short. Marks themselves stayed
    exact. Hence no wrapping in this change.
  - A browser text selection dragged across recycled rows kept 126 of about 415 lines and was lost after scrolling
    away. The library's own line selection persists.
  - Load: virtualised 81, 176 and 429 ms for 500, 3,000 and 10,000 lines with about 2,000 page nodes; the plain
    component took 84 ms at 500 lines and around half a second with 30,000 nodes at 3,000.
  - Redrawing all 22 test marks took up to 44 ms; row lookup was not optimised.
  - Not tested: other browsers, a production build, split layout, tabs in code, real wheel input, and whether the
    browser shows unpainted areas during native smooth scrolling.

Spikes 1.1 and 1.3 remain true but the design no longer depends on them (decision 4a).

## Decisions taken on the author's behalf, to confirm

Confirmed by the author on 2026-11-17, together with `default-style-draft.md` as the built-in default style (task 5.5)
and the voice recommendation under Open Questions.

- **Branch moved.** The review id includes the head, so a new head is a new review without a plan. The old review
  stays as it was and offers to open the new head; nothing is carried over in this change.
- **Agent opens a review that already has a session.** The existing session stays; the opening session is told. The
  user can replace it in the viewer.
- **The agent may edit files during a review** when the reviewer asks, in the user's checkout, under the user's
  permissions. xenagos neither helps nor hinders.
- **Ranges.** A branch against a base is compared from their fork point; two named revisions are compared directly.
- **No line wrapping in the walkthrough code view** (decided after spike 2.6, see decision 5b). Long lines scroll
  sideways.

### Fixes during a review (resolved 2026-11-17)

"The agent may edit files" and "a moved branch is a new review" pull against each other. If the agent commits a fix,
the branch moves and the reviewer is left with a new review that has no plan, while the old one still shows the code
without the fix. If it does not commit, the walkthrough survives, but the viewer does not show the fix either, since a
review covers committed changes only (spec `review-target`).

For this change: the skill tells the session to leave fixes uncommitted while a review is open and to say so, so the
reviewer checks the fix in the agent pane and commits after the review (spec `agent-link`, "Fixes during a review keep
the walkthrough"). In the private checkout the session says its edits are not in the user's checkout, because
`xen clean` removes them.

Found in the build (Claude Code 2.1.326): a background session does not edit the shared checkout; Claude Code puts
its edits in a git worktree under `.claude/worktrees/` in the repository, on a branch of its own, and `claude rm`
keeps a worktree that has uncommitted changes. A fix asked for during a review therefore lands in that worktree, not
in the user's checkout. The skill tells the session to say where the fix is and how to bring it over. Whether to
show worktree fixes in the viewer is a later change.

The skill ships inside the package as a Claude Code plugin (`xenagos/plugin`). Sessions xenagos starts or continues
load it with `--plugin-dir` and get this installation's `xen` first on their PATH (a background session receives the
caller's PATH, not other variables), so nothing is installed in the user's configuration. `xen skill install` copies
the skill into `~/.claude/skills` for the user's own sessions, on their request.

Later change: carry a plan over to a new head. Steps already store `expect` text, so the old plan can be validated
against the new head and every step that still matches kept.

## Not yet verified

- A session for the private checkout (task 3.3). `claude --bg` refuses a folder never trusted in Claude Code, and each
  review's private clone is a new folder, so starting a session there will fail until the user trusts it. To settle
  with task 3.3: one trusted parent for all clones does not help (parent trust does not count); options are telling
  the user to run `claude` there once, or not starting sessions in private clones.

- A session with a Monitor running reports `busy` even after its turn ended, so the viewer would show it as working.
  (`waiting` for an open permission prompt was seen in the build, as were `busy` and `idle`; the server reads them
  every two seconds while a viewer is open, which takes about 0.14 s each.)
- Detecting that another terminal has the session open, beyond `claude attach`. The server looks for `claude attach`
  processes naming the session other than its own; a session shown in Claude Code's agent view is not detected.

## Open Questions

- Which local neural voice to recommend for the `command` provider. Does not change the interface. Proposed and
  accepted on 2026-11-17, to be checked by ear in task 6.9: Kokoro (82M, Apache-2.0) as the recommended voice, Piper
  as the lighter fallback, and macOS `say` with a Premium voice as the option that needs no install.
