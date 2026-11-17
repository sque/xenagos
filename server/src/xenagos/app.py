"""HTTP application: serves the built viewer and the review API."""

from importlib import resources
from pathlib import Path
from typing import Any

from fastapi import Body, FastAPI, HTTPException
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from starlette.responses import Response
from starlette.types import Scope

from xenagos import __version__
from xenagos.access import Access, AccessControl
from xenagos.api import FileView, PlanRejection, ReviewInfo
from xenagos.files import BINARY
from xenagos.plan import Plan
from xenagos.review import PlanRejected, Review
from xenagos.target import ReviewTarget

VIEWER_MISSING = "The viewer is not built. Run `make web` in the xenagos repository, or install a built package."


class ViewerFiles(StaticFiles):
    """The built viewer. Its page must be revalidated on every load, or a browser keeps an old page that names an old
    bundle after xenagos is rebuilt or upgraded; the bundles have content hashes in their names and never change."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        response = await super().get_response(path, scope)
        immutable = path.startswith("assets/")
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable" if immutable else "no-cache"
        return response


def bundled_viewer_dir() -> Path | None:
    """Directory of the built viewer shipped inside the package, or None when it was not built."""
    path = Path(str(resources.files("xenagos") / "static"))
    return path if (path / "index.html").is_file() else None


def create_app(target: ReviewTarget, access: Access, viewer_dir: Path | None) -> FastAPI:
    """Build the application for one review. `viewer_dir` holds the built viewer; None serves an explanation."""
    app = FastAPI(title="xenagos", version=__version__, docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(AccessControl, access=access)
    state = Review(target)
    app.state.review = state

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

    @app.get("/api/file")
    def file(path: str) -> FileView:
        change = state.change_for(path)
        old_path = change.old_path if change is not None else None
        head_path = change.path if change is not None else path
        base = state.files.text(target.base, old_path or head_path)
        head = state.files.text(target.head, head_path)
        if change is None and base is None and head is None:
            raise HTTPException(404, f"{path} exists at neither revision")
        return FileView(
            path=head_path,
            old_path=old_path,
            status=change.status if change is not None else "unchanged",
            binary=BINARY in (base, head),
            base=base if isinstance(base, str) else None,
            head=head if isinstance(head, str) else None,
        )

    @app.get("/api/plan")
    def get_plan() -> Plan:
        if state.plan is None:
            raise HTTPException(404, "this review has no walkthrough yet")
        return state.plan

    @app.put("/api/plan", response_model=Plan, responses={422: {"model": PlanRejection}})
    def put_plan(document: Any = Body()) -> Any:  # noqa: B008 - FastAPI's declaration style
        try:
            return state.submit_plan(document)
        except PlanRejected as rejected:
            return JSONResponse(PlanRejection(problems=rejected.problems).model_dump(), status_code=422)

    # Keep this last: a mount at "/" answers for every route added after it, WebSockets included.
    if viewer_dir is None:

        @app.get("/", response_class=PlainTextResponse, status_code=503)
        def viewer_missing() -> str:
            return VIEWER_MISSING

    else:
        app.mount("/", ViewerFiles(directory=viewer_dir, html=True), name="viewer")
    return app
