"""HTTP application: serves the built viewer and the review API."""

from importlib import resources
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from xenagos import __version__
from xenagos.target import ReviewTarget

VIEWER_MISSING = "The viewer is not built. Run `make web` in the xenagos repository, or install a built package."


class ReviewInfo(BaseModel):
    id: str
    repo: str
    label: str
    base: str
    head: str
    branch: str | None


def bundled_viewer_dir() -> Path | None:
    """Directory of the built viewer shipped inside the package, or None when it was not built."""
    path = Path(str(resources.files("xenagos") / "static"))
    return path if (path / "index.html").is_file() else None


def create_app(target: ReviewTarget, viewer_dir: Path | None) -> FastAPI:
    """Build the application for one review. `viewer_dir` holds the built viewer; None serves an explanation."""
    app = FastAPI(title="xenagos", version=__version__, docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__, "review": target.review_id}

    @app.get("/api/review")
    def review() -> ReviewInfo:
        return ReviewInfo(
            id=target.review_id,
            repo=str(target.repo),
            label=target.label,
            base=target.base,
            head=target.head,
            branch=target.branch,
        )

    if viewer_dir is None:

        @app.get("/", response_class=PlainTextResponse, status_code=503)
        def viewer_missing() -> str:
            return VIEWER_MISSING

    else:
        app.mount("/", StaticFiles(directory=viewer_dir, html=True), name="viewer")
    return app
