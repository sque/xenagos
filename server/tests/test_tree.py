from pathlib import Path
from typing import Any

import pytest

from tests.conftest import FixtureRepo, init_repo
from tests.test_app import client
from xenagos.target import ReviewTarget, resolve


@pytest.fixture
def scheduler(tmp_path: Path) -> FixtureRepo:
    """main: a small project. feature: batch.py modified, errors.py added, legacy_retry.py deleted, old_name.py
    renamed, uv.lock changed; queue.py and the rest unchanged."""
    r = init_repo(tmp_path / "scheduler")
    r.commit(
        "base",
        {
            "README.md": "readme\n",
            "scheduler/batch.py": "".join(f"b{n} = {n}\n" for n in range(1, 31)),
            "scheduler/queue.py": "".join(f"q{n} = {n}\n" for n in range(1, 21)),
            "scheduler/legacy_retry.py": "retry = True\n",
            "scheduler/old_name.py": "".join(f"o{n} = {n}\n" for n in range(1, 11)),
            "api/routes.py": "routes = []\n",
            "uv.lock": "v1\n",
        },
    )
    r.git("switch", "-q", "-c", "feature")
    r.git("rm", "-q", "scheduler/legacy_retry.py")
    r.git("mv", "scheduler/old_name.py", "scheduler/new_name.py")
    batch = (
        (r.path / "scheduler/batch.py").read_text().replace("b5 = 5\n", "b5 = 50\n").replace("b25 = 25\n", "b25 = 0\n")
    )
    r.commit(
        "head",
        {"scheduler/batch.py": batch, "scheduler/errors.py": "class Failed(Exception): ...\n", "uv.lock": "v2\n"},
    )
    return r


def step(path: str, line: int, side: str = "head") -> dict[str, Any]:
    target = {"path": path, "side": side, "startLine": line, "endLine": line}
    return {"narration": "Look here.", "form": "lines", "target": target}


PLAN: dict[str, Any] = {
    "orientation": {"problem": "Batches fail together.", "source": "inferred"},
    "sections": [
        {
            "title": "Fail one batch",
            "role": "core",
            "explanation": "Only the failing batch ends.",
            "hunks": ["scheduler/batch.py:h1", "scheduler/errors.py:h1", "scheduler/new_name.py:h1"],
            "steps": [
                step("scheduler/batch.py", 5),
                step("scheduler/queue.py", 3),
                step("scheduler/old_name.py", 2, side="base"),
            ],
        }
    ],
}


@pytest.fixture
def target(scheduler: FixtureRepo) -> ReviewTarget:
    return resolve(scheduler.path)


def test_tree_without_a_plan_lists_head_files_and_deleted_ones(target: ReviewTarget) -> None:
    tree = client(target).get("/api/tree").json()
    assert tree["files"] == [
        "README.md",
        "api/routes.py",
        "scheduler/batch.py",
        "scheduler/errors.py",
        "scheduler/legacy_retry.py",
        "scheduler/new_name.py",
        "scheduler/queue.py",
        "uv.lock",
    ]
    changed = {e["path"]: e for e in tree["changed"]}
    assert {p: e["status"] for p, e in changed.items()} == {
        "scheduler/batch.py": "modified",
        "scheduler/errors.py": "added",
        "scheduler/legacy_retry.py": "deleted",
        "scheduler/new_name.py": "renamed",
        "uv.lock": "modified",
    }
    assert changed["scheduler/new_name.py"]["oldPath"] == "scheduler/old_name.py"
    assert changed["uv.lock"]["category"] == "generated"
    assert changed["scheduler/batch.py"]["category"] == "code"
    assert all(e["covered"] is None for e in tree["changed"])
    assert tree["visited"] == []


def test_tree_marks_coverage_and_visited_files_from_the_plan(target: ReviewTarget) -> None:
    viewer = client(target)
    response = viewer.put("/api/plan", json=PLAN)
    assert response.status_code == 200, response.text
    tree = viewer.get("/api/tree").json()
    covered = {e["path"]: e["covered"] for e in tree["changed"]}
    assert covered == {
        "scheduler/batch.py": "partly",  # h2 (line 25) is not claimed
        "scheduler/errors.py": "all",
        "scheduler/legacy_retry.py": "none",
        "scheduler/new_name.py": "all",
        "uv.lock": "none",
    }
    # queue.py is unchanged and visited; the base-side step on old_name.py visits the renamed file.
    assert tree["visited"] == ["scheduler/batch.py", "scheduler/new_name.py", "scheduler/queue.py"]
