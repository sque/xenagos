"""Thin runner for the git command line. Every read goes through the repository's object store."""

import os
import subprocess
from pathlib import Path

# A tree with nothing in it; the base of a review of a root commit.
EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"


class GitError(Exception):
    """A git command failed."""


def _env() -> dict[str, str]:
    env = dict(os.environ)
    env.update({"GIT_TERMINAL_PROMPT": "0", "GIT_OPTIONAL_LOCKS": "0", "LC_ALL": "C"})
    return env


def run(repo: Path, *args: str) -> str:
    """Run git in `repo` and return its standard output without the trailing newline."""
    result = subprocess.run(  # noqa: S603 - fixed executable, arguments passed as a list
        ["git", "-C", str(repo), *args],  # noqa: S607 - git is looked up on PATH on purpose
        capture_output=True,
        text=True,
        env=_env(),
        check=False,
    )
    if result.returncode != 0:
        raise GitError(result.stderr.strip() or f"git {' '.join(args)} failed with status {result.returncode}")
    return result.stdout.rstrip("\n")


def try_run(repo: Path, *args: str) -> str | None:
    """Like `run`, but return None when git fails."""
    try:
        return run(repo, *args)
    except GitError:
        return None
