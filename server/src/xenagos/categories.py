"""File categories: Code, Tests or Generated (spec: diff-browser; design decision 8).

Rules, first match wins: the reviewer's override for this review; `linguist-generated` in the repository's
attributes at the reviewed head; a known lock file name; a test folder or test file name; otherwise Code.
"""

import re
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Literal

from xenagos import git

Category = Literal["code", "tests", "generated"]
CATEGORIES: tuple[Category, ...] = ("code", "tests", "generated")

LOCK_FILES = frozenset(
    {
        "uv.lock",
        "poetry.lock",
        "Pipfile.lock",
        "pdm.lock",
        "package-lock.json",
        "npm-shrinkwrap.json",
        "yarn.lock",
        "pnpm-lock.yaml",
        "bun.lock",
        "bun.lockb",
        "deno.lock",
        "Cargo.lock",
        "go.sum",
        "go.work.sum",
        "Gemfile.lock",
        "composer.lock",
        "flake.lock",
        "mix.lock",
        "pubspec.lock",
        "Podfile.lock",
        "Package.resolved",
        "packages.lock.json",
        "gradle.lockfile",
        "conan.lock",
    }
)
TEST_FOLDERS = frozenset({"test", "tests", "__tests__", "spec"})
TEST_NAME = re.compile(
    r"""^(
        test_.+\.py | .+_test\.py | conftest\.py
      | .+_test\.go
      | .+\.(test|spec)\.[cm]?[jt]sx?
      | .+_spec\.rb
      | .+Tests?\.(java|kt|swift|cs)
    )$""",
    re.VERBOSE,
)
_ATTRIBUTE = "linguist-generated"
_CHUNK = 500


def by_rules(path: str) -> Category:
    """The category from file names alone: lock files, then tests, otherwise Code."""
    parts = path.split("/")
    if parts[-1] in LOCK_FILES:
        return "generated"
    if TEST_FOLDERS.intersection(parts[:-1]) or TEST_NAME.match(parts[-1]):
        return "tests"
    return "code"


def marked_generated(repo: Path, revision: str, paths: Iterable[str]) -> set[str]:
    """The paths that the repository's attributes at `revision` mark `linguist-generated`."""
    marked: set[str] = set()
    pending = list(paths)
    for start in range(0, len(pending), _CHUNK):
        chunk = pending[start : start + _CHUNK]
        output = git.try_run(repo, "check-attr", f"--source={revision}", "-z", _ATTRIBUTE, "--", *chunk)
        if output is None:
            continue
        fields = output.split("\0")
        for i in range(0, len(fields) - 2, 3):
            path, _, value = fields[i : i + 3]
            if value in ("set", "true"):
                marked.add(path)
    return marked


def categorize(
    repo: Path, revision: str, paths: Iterable[str], overrides: Mapping[str, Category] | None = None
) -> dict[str, Category]:
    """The category of each path, by the rules of design decision 8."""
    paths = list(paths)
    overrides = overrides or {}
    generated = marked_generated(repo, revision, [p for p in paths if p not in overrides])
    result: dict[str, Category] = {}
    for path in paths:
        if path in overrides:
            result[path] = overrides[path]
        elif path in generated:
            result[path] = "generated"
        else:
            result[path] = by_rules(path)
    return result
