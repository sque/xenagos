"""The walkthrough plan an agent submits (spec: walkthrough-plan; design decision 3).

This module is the single definition of the plan format. The viewer's TypeScript types are generated from the JSON
Schema exported here (`python -m xenagos.schema`), and a check fails when they are stale. Checks that need the
repository, such as whether a line range exists, are in `xenagos.anchors`.

The JSON form uses camelCase keys. Unknown keys are rejected, so a misspelled key is an error and not silently lost.
"""

from typing import Annotated, Literal, Self

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, PositiveInt, StringConstraints, model_validator
from pydantic.alias_generators import to_camel

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Identifier = Annotated[str, StringConstraints(pattern=r"^[A-Za-z][A-Za-z0-9_-]{0,63}$")]
"""Ids of visuals and their elements. Kept to a safe alphabet: they reach the page and the agent's session."""
HunkId = Annotated[str, StringConstraints(pattern=r"^[^\s].*:h[1-9][0-9]*$")]
"""A hunk of the pinned diff, as `<path>:h<n>`, numbered from 1 within each file."""


def _relative_path(path: str) -> str:
    if not path or path.startswith("/") or "\\" in path or ".." in path.split("/") or "" in path.split("/"):
        raise ValueError("must be a path relative to the repository root, with / between parts")
    return path


RepoPath = Annotated[str, AfterValidator(_relative_path)]
Side = Literal["base", "head"]
Form = Literal["lines", "box", "circle"]
Role = Literal["core", "consequence", "support"]


class Model(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid", frozen=True)


class CodeTarget(Model):
    """Lines of a file at the base or head revision, optionally narrowed to a span of characters.

    Lines and columns count from 1 and both ends are included. With a span, `startCol` is on the first line and
    `endCol` on the last.
    """

    path: RepoPath
    side: Side = "head"
    start_line: PositiveInt
    end_line: PositiveInt
    start_col: PositiveInt | None = None
    end_col: PositiveInt | None = None
    expect: str | None = Field(
        default=None,
        min_length=1,
        description="Text that must occur in the targeted range; catches a valid range that points at the wrong code.",
    )

    @model_validator(mode="after")
    def _ordered(self) -> Self:
        if self.end_line < self.start_line:
            raise ValueError("endLine is before startLine")
        if (self.start_col is None) != (self.end_col is None):
            raise ValueError("give both startCol and endCol, or neither")
        if (
            self.start_col is not None
            and self.end_col is not None
            and self.start_line == self.end_line
            and self.end_col < self.start_col
        ):
            raise ValueError("endCol is before startCol")
        return self


class VisualTarget(Model):
    """An element that one of the section's visuals declares."""

    visual: Identifier
    element: Identifier


class Step(Model):
    narration: Text = Field(description="Plain text, spoken as written and shown as the caption.")
    form: Form
    target: CodeTarget | VisualTarget


class VisualElement(Model):
    id: Identifier
    link: CodeTarget | None = Field(default=None, description="Code shown when the reviewer activates the element.")


class Visual(Model):
    """Agent-authored HTML shown in a sandboxed frame (spec: section-visuals)."""

    id: Identifier
    title: Title | None = None
    html: Text
    elements: list[VisualElement] = Field(
        default_factory=list, description="Every element that can be linked, selected or spotlighted."
    )

    @model_validator(mode="after")
    def _unique_elements(self) -> Self:
        _require_unique([e.id for e in self.elements], f"element id in visual {self.id}")
        return self


class Section(Model):
    title: Title = Field(description="Names the section's idea, not a file.")
    role: Role
    explanation: Text
    hunks: list[HunkId] = Field(description="The hunks that implement this section's idea.")
    steps: list[Step] = Field(min_length=1)
    visuals: list[Visual] = Field(default_factory=list)

    @model_validator(mode="after")
    def _visual_targets_are_declared(self) -> Self:
        declared = {(v.id, e.id) for v in self.visuals for e in v.elements}
        visuals = {v.id for v in self.visuals}
        for number, step in enumerate(self.steps, start=1):
            target = step.target
            if isinstance(target, VisualTarget) and (target.visual, target.element) not in declared:
                what = "element" if target.visual in visuals else "visual"
                raise ValueError(
                    f"step {number} targets {target.visual}#{target.element}, but this section declares no such {what}"
                )
        return self


class Orientation(Model):
    problem: Text = Field(description="The problem the change addresses, before any solution; a short paragraph.")
    source: Literal["commit-messages", "document", "inferred"]
    document: RepoPath | None = Field(default=None, description="The document the problem is taken from.")

    @model_validator(mode="after")
    def _document_named(self) -> Self:
        if (self.source == "document") != (self.document is not None):
            raise ValueError("name a document exactly when source is 'document'")
        return self


class Plan(Model):
    orientation: Orientation
    sections: list[Section] = Field(min_length=1)

    @model_validator(mode="after")
    def _unique_visuals(self) -> Self:
        _require_unique([v.id for s in self.sections for v in s.visuals], "visual id")
        return self


def _require_unique(values: list[str], what: str) -> None:
    seen: set[str] = set()
    for value in values:
        if value in seen:
            raise ValueError(f"{what} {value!r} is used more than once")
        seen.add(value)
