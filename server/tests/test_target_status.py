"""Reporting what changed around a pinned review (spec: review-target; tasks 3.2 and 3.4)."""

from pathlib import Path

from tests.conftest import FixtureRepo
from tests.test_app import client
from xenagos.target import resolve


def status(repo: FixtureRepo, target: str | None = None) -> dict[str, object]:
    viewer = client(resolve(repo.path, target))
    response = viewer.get("/api/target/status")
    assert response.status_code == 200
    body: dict[str, object] = response.json()
    return body


def test_nothing_to_report_right_after_opening(repo: FixtureRepo) -> None:
    assert status(repo) == {"moved": None, "uncommitted": []}


def test_branch_moved_past_the_pinned_head_is_reported_and_the_review_stays_pinned(repo: FixtureRepo) -> None:
    target = resolve(repo.path)
    viewer = client(target)
    lib_before = viewer.get("/api/file", params={"path": "lib.py"}).json()["head"]
    repo.commit("f3", {"lib.py": "X = 2\n"})
    repo.commit("f4", {"lib.py": "X = 3\n"})
    body = viewer.get("/api/target/status").json()
    assert body["moved"] == {"branch": "feature", "tip": repo.ids["f4"], "ahead": 2}
    # Still the pinned diff and content.
    assert viewer.get("/api/review").json()["head"] == repo.ids["f2"]
    assert viewer.get("/api/file", params={"path": "lib.py"}).json()["head"] == lib_before
    assert [c["path"] for c in viewer.get("/api/changes").json()] == ["app.py", "lib.py", "tests/test_app.py"]


def test_rewritten_and_deleted_branch(repo: FixtureRepo) -> None:
    viewer = client(resolve(repo.path))
    repo.git("reset", "-q", "--hard", repo.ids["f1"])
    repo.commit("f2b", {"lib.py": "X = 9\n"})
    assert viewer.get("/api/target/status").json()["moved"] == {
        "branch": "feature",
        "tip": repo.ids["f2b"],
        "ahead": None,
    }
    repo.git("switch", "-q", "main")
    repo.git("branch", "-q", "-D", "feature")
    assert viewer.get("/api/target/status").json()["moved"] == {"branch": "feature", "tip": None, "ahead": None}


def test_range_naming_a_branch_reports_it_and_a_single_commit_does_not(repo: FixtureRepo) -> None:
    viewer = client(resolve(repo.path, "main...feature"))
    single = client(resolve(repo.path, repo.ids["f1"]))
    repo.commit("f3", {"lib.py": "X = 2\n"})
    assert viewer.get("/api/target/status").json()["moved"]["ahead"] == 1
    assert single.get("/api/target/status").json()["moved"] is None


def test_uncommitted_changes_to_reviewed_files_are_named_without_touching_the_index(repo: FixtureRepo) -> None:
    viewer = client(resolve(repo.path))
    (repo.path / "app.py").write_text("print('edited, not committed')\n")
    (repo.path / "tests" / "test_app.py").write_text("def test(): assert True\n")
    repo.git("add", "tests/test_app.py")  # staged counts as uncommitted too
    (repo.path / "unrelated.txt").write_text("new file\n")
    git_status = repo.git("status", "--porcelain")  # the test's own git may refresh the index; xenagos must not
    index = Path(repo.path / ".git" / "index")
    before = (index.stat().st_mtime_ns, index.read_bytes())
    body = viewer.get("/api/target/status").json()
    assert body["uncommitted"] == ["app.py", "tests/test_app.py"]
    assert (index.stat().st_mtime_ns, index.read_bytes()) == before
    assert repo.git("status", "--porcelain") == git_status
    # The diff is still the committed change only.
    assert viewer.get("/api/file", params={"path": "app.py"}).json()["head"] == "print('feature one')\n"


def test_browsing_a_head_that_is_not_checked_out_leaves_the_checkout_alone(repo: FixtureRepo) -> None:
    """spec: review-target, "Reviewing a head that is not checked out": xenagos's own reads go through the object
    store. (A private checkout for the agent is task 3.3.)"""
    repo.git("switch", "-q", "main")
    (repo.path / "README.md").write_text("edited, not committed\n")
    (repo.path / "notes.txt").write_text("untracked\n")
    repo.git("stash", "list")
    before = (
        repo.git("status", "--porcelain=v1", "-uall"),
        repo.git("branch", "--show-current"),
        repo.git("stash", "list"),
        repo.git("rev-parse", "HEAD"),
    )
    target = resolve(repo.path, "main...feature")
    viewer = client(target)
    paths = [c["path"] for c in viewer.get("/api/changes").json()]
    for path in paths:
        assert viewer.get("/api/file", params={"path": path}).status_code == 200
    for commit in viewer.get("/api/commits").json():
        assert viewer.get("/api/changes", params={"commit": commit["id"]}).status_code == 200
    for url in ("/api/tree", "/api/target/status", "/api/review"):
        assert viewer.get(url).status_code == 200
    after = (
        repo.git("status", "--porcelain=v1", "-uall"),
        repo.git("branch", "--show-current"),
        repo.git("stash", "list"),
        repo.git("rev-parse", "HEAD"),
    )
    assert after == before
    assert (repo.path / "README.md").read_text() == "edited, not committed\n"
