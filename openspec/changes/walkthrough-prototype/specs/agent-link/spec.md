# Spec Delta

## Purpose

Gives each review a real Claude Code session, shown in the viewer as that session's own terminal interface, so the
reviewer talks to an agent that works in the reviewed code under the reviewer's normal rules, and so selections and
questions reach it without copying between windows.

## ADDED Requirements

### Requirement: The agent pane is the session itself
The viewer SHALL show the review's agent as Claude Code's own interface in a terminal pane, not as a re-drawn chat. The
reviewer SHALL be able to type in it directly, and anything the session asks, including permission requests, SHALL
appear and be answerable there.

#### Scenario: Permission request
- **WHEN** the agent wants to run a command that needs the reviewer's approval
- **THEN** Claude Code's own approval prompt appears in the pane and the reviewer answers it there

### Requirement: The session runs where the code is
The review's session SHALL run with its working directory in the reviewed repository: the user's checkout when it is at
the reviewed head, otherwise the private checkout. Project instructions and settings that Claude Code loads for that
directory SHALL therefore apply. When the private checkout is used, the viewer SHALL say so, since settings that
exist only in the user's own checkout do not apply there.

#### Scenario: Project instructions apply
- **GIVEN** the repository has project instructions for Claude Code
- **WHEN** the reviewer asks a question in a review of that repository
- **THEN** the session answering is one that loaded those instructions

### Requirement: xenagos does not change what the agent may do
xenagos SHALL NOT grant, widen or narrow the session's permissions. For a session xenagos starts, the permission mode
SHALL come from configuration and SHALL default to Claude Code's own default.

#### Scenario: Default mode
- **GIVEN** no permission mode is configured
- **WHEN** xenagos starts a session for a review
- **THEN** the session runs in Claude Code's default permission mode

### Requirement: Use the session that did the work, or start one
A review opened by an agent session SHALL use that session as its agent, unless the review already has one, in which
case the existing session stays and the opening session is told so. A person SHALL be able to name an existing
session when opening a review. Otherwise xenagos SHALL start a session when the reviewer first asks for a walkthrough
or asks a question. xenagos SHALL NOT resume a stopped session by itself.

#### Scenario: Review of an agent's own work
- **GIVEN** a background agent session has finished changes on a branch
- **WHEN** that session opens a review of the branch
- **THEN** the agent pane shows that same session, with its earlier conversation

### Requirement: A session that cannot be shown does not block the review
When the session that opened a review is of a kind that cannot be shown in the pane, the review SHALL still open and
the walkthrough that session authors SHALL still be accepted. The pane SHALL say why it is empty.

#### Scenario: Review opened by a hand-started session
- **WHEN** a session the user started by hand in a terminal opens a review and submits a plan
- **THEN** the review opens with that walkthrough and the pane explains that this session cannot be shown

### Requirement: Such a session can be continued in the pane
The pane SHALL offer to continue that same session once the user has closed it where it runs, keeping its
conversation, or to start a new session. Continuing SHALL happen only on the user's choice. If the session is still
open elsewhere, xenagos SHALL NOT leave a copy of it running and SHALL tell the user to close it first.

#### Scenario: Continue a hand-started session
- **GIVEN** a review opened by a session the user started by hand in a terminal, which the user has since closed
- **WHEN** the user chooses to continue it in the pane
- **THEN** the pane shows that same session with its earlier conversation, under the same session id

#### Scenario: Still open elsewhere
- **GIVEN** the session is still open in the user's terminal
- **WHEN** the user chooses to continue it in the pane
- **THEN** no second copy of the session is left running and the pane asks the user to close it first

### Requirement: Questions carry their selection
The reviewer SHALL be able to select lines of code or an element of a visual and ask a question about it from a small
prompt at the selection. The question SHALL be entered into the session as the reviewer's message, together with a
reference to the file, revision side and line range or element, and the section and step the reviewer was on.

#### Scenario: Ask on a selection
- **GIVEN** the reviewer has selected lines 40-52 of a file on the head side during section 3
- **WHEN** they type "why is this guard needed?" in the prompt and send it
- **THEN** the session receives that question with the file, side, range and section, with no pasting by the reviewer,
  and its answer appears in the agent pane

### Requirement: What xenagos may enter into the session
xenagos SHALL enter into the session only: text the reviewer submitted, with its selection reference; and a short
fixed request that the reviewer triggered with a control in the viewer, namely to write the walkthrough, to rewrite
its narration, to repair a visual, or the first message of a session xenagos starts or continues. Every such entry
SHALL be visible in the agent pane as a message. Content of the diff, of files or of visuals SHALL NOT be entered.

#### Scenario: Visual tries to speak to the agent
- **WHEN** a visual's content attempts to send text to the session
- **THEN** nothing is entered into the session

### Requirement: Entries cannot carry control sequences
Text entered into the session SHALL have terminal control characters removed, and a selection reference SHALL be
built by xenagos from values it knows: a file in the review, a revision side, line numbers, a declared element id, a
section and step number.

#### Scenario: Question containing an escape sequence
- **WHEN** the reviewer's question contains terminal escape characters
- **THEN** the session receives the question's visible text only

### Requirement: A question to a busy agent waits
A question sent while the session is working SHALL be queued by the session and answered after its current work, and
the viewer SHALL show whether the session is working, idle, waiting for the reviewer, or ended.

#### Scenario: Ask during work
- **GIVEN** the session is in the middle of a task
- **WHEN** the reviewer sends a question from a selection
- **THEN** the question is shown as queued in the pane and is answered when the current task finishes

### Requirement: The agent can point in the viewer
The session SHALL be able to submit the walkthrough plan, spotlight code or a visual element, and add a step or a
visual to a section. Everything it submits SHALL pass the same anchor validation as the plan.

#### Scenario: Answer that points
- **WHEN** the agent answers a question by referring to a caller in another file
- **THEN** the viewer opens and spotlights that caller while the answer text is in the pane

### Requirement: Fixes during a review keep the walkthrough
The skill shipped with xenagos SHALL tell the session to leave a fix uncommitted while a review is open, since a
commit moves the branch and starts a new review without the plan, and to say that the fix is not shown in the viewer.
This is guidance to the session, not a permission rule.

#### Scenario: Fix asked during playback
- **GIVEN** a walkthrough of `feature` at head `H1` is being played
- **WHEN** the reviewer asks the agent to fix a line
- **THEN** the agent edits the file, does not commit, and says the fix is uncommitted and not shown in the viewer, and the review still has its plan at `H1`

### Requirement: Edits in the private checkout are disclosed
The skill SHALL tell the session that, when it runs in the private checkout, it says its edits are not in the user's
checkout and are removed with the review's data.

#### Scenario: Fix asked in the private checkout
- **GIVEN** the review's session runs in the private checkout
- **WHEN** the reviewer asks the agent to fix a line
- **THEN** the agent says its edit is not in the user's checkout before or while making it

### Requirement: Asking pauses playback
Asking a question during playback SHALL pause playback at the current step; the reviewer SHALL be able to resume from
that step.

#### Scenario: Interrupt and resume
- **GIVEN** playback is on step 2 of section 4
- **WHEN** the reviewer asks a question and later presses resume
- **THEN** playback continues from step 2 of section 4

### Requirement: Shared display is disclosed
When the review's session is also open in another terminal, the viewer SHALL say that the session's display size is
shared and may look wrong in one of them.

#### Scenario: Same session open twice
- **GIVEN** the session is open in the user's own terminal
- **WHEN** the same session is shown in the viewer's pane
- **THEN** the viewer shows a notice about the shared display size
