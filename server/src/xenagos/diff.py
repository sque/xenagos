"""The pinned diff of a review, as files and hunks.

A hunk is one contiguous changed region of a file (spec: walkthrough-plan), so the diff is taken with no context
lines. Hunks are numbered from 1 within each file and named `<path>:h<n>`, with the head path, or the base path for a
deleted file. A file change with no text hunk (binary, mode only, rename only) is one hunk covering the whole file,
so that every change can be claimed or listed as not covered.

Every option that changes how git splits a diff is fixed here, so the user's git configuration cannot change hunk
names between runs.
"""

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from xenagos import git

Status = Literal["added", "modified", "deleted", "renamed", "copied", "type-changed"]
_STATUS: dict[str, Status] = {
    "A": "added",
    "M": "modified",
    "D": "deleted",
    "R": "renamed",
    "C": "copied",
    "T": "type-changed",
}
_DIFF_OPTIONS = (
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--no-relative",
    "--diff-algorithm=histogram",
    "--find-renames",
)
_HUNK_HEADER = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


@dataclass(frozen=True)
class Hunk:
    path: str
    number: int
    base_start: int
    base_count: int
    head_start: int
    head_count: int

    @property
    def id(self) -> str:
        return f"{self.path}:h{self.number}"


@dataclass(frozen=True)
class FileChange:
    status: Status
    path: str
    """Head path, or base path for a deleted file."""
    old_path: str | None
    """Base path when it differs from `path` (renamed or copied)."""
    binary: bool
    hunks: tuple[Hunk, ...]


def changes(repo: Path, base: str, head: str) -> list[FileChange]:
    """Every file changed between `base` and `head`, in git's order, with its hunks."""
    raw = git.run(repo, "--literal-pathspecs", "diff", "--raw", "-z", "--no-abbrev", *_DIFF_OPTIONS, base, head)
    return [_file_change(repo, base, head, entry) for entry in _raw_entries(raw)]


def _raw_entries(raw: str) -> list[tuple[str, list[str]]]:
    """(status letter, paths) for each entry of `git diff --raw -z`."""
    tokens = raw.split("\0")
    entries: list[tuple[str, list[str]]] = []
    i = 0
    while i < len(tokens) and tokens[i]:
        letter = tokens[i].split()[-1][0]
        count = 2 if letter in "RC" else 1
        entries.append((letter, tokens[i + 1 : i + 1 + count]))
        i += 1 + count
    return entries


def _file_change(repo: Path, base: str, head: str, entry: tuple[str, list[str]]) -> FileChange:
    letter, paths = entry
    status = _STATUS[letter]
    old_path, path = (paths[0], paths[1]) if len(paths) == 2 else (None, paths[0])
    patch = git.run(repo, "--literal-pathspecs", "diff", "-U0", "--inter-hunk-context=0", *_DIFF_OPTIONS, base, head,
                    "--", *([old_path] if old_path else []), path)  # fmt: skip
    lines = patch.split("\n")
    binary = any(line.startswith(("Binary files ", "GIT binary patch")) for line in lines)
    hunks: list[Hunk] = []
    for line in lines:
        match = _HUNK_HEADER.match(line)
        if match:
            b_start, b_count, h_start, h_count = match.groups()
            hunks.append(
                Hunk(
                    path,
                    len(hunks) + 1,
                    int(b_start),
                    1 if b_count is None else int(b_count),
                    int(h_start),
                    1 if h_count is None else int(h_count),
                )
            )
    if not hunks:
        hunks.append(Hunk(path, 1, 0, 0, 0, 0))
    return FileChange(status, path, old_path, binary, tuple(hunks))
