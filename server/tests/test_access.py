from pathlib import Path

import pytest
from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient
from starlette.routing import Mount
from starlette.websockets import WebSocketDisconnect

from tests.conftest import FixtureRepo
from xenagos.access import REFUSED, SECRET_HEADER, Access
from xenagos.app import create_app
from xenagos.target import resolve

PORT = 40123
HOST = f"127.0.0.1:{PORT}"


@pytest.fixture
def access(repo: FixtureRepo) -> Access:
    return Access(review_id=resolve(repo.path).review_id, port=PORT, secret="secret-of-a")


@pytest.fixture
def app(repo: FixtureRepo, access: Access, tmp_path: Path) -> FastAPI:
    viewer = tmp_path / "viewer"
    viewer.mkdir()
    (viewer / "index.html").write_text("<title>xenagos</title>")
    app = create_app(resolve(repo.path), access, viewer)

    @app.websocket("/api/echo")
    async def echo(websocket: WebSocket) -> None:
        await websocket.accept()
        await websocket.send_text("hello")
        await websocket.close()

    # The viewer is mounted at "/" and must stay the last route, or it answers for everything after it.
    routes = app.router.routes
    mount = next(route for route in routes if isinstance(route, Mount))
    routes.remove(mount)
    routes.append(mount)
    return app


def client(app: FastAPI, host: str = HOST) -> TestClient:
    return TestClient(app, base_url=f"http://{host}", follow_redirects=False)


@pytest.mark.parametrize("path", ["/", "/api/review", "/api/health"])
def test_request_without_secret_is_refused(app: FastAPI, path: str) -> None:
    response = client(app).get(path)
    assert response.status_code == 403
    assert response.text == REFUSED


def test_another_reviews_secret_is_refused(app: FastAPI, access: Access) -> None:
    c = client(app)
    assert c.get("/api/review", headers={SECRET_HEADER: "secret-of-b"}).status_code == 403
    assert c.get("/?secret=secret-of-b").status_code == 403
    c.cookies.set(access.cookie, "secret-of-b")
    assert c.get("/api/review").status_code == 403


def test_another_reviews_cookie_name_is_ignored(app: FastAPI) -> None:
    c = client(app)
    c.cookies.set("xenagos_someotherreview", "secret-of-a")
    assert c.get("/api/review").status_code == 403


def test_foreign_origin_is_refused_even_with_the_secret(app: FastAPI) -> None:
    for origin in ("https://evil.example", "null", f"http://127.0.0.1:{PORT + 1}"):
        response = client(app).get("/api/review", headers={SECRET_HEADER: "secret-of-a", "Origin": origin})
        assert response.status_code == 403, origin


def test_foreign_host_is_refused_even_with_the_secret(app: FastAPI) -> None:
    for host in ("evil.example", f"127.0.0.1:{PORT + 1}"):
        assert client(app, host).get("/api/review", headers={SECRET_HEADER: "secret-of-a"}).status_code == 403


def test_secret_header_is_accepted(app: FastAPI) -> None:
    response = client(app).get("/api/review", headers={SECRET_HEADER: "secret-of-a", "Origin": f"http://{HOST}"})
    assert response.status_code == 200


def test_secret_in_address_is_exchanged_for_a_cookie(app: FastAPI, access: Access) -> None:
    c = client(app)
    response = c.get("/?secret=secret-of-a&mode=browse")
    assert response.status_code == 303
    assert response.headers["location"] == "/?mode=browse"
    cookie = response.headers["set-cookie"]
    assert cookie.startswith(f"{access.cookie}=secret-of-a")
    assert "HttpOnly" in cookie
    assert "SameSite=strict" in cookie
    assert c.get("/").status_code == 200
    assert c.get("/api/review").status_code == 200


def test_secret_in_address_works_again_for_a_second_tab(app: FastAPI) -> None:
    assert client(app).get("/?secret=secret-of-a").status_code == 303
    assert client(app).get("/?secret=secret-of-a").status_code == 303


def test_websocket_needs_the_cookie_and_this_origin(app: FastAPI, access: Access) -> None:
    c = client(app)
    with pytest.raises(WebSocketDisconnect), c.websocket_connect(f"ws://{HOST}/api/echo"):
        pass
    c.cookies.set(access.cookie, access.secret)
    with (
        pytest.raises(WebSocketDisconnect),
        c.websocket_connect(f"ws://{HOST}/api/echo", headers={"Origin": "https://evil.example"}),
    ):
        pass
    with c.websocket_connect(f"ws://{HOST}/api/echo", headers={"Origin": f"http://{HOST}"}) as ws:
        assert ws.receive_text() == "hello"


def test_visual_assets_are_served_without_the_secret(repo: FixtureRepo, tmp_path: Path) -> None:
    viewer = tmp_path / "viewer"
    (viewer / "visual-assets").mkdir(parents=True)
    (viewer / "visual-assets" / "mermaid.min.js").write_text("// library")
    (viewer / "index.html").write_text("<html></html>")
    target = resolve(repo.path)
    access = Access(review_id=target.review_id, port=PORT, secret="s3cret")
    plain = TestClient(create_app(target, access, viewer), base_url=f"http://127.0.0.1:{PORT}")
    assert plain.get("/visual-assets/mermaid.min.js").text == "// library"
    # As a sandboxed visual frame asks for it.
    assert plain.get("/visual-assets/mermaid.min.js", headers={"Origin": "null"}).status_code == 200
    assert plain.get("/visual-assets/mermaid.min.js", headers={"Host": "evil.example"}).status_code == 403
    assert plain.get("/api/review", headers={"Origin": "null"}).status_code == 403
    assert plain.get("/").status_code == 403
    assert plain.get("/api/review").status_code == 403
    assert plain.post("/visual-assets/mermaid.min.js").status_code == 403
    page = TestClient(
        create_app(target, access, viewer), base_url=f"http://127.0.0.1:{PORT}", headers={SECRET_HEADER: "s3cret"}
    )
    assert page.get("/").headers["Content-Security-Policy"] == "frame-src 'none'; frame-ancestors 'none'"
