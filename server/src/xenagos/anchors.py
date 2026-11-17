"""Checking a plan against the pinned revisions (spec: walkthrough-plan, "Anchors are validated").

Every claimed hunk must exist in the diff and be claimed once; every code target, in steps and in visual links, must
name a text file that exists at its side, lines inside it, columns inside those lines, and contain its `expect` text.
All problems are reported together, each naming the plan item, so the agent can fix them in one go.
"""

from dataclasses import dataclass, field
from pathlib import Path

from xenagos import git
from xenagos.diff import FileChange
from xenagos.plan import CodeTarget, Plan, Section
from xenagos.target import ReviewTarget


@dataclass(frozen=True)
class Problem:
    where: str
    message: str

    def __str__(self) -> str:
        return f"{self.where}: {self.message}"


_BINARY = object()


@dataclass
class RevisionFiles:
    """File contents at pinned revisions, read once each."""

    repo: Path
    _cache: dict[tuple[str, str], list[str] | object | None] = field(default_factory=dict)

    def lines(self, revision: str, path: str) -> list[str] | object | None:
        """The file's lines, `_BINARY` for a binary file, or None when it does not exist at that revision."""
        key = (revision, path)
        if key not in self._cache:
            self._cache[key] = self._read(revision, path)
        return self._cache[key]

    def _read(self, revision: str, path: str) -> list[str] | object | None:
        data = git.try_run_bytes(self.repo, "cat-file", "blob", f"{revision}:{path}")
        if data is None:
            return None
        if b"\0" in data[:8000]:
            return _BINARY
        text = data.decode("utf-8", errors="replace")
        lines = text.split("\n")
        if text.endswith("\n"):
            lines.pop()
        return [line.removesuffix("\r") for line in lines]


def check(plan: Plan, target: ReviewTarget, changes: list[FileChange]) -> list[Problem]:
    files = RevisionFiles(target.repo)
    problems: list[Problem] = []
    hunks = {hunk.id for change in changes for hunk in change.hunks}
    claimed_by: dict[str, int] = {}
    for number, section in enumerate(plan.sections, start=1):
        where = _section(number, section)
        for hunk in section.hunks:
            if hunk not in hunks:
                problems.append(Problem(where, f"claims {hunk}, which is not a hunk of this diff"))
            elif hunk in claimed_by:
                other = claimed_by[hunk]
                again = "again" if other == number else f"already claimed by section {other}"
                problems.append(Problem(where, f"claims {hunk} {again}; each hunk belongs to one section"))
            else:
                claimed_by[hunk] = number
        for step_number, step in enumerate(section.steps, start=1):
            if isinstance(step.target, CodeTarget):
                problems += _check_code(f"{where}, step {step_number}", step.target, target, files)
        for visual in section.visuals:
            for element in visual.elements:
                if element.link is not None:
                    item = f"{where}, visual {visual.id}, element {element.id}"
                    problems += _check_code(item, element.link, target, files)
    return problems


def _section(number: int, section: Section) -> str:
    return f'section {number} ("{section.title}")'


def _check_code(where: str, code: CodeTarget, target: ReviewTarget, files: RevisionFiles) -> list[Problem]:
    revision = target.base if code.side == "base" else target.head
    at = f"at the {code.side} revision"
    lines = files.lines(revision, code.path)
    if lines is None:
        return [Problem(where, f"{code.path} does not exist {at}")]
    if not isinstance(lines, list):
        return [Problem(where, f"{code.path} is binary {at}; target a text file")]
    span = f"lines {code.start_line}-{code.end_line}"
    if code.end_line > len(lines):
        count = f"{len(lines)} line" + ("" if len(lines) == 1 else "s")
        return [Problem(where, f"{span} are past the end of {code.path}, which has {count} {at}")]
    selected = lines[code.start_line - 1 : code.end_line]
    if code.start_col is not None and code.end_col is not None:
        if code.start_col > len(selected[0]) or code.end_col > len(selected[-1]):
            return [Problem(where, f"columns {code.start_col}-{code.end_col} fall outside {span} of {code.path} {at}")]
        selected = [*selected]
        selected[-1] = selected[-1][: code.end_col]
        selected[0] = selected[0][code.start_col - 1 :]
    if code.expect is not None and code.expect.strip() not in "\n".join(selected):
        first = lines[code.start_line - 1].strip()
        preview = first if len(first) <= 80 else first[:77] + "..."
        return [
            Problem(
                where,
                f"expected text {code.expect!r} does not occur in {span} of {code.path} {at}; "
                f"line {code.start_line} reads {preview!r}",
            )
        ]
    return []
