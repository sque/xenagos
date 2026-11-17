from pathlib import Path

from fastapi.testclient import TestClient

from xenagos import __version__
from xenagos.app import VIEWER_MISSING, create_app


def test_health_reports_version() -> None:
    response = TestClient(create_app(None)).get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": __version__}


def test_serves_built_viewer(tmp_path: Path) -> None:
    (tmp_path / "index.html").write_text("<!doctype html><title>xenagos</title>")
    response = TestClient(create_app(tmp_path)).get("/")
    assert response.status_code == 200
    assert "<title>xenagos</title>" in response.text


def test_explains_missing_viewer() -> None:
    response = TestClient(create_app(None)).get("/")
    assert response.status_code == 503
    assert response.text == VIEWER_MISSING
