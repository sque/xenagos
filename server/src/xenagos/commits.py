"""The commits a review spans, for the per-commit view (spec: diff-browser, "Per-commit view")."""

from dataclasses import dataclass
from pathlib import Path

from xenagos import git
from xenagos.git import EMPTY_TREE

_FIELDS = "%H%x00%P%x00%an%x00%aI%x00%B"


@dataclass(frozen=True)
class Commit:
    id: str
    parent: str
    """First parent, or the empty tree for a root commit: a commit is shown against it."""
    author: str
    date: str
    message: str

    @property
    def subject(self) -> str:
        return self.message.split("\n", 1)[0]


def commits(repo: Path, base: str, head: str) -> list[Commit]:
    """The commits reachable from `head` and not from `base`, oldest first."""
    spec = [head] if base == EMPTY_TREE else [f"{base}..{head}"]
    output = git.run(repo, "log", "--reverse", "-z", f"--format={_FIELDS}", *spec, "--")
    found: list[Commit] = []
    fields = output.split("\0")
    for i in range(0, len(fields) - 4, 5):
        commit, parents, author, date, message = fields[i : i + 5]
        found.append(Commit(commit.strip(), (parents.split() or [EMPTY_TREE])[0], author, date, message.strip()))
    return found
