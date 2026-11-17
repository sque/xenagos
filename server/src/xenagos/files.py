"""File contents at pinned revisions, read from the object store and kept once read (revisions never change)."""

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path

from xenagos import git


class Binary(Enum):
    FILE = "binary"


BINARY = Binary.FILE


@dataclass
class RevisionFiles:
    repo: Path
    _text: dict[tuple[str, str], str | Binary | None] = field(default_factory=dict)

    def text(self, revision: str, path: str) -> str | Binary | None:
        """The file's text, `BINARY` for a binary file, or None when it does not exist at that revision."""
        key = (revision, path)
        if key not in self._text:
            data = git.try_run_bytes(self.repo, "cat-file", "blob", f"{revision}:{path}")
            if data is None:
                self._text[key] = None
            elif b"\0" in data[:8000]:
                self._text[key] = BINARY
            else:
                self._text[key] = data.decode("utf-8", errors="replace")
        return self._text[key]

    def lines(self, revision: str, path: str) -> list[str] | Binary | None:
        """The file's lines without line endings; see `text`."""
        text = self.text(revision, path)
        if not isinstance(text, str):
            return text
        lines = text.split("\n")
        if text.endswith("\n"):
            lines.pop()
        return [line.removesuffix("\r") for line in lines]
