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
    monkeypatch.setattr(
        cli, "serve", lambda t, port, open_browser, session: served.append((t.base, t.head, open_browser))
    )
    assert cli.main(["-C", str(repo.path)]) == 0
    assert served == [(repo.ids["c2"], repo.ids["f2"], True)]


@pytest.mark.parametrize(
    ("setup", "message"),
    [
        (["switch", "-q", "main"], "you are on the default branch main; name a range or a commit"),
        (["switch", "-q", "--detach", "HEAD"], "HEAD is detached, so there is no branch to review; name a range"),
    ],
)
def test_no_default_target_opens_nothing_and_asks_for_one(
    repo: FixtureRepo,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    setup: list[str],
    message: str,
) -> None:
    repo.git(*setup)
    served: list[object] = []
    monkeypatch.setattr(cli, "serve", lambda *args, **kwargs: served.append(args))
    assert cli.main(["-C", str(repo.path)]) == 2
    assert message in capsys.readouterr().err
    assert served == []
