# End-to-end note (task 8.1)

Two full walkthroughs of real branches of this repository, played by the author (Kostas) in the viewer on the real
server. Each run lists what worked, what the narration sounded like, and every point where the reviewer had to leave the
viewer. The last part names the manual checks that scenario-coverage.md defers to this note (task 8.2).

## Run 1: opened by the session that wrote the branch (2026-11-19)

**Review** `02e8297379f44890`, `main...walkthrough-prototype` pinned at `1cb83a64..e43da929`: the whole prototype,
13 sections, 64 steps, one visual (section 8).

**Opened by** the Claude Code session that wrote the branch, with `xen open`. It wrote the walkthrough from `xen guide`
and submitted it with `xen plan submit`.
Deviation from the task: that session was a plain interactive one, not a background one, so the agent pane could not
show it. The pane said so and offered to continue it or start a new session; the reviewer started a new one.
A background session opening a review of its own work and the pane showing its earlier conversation was seen live for
task 7.2.

**What worked**

- The plan: sections are ideas spanning files (section 2, "One server per review, reached only with its secret", covers
  eleven files), ordered from what is pinned to how it is checked, with the orientation taken from the proposal and
  marked as such. No section or step gives a verdict.
- Narration under the default style builds step on step (section 2: the registry claim, then why the claim is a hard
  link, then "being on loopback is not enough").
- Playback, spotlight and captions across files; outline and header row; browse mode beside it.
- Starting a new session from the pane, once the folder was trusted.

**Found and fixed during the run**

- The play and pause button sat off centre, a page-sized blank gap appeared between two sections (a file view replaced
  while it was still loading appended its container anyway), and next while paused played on instead of stopping
  (spec: "Step by hand" added). Fixed in e709fc4.
- Browse rows repeated the status as a word beside its letter, hiding most of the path; the select arrow sat off.
  Fixed in e43da92.
- The one visual was easy to miss and its diagram too wide to read: diagram zoom and pan added (task 6.15). The side
  columns could not be resized: dividers added (task 6.14).
- Voice: the browser voice first, then Kokoro (`af_heart`) as a voice command, with the command's voices offered in the
  narration menu (bae7cda). Starting a step lagged about 2.7 s while Kokoro made its audio: the player now prepares the
  step it stands on, the same step for a new voice, and the next section's first step (536bdb3).

**What the narration sounded like.** With Kokoro, in the author's words after trying its voices from the menu: it
"works lovely".

**Where the reviewer left the viewer**

1. To a terminal, to run `claude` once in the repository and accept Claude Code's trust prompt, before a session could
   be started from the pane.
2. To the session that wrote the branch, in its own terminal, to ask how to ask about a selection and where the visuals
   were: that session could not be shown in the pane.
3. To a terminal, to rebuild and reinstall after fixes (a development step, not part of reviewing). A reinstall that
   reused uv's cached wheel served the old viewer until reinstalled with `--no-cache`.
4. Voice setup: installing Kokoro and pointing the configuration at it happened outside the viewer; choosing among its
   voices then happened in the narration menu.

## Run 2: opened by a person with no session (2026-11-20)

**Review** `d8a0ce62294cf803`, `e43da92..walkthrough-prototype` pinned at `e43da929..c606cf0a`: 37 files, the work done
after run 1 (resizable columns, diagram zoom, voices from the menu, audio prepared ahead, private checkout).

**Opened by** `xen` in a terminal with no Claude Code session, then driven in Chrome by the author's Claude Code
session on the author's request, standing in for the person. The page's audio was muted, so Kokoro spoke every step
unheard; how it sounds is the author's judgement from run 1.

**What worked**

- Asking for the first walkthrough: the pane showed the new background session with the request as its first message.
  It read the guide, wrote the plan to a file outside the repository and submitted it; the walkthrough appeared after
  190 s without a reload. 6 sections, 32 steps, one visual (a Mermaid diagram of where the session runs).
- The plan: the orientation states the problem and marks it as taken from the commit messages; each section is one
  idea across files (section 3, the voices, spans 11 files); no section or step gives a verdict; steps build on each
  other ("Start with the old guard on the server" ... "The server's guard now asks only whether a command exists").
- A question asked from a selection while the session was writing the plan showed as queued in the pane and was
  answered in the same run. The answer ran `xen show` on the voice code in another file and said what it showed.
- Playback across files with spotlight and caption; pause, then next while paused showed one step and stopped on it;
  play then went on from the following step.
- Asking from a selection during playback paused it. The answer to "who calls resize?" spotlighted the four callers
  while its text was in the pane; resume went back to the paused step and continued from it.
- Asked in the pane for a widget, the session added a visual with three sliders with `xen visual add` in 80 s. It
  appeared above the code at once, and moving the window-width slider updated the three column widths and their
  reasons.
- A small fix asked in the pane: the session said where the edit is, that the reviewed branch and the walkthrough are
  unchanged, that the viewer does not show it, and how to bring it over. The reviewed branch stayed at `c606cf0` and
  the plan kept its 6 sections and 32 steps.
- Asked to open a review of its own fix, the same session ran `xen open`; that review's agent pane showed the same
  session with its earlier conversation, and the notice that its display is shared with the other open review.
- The session's answers addressed the author as "Kostas", an instruction from his own Claude Code configuration: the
  session loaded the instructions for that folder.

**Found**

- The fix was committed. Claude Code put the background session's edit in a worktree of its own
  (`.claude/worktrees/default-left-comment`, branch `worktree-default-left-comment`) and the session committed it
  there (`4fdcc7e`), against the skill's "do not commit". The reviewed branch did not move, so the walkthrough
  survived; the session gave its reason (the fix outlives the worktree). The worktree folder then shows as untracked
  in the user's checkout.
- Adding the visual replaced the plan, and the viewer went back to step 1 of the section with no step marked done;
  before, it was paused on step 4.
- No permission prompt appeared: the author's Claude Code runs in auto mode. A prompt answered in the pane was seen
  live for task 7.1.

**Where the reviewer left the viewer.** Nowhere for the review itself. The link to the review of the fix was printed
in the pane, to be opened in a new tab, because the session was asked not to open a browser. The checks of git state
and of the session's commands were made outside, to verify, not because the review needed them.

## Manual checks named in scenario-coverage.md

| Scenario | Seen |
|---|---|
| Intent inferred | Run 2: the orientation states the problem and names its source (the commit messages); run 1 names the proposal. Inferred-from-code is covered by the plan tests only. |
| Idea spanning files | Runs 1 and 2: sections are ideas across files, titled by purpose. |
| No verdict | Runs 1 and 2: no section or step gives a verdict. |
| First walkthrough | Run 2. |
| Step that builds on the last one | Runs 1 and 2. |
| Switch provider | Run 1: browser voice, then Kokoro, same plan; voices switched in the menu and heard by the author. |
| Interactive model | Run 2: the slider widget. |
| Permission request | Task 7.1 (live); none arose in run 2 under auto mode. |
| Project instructions apply | Run 2: answers follow the author's instructions for the folder. |
| Review of an agent's own work | Run 2: the session's review of its own fix showed it in the pane with its conversation; also task 7.2. |
| Ask during work | Run 2. |
| Answer that points | Run 2, twice. |
| Fix asked during playback | Run 2: the walkthrough survived and the session said where the fix is and that the viewer does not show it, but it committed the fix on its own worktree branch (see Found). |
| Interrupt and resume | Run 2. |
