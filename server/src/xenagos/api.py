"""Models the server sends to the viewer. Their TypeScript types are generated with the plan's (`xenagos.schema`)."""

from typing import Annotated, Literal

from pydantic import Field, PositiveInt

from xenagos.plan import (
    CodeTarget,
    Form,
    Identifier,
    Model,
    RepoPath,
    Side,
    Step,
    Visual,
    VisualTarget,
)


class ReviewInfo(Model):
    id: str
    repo: str
    label: str
    base: str
    head: str
    branch: str | None
    style: str = Field(description="The narration style a walkthrough is written in (`default` until styles exist).")


class SessionChoiceItem(Model):
    """A Claude Code session the reviewer can make the review's agent."""

    session: str
    name: str | None
    kind: str
    running: bool
    cwd: str | None


class FileView(Model):
    """A file at both pinned revisions, for the whole-file view. Text is absent when the file does not exist at that
    revision or is binary."""

    path: str
    old_path: str | None
    status: Literal["added", "modified", "deleted", "renamed", "copied", "type-changed", "unchanged"]
    binary: bool
    base: str | None
    head: str | None


class PlanRejection(Model):
    """Why a submitted plan was not accepted; each problem names the plan item it concerns."""

    problems: list[str]


class AgentStatus(Model):
    """The review's agent session as the viewer shows it (spec: agent-link).

    `state` is `none` (no session yet), `attachable` (a running background session the pane can show), `not-shown`
    (a session of a kind the pane cannot show), `ended` (stopped or gone), or `unavailable` (Claude Code could not be
    asked)."""

    state: Literal["none", "attachable", "not-shown", "ended", "unavailable"]
    session: str | None = None
    name: str | None = None
    activity: str | None = Field(default=None, description="What Claude Code reports while it runs: idle, busy, ...")
    shared: bool = Field(default=False, description="The session is also shown in another terminal.")
    reason: str | None = Field(default=None, description="Why the pane is empty, for the reviewer.")


class CodeSelection(Model):
    """Lines the reviewer selected. In the unified view a selection can start on a deleted line and end on an added
    one, so each end names its side."""

    kind: Literal["code"]
    path: RepoPath = Field(description="The file as the viewer names it: its head path, or base path if deleted.")
    start_side: Side
    start_line: PositiveInt
    end_side: Side
    end_line: PositiveInt


class ElementSelection(Model):
    kind: Literal["element"]
    visual: Identifier
    element: Identifier


class Position(Model):
    """Where the reviewer was in the walkthrough, counted from 1."""

    section: PositiveInt
    step: PositiveInt


class Question(Model):
    question: str = Field(max_length=4000)
    selection: Annotated[CodeSelection | ElementSelection, Field(discriminator="kind")]
    position: Position | None = None


class AgentRequest(Model):
    """A fixed request the reviewer sends with a control in the viewer."""

    kind: Literal["walkthrough", "narration", "visual"]
    visual: Identifier | None = Field(default=None, description="The visual to repair, for `visual`.")


class Delivery(Model):
    """What happened to a question or request."""

    started: bool = Field(description="True when a session was started for it, with it as the first message.")
    session: str


class Show(Model):
    """Something the agent points at in the viewer."""

    target: CodeTarget | VisualTarget
    form: Form = "lines"


class ShowResult(Model):
    viewers: int = Field(description="How many viewers received it; 0 means the reviewer did not see it.")


class StepAddition(Model):
    section: PositiveInt
    after: int | None = Field(default=None, ge=0, description="Insert after this step (0 = first); default: last.")
    step: Step


class VisualAddition(Model):
    """Adds a visual to a section, or replaces the section's visual with the same id."""

    section: PositiveInt
    visual: Visual


class SessionChoice(Model):
    session: str = Field(description="Full session id.")
    replace: bool = False
