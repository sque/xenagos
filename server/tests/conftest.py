import json
import os
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest


@dataclass
class FixtureRepo:
    """A throwaway git repository with named commits."""

    path: Path
    ids: dict[str, str] = field(default_factory=dict)

    def git(self, *args: str) -> str:
        result = subprocess.run(  # noqa: S603
            ["git", "-C", str(self.path), *args],  # noqa: S607
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout.strip()

    def commit(self, name: str, files: dict[str, str]) -> str:
        for rel, content in files.items():
            file = self.path / rel
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(content)
        self.git("add", "-A")
        self.git("commit", "-q", "-m", name)
        self.ids[name] = self.git("rev-parse", "HEAD")
        return self.ids[name]


def init_repo(path: Path, branch: str = "main") -> FixtureRepo:
    path.mkdir(parents=True, exist_ok=True)
    repo = FixtureRepo(path)
    repo.git("init", "-q", "-b", branch)
    repo.git("config", "user.name", "Fixture")
    repo.git("config", "user.email", "fixture@example.invalid")
    repo.git("config", "commit.gpgsign", "false")
    return repo


def feature_repo(path: Path) -> FixtureRepo:
    """main: c1, c2, m3. feature forks from c2: f1, f2. Checked out on feature."""
    r = init_repo(path)
    r.commit("c1", {"app.py": "print('one')\n"})
    r.commit("c2", {"app.py": "print('two')\n"})
    r.git("switch", "-q", "-c", "feature")
    r.commit("f1", {"app.py": "print('feature one')\n", "tests/test_app.py": "def test(): pass\n"})
    r.commit("f2", {"lib.py": "X = 1\n"})
    r.git("switch", "-q", "main")
    r.commit("m3", {"README.md": "readme\n"})
    r.git("switch", "-q", "feature")
    return r


@pytest.fixture(autouse=True)
def isolated(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Every test, and every server it starts, gets its own data home, and never reaches the real Claude Code. Tests
    run from inside a Claude Code session would otherwise also look like commands of that session."""
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "data"))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "config"))
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path / "cache"))
    monkeypatch.setenv("XENAGOS_CLAUDE", str(tmp_path / "no-claude-in-tests"))
    for variable in ("CLAUDECODE", "CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID"):
        monkeypatch.delenv(variable, raising=False)


@pytest.fixture
def repo(tmp_path: Path) -> FixtureRepo:
    return feature_repo(tmp_path / "repo")


@pytest.fixture
def state_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """An empty XDG state home for this test, also seen by the servers it starts."""
    path = tmp_path / "state"
    monkeypatch.setenv("XDG_STATE_HOME", str(path))
    return path


@dataclass
class FakeClaude:
    """The `claude` stand-in of `tests/fake_claude.py`, installed for one test."""

    state_file: Path

    def state(self) -> dict[str, Any]:
        data: dict[str, Any] = json.loads(self.state_file.read_text())
        return data

    def write(self, **changes: Any) -> None:
        self.state_file.write_text(json.dumps(self.state() | changes))

    def add(
        self,
        short: str,
        *,
        kind: str = "background",
        running: bool = True,
        name: str | None = None,
        status: str = "idle",
    ) -> str:
        """Add a session and return its full id."""
        session_id = f"{short}-0000-4000-8000-000000000000"
        row: dict[str, Any] = {"cwd": str(Path.home()), "kind": kind, "sessionId": session_id}
        row["name"] = name or f"session {short}"
        if kind == "background":
            row["id"] = short
        if running:
            row |= {"pid": os.getpid(), "status": status}
        self.write(sessions=[*self.state()["sessions"], row])
        return session_id

    def calls(self, command: str) -> list[dict[str, Any]]:
        return [c for c in self.state()["calls"] if c["argv"][:1] == [command]]


@pytest.fixture
def fake_claude(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> FakeClaude:
    state = tmp_path / "fake-claude.json"
    state.write_text(json.dumps({"sessions": [], "calls": [], "refuse": None}))
    program = tmp_path / "bin" / "claude"
    program.parent.mkdir()
    script = Path(__file__).with_name("fake_claude.py")
    program.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{script}" "$@"\n')
    program.chmod(0o755)
    monkeypatch.setenv("XENAGOS_CLAUDE", str(program))
    monkeypatch.setenv("XENAGOS_FAKE_CLAUDE_STATE", str(state))
    return FakeClaude(state)
