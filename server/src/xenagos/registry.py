"""Records of running reviews: one file per running review server (design decision 4).

A record is created atomically and only if none exists for the same review, so two attempts to open the same target
at once start one server. A record whose process has gone is removed by whoever finds it.
"""

import contextlib
import json
import os
import secrets
import signal
import time
import urllib.error
import urllib.request
from pathlib import Path

from pydantic import BaseModel

from xenagos.paths import state_home
from xenagos.target import ReviewTarget

LOOPBACK = "127.0.0.1"
SECRET_HEADER = "X-Xenagos-Secret"  # noqa: S105 - a header name, not a secret
STARTUP_GRACE_SECONDS = 15.0


class Entry(BaseModel):
    review_id: str
    repo: str
    label: str
    base: str
    head: str
    branch: str | None
    port: int
    secret: str
    pid: int
    started: float
    session: str | None = None

    @property
    def url(self) -> str:
        return f"http://{LOOPBACK}:{self.port}/"


def new_entry(target: ReviewTarget, port: int) -> Entry:
    return Entry(
        review_id=target.review_id,
        repo=str(target.repo),
        label=target.label,
        base=target.base,
        head=target.head,
        branch=target.branch,
        port=port,
        secret=secrets.token_urlsafe(32),
        pid=os.getpid(),
        started=time.time(),
    )


def reviews_dir() -> Path:
    path = state_home() / "reviews"
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    return path


def _path(review_id: str) -> Path:
    return reviews_dir() / f"{review_id}.json"


def _read(path: Path) -> Entry | None:
    try:
        return Entry.model_validate_json(path.read_text())
    except (OSError, ValueError):
        return None


def claim(entry: Entry) -> Entry | None:
    """Record `entry` as the running server of its review. If a live server already has the review, return its entry
    and record nothing."""
    final = _path(entry.review_id)
    temp = final.with_name(f".{entry.review_id}.{entry.pid}.tmp")
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        os.fchmod(f.fileno(), 0o600)
        f.write(entry.model_dump_json(indent=2))
    try:
        for _ in range(3):
            try:
                os.link(temp, final)  # fails if a record exists; never leaves a half-written record
                return None
            except FileExistsError:
                existing = _read(final)
                if existing is not None and is_live(existing):
                    return existing
                _remove_if_unchanged(final, existing)
        raise RuntimeError(f"could not record the review in {final}")
    finally:
        temp.unlink(missing_ok=True)


def release(entry: Entry) -> None:
    """Remove the record of `entry`, if it is still the one recorded."""
    path = _path(entry.review_id)
    current = _read(path)
    if current is not None and current.pid == entry.pid and current.secret == entry.secret:
        path.unlink(missing_ok=True)


def _remove_if_unchanged(path: Path, seen: Entry | None) -> None:
    if _read(path) == seen:
        path.unlink(missing_ok=True)


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def answers(entry: Entry, timeout: float = 1.0) -> bool:
    """Whether the server recorded in `entry` answers as that review."""
    request = urllib.request.Request(f"{entry.url}api/health", headers={SECRET_HEADER: entry.secret})  # noqa: S310
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - loopback http only
            return bool(json.load(response).get("review") == entry.review_id)
    except (urllib.error.URLError, OSError, ValueError):
        return False


def is_live(entry: Entry) -> bool:
    """A record is live while its process runs and its server answers. A process that has not answered yet is given
    a short grace period after it started, since it records itself before it serves."""
    if not pid_alive(entry.pid):
        return False
    if answers(entry):
        return True
    return time.time() - entry.started < STARTUP_GRACE_SECONDS


def live_entries() -> list[Entry]:
    """All live records, removing the dead ones found on the way."""
    found: list[Entry] = []
    for path in sorted(reviews_dir().glob("*.json")):
        entry = _read(path)
        if entry is not None and is_live(entry):
            found.append(entry)
        else:
            _remove_if_unchanged(path, entry)
    return sorted(found, key=lambda e: e.started)


def find(prefix: str) -> list[Entry]:
    return [e for e in live_entries() if e.review_id.startswith(prefix)]


def stop(entry: Entry, timeout: float = 10.0) -> bool:
    """Ask the review's server to end and wait for it. Its record is removed either way."""
    with contextlib.suppress(ProcessLookupError):
        os.kill(entry.pid, signal.SIGTERM)
    deadline = time.monotonic() + timeout
    while pid_alive(entry.pid) and time.monotonic() < deadline:
        time.sleep(0.05)
    stopped = not pid_alive(entry.pid)
    if stopped:
        _remove_if_unchanged(_path(entry.review_id), entry)
    return stopped
