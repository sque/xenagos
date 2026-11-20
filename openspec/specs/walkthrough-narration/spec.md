# walkthrough-narration Specification

## Purpose
Playing a section the way an author explains at a shared screen: show the place, mark it, say what is going on, then
move to the next place, at a pace a person can follow and can interrupt.

## Requirements

### Requirement: Step playback
Playing a section SHALL run its steps in order. For each step the viewer SHALL first bring the target into view, opening
the file and scrolling as needed, then mark it with a spotlight, then speak the step's narration while showing the same
text as a caption at the target. The spotlight SHALL be removed when the next step begins.

#### Scenario: Step in another file
- **GIVEN** step 2 targets a file that is not open
- **WHEN** step 1 ends
- **THEN** the file opens at the target lines, the spotlight appears, and only then does the voice for step 2 start

### Requirement: The caption floats and does not move the code
The caption SHALL be shown as an overlay anchored to the step's target. Showing or removing it SHALL NOT change the
layout of the diff: no line moves. It SHALL NOT cover any part of the target. It MAY cover other code, and the reviewer
SHALL be able to hide it for the current step.

#### Scenario: Caption appears
- **GIVEN** a step whose target is lines 133 to 137
- **WHEN** the step's caption appears
- **THEN** every code line is at the same position as before, and lines 133 to 137 are fully visible

#### Scenario: Caption in the way
- **WHEN** the reviewer hides the caption because it covers a line they want to read
- **THEN** the caption is gone until the next step, and playback continues

### Requirement: Moving between steps is smooth
On a change of step the current caption SHALL close, then the viewer SHALL scroll to the next target with a visible,
continuous movement when it is in the same file, then the spotlight and the new caption SHALL appear. Only one caption
SHALL be shown at a time. When the user's system asks for reduced motion, the changes SHALL be immediate.

#### Scenario: Next step further down the same file
- **GIVEN** step 2 targets lines 133 to 137 and step 3 targets lines 157 to 161 of the same file
- **WHEN** step 2 ends
- **THEN** its caption closes, the code scrolls continuously until lines 157 to 161 are in view, and only then does
  step 3's caption appear

#### Scenario: Reduced motion
- **GIVEN** the system setting for reduced motion is on
- **WHEN** a step ends
- **THEN** the next target is shown without animated scrolling

### Requirement: Spotlight forms
A spotlight SHALL be one of: highlighted whole lines, a box around a region, or a circle around a short span. It SHALL
work on changed lines on either side of a diff, on unchanged lines of an expanded file, and on an element of a visual.

#### Scenario: Circle on one call
- **WHEN** a step targets a single call expression with a circle
- **THEN** a circle is drawn around that expression and the rest of the line is not marked

### Requirement: Narration is speakable text
Narration SHALL be plain text that can be spoken as written, with no markup. The same text SHALL serve as the caption.
A plan containing narration with markup SHALL be returned to the agent, with the step named, before it is shown.

#### Scenario: Markup in narration
- **WHEN** the agent submits a step whose narration contains a heading or a code fence
- **THEN** the plan is returned to the agent with that step named

### Requirement: Narration style is configuration
The style narration is written in SHALL come from a style definition in configuration and not from the application. A
style definition SHALL hold a description of the narrator's voice with examples, and the limits checked when a plan is
submitted. The viewer SHALL show the name of the style a walkthrough was narrated with.

#### Scenario: Style named in the viewer
- **WHEN** a walkthrough narrated with the style `default` is opened
- **THEN** the viewer shows `default` as its narration style

### Requirement: Style changes need no rebuild
A user SHALL be able to edit the active style or select another, for themselves and per repository, with the
repository's choice taking precedence. The change SHALL apply to the next narration generated, with no reinstall,
rebuild or restart of an open viewer.

#### Scenario: Edit the style
- **GIVEN** the user changes the style's voice description from a teacher to a terse colleague
- **WHEN** the next walkthrough is generated
- **THEN** its narration follows the new description and the viewer shows that style's name

#### Scenario: Repository overrides user
- **GIVEN** the user's configuration selects one style and the reviewed repository's configuration selects another
- **WHEN** a walkthrough of that repository is generated
- **THEN** the repository's style is used

### Requirement: Default style
xenagos SHALL ship a default style: the author explaining the change to a colleague, warm and plain. Under it each
step says where to look and then what it means, in one to three first-person sentences, connects to what the previous
step established, and does not recite code token by token or speak file paths or line numbers.

#### Scenario: Step that builds on the last one
- **GIVEN** the default style, and step 1 explained that the queue picks a replica by depth alone
- **WHEN** step 2 introduces the new penalty
- **THEN** step 2's narration refers back to the depth rule in its own words before saying what the penalty adds

### Requirement: Style limits are enforced on submit
A plan whose narration breaks a limit of the active style SHALL be returned to the agent, with the step and the limit
named, before it is shown.

#### Scenario: Line number under the default style
- **GIVEN** the default style is active
- **WHEN** the agent submits a step whose narration names a line number
- **THEN** the plan is returned to the agent naming that step and that limit

### Requirement: Re-narrate without re-planning
The reviewer SHALL be able to ask, from the viewer, for the narration of an existing walkthrough to be rewritten under
the currently active style. Sections, claimed code, step targets and visuals SHALL stay as they were.

#### Scenario: Try another style on the same walkthrough
- **GIVEN** a walkthrough narrated with the default style
- **WHEN** the user selects another style and asks for re-narration
- **THEN** every step keeps its target and order, only narration text changes, and the viewer shows the new style's name

### Requirement: Human pace
Playback SHALL leave a short pause between steps and SHALL stop at the end of each section until the reviewer continues.

#### Scenario: End of section
- **WHEN** the last step of a section finishes
- **THEN** playback stops, the section stays on screen, and nothing advances until the reviewer chooses the next section

### Requirement: Reviewer controls
The reviewer SHALL be able to play, pause, resume from the paused point, replay the current step, go to the previous or
next step, jump to any section or step, and change speech speed. Scrolling or clicking elsewhere during playback SHALL pause it
without losing the current step.

#### Scenario: Wander off and return
- **GIVEN** playback is on step 3
- **WHEN** the reviewer scrolls to another file and later presses resume
- **THEN** the viewer returns to step 3's target and continues from step 3

#### Scenario: Step by hand
- **GIVEN** playback is paused, or has not started, on step 2
- **WHEN** the reviewer presses next
- **THEN** the viewer shows and speaks step 3 and stops on it, without moving on to step 4
- **AND** pressing play then continues from step 4

### Requirement: Voice is pluggable
The voice that speaks narration SHALL be a replaceable provider chosen in configuration. The system SHALL ship a
provider that runs on the machine with no account, and SHALL accept a provider defined by the user as a command that
receives the narration text and returns audio. Changing provider or voice SHALL NOT require regenerating the plan.

#### Scenario: Switch provider
- **GIVEN** a review whose plan was generated while the on-machine provider was active
- **WHEN** the user configures a different provider and replays a section
- **THEN** the same steps play with the new voice and the plan is unchanged

#### Scenario: Try voices from the menu
- **GIVEN** the configuration names a voice command with several of its voices, beside the browser's own voices
- **WHEN** the reviewer picks another voice in the narration menu
- **THEN** the next step is spoken in that voice, and the choice is kept for the next visit in that browser

#### Scenario: User command as provider
- **GIVEN** the configured provider is a user command
- **WHEN** a step plays
- **THEN** the command receives that step's narration text and the audio it returns is what the reviewer hears

#### Scenario: Provider fails
- **WHEN** the provider returns an error or no audio for a step
- **THEN** the step plays with caption and spotlight only, and the viewer reports the failure once

### Requirement: Voice is optional and disclosed
The reviewer SHALL be able to turn voice off; playback then advances by caption with the same spotlight and pacing.
When the configured provider sends narration text outside the machine, the viewer SHALL say so before the first use in
a review.

#### Scenario: Voice off
- **WHEN** the reviewer turns voice off and plays a section
- **THEN** each step shows its spotlight and caption for a reading-length time and no audio is produced

### Requirement: Walkthrough shows whole files
In walkthrough mode the code view SHALL show one file at a time in full, at the reviewed head, with the change marked
in place: added and modified lines marked, and deleted lines shown where they were, marked as deleted and without a
line number of their own. The positions of the changes within the file SHALL be indicated along the scroll track. A
step that targets the base revision SHALL show the base content at its target.

#### Scenario: File with a deletion
- **GIVEN** a 212-line file where the change replaces one line by five
- **WHEN** a step shows that file
- **THEN** all 212 lines are available by scrolling, the five new lines are marked as added, the removed line appears
  above them marked as deleted, and the scroll track shows where the change is

### Requirement: Section and step are always in view
While a walkthrough is open the viewer SHALL show, in a single compact row above the code, the current section's
title, its position among the sections, the current step's position in the section, and the section's explanation
shortened to one line with the full text available on request.

#### Scenario: Long explanation
- **WHEN** the current section's explanation does not fit on one line
- **THEN** it is cut with an ellipsis and the full text can be opened

### Requirement: Outline of sections and steps
The viewer SHALL show an outline listing the orientation and every section in order. The current section SHALL be
expanded into its steps, each marked as done, current or upcoming, and a step that targets unchanged code SHALL be
marked as such. Choosing a section or a step SHALL go to it.

#### Scenario: Jump to a later step
- **GIVEN** the outline shows the current section's four steps and playback is on the second
- **WHEN** the reviewer chooses the fourth
- **THEN** the viewer goes to the fourth step's target, spotlights it and shows its caption

### Requirement: Voice and wording settings are together and distinct
The viewer SHALL offer one menu holding two labelled groups: voice settings, which change how narration sounds
(spoken or not, which voice, speed), and wording settings, which change what is said (the narration style, and the
request to rewrite the narration). The transport controls SHALL be compact and SHALL NOT need text labels.

#### Scenario: Reviewer looks for the style
- **WHEN** the reviewer opens the narration menu
- **THEN** the narration style appears under wording, separate from the voice settings
