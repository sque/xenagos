import pytest

from tests.conftest import FixtureRepo
from xenagos import cli


def test_unknown_target_exits_with_its_name(repo: FixtureRepo, capsys: pytest.CaptureFixture[str]) -> None:
    assert cli.main(["-C", str(repo.path), "nope"]) == 2
    assert "unknown revision: nope" in capsys.readouterr().err


def test_default_target_starts_server_for_current_branch(
    repo: FixtureRepo, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    served: list[tuple[str, str, bool]] = []
    monkeypatch.setattr(cli, "serve", lambda t, port, open_browser: served.append((t.base, t.head, open_browser)))
    assert cli.main(["-C", str(repo.path)]) == 0
    assert served == [(repo.ids["c2"], repo.ids["f2"], True)]
