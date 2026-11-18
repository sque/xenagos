"""One review's working state in the server: its pinned target, diff, file contents and current plan.

Every change to the plan goes through the same validation, whether the agent submits a whole plan, adds a step or a
visual, or rewrites the narration, and an accepted plan is saved at once, so it survives the server.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from functools import cached_property
from typing import Any, cast

from pydantic import ValidationError

from xenagos import anchors, narration
from xenagos.api import Show, StepAddition, VisualAddition
from xenagos.categories import Category, categorize
from xenagos.config import ConfigError, Limits, Style
from xenagos.diff import FileChange, changes
from xenagos.files import RevisionFiles
from xenagos.plan import CodeTarget, Plan, Section, StyleRef
from xenagos.store import ReviewStore
from xenagos.target import ReviewTarget


class PlanRejected(Exception):
    def __init__(self, problems: list[str]) -> None:
        super().__init__("; ".join(problems))
        self.problems = problems


@dataclass
class Review:
    target: ReviewTarget
    store: ReviewStore | None = None
    """Where accepted plans are saved; None keeps them in memory only."""
    on_plan: Callable[[Plan], None] = lambda plan: None
    style: Callable[[], Style] | None = None
    """The active narration style, read on each submission; None checks plain text only."""
    plan: Plan | None = None
    files: RevisionFiles = field(init=False)

    def __post_init__(self) -> None:
        self.files = RevisionFiles(self.target.repo)
        if self.plan is None and self.store is not None:
            self.plan = self.store.load_plan()

    @cached_property
    def changes(self) -> list[FileChange]:
        return changes(self.target.repo, self.target.base, self.target.head)

    @cached_property
    def categories(self) -> dict[str, Category]:
        """The category of each changed file, by its head path (base path when deleted)."""
        return categorize(self.target.repo, self.target.head, [c.path for c in self.changes])

    def change_for(self, path: str) -> FileChange | None:
        return next((c for c in self.changes if path in (c.path, c.old_path)), None)

    def submit_plan(self, document: Any) -> Plan:
        """Validate a submitted plan against the format and the pinned revisions, and make it the current plan.
        A rejected plan leaves the current plan as it was."""
        try:
            plan = Plan.model_validate(document)
        except ValidationError as error:
            raise PlanRejected([_describe(e) for e in error.errors()]) from error
        return self._accept(plan)

    def _accept(self, plan: Plan) -> Plan:
        problems = [str(p) for p in anchors.check(plan, self.target, self.changes, self.files)]
        try:
            style = self.style() if self.style is not None else None
        except ConfigError as error:
            raise PlanRejected([f"the narration style cannot be used: {error}"]) from error
        problems += narration.check(plan, style if style is not None else _PLAIN)
        if problems:
            raise PlanRejected(problems)
        if style is not None:
            plan = plan.model_copy(update={"style": StyleRef(name=style.name, hash=style.hash)})
        if self.store is not None:
            self.store.save_plan(plan)
        self.plan = plan
        self.on_plan(plan)
        return plan

    def _current(self) -> Plan:
        if self.plan is None:
            raise PlanRejected(["this review has no walkthrough yet; submit a plan first"])
        return self.plan

    def add_step(self, addition: StepAddition) -> Plan:
        plan = self._current()
        index = self._section_index(plan, addition.section)
        section = plan.sections[index]
        after = len(section.steps) if addition.after is None else addition.after
        if after > len(section.steps):
            raise PlanRejected([f"section {addition.section} has {len(section.steps)} steps; cannot add after {after}"])
        steps = [*section.steps[:after], addition.step, *section.steps[after:]]
        return self._accept(_with_section(plan, index, _revalidated(section, steps=steps)))

    def add_visual(self, addition: VisualAddition) -> Plan:
        plan = self._current()
        index = self._section_index(plan, addition.section)
        section = plan.sections[index]
        visuals = [v for v in section.visuals if v.id != addition.visual.id]
        replaced = len(visuals) != len(section.visuals)
        visuals = (
            [addition.visual if v.id == addition.visual.id else v for v in section.visuals]
            if replaced
            else [*visuals, addition.visual]
        )
        return self._accept(_with_section(plan, index, _revalidated(section, visuals=visuals)))

    def submit_narration(self, document: Any) -> Plan:
        """Accept a plan that differs from the current one in narration text only (spec: walkthrough-plan)."""
        current = self._current()
        try:
            plan = Plan.model_validate(document)
        except ValidationError as error:
            raise PlanRejected([_describe(e) for e in error.errors()]) from error
        problems = _narration_only(current, plan)
        if problems:
            raise PlanRejected(problems)
        return self._accept(plan)

    def check_show(self, show: Show) -> None:
        target = show.target
        if isinstance(target, CodeTarget):
            problems = anchors.check_code("show", target, self.target, self.files)
            if problems:
                raise PlanRejected([str(p) for p in problems])
            return
        declared = self.plan is not None and any(
            v.id == target.visual and any(e.id == target.element for e in v.elements)
            for s in self.plan.sections
            for v in s.visuals
        )
        if not declared:
            what = f"element {target.element} in visual {target.visual}"
            raise PlanRejected([f"show: the walkthrough declares no {what}"])

    @staticmethod
    def _section_index(plan: Plan, number: int) -> int:
        if number > len(plan.sections):
            raise PlanRejected([f"the walkthrough has {len(plan.sections)} sections; there is no section {number}"])
        return number - 1


def without_narration(plan: Plan) -> dict[str, Any]:
    """The plan as JSON with every narration emptied, for an agent to write new narration into."""
    document: dict[str, Any] = plan.model_dump(mode="json", by_alias=True, exclude_none=True)
    for section in document["sections"]:
        for step in section["steps"]:
            step["narration"] = ""
    return document


def _narration_only(current: Plan, new: Plan) -> list[str]:
    def shape(plan: Plan) -> list[dict[str, Any]]:
        return [
            {
                "section": s.model_dump(exclude={"steps"}),
                "steps": [step.model_dump(exclude={"narration"}) for step in s.steps],
            }
            for s in plan.sections
        ]

    if current.orientation != new.orientation:
        return ["only narration may change; the orientation differs"]
    if len(current.sections) != len(new.sections):
        counts = f"{len(new.sections)} sections instead of {len(current.sections)}"
        return [f"only narration may change; the plan has {counts}"]
    problems: list[str] = []
    for number, (old, nw) in enumerate(zip(shape(current), shape(new), strict=True), start=1):
        if old["section"] != nw["section"]:
            problems.append(f"section {number}: only narration may change; the section's other fields differ")
        elif len(old["steps"]) != len(nw["steps"]):
            problems.append(f"section {number}: only narration may change; it has a different number of steps")
        else:
            problems += [
                f"section {number}, step {i}: only narration may change; the step's target or form differs"
                for i, (a, b) in enumerate(zip(old["steps"], nw["steps"], strict=True), start=1)
                if a != b
            ]
    return problems


def _with_section(plan: Plan, index: int, section: Section) -> Plan:
    sections = [*plan.sections]
    sections[index] = section
    return _revalidated(plan, sections=sections)


def _revalidated[M: Plan | Section](model: M, **changes: Any) -> M:
    """A copy of `model` with `changes`, checked by the model's own validators (model_copy skips them)."""
    data = {**dict(model), **changes}
    try:
        return cast(M, type(model).model_validate(data))
    except ValidationError as error:
        raise PlanRejected([_describe(e) for e in error.errors()]) from error


def _describe(error: Any) -> str:
    location = ".".join(str(part) for part in error["loc"]) or "plan"
    return f"{location}: {error['msg']}"


_PLAIN = Style(name="none", text="", limits=Limits(), hash="", folder=None)
"""No style: narration is still checked to be plain text."""
