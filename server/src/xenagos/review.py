"""One review's working state in the server: its pinned target, diff, file contents and current plan."""

from dataclasses import dataclass, field
from functools import cached_property
from typing import Any

from pydantic import ValidationError

from xenagos import anchors
from xenagos.diff import FileChange, changes
from xenagos.files import RevisionFiles
from xenagos.plan import Plan
from xenagos.target import ReviewTarget


class PlanRejected(Exception):
    def __init__(self, problems: list[str]) -> None:
        super().__init__("; ".join(problems))
        self.problems = problems


@dataclass
class Review:
    target: ReviewTarget
    plan: Plan | None = None
    files: RevisionFiles = field(init=False)

    def __post_init__(self) -> None:
        self.files = RevisionFiles(self.target.repo)

    @cached_property
    def changes(self) -> list[FileChange]:
        return changes(self.target.repo, self.target.base, self.target.head)

    def change_for(self, path: str) -> FileChange | None:
        return next((c for c in self.changes if path in (c.path, c.old_path)), None)

    def submit_plan(self, document: Any) -> Plan:
        """Validate a submitted plan against the format and the pinned revisions, and make it the current plan.
        A rejected plan leaves the current plan as it was."""
        try:
            plan = Plan.model_validate(document)
        except ValidationError as error:
            raise PlanRejected([_describe(e) for e in error.errors()]) from error
        problems = anchors.check(plan, self.target, self.changes, self.files)
        if problems:
            raise PlanRejected([str(p) for p in problems])
        self.plan = plan
        return plan


def _describe(error: Any) -> str:
    location = ".".join(str(part) for part in error["loc"]) or "plan"
    return f"{location}: {error['msg']}"
