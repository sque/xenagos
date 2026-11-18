"""Browse mode's server side (spec: diff-browser; tasks 4.1 and 4.2)."""

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import FixtureRepo, init_repo
from tests.test_app import PORT
from xenagos.access import SECRET_HEADER, Access
from xenagos.app import create_app
from xenagos.store import ReviewStore
from xenagos.target import ReviewTarget, resolve

A_BASE = "".join(f"a{n} = {n}\n" for n in range(1, 401))


@pytest.fixture
def three(tmp_path: Path) -> FixtureRepo:
    """main: c1. feature: k1 (a.py edited, test added), k2 (lock file and a generated client), k3 (a.py edited
    in two places 300 lines apart)."""
    r = init_repo(tmp_path / "three")
    r.commit("c1", {"a.py": A_BASE, ".gitattributes": "gen/** linguist-generated\n"})
    r.git("switch", "-q", "-c", "feature")
    r.commit(
        "k1\n\nWhy k1 exists.",
        {"a.py": A_BASE.replace("a5 = 5\n", "a5 = 50\n"), "tests/test_a.py": "def test(): pass\n"},
    )
    r.commit("k2", {"uv.lock": "".join(f"pkg{n}\n" for n in range(40)), "gen/client.py": "client = 1\n"})
    r.commit(
        "k3",
        {"a.py": A_BASE.replace("a5 = 5\n", "a5 = 50\n").replace("a20 = 20\n", "a20 = 2\na20b = 0\n").replace(
            "a320 = 320\n", "a320 = 3\n")},
    )  # fmt: skip
    r.ids["k1"] = r.git("rev-parse", "HEAD~2")
    return r


def viewer(target: ReviewTarget, store: ReviewStore | None = None) -> TestClient:
    access = Access(review_id=target.review_id, port=PORT, secret="s3cret")
    return TestClient(
        create_app(target, access, None, store=store),
        base_url=f"http://127.0.0.1:{PORT}",
        headers={SECRET_HEADER: "s3cret"},
    )


def by_path(files: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {f["path"]: f for f in files}


def test_commit_list_oldest_first_with_messages(three: FixtureRepo) -> None:
    commits = viewer(resolve(three.path)).get("/api/commits").json()
    assert [c["subject"] for c in commits] == ["k1", "k2", "k3"]
    assert commits[0]["message"] == "k1\n\nWhy k1 exists."
    assert commits[0]["id"] == three.ids["k1"]
    assert commits[0]["author"] == "Fixture"


def test_combined_changes_with_counts_and_categories(three: FixtureRepo) -> None:
    files = by_path(viewer(resolve(three.path)).get("/api/changes").json())
    assert {p: (f["category"], f["added"], f["removed"]) for p, f in files.items()} == {
        "a.py": ("code", 4, 3),
        "gen/client.py": ("generated", 1, 0),
        "tests/test_a.py": ("tests", 1, 0),
        "uv.lock": ("generated", 40, 0),
    }
    assert [h["id"] for h in files["a.py"]["hunks"]] == ["a.py:h1", "a.py:h2", "a.py:h3"]


def test_one_commit_shows_only_what_it_changed(three: FixtureRepo) -> None:
    client = viewer(resolve(three.path))
    k2, k3 = (c["id"] for c in client.get("/api/commits").json()[1:])
    assert sorted(by_path(client.get("/api/changes", params={"commit": k2}).json())) == ["gen/client.py", "uv.lock"]
    a = by_path(client.get("/api/changes", params={"commit": k3}).json())["a.py"]
    assert (a["added"], a["removed"], len(a["hunks"])) == (3, 2, 2)
    sides = client.get("/api/file", params={"path": "a.py", "commit": k3}).json()
    assert "a5 = 50\na6" in sides["base"] and "a20 = 20\n" in sides["base"]
    assert "a20b = 0\n" in sides["head"]
    added = client.get("/api/file", params={"path": "tests/test_a.py", "commit": three.ids["k1"]}).json()
    assert (added["status"], added["base"], added["head"]) == ("added", None, "def test(): pass\n")


def test_commits_outside_the_review_are_refused(three: FixtureRepo) -> None:
    client = viewer(resolve(three.path))
    for commit in (three.ids["c1"], "nope"):
        assert client.get("/api/changes", params={"commit": commit}).status_code == 404
        assert client.get("/api/file", params={"path": "a.py", "commit": commit}).status_code == 404


def test_single_root_commit_review(three: FixtureRepo) -> None:
    client = viewer(resolve(three.path, three.ids["c1"]))
    (commit,) = client.get("/api/commits").json()
    assert commit["id"] == three.ids["c1"]
    assert sorted(by_path(client.get("/api/changes", params={"commit": commit["id"]}).json())) == [
        ".gitattributes",
        "a.py",
    ]


def test_category_correction_lasts_for_the_review(three: FixtureRepo) -> None:
    target = resolve(three.path)
    store = ReviewStore(target.review_id)
    store.save_target(target)
    client = viewer(target, store)
    assert client.put("/api/categories", json={"path": "uv.lock", "category": "code"}).json() == {"uv.lock": "code"}
    assert by_path(client.get("/api/changes").json())["uv.lock"]["category"] == "code"
    k2 = client.get("/api/commits").json()[1]["id"]
    assert by_path(client.get("/api/changes", params={"commit": k2}).json())["uv.lock"]["category"] == "code"
    # A new server for the same review keeps it.
    again = viewer(target, ReviewStore(target.review_id))
    assert by_path(again.get("/api/changes").json())["uv.lock"]["category"] == "code"
    assert again.put("/api/categories", json={"path": "uv.lock", "category": None}).json() == {}
    assert by_path(again.get("/api/changes").json())["uv.lock"]["category"] == "generated"
    refused = again.put("/api/categories", json={"path": "README.md", "category": "tests"})
    assert (refused.status_code, refused.json()["problems"]) == (422, ["README.md is not a file this review changes"])
