"""A review's saved state (design decision 9; spec: review-session, "A review survives its instance").

Each review has a directory under the data home, named by its review id, that outlives the server: the pinned target,
the review's agent session and the current plan. A server for the review can be started again from it alone, which is
how an agent command reaches a review whose server has ended. Files are replaced whole through a rename, so a reader
never sees half a file, and are readable only by the user.
"""

import contextlib
import os
import secrets
import threading
import time
from pathlib import Path

from pydantic import BaseModel, ValidationError

from xenagos.paths import data_home
from xenagos.plan import Plan
from xenagos.target import ReviewTarget


class SavedReview(BaseModel):
    review_id: str
    repo: str
    base: str
    head: str
    label: str
    branch: str | None
    session: str | None = None
    """Full id of the review's Claude Code session, if it has one."""
    session_name: str | None = None
    session_cwd: str | None = None
    """Where the session runs. A session is continued from its own folder, and its name is passed again, after
    Claude Code has stopped listing it."""
    created: float

    @property
    def target(self) -> ReviewTarget:
        return ReviewTarget(Path(self.repo), self.base, self.head, self.label, self.branch)


_WRITING = threading.RLock()


def reviews_root() -> Path:
    return data_home() / "reviews"


class ReviewStore:
    def __init__(self, review_id: str) -> None:
        self.review_id = review_id
        self.dir = reviews_root() / review_id

    @property
    def log_path(self) -> Path:
        """Output of a server started in the background for this review."""
        return self.dir / "server.log"

    def exists(self) -> bool:
        return (self.dir / "review.json").is_file()

    def load(self) -> SavedReview | None:
        return _read(self.dir / "review.json", SavedReview)

    def save_target(self, target: ReviewTarget) -> SavedReview:
        """Record the review's target, keeping what was saved before. Returns the saved review."""
        saved = self.load()
        if saved is None:
            saved = SavedReview(
                review_id=target.review_id,
                repo=str(target.repo),
                base=target.base,
                head=target.head,
                label=target.label,
                branch=target.branch,
                created=time.time(),
            )
            self._write("review.json", saved.model_dump_json(indent=2))
        return saved

    def set_session(self, session: str | None, name: str | None = None, cwd: str | None = None) -> None:
        with _WRITING:  # read, change and write as one step: requests and the state follower run on threads
            saved = self.load()
            if saved is None:
                raise FileNotFoundError(f"no saved review {self.review_id}")
            update = {"session": session, "session_name": name, "session_cwd": cwd}
            current = {"session": saved.session, "session_name": saved.session_name, "session_cwd": saved.session_cwd}
            if update != current:
                self._write("review.json", saved.model_copy(update=update).model_dump_json(indent=2))

    def load_plan(self) -> Plan | None:
        return _read(self.dir / "plan.json", Plan)

    def save_plan(self, plan: Plan) -> None:
        self._write("plan.json", plan.model_dump_json(by_alias=True, exclude_none=True, indent=2))

    def _write(self, name: str, text: str) -> None:
        self.dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        final = self.dir / name
        temp = final.with_name(f".{name}.{os.getpid()}.{secrets.token_hex(4)}.tmp")
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        try:
            with os.fdopen(fd, "w") as f:
                f.write(text)
            temp.replace(final)
        finally:
            with contextlib.suppress(FileNotFoundError):
                temp.unlink()


def saved_reviews() -> list[SavedReview]:
    root = reviews_root()
    if not root.is_dir():
        return []
    found = [_read(path / "review.json", SavedReview) for path in sorted(root.iterdir())]
    return [review for review in found if review is not None]


def _read[T: BaseModel](path: Path, model: type[T]) -> T | None:
    try:
        return model.model_validate_json(path.read_text())
    except FileNotFoundError:
        return None
    except (OSError, ValidationError):
        # A file from another version of xenagos, or damaged: the review starts without it rather than not at all.
        return None
