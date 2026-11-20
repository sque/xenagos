# Spec Delta

## Purpose

Lets the agent accompany a section with whatever picture conveys the idea best, from an informal sketch to a small
interactive model, without letting agent-authored content reach outside its frame.

## ADDED Requirements

### Requirement: Optional, free-form visuals
A section MAY have one or more visuals. A visual MAY be a static diagram or an interactive widget whose state the
reviewer can change. No diagram notation SHALL be required. A section without a visual SHALL be valid.

#### Scenario: Interactive model
- **GIVEN** a section about a scoring rule
- **WHEN** the agent attaches a widget with adjustable inputs
- **THEN** the reviewer can change the inputs and see the resulting choice update

### Requirement: The visual comes before the code
When the current section has a visual, walkthrough mode SHALL show it in the same column as the code and above it,
so it is seen first. The reviewer SHALL be able to collapse it and to enlarge it. When the section has no visual, no
space SHALL be taken and no placeholder shown.

#### Scenario: Section without a visual
- **WHEN** the reviewer moves from a section with a visual to one without
- **THEN** the visual area is gone and the code view uses the freed space

#### Scenario: Collapse to read code
- **WHEN** the reviewer collapses the visual
- **THEN** the code view uses the freed space and the visual can be opened again

### Requirement: Diagrams can be zoomed and panned
A visual drawn as a diagram SHALL open fitted to its pane, with zoom in, zoom out and fit controls over it. The
reviewer SHALL be able to zoom with a pinch or Ctrl and the wheel, and to move the diagram by dragging it or with the
wheel. A visual that is not a diagram SHALL keep its own scrolling and its own handling of the pointer.

#### Scenario: Read a wide diagram
- **GIVEN** a section visual whose diagram is wider than its pane
- **WHEN** the reviewer zooms in and drags the diagram
- **THEN** the diagram grows and follows the drag

### Requirement: A zoomed diagram keeps its links and spotlights
In a zoomable diagram, a click that does not drag SHALL still link or select as before, and a spotlight on an element
outside the shown part SHALL move the diagram to show it.

#### Scenario: Click after zooming
- **GIVEN** the reviewer has zoomed in on a diagram
- **WHEN** the reviewer clicks a linked node without dragging
- **THEN** its code opens, as it would without zoom

#### Scenario: Spotlight out of view
- **GIVEN** the reviewer has zoomed in on one corner of a diagram
- **WHEN** a step spotlights a node in another corner
- **THEN** the diagram moves so that node is shown

### Requirement: Visuals link to code
A visual SHALL declare the elements that can be linked, selected or spotlighted, each with an id, when it is
submitted. A declared element MAY be linked to a code location; activating it SHALL show that location in the viewer.
Steps MAY spotlight a declared element. Signals from a visual naming an element it did not declare SHALL be ignored.

#### Scenario: Click a node
- **WHEN** the reviewer clicks a diagram node linked to a function
- **THEN** the viewer shows that function's lines at the head revision

#### Scenario: Undeclared element
- **WHEN** a visual signals a selection of an element id it did not declare
- **THEN** nothing is selected and nothing reaches the agent session

### Requirement: Visuals are isolated
A visual SHALL NOT be able to read or change the viewer, reach the network, or reach the agent, except through the
defined link-to-code and selection signals.

#### Scenario: Visual attempts a network call
- **WHEN** a visual's content tries to fetch a remote address
- **THEN** the request is blocked and the rest of the viewer is unaffected

### Requirement: A broken visual does not break the section
A visual that fails to render SHALL be replaced by a notice in its place; the section's text, code and narration SHALL
remain usable, and the notice SHALL offer the reviewer a control to ask the agent to repair it.

#### Scenario: Malformed diagram
- **WHEN** a visual's source cannot be rendered
- **THEN** the section shows a notice where the visual would be and playback of its steps still works
