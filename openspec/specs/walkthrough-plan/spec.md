# walkthrough-plan Specification

## Purpose
The agent-authored plan behind walkthrough mode: an ordered set of sections that build the reviewer's mental model of
the change one idea at a time, each tied to real code, and honest about what it leaves out. In these specs a hunk is one
contiguous changed region of a file in the diff, a section is one idea of the plan, and a step is one narrated moment
inside a section.

## Requirements

### Requirement: Opening orientation
A plan SHALL begin with an orientation that states the problem the change addresses before any solution, in at most a
short paragraph, and names the source of that statement: the commit messages, a document in the repository, or the
agent's own reading of the code.

#### Scenario: Intent inferred
- **GIVEN** a change whose commit messages say only "wip"
- **WHEN** the plan is generated
- **THEN** the orientation states the problem and marks it as inferred from the code

### Requirement: Sections are ideas, ordered to build understanding
A plan SHALL split the change into ordered sections. Each section SHALL carry one idea, a title that names that idea
and not a file, a short explanation, a role of core, consequence or support, and the hunks that
implement it. A section MAY draw code from several files. Later sections MAY rely on earlier ones; no section SHALL
depend on a later one to make sense.

#### Scenario: Idea spanning files
- **GIVEN** a change where a new field is added in one file and read in two others
- **WHEN** the plan is generated
- **THEN** one section holds the three related hunks under a title naming the purpose of the field

### Requirement: Steps point at code, changed or not
Each section SHALL contain ordered steps. A step SHALL have narration text, a target and a spotlight form. A target is a line
range in a file at the base or head revision, optionally narrowed to a span of characters, or an element that one of
the section's visuals declares. A step MAY target code the change did not touch.

#### Scenario: Refresher on untouched code
- **GIVEN** a change that alters how a function is called but not the function
- **WHEN** a step needs to recall what the function does
- **THEN** the step targets the function's unchanged lines at the head revision

### Requirement: Anchors are validated
Before a plan is shown, every hunk it claims and every step target SHALL be checked against the pinned
revisions. A plan with a target that does not resolve SHALL be rejected and returned to the agent with the failing
anchors named; it SHALL NOT be shown with broken or shifted highlights.

#### Scenario: Line range past end of file
- **WHEN** the agent submits a step targeting lines 400-410 of a 120-line file
- **THEN** the plan is rejected, the error names that step, and the viewer keeps showing the previous state

### Requirement: Coverage is visible
Every hunk of the diff SHALL be either claimed by exactly one plan section or listed as not covered. The
viewer SHALL make the not-covered hunks visible in walkthrough mode, with their files and line counts, and SHALL let
the reviewer open any of them.

#### Scenario: Uncovered code change
- **GIVEN** a plan that claims every hunk except one in `src/retry.py`
- **WHEN** the walkthrough opens
- **THEN** `src/retry.py` is shown as changed but not covered, with its line count, and can be opened

### Requirement: The plan explains and does not vouch
Plan text SHALL explain what the change does and why. It SHALL NOT state that the change is correct, safe or ready to
merge.

#### Scenario: No verdict
- **WHEN** a plan is generated for any change
- **THEN** no section or step contains an approval or correctness verdict

### Requirement: A walkthrough is asked for, not automatic
Walkthrough mode for a review that has no plan SHALL say so and offer a control to ask for one. Using it SHALL ask the
review's agent session to write the plan, starting a session if the review has none. The plan SHALL appear when the
agent has submitted one that passes validation. The reviewer SHALL be able to ask for the plan to be written again.

#### Scenario: First walkthrough
- **GIVEN** a review with no plan and no agent session
- **WHEN** the reviewer asks for a walkthrough
- **THEN** a session starts, the request to write the plan is visible in the agent pane, and the sections appear once a
  valid plan is submitted
