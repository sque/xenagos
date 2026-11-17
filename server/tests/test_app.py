from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests.conftest import FixtureRepo
from xenagos import __version__
from xenagos.app import VIEWER_MISSING, create_app
from xenagos.target import ReviewTarget, resolve


@pytest.fixture
def target(repo: FixtureRepo) -> ReviewTarget:
    return resolve(repo.path)


def test_health_reports_version(target: ReviewTarget) -> None:
    response = TestClient(create_app(target, None)).get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": __version__}


def test_review_reports_pinned_ids(target: ReviewTarget, repo: FixtureRepo) -> None:
    body = TestClient(create_app(target, None)).get("/api/review").json()
    assert body["base"] == repo.ids["c2"]
    assert body["head"] == repo.ids["f2"]
    assert body["label"] == "feature against main"
    assert body["id"] == target.review_id


def test_serves_built_viewer(target: ReviewTarget, tmp_path: Path) -> None:
    (tmp_path / "index.html").write_text("<!doctype html><title>xenagos</title>")
    response = TestClient(create_app(target, tmp_path)).get("/")
    assert response.status_code == 200
    assert "<title>xenagos</title>" in response.text


def test_explains_missing_viewer(target: ReviewTarget) -> None:
    response = TestClient(create_app(target, None)).get("/")
    assert response.status_code == 503
    assert response.text == VIEWER_MISSING
