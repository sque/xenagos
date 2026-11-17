import subprocess
from dataclasses import dataclass, field
from pathlib import Path

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


@pytest.fixture
def repo(tmp_path: Path) -> FixtureRepo:
    return feature_repo(tmp_path / "repo")


@pytest.fixture
def state_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """An empty XDG state home for this test, also seen by the servers it starts."""
    path = tmp_path / "state"
    monkeypatch.setenv("XDG_STATE_HOME", str(path))
    return path
