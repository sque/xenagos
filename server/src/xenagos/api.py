"""Models the server sends to the viewer. Their TypeScript types are generated with the plan's (`xenagos.schema`)."""

from typing import Annotated, Literal

from pydantic import Field, PositiveInt

from xenagos.categories import Category
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
    style: str = Field(description="The active narration style: a walkthrough asked for now is written in it.")
    voice: "VoiceInfo"


class VoiceInfo(Model):
    """Voice settings from configuration (spec: configuration)."""

    enabled: bool
    provider: Literal["browser", "command"]
    name: str | None
    speed: float
    off_machine: bool = Field(description="The configured command sends narration text off this machine.")


class VoiceRequest(Model):
    """Narration to speak with the `command` provider; voice and speed default to the configured ones."""

    text: str = Field(min_length=1, max_length=4000)
    voice: str | None = None
    speed: float | None = Field(default=None, gt=0, le=4)


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


class HunkInfo(Model):
    id: str
    base_start: int
    base_count: int
    head_start: int
    head_count: int


class ChangedFile(Model):
    """A file the change touches, as the diff of the pinned revisions has it."""

    path: str = Field(description="Head path, or base path for a deleted file.")
    old_path: str | None
    status: Literal["added", "modified", "deleted", "renamed", "copied", "type-changed"]
    binary: bool
    hunks: list[HunkInfo]
    added: int = Field(description="Lines added; 0 for a binary file.")
    removed: int = Field(description="Lines removed; 0 for a binary file.")
    category: Category


class CommitInfo(Model):
    """A commit of the review, for the per-commit view (spec: diff-browser)."""

    id: str
    subject: str
    message: str
    author: str
    date: str = Field(description="Author date, ISO 8601.")


class CategoryChange(Model):
    """Put a changed file in another category for this review; null puts it back where the rules place it."""

    path: str
    category: Category | None


class UncoveredFile(Model):
    """A changed file with hunks that no section of the plan claims (spec: walkthrough-plan, "Coverage is visible")."""

    path: str = Field(description="Head path, or base path for a deleted file.")
    old_path: str | None
    status: Literal["added", "modified", "deleted", "renamed", "copied", "type-changed"]
    binary: bool
    category: Category
    partly: bool = Field(description="Some of the file's hunks are claimed by a section, the ones listed are not.")
    hunks: list[HunkInfo] = Field(description="The hunks no section claims.")
    added: int = Field(description="Lines added by the hunks listed.")
    removed: int = Field(description="Lines removed by the hunks listed.")


class CategoryCoverage(Model):
    category: Category
    files: list[UncoveredFile]
    added: int
    removed: int


class Coverage(Model):
    """What the plan leaves out, by category in the order Code, Tests, Generated; empty categories are omitted."""

    categories: list[CategoryCoverage]
    hunks: int = Field(description="How many hunks no section claims.")
    files: int = Field(description="How many files have a hunk no section claims.")


class ChangedEntry(Model):
    """A changed file as the repository explorer marks it."""

    path: str = Field(description="Head path, or base path for a deleted file.")
    old_path: str | None
    status: Literal["added", "modified", "deleted", "renamed", "copied", "type-changed"]
    binary: bool
    category: Category
    covered: Literal["all", "partly", "none"] | None = Field(
        description="How many of the file's hunks the walkthrough claims; null when there is no walkthrough."
    )


class RepositoryTree(Model):
    """The repository explorer's data (spec: repository-explorer)."""

    files: list[str] = Field(description="Every file at the head, with deleted files added back; sorted.")
    changed: list[ChangedEntry]
    visited: list[str] = Field(description="Files some step of the walkthrough targets.")


class BranchMoved(Model):
    branch: str
    tip: str | None = Field(description="The branch's tip now; null when the branch no longer exists.")
    ahead: int | None = Field(
        description="Commits on the branch after the reviewed head; null when the head is no longer on the branch."
    )


class TargetStatus(Model):
    """What changed around the pinned review since it opened (spec: review-target)."""

    moved: BranchMoved | None = Field(description="The reviewed branch no longer points at the reviewed head.")
    uncommitted: list[str] = Field(description="Files in the review with uncommitted changes in the working tree.")
