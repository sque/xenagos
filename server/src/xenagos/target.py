"""What is being reviewed: a target resolved to a fixed pair of commits (spec: review-target).

Target syntax follows `git diff`:

- no target: the current branch against the repository's default branch, from their fork point;
- `--base <branch>`: the current branch against that branch, from their fork point;
- `A...B`: B against A, from their fork point;
- `A..B`: B against A, compared directly;
- `<rev>`: that single commit against its first parent.
"""

import hashlib
from dataclasses import dataclass
from pathlib import Path

from xenagos import git
from xenagos.git import EMPTY_TREE


class TargetError(Exception):
    """The target cannot be resolved; the message is meant for the user."""


@dataclass(frozen=True)
class ReviewTarget:
    repo: Path
    """Top-level directory of the repository."""
    base: str
    """Full id of the base commit, or the empty tree for a root commit."""
    head: str
    """Full id of the head commit."""
    label: str
    """The target as the user would name it, for display."""
    branch: str | None
    """Branch whose tip was the head when the review opened, if any; used to report that it has moved."""

    @property
    def review_id(self) -> str:
        """Stable id of the review: the same repository, base and head give the same id."""
        key = f"{self.repo}\0{self.base}\0{self.head}".encode()
        return hashlib.sha256(key).hexdigest()[:16]


def repository_root(path: Path) -> Path:
    top = git.try_run(path, "rev-parse", "--show-toplevel")
    if top is None:
        raise TargetError(f"not inside a git repository: {path}")
    return Path(top).resolve()


def resolve_commit(repo: Path, rev: str) -> str:
    commit = git.try_run(repo, "rev-parse", "--verify", "--quiet", "--end-of-options", f"{rev}^{{commit}}")
    if commit is None:
        raise TargetError(f"unknown revision: {rev}")
    return commit


def current_branch(repo: Path) -> str | None:
    return git.try_run(repo, "symbolic-ref", "--quiet", "--short", "HEAD")


def fork_point(repo: Path, a: str, b: str) -> str:
    base = git.try_run(repo, "merge-base", a, b)
    if base is None:
        raise TargetError("the two revisions share no history, so there is no fork point to compare from")
    return base


def default_branch_refs(repo: Path) -> list[str]:
    """Refs that stand for the default branch, local and remote, or an empty list when it cannot be found."""
    name: str | None = None
    origin_head = git.try_run(repo, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD")
    if origin_head is not None:
        name = origin_head.removeprefix("origin/")
    else:
        for candidate in ("main", "master"):
            if _ref_exists(repo, f"refs/heads/{candidate}") or _ref_exists(repo, f"refs/remotes/origin/{candidate}"):
                name = candidate
                break
    if name is None:
        return []
    return [ref for ref in (f"refs/heads/{name}", f"refs/remotes/origin/{name}") if _ref_exists(repo, ref)]


def _ref_exists(repo: Path, ref: str) -> bool:
    return git.try_run(repo, "show-ref", "--verify", "--quiet", ref) is not None


def _newest(repo: Path, commits: list[str]) -> str:
    """The commit in `commits` that descends from all the others (they are fork points on one line of history)."""
    newest = commits[0]
    for commit in commits[1:]:
        if git.try_run(repo, "merge-base", "--is-ancestor", newest, commit) is not None:
            newest = commit
    return newest


def _short(name: str) -> str:
    return name.removeprefix("refs/heads/").removeprefix("refs/remotes/")


def resolve(path: Path, target: str | None = None, base: str | None = None) -> ReviewTarget:
    """Resolve a target in the repository containing `path` to pinned commit ids."""
    repo = repository_root(path)
    if target is not None and base is not None:
        raise TargetError("name either a target or a base branch, not both")
    if base is not None:
        branch = current_branch(repo)
        head = resolve_commit(repo, "HEAD")
        base_id = fork_point(repo, resolve_commit(repo, base), head)
        return ReviewTarget(repo, base_id, head, f"{branch or 'HEAD'} against {base}", branch)
    if target is None:
        return _default_target(repo)
    if "..." in target:
        a, b = target.split("...", 1)
        head = resolve_commit(repo, b or "HEAD")
        base_id = fork_point(repo, resolve_commit(repo, a or "HEAD"), head)
        return ReviewTarget(repo, base_id, head, target, _branch_named(repo, b))
    if ".." in target:
        a, b = target.split("..", 1)
        return ReviewTarget(
            repo, resolve_commit(repo, a or "HEAD"), resolve_commit(repo, b or "HEAD"), target, _branch_named(repo, b)
        )
    head = resolve_commit(repo, target)
    parent = git.try_run(repo, "rev-parse", "--verify", "--quiet", f"{head}^1")
    return ReviewTarget(repo, parent or EMPTY_TREE, head, target, None)


def _branch_named(repo: Path, rev: str) -> str | None:
    """The branch a range names as its head, so a moved branch can be reported; None for other revisions."""
    if not rev:
        return current_branch(repo)
    return rev if _ref_exists(repo, f"refs/heads/{rev}") else None


def _default_target(repo: Path) -> ReviewTarget:
    branch = current_branch(repo)
    if branch is None:
        raise TargetError("HEAD is detached, so there is no branch to review; name a range or a commit")
    refs = default_branch_refs(repo)
    if not refs:
        raise TargetError("cannot tell which branch is the default branch; name a range or a commit")
    if f"refs/heads/{branch}" in refs:
        raise TargetError(f"you are on the default branch {branch}; name a range or a commit")
    head = resolve_commit(repo, "HEAD")
    base_id = _newest(repo, [fork_point(repo, ref, head) for ref in refs])
    return ReviewTarget(repo, base_id, head, f"{branch} against {_short(refs[0])}", branch)


@dataclass(frozen=True)
class Moved:
    """How the reviewed branch differs from the pinned head (spec: review-target, "Target is pinned")."""

    branch: str
    tip: str | None
    """The branch's tip now; None when the branch no longer exists."""
    ahead: int | None
    """Commits on the branch after the pinned head; None when the head is no longer on the branch (rewritten)."""


def branch_moved(target: ReviewTarget) -> Moved | None:
    """None while the branch still points at the pinned head, or when the review names no branch."""
    if target.branch is None:
        return None
    tip = git.try_run(target.repo, "rev-parse", "--verify", "--quiet", f"refs/heads/{target.branch}^{{commit}}")
    if tip == target.head:
        return None
    if tip is None:
        return Moved(target.branch, None, None)
    if git.try_run(target.repo, "merge-base", "--is-ancestor", target.head, tip) is None:
        return Moved(target.branch, tip, None)
    count = git.run(target.repo, "rev-list", "--count", f"{target.head}..{tip}")
    return Moved(target.branch, tip, int(count))


def uncommitted(repo: Path, paths: set[str]) -> list[str]:
    """The paths among `paths` with uncommitted changes in the user's working tree or index. Read only: git is run
    with optional locks off (`xenagos.git`), so `git status` does not refresh the index."""
    output = git.try_run(repo, "status", "--porcelain=v1", "-z", "--untracked-files=no", "--no-renames")
    if output is None:
        return []
    dirty = {entry[3:] for entry in output.split("\0") if len(entry) > 3}
    return sorted(dirty & paths)
