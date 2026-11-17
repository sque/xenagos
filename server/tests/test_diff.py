from pathlib import Path

import pytest

from tests.conftest import FixtureRepo, init_repo
from xenagos.diff import changes
from xenagos.git import EMPTY_TREE

TWENTY = "".join(f"line {n}\n" for n in range(1, 21))


@pytest.fixture
def varied(tmp_path: Path) -> FixtureRepo:
    """base: multi.py (20 lines), old.py, image.bin, move_me.py. head: two edits in multi.py, old.py deleted,
    image.bin changed, move_me.py renamed, new.py added, a file with a space in its name added."""
    r = init_repo(tmp_path / "varied")
    r.commit("base", {"multi.py": TWENTY, "old.py": "gone\n", "move_me.py": "a\nb\nc\nd\ne\nf\n"})
    (r.path / "image.bin").write_bytes(b"\x89PNG\0\x01")
    r.commit("binary", {})
    r.git("mv", "move_me.py", "moved.py")
    r.git("rm", "-q", "old.py")
    (r.path / "image.bin").write_bytes(b"\x89PNG\0\x02")
    edited = TWENTY.replace("line 3\n", "line three\n").replace("line 15\n", "line 15\nline 15b\n")
    r.commit("head", {"multi.py": edited, "new.py": "x = 1\ny = 2\n", "with space.txt": "s\n"})
    return r


def test_hunks_are_contiguous_regions_numbered_per_file(varied: FixtureRepo) -> None:
    by_path = {c.path: c for c in changes(varied.path, varied.ids["binary"], varied.ids["head"])}
    multi = by_path["multi.py"]
    assert multi.status == "modified"
    assert [h.id for h in multi.hunks] == ["multi.py:h1", "multi.py:h2"]
    h1, h2 = multi.hunks
    assert (h1.base_start, h1.base_count, h1.head_start, h1.head_count) == (3, 1, 3, 1)
    assert (h2.base_count, h2.head_start, h2.head_count) == (0, 16, 1)


def test_statuses_and_whole_file_hunks(varied: FixtureRepo) -> None:
    by_path = {c.path: c for c in changes(varied.path, varied.ids["binary"], varied.ids["head"])}
    assert by_path["old.py"].status == "deleted"
    assert [h.id for h in by_path["old.py"].hunks] == ["old.py:h1"]
    assert by_path["new.py"].status == "added"
    assert by_path["new.py"].hunks[0].head_count == 2
    moved = by_path["moved.py"]
    assert (moved.status, moved.old_path) == ("renamed", "move_me.py")
    assert [h.id for h in moved.hunks] == ["moved.py:h1"]  # rename only: one hunk for the whole file
    image = by_path["image.bin"]
    assert image.binary
    assert [h.id for h in image.hunks] == ["image.bin:h1"]
    assert by_path["with space.txt"].hunks[0].id == "with space.txt:h1"


def test_root_commit_against_empty_tree(repo: FixtureRepo) -> None:
    (change,) = changes(repo.path, EMPTY_TREE, repo.ids["c1"])
    assert (change.status, change.path, change.hunks[0].head_count) == ("added", "app.py", 1)


def test_user_diff_configuration_does_not_change_hunks(varied: FixtureRepo) -> None:
    before = changes(varied.path, varied.ids["binary"], varied.ids["head"])
    for key, value in [("diff.interHunkContext", "20"), ("diff.algorithm", "patience"), ("diff.renames", "false"),
                       ("diff.noprefix", "true"), ("diff.external", "false")]:  # fmt: skip
        varied.git("config", key, value)
    assert changes(varied.path, varied.ids["binary"], varied.ids["head"]) == before
