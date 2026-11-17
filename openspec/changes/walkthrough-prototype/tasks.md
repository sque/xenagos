# Tasks

## 1. Spikes that can change the design

- [x] 1.1 Attached wait: a throwaway stdio MCP server with a tool that returns after 5 minutes, called from a real Claude Code session; verified when the session receives the result and continues the tour without user input, or the failure mode is written into design.md with the fallback chosen
- [x] 1.2 Overlay: render one diff and one full file with the pinned `@pierre/diffs`, draw a box and a circle on given line and character ranges, scroll and switch layout; verified by measured mark-to-text offsets in a headless browser for each state
- [x] 1.3 Standalone session: start a session through the Python Agent SDK with one in-process tool and a working directory; verified when the session calls the tool and reads a file from that directory
- [x] 1.4 Type a pasted question into a background session through `claude attach` on a pseudo-terminal, idle and busy; verified by both answers appearing (design.md, spike 2.1)
- [x] 1.5 Try `claude attach` on a plain interactive session; verified by the recorded refusal (spike 2.2)
- [x] 1.6 Find how a session learns its own id; verified by `CLAUDE_CODE_SESSION_ID` in a background and a plain session (spike 2.3)
- [x] 1.7 Deliver reviewer questions through Claude Code's Monitor tool to a plain and a background session, idle and busy, including an action request; verified by the recorded answers and refusals (spike 2.4)
- [x] 1.8 Continue a closed plain session with `claude --resume <id> --bg`, attach, and check its context; repeat while it is still open; verified by the remembered word and by the recorded copy notice (spike 2.5)
- [x] 1.9 Spotlights on the virtualised file view: repeat the measurement of spike 1.2 on a 3,000-line file shown whole with the change in place, including a target far off screen and a box that crosses the rendered window; verified by measured offsets recorded in design.md, spike 2.6 (passes without line wrapping)

## 2. Project skeleton

- [x] 2.1 Repository with a uv-managed Python `server` package (ruff, strict type check, pytest) and a TypeScript `web` package (lint, type check, test runner), and a build that bundles the built viewer into the Python package; verified by one passing test per package and by `uv tool install` of the built package serving the viewer with no Node present
- [ ] 2.2 `xen [target]` starts a review server in the foreground on a free loopback port and opens the viewer, defaulting to the current branch against the default branch; verified by running it in the fixture with no arguments and by no new Claude Code session existing afterwards (spec: review-session)
- [ ] 2.3 Registry entry per running server (mode 0600), review id from repository, base and head, reuse of a running server for the same target, cleanup of dead entries, `xen list` and `xen stop`; verified by tests starting two reviews, reopening one, stopping one, and killing one
- [ ] 2.4 Access control: loopback bind, per-process secret exchanged for a cookie, cookie named per review, `Host` and `Origin` checks; verified by tests for a request with no secret, with another review's secret, and with a foreign `Origin`
- [ ] 2.5 Review data directory that outlives the server, and idle shutdown after a configurable period with no viewer, and after a longer period when never opened; verified by stopping and reopening a review with state intact, and by a test with a short idle period

## 3. Review target (spec: review-target)

- [ ] 3.1 Resolve range, single commit, and branch-against-base to pinned base and head ids, with errors naming an unknown revision; verified by tests on a fixture repository
- [ ] 3.2 Report when the reviewed branch has moved past the pinned head; verified by a test that commits to the fixture after opening
- [ ] 3.4 Default-target refusals (on the default branch, detached, no default branch found) and the notice that uncommitted changes are not included; verified by tests on the fixture
- [ ] 3.3 Private clone at the head when it differs from the user's checkout; verified by a test asserting `git status`, current branch and stash list of the fixture are identical before and after

## 4. Browse mode (spec: diff-browser)

- [ ] 4.1 Server endpoints for file list, per-file diff, file content at a revision, and commit list; verified by tests on the fixture
- [ ] 4.2 File categories with rule order from design decision 8 and per-review override; verified by tests including a lock file, a `linguist-generated` file and a test file
- [ ] 4.3 File tree grouped by category with counts, folders kept as a subtree inside each category, Generated collapsed and not rendered until opened; verified in the browser on a change containing a large lock file
- [ ] 4.4 Unified and side-by-side layouts, labels for renamed, added, deleted and binary files; verified in the browser on the fixture
- [ ] 4.5 Full-file expansion and stepwise expansion around a hunk; verified in the browser on a file with two distant hunks
- [ ] 4.6 Per-commit view with commit message; verified in the browser on a three-commit range

## 5. Plan (spec: walkthrough-plan)

- [ ] 5.1 Plan schema as Pydantic models, JSON Schema export, generated TypeScript types and a staleness check; verified by the check failing after a model change without regeneration, and by tests accepting a valid sample and rejecting samples with a missing role, an empty title, a step without target, a step without form, and a target naming an undeclared visual element
- [ ] 5.2 Anchor validation against pinned revisions including `expect` text, with rejected items named; verified by tests for an out-of-range target, a wrong `expect`, and a hunk claimed twice
- [ ] 5.3 Not-covered list by category with line counts; verified by a test where one hunk is left unclaimed
- [ ] 5.4 Configuration loading (spec: configuration): XDG locations with fallbacks, key-by-key merge of repository over user over built-in, schema validation with unknown keys reported, style directories with the same lookup order, read on each use; verified by tests for each level winning in turn, a partial repository override, a misspelled key, a custom `XDG_CONFIG_HOME`, and an edit taking effect without restarting the server
- [ ] 5.4a `agent_open`, `session.name` and `session.permission_mode` settings; verified by an agent-started review under each `agent_open` value and by a started session carrying the configured name and mode
- [ ] 5.5 Built-in default style (`style.md` with worked examples, `limits.toml`) from `default-style-draft.md` in this change, plus the `terse` style as a second built-in; verified by the user's approval of the draft recorded in design.md, and by the worked example passing its own limits
- [ ] 5.6 Narration checks: plain-text check always, plus the active style's limits, with step and limit named on rejection; verified by tests for markup, a line number under the default style, and the same text passing under a style with empty limits
- [ ] 5.7 Authoring guide printed by `xen guide`, composed from format rules, section and step rules, the no-verdict rule and the active style; verified by generating a plan for the fixture from the guide alone and passing validation
- [ ] 5.8 Re-narration through `xen plan get --without-narration` and `xen narration submit`, triggered by a control in the viewer, rejecting any change other than narration text, and recording style name and hash on the plan; verified by tests and by re-narrating the fixture walkthrough under a second style

## 6. Walkthrough viewer (specs: walkthrough-narration, section-visuals, repository-explorer)

- [x] 6.1 Mockups of browse mode and of walkthrough mode mid-step, reviewed by the user; layout "B" approved on 2026-11-13 and recorded in design.md decision 5b
- [ ] 6.2 Three-column walkthrough layout from decision 5b with a draggable divider between outline and agent; verified in the browser at 1280 and 1440 wide
- [ ] 6.3 Whole-file code view on the virtualised diff component, lines not wrapped, horizontal scroll to a far target: unified diff fully expanded, deleted lines inline without a number, change ticks beside the scroll track, base content for steps that target the base revision; verified in the browser on a file with an added block, a deleted line and a far change
- [ ] 6.4 Repository explorer: tree at the head with deleted files added back, change marks on files and folders, generated files de-emphasised, current-file highlight that reveals and follows the narrator, visited mark, changed-but-not-covered mark, narrow and whole views with hidden counts, open-file pauses playback; verified by tests on the fixture for the data and in the browser for each mark
- [ ] 6.5 Header row and outline: section title, positions, one-line explanation with full text on request; outline with orientation, sections, current section's steps and their states, unchanged-code mark, jump on choose; verified in the browser
- [ ] 6.6 Overlay drawn synchronously in the library's post-render hook, off-window targets not drawn and partly rendered ones clamped; overlay regression check: the measured comparison of mark position against target text from spikes 1.2 and 2.6, run in a headless browser for scroll, layout switch, resize and expansion; verified by the check passing and by it failing when redraw-after-render is disabled
- [ ] 6.7 Step playback: bring target into view with our own eased scroll from the library's line metrics, spotlight (lines, box, circle), caption as an overlay that moves no code and never covers the target, close-scroll-open sequence between steps, immediate under reduced motion, hide-caption control, pause between steps, stop at section end; verified in the browser including a step in an unopened file and a step on untouched code
- [ ] 6.8 Controls: icon transport (previous, pause or resume, next, replay), keyboard equivalents, jump from the outline, pause on scroll or click elsewhere and return on resume; verified in the browser
- [ ] 6.9 Voice interface with `browser` and `command` providers, audio cache, voice off, failure fallback to captions, disclosure for off-machine providers; verified by tests for the command provider and cache, and by ear in the browser
- [ ] 6.10 Narration menu with voice group and wording group, including the rewrite-narration request and the active style name; verified in the browser
- [ ] 6.11 Visual frame with sandbox, `link`, `select` and `spotlight` messages, bundled Mermaid helper, and the render-failure notice; verified by a visual that tries a network call and is blocked, and a malformed visual that shows the notice
- [ ] 6.12 Visual pane above the code: shown only when the section has one, collapse and enlarge, code view takes freed space; verified in the browser moving between a section with and without a visual
- [ ] 6.13 Not-covered hunks reachable in walkthrough mode with files and line counts; verified in the browser on a plan that leaves one hunk unclaimed

## 7. Agent link (spec: agent-link)

- [ ] 7.1 Agent pane: server-side pseudo-terminal running `claude attach`, WebSocket bridge with resize, browser terminal in the viewer, attach process ended when the viewer disconnects and the session left running; verified in the browser on a background session, including a permission prompt answered in the pane
- [ ] 7.2 Session choice: use the session that ran `xen open` via `CLAUDE_CODE_SESSION_ID`, `xen --session`, or start one on first need with configured name template and permission mode in the right working directory; never resume automatically; verified by tests for each path and by the pane showing an existing session's earlier conversation
- [ ] 7.3 Session that cannot be shown: review opens, plan accepted, pane explains and offers to continue it here or start a new one; continue keeps id, conversation and name; a copy started because the original is still open is stopped and removed and the user is told to close it; verified by running `xen open` from a plain interactive session and choosing continue once after closing it and once while it is open
- [ ] 7.4 `xen` agent commands (`guide`, `plan submit`, `plan get`, `narration submit`, `show`, `step add`, `visual add`) finding their review by session id or `--review`, restarting an ended server from saved state, with anchor validation and errors the agent can act on; verified by tests against the fixture
- [ ] 7.5 Claude Code skill teaching the session the commands, when to point, and to leave fixes uncommitted while a review is open (saying so, and saying when edits land in the private checkout); verified by a session authoring a valid plan for the fixture and using `xen show` in an answer, with only the skill as guidance, and by a fix asked during playback that stays uncommitted with the plan intact
- [ ] 7.6 Selection prompt on code and on visual elements; question and one-line reference pasted into the attach pseudo-terminal and submitted; control characters stripped and the reference built from validated values; fixed requests for walkthrough, re-narration and visual repair; verified in the browser idle and busy, by a question containing escape sequences, and by a visual that tries to send text or names an undeclared element
- [ ] 7.7 Session state in the viewer (working, idle, waiting, ended), offer to start a session when it ends, shared-display notice when the session is open elsewhere; verified in the browser for each
- [ ] 7.9 Walkthrough mode with no plan: empty state, ask-for-walkthrough control, plan appears when valid, ask-again control; style name shown; verified in the browser from a review with no session
- [ ] 7.10 Replace the review's session on the user's request, and keep the existing session when another one opens the same review; agent session name in `xen list`; verified by tests and in the browser
- [ ] 7.8 Asking pauses playback and resume continues from the same step; verified in the browser

## 8. End to end

- [ ] 8.1 Run a full walkthrough on a real multi-file branch twice, once opened by the background session that wrote the branch and once opened by a person with no session; verified by a written note listing what worked, what the narration sounded like, and every point where the reviewer had to leave the viewer
- [ ] 8.2 `openspec validate walkthrough-prototype --strict` passes and every scenario in the nine specs is covered by a test or by a named manual check in the note from 8.1
