"""Checking a plan against the pinned revisions (spec: walkthrough-plan, "Anchors are validated").

Every claimed hunk must exist in the diff and be claimed once; every code target, in steps and in visual links, must
name a text file that exists at its side, lines inside it, columns inside those lines, and contain its `expect` text.
All problems are reported together, each naming the plan item, so the agent can fix them in one go.
"""

from dataclasses import dataclass

from xenagos.diff import FileChange
from xenagos.files import RevisionFiles
from xenagos.plan import CodeTarget, Plan, Section
from xenagos.target import ReviewTarget


@dataclass(frozen=True)
class Problem:
    where: str
    message: str

    def __str__(self) -> str:
        return f"{self.where}: {self.message}"


def check(
    plan: Plan, target: ReviewTarget, changes: list[FileChange], files: RevisionFiles | None = None
) -> list[Problem]:
    files = files or RevisionFiles(target.repo)
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
                problems += check_code(f"{where}, step {step_number}", step.target, target, files)
        for visual in section.visuals:
            for element in visual.elements:
                if element.link is not None:
                    item = f"{where}, visual {visual.id}, element {element.id}"
                    problems += check_code(item, element.link, target, files)
    return problems


def _section(number: int, section: Section) -> str:
    return f'section {number} ("{section.title}")'


def check_code(where: str, code: CodeTarget, target: ReviewTarget, files: RevisionFiles) -> list[Problem]:
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
