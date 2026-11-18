"""`xen open` and the agent commands against review servers running as processes (tasks 2.5, 7.2, 7.4)."""

import json
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import FakeClaude, FixtureRepo
from xenagos import claude, cli, registry
from xenagos.access import SECRET_HEADER, Access
from xenagos.app import IdlePolicy, create_app
from xenagos.store import ReviewStore
from xenagos.target import ReviewTarget, resolve

SAMPLE = json.loads((Path(__file__).parent / "data" / "plan-sample.json").read_text())


@pytest.fixture
def reviews(state_home: Path) -> Iterator[None]:
    """Stops every review server the test started."""
    yield
    for entry in registry.live_entries():
        registry.stop(entry)


@pytest.fixture
def target(repo: FixtureRepo) -> ReviewTarget:
    return resolve(repo.path)


def xen(capsys: pytest.CaptureFixture[str], *argv: str) -> tuple[int, str, str]:
    status = cli.main(list(argv))
    out, err = capsys.readouterr()
    return status, out, err


def write(tmp_path: Path, name: str, document: Any) -> str:
    path = tmp_path / name
    path.write_text(json.dumps(document))
    return str(path)


def open_as(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], repo: FixtureRepo, session: str
) -> str:
    monkeypatch.setenv("CLAUDE_CODE_SESSION_ID", session)
    status, out, err = xen(capsys, "open", "-C", str(repo.path), "--no-browser")
    assert status == 0, err
    assert "Viewer: http://127.0.0.1:" in out
    return out


@pytest.mark.usefixtures("reviews")
def test_agent_opens_a_review_and_writes_its_walkthrough(
    repo: FixtureRepo,
    target: ReviewTarget,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    open_as(monkeypatch, capsys, repo, "session-one")
    assert ReviewStore(target.review_id).load().session == "session-one"  # type: ignore[union-attr]

    status, out, _ = xen(capsys, "guide")
    assert status == 0
    assert "# Writing a xenagos walkthrough" in out
    assert "app.py:h1  base line 1  head line 1" in out
    assert f"Repository: {target.repo}" in out
    assert "lib.py: added" in out

    status, out, _ = xen(capsys, "plan", "submit", write(tmp_path, "plan.json", SAMPLE))
    assert (status, out.split(".")[0]) == (0, "Plan accepted: 2 sections, 4 steps")
    status, out, _ = xen(capsys, "plan", "get")
    assert json.loads(out)["sections"][0]["title"] == "Greet with the feature's name"
    status, out, _ = xen(capsys, "plan", "get", "--without-narration")
    assert json.loads(out)["sections"][0]["steps"][0]["narration"] == ""

    status, out, _ = xen(capsys, "show", "lib.py:1", "--form", "box")
    assert status == 0
    assert "No viewer is open, so the reviewer did not see it" in out
    status, _, err = xen(capsys, "show", "lib.py:3-4")
    assert status == 1
    assert "Show rejected:\n- show: lines 3-4 are past the end of lib.py" in err
    status, _, err = xen(capsys, "show", "--element", "greeting#nowhere")
    assert status == 1

    step = {
        "narration": "Nothing reads it yet.",
        "form": "lines",
        "target": {"path": "lib.py", "startLine": 1, "endLine": 1},
    }
    status, out, err = xen(capsys, "step", "add", "--section", "2", write(tmp_path, "step.json", step))
    assert (status, out.strip()) == (0, "Step added to section 2."), err
    visual = {"id": "constant", "html": "<p id='x'>X = 1</p>", "elements": [{"id": "x"}]}
    status, out, err = xen(capsys, "visual", "add", "--section", "2", write(tmp_path, "visual.json", visual))
    assert status == 0, err

    changed = json.loads(xen(capsys, "plan", "get")[1])
    changed["sections"][1]["steps"][0]["target"]["endLine"] = 1
    changed["sections"][0]["title"] = "Renamed"
    status, _, err = xen(capsys, "narration", "submit", write(tmp_path, "narration.json", changed))
    assert status == 1
    assert "Narration rejected:\n- section 1: only narration may change" in err

    bad = json.loads(json.dumps(SAMPLE))
    bad["sections"][0]["steps"][1]["target"]["expect"] = "nothing like it"
    status, _, err = xen(capsys, "plan", "submit", write(tmp_path, "bad.json", bad))
    assert status == 1
    assert 'Plan rejected:\n- section 1 ("Greet with the feature\'s name"), step 2: expected text' in err


@pytest.mark.usefixtures("reviews")
def test_review_keeps_the_session_it_has(
    repo: FixtureRepo, target: ReviewTarget, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    open_as(monkeypatch, capsys, repo, "session-one")
    out = open_as(monkeypatch, capsys, repo, "session-two")
    assert "already has agent session session-one, which stays its agent" in out
    assert ReviewStore(target.review_id).load().session == "session-one"  # type: ignore[union-attr]
    assert len(registry.live_entries()) == 1
    store = ReviewStore(target.review_id)
    store.set_session("session-one", "review repo feature", str(repo.path))
    assert "review repo feature" in xen(capsys, "list")[1]


@pytest.mark.usefixtures("reviews")
def test_ended_review_is_started_again_with_its_state(
    repo: FixtureRepo,
    target: ReviewTarget,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    open_as(monkeypatch, capsys, repo, "session-one")
    xen(capsys, "plan", "submit", write(tmp_path, "plan.json", SAMPLE))
    [first] = registry.live_entries()
    assert xen(capsys, "stop", "--all")[0] == 0
    assert registry.live_entries() == []

    status, out, err = xen(capsys, "plan", "get")
    assert status == 0, err
    assert json.loads(out)["orientation"]["source"] == "inferred"
    [second] = registry.live_entries()
    assert second.review_id == first.review_id
    assert second.pid != first.pid


@pytest.mark.usefixtures("reviews")
def test_commands_say_which_review_to_name(
    repo: FixtureRepo, target: ReviewTarget, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    open_as(monkeypatch, capsys, repo, "session-one")
    monkeypatch.delenv("CLAUDE_CODE_SESSION_ID")
    status, _, err = xen(capsys, "plan", "get")
    assert status == 2
    assert "name the review with --review <id>" in err
    assert target.review_id in err
    assert xen(capsys, "plan", "get", "--review", target.review_id[:6])[0] == 1  # found; it has no plan yet
    monkeypatch.setenv("CLAUDE_CODE_SESSION_ID", "someone-else")
    status, _, err = xen(capsys, "show", "app.py:1")
    assert status == 2
    assert "this session is not the agent of any review" in err


@pytest.mark.usefixtures("reviews")
def test_named_session_becomes_the_agent(
    repo: FixtureRepo,
    target: ReviewTarget,
    fake_claude: FakeClaude,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    session = fake_claude.add("abcd1234", name="worker")
    status, _, err = xen(capsys, "open", "-C", str(repo.path), "--session", "worker", "--no-browser")
    assert status == 0, err
    assert ReviewStore(target.review_id).load().session == session  # type: ignore[union-attr]
    status, _, err = xen(capsys, "open", "-C", str(repo.path), "--session", "nobody", "--no-browser")
    assert status == 2
    assert "no Claude Code session 'nobody'" in err

    served: list[str | None] = []
    monkeypatch.setattr(cli, "serve", lambda t, port, open_browser, session: served.append(session.session_id))
    assert xen(capsys, "-C", str(repo.path), "--session", "abcd1234")[0] == 0
    assert served == [session]
    assert ReviewStore(target.review_id).load().session_name == "worker"  # type: ignore[union-attr]


def test_person_naming_a_session_replaces_the_reviews(
    target: ReviewTarget, fake_claude: FakeClaude, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = ReviewStore(target.review_id)
    store.save_target(target)
    store.set_session("old-session")
    new = fake_claude.add("abcd1234")
    seen: list[str | None] = []

    def stop_before_serving(port: int) -> Any:
        saved = store.load()
        seen.append(saved.session if saved is not None else None)
        raise SystemExit(0)

    monkeypatch.setattr(cli, "listen_on_loopback", stop_before_serving)
    with pytest.raises(SystemExit):
        cli.serve(target, 0, open_browser=False, session=claude.resolve(new))
    assert seen == [new]


# Idle shutdown (task 2.5)


def idle_app(target: ReviewTarget, policy: IdlePolicy, ended: threading.Event) -> TestClient:
    access = Access(review_id=target.review_id, port=40125, secret="s3cret")
    app = create_app(target, access, None, idle=policy, on_idle=ended.set)
    return TestClient(app, base_url="http://127.0.0.1:40125", headers={SECRET_HEADER: "s3cret"})


def test_review_never_opened_ends_after_the_longer_period(target: ReviewTarget) -> None:
    ended = threading.Event()
    with idle_app(target, IdlePolicy(idle_seconds=0.1, unopened_seconds=0.6), ended):
        assert not ended.wait(0.3)
        assert ended.wait(5)


def test_review_ends_once_its_viewer_has_been_closed_for_the_idle_period(target: ReviewTarget) -> None:
    ended = threading.Event()
    with idle_app(target, IdlePolicy(idle_seconds=0.3, unopened_seconds=0.3), ended) as api:
        with api.websocket_connect("ws://127.0.0.1:40125/api/events"):
            assert not ended.wait(0.8)
        started = time.monotonic()
        assert ended.wait(5)
        assert time.monotonic() - started >= 0.2
