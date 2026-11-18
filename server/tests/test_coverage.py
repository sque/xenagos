import copy
import json
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from tests.conftest import FixtureRepo, init_repo
from tests.test_app import client
from xenagos.categories import categorize
from xenagos.coverage import not_covered, summary
from xenagos.diff import changes
from xenagos.plan import Plan
from xenagos.target import resolve

SAMPLE: dict[str, Any] = json.loads((Path(__file__).parent / "data" / "plan-sample.json").read_text())


def without_lib(plan: dict[str, Any]) -> dict[str, Any]:
    """The sample plan with `lib.py:h1` left unclaimed and nothing pointing at lib.py."""
    plan = copy.deepcopy(plan)
    section = plan["sections"][1]
    section["hunks"] = ["tests/test_app.py:h1"]
    section["steps"] = [step("tests/test_app.py", "def test")]
    return plan


def step(path: str, expect: str, line: int = 1) -> dict[str, Any]:
    target = {"path": path, "startLine": line, "endLine": line, "expect": expect}
    return {"narration": "A placeholder step.", "form": "lines", "target": target}


def test_one_unclaimed_hunk_is_listed_with_category_and_line_counts(repo: FixtureRepo) -> None:
    target = resolve(repo.path)
    found = changes(target.repo, target.base, target.head)
    categories = categorize(target.repo, target.head, [c.path for c in found])
    coverage = not_covered(Plan.model_validate(without_lib(SAMPLE)), found, categories)
    assert (coverage.hunks, coverage.files) == (1, 1)
    (group,) = coverage.categories
    assert (group.category, group.added, group.removed) == ("code", 1, 0)
    (file,) = group.files
    assert (file.path, file.status, file.partly, file.added, file.removed) == ("lib.py", "added", False, 1, 0)
    assert [h.id for h in file.hunks] == ["lib.py:h1"]
    assert summary(coverage) == "Not covered by any section (1 hunk), shown to the reviewer:\n- code: lib.py:h1 (+1 -0)"


def test_full_plan_covers_everything(repo: FixtureRepo) -> None:
    target = resolve(repo.path)
    found = changes(target.repo, target.base, target.head)
    coverage = not_covered(Plan.model_validate(SAMPLE), found, {})
    assert (coverage.hunks, coverage.files, coverage.categories) == (0, 0, [])
    assert summary(coverage) == "Every hunk is claimed by a section."


def test_partly_covered_file_lists_only_its_unclaimed_hunks(tmp_path: Path) -> None:
    r = init_repo(tmp_path / "two")
    twenty = "".join(f"line {n}\n" for n in range(1, 21))
    r.commit("base", {"multi.py": twenty, "tests/test_multi.py": "a\n", "uv.lock": "1\n"})
    edited = twenty.replace("line 3\n", "line three\n").replace("line 15\n", "line 15\nline 15b\nline 15c\n")
    r.commit("head", {"multi.py": edited, "tests/test_multi.py": "b\n", "uv.lock": "2\n3\n"})
    found = changes(r.path, r.ids["base"], r.ids["head"])
    plan = copy.deepcopy(SAMPLE)
    plan["sections"] = [{**plan["sections"][1], "hunks": ["multi.py:h1"], "steps": [step("multi.py", "three", 3)]}]
    coverage = not_covered(Plan.model_validate(plan), found, categorize(r.path, r.ids["head"], [c.path for c in found]))
    assert [g.category for g in coverage.categories] == ["code", "tests", "generated"]
    multi = coverage.categories[0].files[0]
    assert (multi.partly, [h.id for h in multi.hunks], multi.added, multi.removed) == (True, ["multi.py:h2"], 2, 0)
    assert (coverage.categories[1].added, coverage.categories[1].removed) == (1, 1)
    assert (coverage.categories[2].added, coverage.categories[2].removed) == (2, 1)
    assert coverage.hunks == 3


def test_coverage_endpoint(repo: FixtureRepo) -> None:
    viewer: TestClient = client(resolve(repo.path))
    assert viewer.get("/api/coverage").status_code == 404
    assert viewer.put("/api/plan", json=without_lib(SAMPLE)).status_code == 200
    body = viewer.get("/api/coverage").json()
    assert body["hunks"] == 1
    assert body["categories"][0]["files"][0]["path"] == "lib.py"
    assert body["categories"][0]["files"][0]["hunks"][0]["headCount"] == 1
