from pathlib import Path

import pytest

from tests.conftest import FixtureRepo, init_repo
from xenagos.git import EMPTY_TREE
from xenagos.target import TargetError, resolve


def test_default_is_current_branch_against_default_from_fork_point(repo: FixtureRepo) -> None:
    t = resolve(repo.path)
    assert (t.base, t.head) == (repo.ids["c2"], repo.ids["f2"])
    assert t.branch == "feature"
    assert t.label == "feature against main"
    assert t.repo == repo.path.resolve()


def test_resolves_from_a_subdirectory(repo: FixtureRepo) -> None:
    assert resolve(repo.path / "tests").head == repo.ids["f2"]


def test_current_branch_against_named_base(repo: FixtureRepo) -> None:
    t = resolve(repo.path, base="main")
    assert (t.base, t.head, t.branch) == (repo.ids["c2"], repo.ids["f2"], "feature")


def test_three_dots_compare_from_fork_point(repo: FixtureRepo) -> None:
    t = resolve(repo.path, "main...feature")
    assert (t.base, t.head, t.branch) == (repo.ids["c2"], repo.ids["f2"], "feature")


def test_two_dots_compare_directly(repo: FixtureRepo) -> None:
    t = resolve(repo.path, "main..feature")
    assert (t.base, t.head) == (repo.ids["m3"], repo.ids["f2"])


def test_single_commit_against_its_parent(repo: FixtureRepo) -> None:
    t = resolve(repo.path, repo.ids["f1"][:8])
    assert (t.base, t.head, t.branch) == (repo.ids["c2"], repo.ids["f1"], None)


def test_root_commit_against_empty_tree(repo: FixtureRepo) -> None:
    assert resolve(repo.path, repo.ids["c1"]).base == EMPTY_TREE


@pytest.mark.parametrize("target", ["nope", "main..nope", "nope...feature", "--output=/tmp/x"])
def test_unknown_revision_is_named(repo: FixtureRepo, target: str) -> None:
    missing = target.split(".")[-1] if target.startswith("main") else target.split(".")[0]
    with pytest.raises(TargetError, match=f"unknown revision: {missing}"):
        resolve(repo.path, target)


def test_target_and_base_together_are_refused(repo: FixtureRepo) -> None:
    with pytest.raises(TargetError, match="not both"):
        resolve(repo.path, "main..feature", base="main")


def test_review_id_depends_on_repository_base_and_head(repo: FixtureRepo) -> None:
    a = resolve(repo.path)
    assert resolve(repo.path, "main...feature").review_id == a.review_id
    assert resolve(repo.path, "main..feature").review_id != a.review_id


def test_not_a_repository(tmp_path: Path) -> None:
    with pytest.raises(TargetError, match="not inside a git repository"):
        resolve(tmp_path)


def test_no_default_target_on_default_branch(repo: FixtureRepo) -> None:
    repo.git("switch", "-q", "main")
    with pytest.raises(TargetError, match="on the default branch main; name a range or a commit"):
        resolve(repo.path)


def test_no_default_target_when_detached(repo: FixtureRepo) -> None:
    repo.git("switch", "-q", "--detach", repo.ids["f1"])
    with pytest.raises(TargetError, match="detached"):
        resolve(repo.path)


def test_no_default_target_without_a_default_branch(tmp_path: Path) -> None:
    r = init_repo(tmp_path / "trunk-only", branch="trunk")
    r.commit("t1", {"a": "1\n"})
    r.git("switch", "-q", "-c", "topic")
    r.commit("t2", {"a": "2\n"})
    with pytest.raises(TargetError, match="cannot tell which branch is the default"):
        resolve(r.path)


def test_default_uses_the_newest_fork_point_of_local_and_remote(repo: FixtureRepo, tmp_path: Path) -> None:
    clone = FixtureRepo(tmp_path / "clone", dict(repo.ids))
    repo.git("switch", "-q", "main")  # a clone's origin/HEAD follows the branch checked out in the source
    repo.git("clone", "-q", str(repo.path), str(clone.path))
    clone.git("config", "user.name", "Fixture")
    clone.git("config", "user.email", "fixture@example.invalid")
    clone.git("switch", "-q", "-c", "topic", "origin/main")
    clone.commit("t1", {"topic.py": "T = 1\n"})
    clone.git("branch", "-f", "main", repo.ids["c2"])  # local main is behind origin/main
    t = resolve(clone.path)
    assert (t.base, t.head) == (repo.ids["m3"], clone.ids["t1"])
    assert t.label == "topic against main"
