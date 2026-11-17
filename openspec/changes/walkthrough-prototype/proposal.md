# Proposal

## Why

Reviewing a change, whether written by an agent or by a colleague, means rebuilding the author's mental model from a
diff. Existing tools tried on a real PR (Plannotator, Kankō, Codiff) split the change into explained sections, but none
narrates a section the way an author would at a screen share: pointing at the lines, speaking, moving on at a human
pace. Questions asked inside those tools also went to a tool-less side session, so answers had to be relayed by hand.

## What Changes

First working prototype of xenagos, a local web viewer with two modes over one diff. A person starts it in a folder
to look at a change; an agent starts it for its user after implementing one. Each review is its own instance.

- Review a local diff: a branch range, a single commit, or the commits of a range one at a time. The user's working
  copy is never modified.
- Browse mode: file tree grouped as Code, Tests and Generated; split or unified diff; any file expandable to its full
  content.
- Walkthrough mode: an agent splits the diff into ordered sections that build a mental model step by step. The
  reviewer sees whole files with the change marked in place, a tree of the repository showing where the narrator is
  and which files changed, and an outline of sections and steps.
- Narration: each section plays as a sequence of spoken steps. For each step the viewer jumps to the file, spotlights
  the lines (highlight, box or circle) and speaks the explanation, then moves on. Steps may point at unchanged code.
- Visuals: a section may carry a diagram or a small interactive widget, in any form the agent finds clearest.
- Agent: each review has a real Claude Code session, shown in the viewer as its own terminal interface and running
  in the reviewed code under the reviewer's normal permissions. It is the session that did the work when an agent
  opened the review, otherwise one xenagos starts.
- Questions: the reviewer selects code or a visual and asks from a prompt at the selection; the question is entered
  into that session with the selection reference, and the session can point back into the viewer.

Out of scope here, planned as later changes:

- `github-pr`: open a GitHub PR by number or URL, use its description as author intent.
- `review-comments`: show PR comments, discuss one with the agent, apply a fix, reply and resolve.
- Reviewer calibration and understanding checks (what the reviewer already knows; a closing check).
- Sharing a finished walkthrough as a static page.

## Capabilities

### New Capabilities

- `review-target`: what is being reviewed, how it is resolved to a fixed pair of revisions, and the guarantee that the
  user's working copy is untouched.
- `diff-browser`: the browse mode: file tree, Code / Tests / Generated grouping, per-commit view, split and unified
  diff, full-file expansion.
- `walkthrough-plan`: the agent-authored plan: ordered sections, steps, anchors to real code, validation against the
  diff, and the list of changes the plan does not cover.
- `walkthrough-narration`: playing a section over whole files: voice, spotlight, caption, pacing, outline of
  sections and steps, and reviewer controls.
- `repository-explorer`: the file tree in walkthrough mode: change marks, the narrator's position, files the
  walkthrough visits or skips.
- `section-visuals`: optional diagrams and interactive widgets attached to a section, and how they are isolated.
- `review-session`: who starts a review and when, independent instances side by side, reuse, listing and stopping,
  state that survives, one agent per review, and local secret-bound access.
- `configuration`: user-wide settings in the XDG location with per-repository override, including how an
  agent-started review is presented.
- `agent-link`: the review's Claude Code session shown as a terminal pane, where it runs, what it may do, how
  questions with their selection reach it, and how it points back into the viewer.

### Modified Capabilities

None. This is the first change.

## Impact

- New repository `xenagos`; no existing code.
- Runs locally. Reads git repositories on disk and starts or shows Claude Code background sessions.
- Narration voice may send narration text to a speech service, depending on the design decision on voice; the specs
  require that this is visible and can be turned off.
