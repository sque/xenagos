"""Models the server sends to the viewer. Their TypeScript types are generated with the plan's (`xenagos.schema`)."""

from typing import Literal

from xenagos.plan import Model


class ReviewInfo(Model):
    id: str
    repo: str
    label: str
    base: str
    head: str
    branch: str | None


class FileView(Model):
    """A file at both pinned revisions, for the whole-file view. Text is absent when the file does not exist at that
    revision or is binary."""

    path: str
    old_path: str | None
    status: Literal["added", "modified", "deleted", "renamed", "copied", "type-changed", "unchanged"]
    binary: bool
    base: str | None
    head: str | None


class PlanRejection(Model):
    """Why a submitted plan was not accepted; each problem names the plan item it concerns."""

    problems: list[str]
