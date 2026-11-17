"""HTTP application: serves the built viewer and the review API."""

from importlib import resources
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles

from xenagos import __version__

VIEWER_MISSING = "The viewer is not built. Run `make web` in the xenagos repository, or install a built package."


def bundled_viewer_dir() -> Path | None:
    """Directory of the built viewer shipped inside the package, or None when it was not built."""
    path = Path(str(resources.files("xenagos") / "static"))
    return path if (path / "index.html").is_file() else None


def create_app(viewer_dir: Path | None) -> FastAPI:
    """Build the application. `viewer_dir` holds the built viewer; None serves an explanation instead."""
    app = FastAPI(title="xenagos", version=__version__, docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    if viewer_dir is None:

        @app.get("/", response_class=PlainTextResponse, status_code=503)
        def viewer_missing() -> str:
            return VIEWER_MISSING

    else:
        app.mount("/", StaticFiles(directory=viewer_dir, html=True), name="viewer")
    return app
