"""The repository explorer's data (spec: repository-explorer; design decision 5b, "Explorer data").

Every file at the reviewed head, with the files the change deleted added back at the paths they had; the change
status, category and coverage of each changed file; and the files that steps of the walkthrough visit.
"""

from collections.abc import Mapping
from pathlib import Path

from xenagos import git
from xenagos.api import ChangedEntry, RepositoryTree
from xenagos.categories import Category
from xenagos.diff import FileChange
from xenagos.plan import CodeTarget, Plan


def head_files(repo: Path, head: str) -> list[str]:
    output = git.run(repo, "ls-tree", "-r", "-z", "--full-tree", "--name-only", head)
    return [path for path in output.split("\0") if path]


def visited(plan: Plan, changes: list[FileChange]) -> set[str]:
    """The paths, as the tree names them, that some step targets. A step at the base side of a renamed file names
    the old path; the tree shows the file under its new one."""
    renamed = {c.old_path: c.path for c in changes if c.old_path is not None and c.status == "renamed"}
    paths: set[str] = set()
    for section in plan.sections:
        for step in section.steps:
            target = step.target
            if isinstance(target, CodeTarget):
                paths.add(renamed.get(target.path, target.path) if target.side == "base" else target.path)
    return paths


def repository_tree(
    files: list[str], changes: list[FileChange], categories: Mapping[str, Category], plan: Plan | None
) -> RepositoryTree:
    claimed = {hunk for section in plan.sections for hunk in section.hunks} if plan is not None else set()
    entries: list[ChangedEntry] = []
    for change in changes:
        covered = None
        if plan is not None:
            count = sum(1 for h in change.hunks if h.id in claimed)
            covered = "none" if count == 0 else "all" if count == len(change.hunks) else "partly"
        entries.append(
            ChangedEntry(
                path=change.path,
                old_path=change.old_path,
                status=change.status,
                binary=change.binary,
                category=categories.get(change.path, "code"),
                covered=covered,
            )
        )
    deleted = [c.path for c in changes if c.status == "deleted"]
    every = sorted({*files, *deleted})
    return RepositoryTree(
        files=every,
        changed=entries,
        visited=sorted(visited(plan, changes)) if plan is not None else [],
    )
