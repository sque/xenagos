"""What a plan leaves out (spec: walkthrough-plan, "Coverage is visible").

Every hunk of the diff is either claimed by one section or listed here, with its file, the file's category and the
lines it adds and removes. Anchor validation already guarantees that a claimed hunk exists and is claimed once.
"""

from collections.abc import Mapping

from xenagos.api import CategoryCoverage, Coverage, HunkInfo, UncoveredFile
from xenagos.categories import CATEGORIES, Category
from xenagos.diff import FileChange, Hunk
from xenagos.plan import Plan


def hunk_info(hunk: Hunk) -> HunkInfo:
    return HunkInfo(
        id=hunk.id,
        base_start=hunk.base_start,
        base_count=hunk.base_count,
        head_start=hunk.head_start,
        head_count=hunk.head_count,
    )


def not_covered(plan: Plan, changes: list[FileChange], categories: Mapping[str, Category]) -> Coverage:
    claimed = {hunk for section in plan.sections for hunk in section.hunks}
    files: list[UncoveredFile] = []
    for change in changes:
        left = [h for h in change.hunks if h.id not in claimed]
        if not left:
            continue
        files.append(
            UncoveredFile(
                path=change.path,
                old_path=change.old_path,
                status=change.status,
                binary=change.binary,
                category=categories.get(change.path, "code"),
                partly=len(left) < len(change.hunks),
                hunks=[hunk_info(h) for h in left],
                added=sum(h.head_count for h in left),
                removed=sum(h.base_count for h in left),
            )
        )
    groups: list[CategoryCoverage] = []
    for category in CATEGORIES:
        members = [f for f in files if f.category == category]
        if members:
            groups.append(
                CategoryCoverage(
                    category=category,
                    files=members,
                    added=sum(f.added for f in members),
                    removed=sum(f.removed for f in members),
                )
            )
    return Coverage(categories=groups, hunks=sum(len(f.hunks) for f in files), files=len(files))


def summary(coverage: Coverage) -> str:
    """One line per file, for the agent that submitted the plan."""
    if not coverage.hunks:
        return "Every hunk is claimed by a section."
    lines = [f"Not covered by any section ({coverage.hunks} hunk{'s' * (coverage.hunks != 1)}), shown to the reviewer:"]
    for group in coverage.categories:
        for file in group.files:
            ids = ", ".join(h.id for h in file.hunks)
            counts = "binary" if file.binary else f"+{file.added} -{file.removed}"
            lines.append(f"- {group.category}: {ids} ({counts})")
    return "\n".join(lines)
