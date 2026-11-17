import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import FixtureRepo
from xenagos import __version__
from xenagos.access import SECRET_HEADER, Access
from xenagos.app import VIEWER_MISSING, create_app
from xenagos.target import ReviewTarget, resolve

PORT = 40123


@pytest.fixture
def target(repo: FixtureRepo) -> ReviewTarget:
    return resolve(repo.path)


def client(target: ReviewTarget, viewer_dir: Path | None = None) -> TestClient:
    access = Access(review_id=target.review_id, port=PORT, secret="s3cret")
    return TestClient(
        create_app(target, access, viewer_dir),
        base_url=f"http://127.0.0.1:{PORT}",
        headers={SECRET_HEADER: "s3cret"},
    )


def test_health_reports_version(target: ReviewTarget) -> None:
    response = client(target).get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": __version__, "review": target.review_id}


def test_review_reports_pinned_ids(target: ReviewTarget, repo: FixtureRepo) -> None:
    body = client(target).get("/api/review").json()
    assert body["base"] == repo.ids["c2"]
    assert body["head"] == repo.ids["f2"]
    assert body["label"] == "feature against main"
    assert body["id"] == target.review_id


def test_serves_built_viewer(target: ReviewTarget, tmp_path: Path) -> None:
    (tmp_path / "index.html").write_text("<!doctype html><title>xenagos</title>")
    response = client(target, tmp_path).get("/")
    assert response.status_code == 200
    assert "<title>xenagos</title>" in response.text


def test_explains_missing_viewer(target: ReviewTarget) -> None:
    response = client(target).get("/")
    assert response.status_code == 503
    assert response.text == VIEWER_MISSING


SAMPLE_PLAN = json.loads((Path(__file__).parent / "data" / "plan-sample.json").read_text())


def test_file_shows_both_revisions(target: ReviewTarget) -> None:
    body = client(target).get("/api/file", params={"path": "app.py"}).json()
    assert body == {
        "path": "app.py",
        "oldPath": None,
        "status": "modified",
        "binary": False,
        "base": "print('two')\n",
        "head": "print('feature one')\n",
    }


def test_file_added_and_unchanged(target: ReviewTarget, repo: FixtureRepo) -> None:
    c = client(target)
    added = c.get("/api/file", params={"path": "lib.py"}).json()
    assert (added["status"], added["base"], added["head"]) == ("added", None, "X = 1\n")
    repo.commit("later", {"other.py": "unrelated\n"})  # after the pinned head: not part of the review
    assert c.get("/api/file", params={"path": "other.py"}).status_code == 404


def test_file_unchanged_by_the_review(repo: FixtureRepo) -> None:
    target = resolve(repo.path, "main..main")
    body = client(target).get("/api/file", params={"path": "app.py"}).json()
    assert (body["status"], body["base"], body["head"]) == ("unchanged", "print('two')\n", "print('two')\n")


def test_plan_is_absent_until_one_is_accepted(target: ReviewTarget) -> None:
    c = client(target)
    assert c.get("/api/plan").status_code == 404
    accepted = c.put("/api/plan", json=SAMPLE_PLAN)
    assert accepted.status_code == 200
    assert c.get("/api/plan").json()["sections"][0]["steps"][1]["target"]["startCol"] == 7


def test_rejected_plan_names_problems_and_keeps_the_previous_plan(target: ReviewTarget) -> None:
    c = client(target)
    c.put("/api/plan", json=SAMPLE_PLAN)
    broken = json.loads(json.dumps(SAMPLE_PLAN))
    broken["sections"][1]["steps"][0]["target"].update({"startLine": 400, "endLine": 410})
    response = c.put("/api/plan", json=broken)
    assert response.status_code == 422
    assert response.json()["problems"] == [
        'section 2 ("A test and a constant to build on"), step 1: '
        "lines 400-410 are past the end of lib.py, which has 1 line at the head revision"
    ]
    assert c.get("/api/plan").json() == accepted_form(SAMPLE_PLAN, c)


def test_plan_with_format_errors_is_rejected(target: ReviewTarget) -> None:
    broken = json.loads(json.dumps(SAMPLE_PLAN))
    del broken["sections"][0]["role"]
    response = client(target).put("/api/plan", json=broken)
    assert response.status_code == 422
    assert response.json()["problems"] == ["sections.0.role: Field required"]


def accepted_form(plan: dict[str, Any], c: TestClient) -> Any:
    return c.put("/api/plan", json=plan).json()
