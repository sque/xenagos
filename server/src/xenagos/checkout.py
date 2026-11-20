"""xenagos's private checkout of a reviewed head (design decision 2; specs: review-target, agent-link).

Browsing reads the object store and needs no checkout. The review's agent session needs a folder at the reviewed head:
the user's own checkout when it is there, otherwise a clone that xenagos makes under its data folder. The clone is made
from the user's repository without changing it (no worktree record, no ref, no index refresh), and is kept for the
review: what the session changes in it stays its own until the review's data is removed.
"""

import shutil
from pathlib import Path

from xenagos import git
from xenagos.paths import data_home
from xenagos.target import ReviewTarget


def checkouts_root() -> Path:
    return data_home() / "checkouts"


def private_path(review_id: str) -> Path:
    return checkouts_root() / review_id


def is_private(folder: str | Path | None) -> bool:
    """Whether `folder` is in one of xenagos's private checkouts."""
    if folder is None:
        return False
    return Path(folder).resolve().is_relative_to(checkouts_root().resolve())


def at_head(target: ReviewTarget) -> bool:
    """Whether the user's checkout has the reviewed head checked out."""
    return git.try_run(target.repo, "rev-parse", "HEAD") == target.head


def private_checkout(target: ReviewTarget) -> Path:
    """The review's private checkout, cloned at the reviewed head on first use and reused after that. Raises GitError
    when it cannot be made."""
    path = private_path(target.review_id)
    if (path / ".git").exists():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(f"{path.name}.partial")
    shutil.rmtree(partial, ignore_errors=True)
    try:
        # A local clone links the repository's object files, so every commit in it is there, including the head.
        git.run(target.repo, "clone", "--quiet", "--local", "--no-checkout", str(target.repo), str(partial))
        git.run(partial, "checkout", "--quiet", "--detach", target.head)
    except git.GitError:
        shutil.rmtree(partial, ignore_errors=True)
        raise
    partial.rename(path)
    return path
