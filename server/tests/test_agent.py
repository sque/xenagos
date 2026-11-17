"""The review's agent session through the server (spec: agent-link; tasks 7.1, 7.2, 7.6)."""

import json
import time
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from starlette.testclient import WebSocketTestSession

from tests.conftest import FakeClaude, FixtureRepo
from xenagos import agent as agent_module
from xenagos.access import SECRET_HEADER, Access
from xenagos.agent import AgentSettings, visible_text
from xenagos.app import create_app
from xenagos.plan import Plan
from xenagos.store import ReviewStore
from xenagos.target import ReviewTarget, resolve

PORT = 40124
SAMPLE = json.loads((Path(__file__).parent / "data" / "plan-sample.json").read_text())


@pytest.fixture(autouse=True)
def quick_typing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(agent_module, "SETTLE_SECONDS", 0.0)


@pytest.fixture
def target(repo: FixtureRepo) -> ReviewTarget:
    return resolve(repo.path)


def client(target: ReviewTarget, settings: AgentSettings | None = None) -> TestClient:
    access = Access(review_id=target.review_id, port=PORT, secret="s3cret")
    app = create_app(target, access, None, store=ReviewStore(target.review_id), settings=settings)
    return TestClient(app, base_url=f"http://127.0.0.1:{PORT}", headers={SECRET_HEADER: "s3cret"})


def terminal(api: TestClient) -> WebSocketTestSession:
    return api.websocket_connect(f"ws://127.0.0.1:{PORT}/api/agent/terminal?cols=100&rows=30")


def read_until(socket: WebSocketTestSession, text: str, limit: int = 50) -> str:
    seen = ""
    for _ in range(limit):
        message = socket.receive()
        if message.get("bytes"):
            seen += message["bytes"].decode(errors="replace")
        elif message.get("text"):
            seen += message["text"]
        if text in seen:
            return seen
    raise AssertionError(f"{text!r} not received; got {seen!r}")


def question(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "question": "why is this needed?",
        "selection": {
            "kind": "code",
            "path": "app.py",
            "startSide": "head",
            "startLine": 1,
            "endSide": "head",
            "endLine": 1,
        },
    }
    return body | overrides


# Status and choice of session


def test_review_without_session_says_so(target: ReviewTarget, fake_claude: FakeClaude) -> None:
    status = client(target).get("/api/agent").json()
    assert (status["state"], status["session"]) == ("none", None)


@pytest.mark.parametrize(
    ("kind", "running", "state"),
    [("background", True, "attachable"), ("background", False, "ended"), ("interactive", True, "not-shown")],
)
def test_status_follows_what_claude_code_reports(
    target: ReviewTarget, fake_claude: FakeClaude, kind: str, running: bool, state: str
) -> None:
    session = fake_claude.add("aaaa1111", kind=kind, running=running, name="worker")
    api = client(target)
    assert api.put("/api/agent/session", json={"session": session}).status_code == 200
    status = api.get("/api/agent").json()
    assert (status["state"], status["session"], status["name"]) == (state, session, "worker")
    assert (status.get("reason") is None) == (state == "attachable")


def test_session_that_no_longer_exists_has_ended(target: ReviewTarget, fake_claude: FakeClaude) -> None:
    api = client(target)
    api.put("/api/agent/session", json={"session": "gone-0000"})
    assert api.get("/api/agent").json()["state"] == "ended"


def test_review_keeps_its_session_unless_replaced(target: ReviewTarget, fake_claude: FakeClaude) -> None:
    first = fake_claude.add("aaaa1111")
    second = fake_claude.add("bbbb2222")
    api = client(target)
    api.put("/api/agent/session", json={"session": first})
    refused = api.put("/api/agent/session", json={"session": second})
    assert refused.status_code == 409
    assert first in refused.json()["detail"]
    assert api.put("/api/agent/session", json={"session": second, "replace": True}).json()["session"] == second
    assert ReviewStore(target.review_id).load().session == second  # type: ignore[union-attr]


def test_session_survives_the_server(target: ReviewTarget, fake_claude: FakeClaude) -> None:
    session = fake_claude.add("aaaa1111")
    client(target).put("/api/agent/session", json={"session": session})
    assert client(target).get("/api/agent").json()["session"] == session


# Starting a session on first need


def test_question_without_session_starts_one_with_it(
    target: ReviewTarget, repo: FixtureRepo, fake_claude: FakeClaude
) -> None:
    api = client(target, AgentSettings(name_template="review {repo} {branch}", permission_mode="plan"))
    answer = api.post("/api/agent/ask", json=question(position=None))
    assert answer.status_code == 200, answer.text
    assert answer.json()["started"] is True
    [start] = fake_claude.calls("--bg")
    argv = start["argv"]
    assert argv[1:5] == ["-n", "review repo feature", "--permission-mode", "plan"]
    prompt = argv[-1]
    assert f"xenagos review {target.review_id}" in prompt
    assert prompt.endswith(f"[xenagos review {target.review_id}] app.py line 1 (head)\nwhy is this needed?")
    assert Path(start["cwd"]).resolve() == repo.path.resolve()
    session = answer.json()["session"]
    assert ReviewStore(target.review_id).load().session == session  # type: ignore[union-attr]
    assert api.get("/api/agent").json()["state"] == "attachable"


def test_started_session_uses_claude_codes_default_mode(target: ReviewTarget, fake_claude: FakeClaude) -> None:
    client(target).post("/api/agent/request", json={"kind": "walkthrough"})
    [start] = fake_claude.calls("--bg")
    assert "--permission-mode" not in start["argv"]
    assert "Please write the walkthrough" in start["argv"][-1]


def test_refusal_to_start_is_passed_on(target: ReviewTarget, fake_claude: FakeClaude) -> None:
    fake_claude.write(refuse="Workspace not trusted. Run `claude` in /x once and accept the trust prompt, then retry.")
    answer = client(target).post("/api/agent/ask", json=question())
    assert answer.status_code == 502
    assert "Workspace not trusted" in answer.json()["detail"]
    assert ReviewStore(target.review_id).load().session is None  # type: ignore[union-attr]


def test_no_session_is_started_away_from_the_reviewed_head(
    target: ReviewTarget, repo: FixtureRepo, fake_claude: FakeClaude
) -> None:
    repo.git("switch", "-q", "main")
    answer = client(target).post("/api/agent/ask", json=question())
    assert answer.status_code == 409
    assert "not at the reviewed head" in answer.json()["detail"]
    assert fake_claude.calls("--bg") == []


def test_stopped_session_is_not_attached_or_resumed(target: ReviewTarget, fake_claude: FakeClaude) -> None:
    session = fake_claude.add("aaaa1111", running=False)
    api = client(target)
    api.put("/api/agent/session", json={"session": session})
    with terminal(api) as socket:
        assert socket.receive_json()["type"] == "unavailable"
    assert fake_claude.calls("attach") == []
    assert api.post("/api/agent/ask", json=question()).status_code == 409
    assert fake_claude.calls("--bg") == []


# The pane and what is typed into it


def test_pane_attaches_and_passes_keys_and_size(target: ReviewTarget, fake_claude: FakeClaude) -> None:
    session = fake_claude.add("aaaa1111")
    api = client(target)
    api.put("/api/agent/session", json={"session": session})
    with terminal(api) as socket:
        read_until(socket, "attached aaaa1111 100x30")
        socket.send_text(json.dumps({"type": "input", "data": "y"}))
        read_until(socket, "got b'y'")
        socket.send_text(json.dumps({"type": "resize", "cols": 80, "rows": 20}))
        read_until(socket, "size 80x20")
    [call] = fake_claude.calls("attach")
    assert call["argv"] == ["attach", "aaaa1111"]


def test_attach_program_ends_when_the_viewer_leaves(target: ReviewTarget, fake_claude: FakeClaude) -> None:
    session = fake_claude.add("aaaa1111")
    api = client(target)
    api.put("/api/agent/session", json={"session": session})
    agent = api.app.state.agent  # type: ignore[attr-defined]
    with terminal(api) as socket:
        read_until(socket, "attached")
        [attached] = agent.terminals
    deadline = time.monotonic() + 10
    while (agent.terminals or attached.process.poll() is None) and time.monotonic() < deadline:
        time.sleep(0.05)
    assert agent.terminals == []
    assert attached.process.poll() is not None


def test_question_is_pasted_and_submitted(target: ReviewTarget, fake_claude: FakeClaude) -> None:
    session = fake_claude.add("aaaa1111")
    api = client(target)
    api.put("/api/agent/session", json={"session": session})
    api.put("/api/plan", json=SAMPLE)
    with terminal(api) as socket:
        read_until(socket, "attached")
        body = question(question="what\x1b[201~\x1b]0;x\x07 is\r\nthis\x00?", position={"section": 1, "step": 2})
        answer = api.post("/api/agent/ask", json=body)
        assert answer.json() == {"started": False, "session": session}
        seen = read_until(socket, "got b'\\r'")
    reference = f"[xenagos review {target.review_id}] app.py line 1 (head) \\xc2\\xb7 section 1, step 2"
    # The question's own escape characters are gone, so its fake paste end did not end the paste.
    assert f"got b'\\x1b[200~{reference}\\nwhat[201~]0;x is\\nthis?\\x1b[201~'" in seen


def test_nothing_is_typed_while_the_session_waits_for_an_answer(target: ReviewTarget, fake_claude: FakeClaude) -> None:
    session = fake_claude.add("aaaa1111", status="waiting")
    api = client(target)
    api.put("/api/agent/session", json={"session": session})
    with terminal(api) as socket:
        read_until(socket, "attached")
        answer = api.post("/api/agent/ask", json=question())
        assert answer.status_code == 409
        assert "waiting for your answer" in answer.json()["detail"]
        socket.send_text(json.dumps({"type": "input", "data": "x"}))
        assert "200~" not in read_until(socket, "got b'x'")  # the question before it was never typed


def test_question_needs_the_pane(target: ReviewTarget, fake_claude: FakeClaude) -> None:
    session = fake_claude.add("aaaa1111")
    api = client(target)
    api.put("/api/agent/session", json={"session": session})
    answer = api.post("/api/agent/ask", json=question())
    assert answer.status_code == 409
    assert "agent pane is not open" in answer.json()["detail"]


@pytest.mark.parametrize(
    ("selection", "position", "problem"),
    [
        ({"path": "nope.py"}, None, "nope.py is not a file of this review"),
        ({"endLine": 9}, None, "line 9 is not in app.py at the head"),
        ({"startSide": "base", "endSide": "base", "path": "lib.py"}, None, "line 1 is not in lib.py at the base"),
        ({}, {"section": 3, "step": 1}, "no section 3"),
        ({}, {"section": 1, "step": 9}, "section 1 has no step 9"),
    ],
)
def test_selection_reference_is_checked(
    target: ReviewTarget, fake_claude: FakeClaude, selection: dict[str, Any], position: Any, problem: str
) -> None:
    api = client(target)
    api.put("/api/plan", json=SAMPLE)
    body = question(position=position)
    body["selection"] |= selection
    answer = api.post("/api/agent/ask", json=body)
    assert answer.status_code == 422
    assert problem in answer.json()["detail"]
    assert fake_claude.calls("--bg") == []


def test_visual_element_must_be_declared(target: ReviewTarget, fake_claude: FakeClaude) -> None:
    api = client(target)
    api.put("/api/plan", json=SAMPLE)
    selection = {"kind": "element", "visual": "greeting", "element": "nowhere"}
    answer = api.post("/api/agent/ask", json=question(selection=selection))
    assert answer.status_code == 422
    assert "declares no element nowhere in visual greeting" in answer.json()["detail"]
    selection["element"] = "after"
    assert api.post("/api/agent/ask", json=question(selection=selection)).status_code == 200
    assert "visual greeting, element after" in fake_claude.calls("--bg")[0]["argv"][-1]


def test_selection_across_sides(target: ReviewTarget, fake_claude: FakeClaude) -> None:
    selection = {"kind": "code", "path": "app.py", "startSide": "base", "startLine": 1, "endSide": "head", "endLine": 1}
    assert client(target).post("/api/agent/ask", json=question(selection=selection)).status_code == 200
    assert "app.py from line 1 (base) to line 1 (head)" in fake_claude.calls("--bg")[0]["argv"][-1]


def test_empty_question_is_refused(target: ReviewTarget, fake_claude: FakeClaude) -> None:
    answer = client(target).post("/api/agent/ask", json=question(question="\x1b\x07 "))
    assert answer.status_code == 422


def test_fixed_requests_need_what_they_name(target: ReviewTarget, fake_claude: FakeClaude) -> None:
    api = client(target)
    assert api.post("/api/agent/request", json={"kind": "narration"}).status_code == 409
    assert api.post("/api/agent/request", json={"kind": "visual", "visual": "greeting"}).status_code == 422
    api.put("/api/plan", json=SAMPLE)
    assert api.post("/api/agent/request", json={"kind": "visual", "visual": "greeting"}).status_code == 200
    assert "Visual greeting" in fake_claude.calls("--bg")[0]["argv"][-1]


def test_visible_text_keeps_lines_and_drops_controls() -> None:
    assert visible_text("a\tb\r\nc\x1b[31m\x7f\x9bd ") == "a\tb\nc[31md"


# Plan changes and pointing


def test_plan_is_saved_with_the_review(target: ReviewTarget, fake_claude: FakeClaude) -> None:
    assert client(target).put("/api/plan", json=SAMPLE).status_code == 200
    saved = client(target).get("/api/plan").json()
    assert Plan.model_validate(saved) == Plan.model_validate(SAMPLE)


def test_viewer_hears_of_plan_changes_and_pointing(target: ReviewTarget) -> None:
    api = client(target)
    with api.websocket_connect(f"ws://127.0.0.1:{PORT}/api/events") as events:
        api.put("/api/plan", json=SAMPLE)
        assert events.receive_json() == {"type": "plan"}
        shown = api.post("/api/show", json={"target": {"path": "lib.py", "startLine": 1, "endLine": 1}, "form": "box"})
        assert shown.json() == {"viewers": 1}
        event = events.receive_json()
        assert event == {
            "type": "show",
            "target": {"path": "lib.py", "side": "head", "startLine": 1, "endLine": 1},
            "form": "box",
        }
    time.sleep(0.05)
    shown = api.post("/api/show", json={"target": {"path": "lib.py", "startLine": 1, "endLine": 1}})
    assert shown.json() == {"viewers": 0}


def test_show_is_checked_like_a_plan(target: ReviewTarget) -> None:
    api = client(target)
    answer = api.post("/api/show", json={"target": {"path": "lib.py", "startLine": 4, "endLine": 4}})
    assert answer.status_code == 422
    assert answer.json()["problems"] == [
        "show: lines 4-4 are past the end of lib.py, which has 1 line at the head revision"
    ]
    answer = api.post("/api/show", json={"target": {"visual": "greeting", "element": "after"}})
    assert answer.status_code == 422


def test_step_and_visual_are_added_through_validation(target: ReviewTarget) -> None:
    api = client(target)
    api.put("/api/plan", json=SAMPLE)
    step = {
        "narration": "The test file is new.",
        "form": "lines",
        "target": {"path": "tests/test_app.py", "startLine": 1, "endLine": 1},
    }
    added = api.post("/api/plan/steps", json={"section": 2, "after": 0, "step": step})
    assert added.status_code == 200, added.text
    assert added.json()["sections"][1]["steps"][0]["narration"] == "The test file is new."
    bad = {**step, "target": {"path": "tests/test_app.py", "startLine": 5, "endLine": 5}}
    rejected = api.post("/api/plan/steps", json={"section": 2, "step": bad})
    assert rejected.status_code == 422
    assert "section 2" in rejected.json()["problems"][0]
    assert api.post("/api/plan/steps", json={"section": 9, "step": step}).status_code == 422
    visual = {"id": "lib", "html": "<p id='x'>X</p>", "elements": [{"id": "x"}]}
    assert api.post("/api/plan/visuals", json={"section": 2, "visual": visual}).status_code == 200
    duplicate = {**visual, "id": "greeting"}
    assert api.post("/api/plan/visuals", json={"section": 2, "visual": duplicate}).status_code == 422
    replaced = api.post("/api/plan/visuals", json={"section": 2, "visual": {**visual, "title": "Lib"}})
    assert [v.get("title") for v in replaced.json()["sections"][1]["visuals"]] == ["Lib"]


def test_narration_submit_changes_narration_only(target: ReviewTarget) -> None:
    api = client(target)
    api.put("/api/plan", json=SAMPLE)
    blank = api.get("/api/plan/without-narration").json()
    assert {step["narration"] for s in blank["sections"] for step in s["steps"]} == {""}
    renarrated = json.loads(json.dumps(SAMPLE))
    for section in renarrated["sections"]:
        for step in section["steps"]:
            step["narration"] = "Said differently."
    assert api.put("/api/plan/narration", json=renarrated).status_code == 200
    moved = json.loads(json.dumps(renarrated))
    moved["sections"][0]["steps"][0]["form"] = "box"
    rejected = api.put("/api/plan/narration", json=moved)
    assert rejected.status_code == 422
    assert rejected.json()["problems"] == [
        "section 1, step 1: only narration may change; the step's target or form differs"
    ]


# A session that cannot be shown (task 7.3)


def test_hand_started_session_still_open_is_not_continued(target: ReviewTarget, fake_claude: FakeClaude) -> None:
    session = fake_claude.add("cccc3333", kind="interactive", name="by-hand")
    api = client(target)
    api.put("/api/agent/session", json={"session": session})
    status = api.get("/api/agent").json()
    assert status["state"] == "not-shown"
    assert "Close it in its terminal, then continue it here" in status["reason"]
    answer = api.post("/api/agent/continue")
    assert answer.status_code == 409
    assert "still open in another terminal" in answer.json()["detail"]
    assert fake_claude.calls("--resume") == []


def test_closed_hand_started_session_is_continued_with_its_id_and_name(
    target: ReviewTarget, fake_claude: FakeClaude
) -> None:
    session = fake_claude.add("cccc3333", kind="interactive", name="by-hand")
    api = client(target)
    api.put("/api/agent/session", json={"session": session})
    api.get("/api/agent")  # Claude Code lists it: its name and folder are remembered
    fake_claude.write(sessions=[])  # closed in its terminal; Claude Code no longer lists it
    assert api.get("/api/agent").json()["state"] == "ended"
    status = api.post("/api/agent/continue").json()
    assert (status["state"], status["session"], status["name"]) == ("attachable", session, "by-hand")
    [call] = fake_claude.calls("--resume")
    assert call["argv"][:5] == ["--resume", session, "--bg", "-n", "by-hand"]
    assert "continues in the review's agent pane" in call["argv"][-1]
    assert call["cwd"] == str(Path.home().resolve())


def test_copy_of_a_session_open_elsewhere_is_removed(target: ReviewTarget, fake_claude: FakeClaude) -> None:
    session = fake_claude.add("cccc3333", kind="background", running=False, name="stopped")
    fake_claude.write(copy_on_resume=True)
    api = client(target)
    api.put("/api/agent/session", json={"session": session})
    answer = api.post("/api/agent/continue")
    assert answer.status_code == 409
    assert "Close it there, then choose continue again" in answer.json()["detail"]
    [stop] = fake_claude.calls("stop")
    [remove] = fake_claude.calls("rm")
    assert stop["argv"][1] == remove["argv"][1] != "cccc3333"
    assert [row["sessionId"] for row in fake_claude.state()["sessions"]] == [session]
    assert ReviewStore(target.review_id).load().session == session  # type: ignore[union-attr]


def test_new_session_replaces_the_reviews_on_request(target: ReviewTarget, fake_claude: FakeClaude) -> None:
    old = fake_claude.add("cccc3333", kind="interactive")
    api = client(target)
    api.put("/api/agent/session", json={"session": old})
    status = api.post("/api/agent/start").json()
    assert status["state"] == "attachable"
    assert status["session"] != old
    assert ReviewStore(target.review_id).load().session == status["session"]  # type: ignore[union-attr]
    [start] = fake_claude.calls("--bg")
    assert start["argv"][-1].endswith("Say in one short sentence that you are ready.")
