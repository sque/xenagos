"""Configuration and narration styles (tasks 5.4, 5.4a, 5.5, 5.6, 5.7)."""

import json
import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import FakeClaude, FixtureRepo
from xenagos import cli, config, narration, registry
from xenagos.access import SECRET_HEADER, Access
from xenagos.app import create_app
from xenagos.plan import Plan
from xenagos.store import ReviewStore
from xenagos.target import ReviewTarget, resolve

SAMPLE = json.loads((Path(__file__).parent / "data" / "plan-sample.json").read_text())
PORT = 40127


def write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return path


@pytest.fixture
def user(tmp_path: Path) -> Path:
    """The user's configuration folder (conftest points XDG_CONFIG_HOME at tmp_path / "config")."""
    return tmp_path / "config" / "xenagos"


@pytest.fixture
def target(repo: FixtureRepo) -> ReviewTarget:
    return resolve(repo.path)


def client(target: ReviewTarget) -> TestClient:
    access = Access(review_id=target.review_id, port=PORT, secret="s")
    app = create_app(target, access, None, store=ReviewStore(target.review_id))
    return TestClient(app, base_url=f"http://127.0.0.1:{PORT}", headers={SECRET_HEADER: "s"})


def plan_with(*narrations: str) -> dict[str, Any]:
    """The sample plan with section 2's steps narrated as given, and section 1 narrated so any style accepts it."""
    plan = json.loads(json.dumps(SAMPLE))
    for step in plan["sections"][0]["steps"]:
        step["narration"] = "Start here."
    steps = plan["sections"][1]["steps"]
    plan["sections"][1]["steps"] = [{**steps[0], "narration": text} for text in narrations]
    return plan


# 5.4 Loading


def test_no_configuration_means_built_in_defaults(repo: FixtureRepo) -> None:
    settings = config.load(repo.path)
    assert settings == config.Settings()
    assert (settings.agent_open, settings.narration.style, settings.voice.enabled) == ("window", "default", True)


def test_each_level_wins_over_the_one_below(repo: FixtureRepo, user: Path) -> None:
    assert config.load(repo.path).agent_open == "window"
    write(user / "config.toml", 'agent_open = "link"\n')
    assert config.load(repo.path).agent_open == "link"
    write(repo.path / ".xenagos" / "config.toml", 'agent_open = "window"\n')
    assert config.load(repo.path).agent_open == "window"


def test_repository_overrides_only_what_it_sets(repo: FixtureRepo, user: Path) -> None:
    write(user / "config.toml", '[narration]\nstyle = "terse"\n[voice]\nenabled = false\nspeed = 1.2\n')
    write(repo.path / ".xenagos" / "config.toml", '[narration]\nstyle = "default"\n')
    settings = config.load(repo.path)
    assert settings.narration.style == "default"
    assert (settings.voice.enabled, settings.voice.speed) == (False, 1.2)


def test_misspelled_setting_names_file_and_setting(repo: FixtureRepo, user: Path) -> None:
    path = write(user / "config.toml", "[voice]\nenabeld = false\n")
    with pytest.raises(config.ConfigError) as error:
        config.load(repo.path)
    assert str(error.value) == f"{path}: voice.enabeld: is not a setting xenagos knows"


def test_invalid_value_names_file_and_setting(repo: FixtureRepo) -> None:
    path = write(repo.path / ".xenagos" / "config.toml", 'agent_open = "popup"\n[session]\nname = "x {who}"\n')
    with pytest.raises(config.ConfigError) as error:
        config.load(repo.path)
    message = str(error.value)
    assert f"{path}: agent_open: Input should be 'window' or 'link'" in message
    assert f"{path}: session.name: Value error, the template may use" in message


def test_unreadable_toml_is_reported(repo: FixtureRepo, user: Path) -> None:
    path = write(user / "config.toml", "agent_open = \n")
    with pytest.raises(config.ConfigError, match=re.escape(f"{path}: is not valid TOML")):
        config.load(repo.path)


def test_custom_configuration_home(repo: FixtureRepo, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "cfg"))
    write(tmp_path / "cfg" / "xenagos" / "config.toml", "[voice]\nenabled = false\n")
    assert config.load(repo.path).voice.enabled is False


def test_edits_apply_to_an_open_review_without_restart(target: ReviewTarget, repo: FixtureRepo, user: Path) -> None:
    api = client(target)
    assert api.get("/api/review").json()["style"] == "default"
    assert api.get("/api/review").json()["voice"]["enabled"] is True
    write(user / "config.toml", "[voice]\nenabled = false\n")
    write(repo.path / ".xenagos" / "config.toml", '[narration]\nstyle = "terse"\n')
    info = api.get("/api/review").json()
    assert (info["style"], info["voice"]["enabled"]) == ("terse", False)
    write(user / "config.toml", "[voice]\nloud = true\n")
    refused = api.get("/api/review")
    assert refused.status_code == 500
    assert "voice.loud: is not a setting xenagos knows" in refused.json()["detail"]


def test_xen_refuses_to_start_with_invalid_configuration(
    repo: FixtureRepo, user: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = write(user / "config.toml", "idle_minuts = 5\n")
    assert cli.main(["-C", str(repo.path), "--no-browser"]) == 2
    assert f"{path}: idle_minuts: is not a setting xenagos knows" in capsys.readouterr().err


def test_styles_are_found_in_repository_then_user_then_built_in(repo: FixtureRepo, user: Path) -> None:
    assert config.load_style("default", repo.path).folder == config.builtin_styles() / "default"
    write(user / "styles" / "default" / "style.md", "user's default")
    assert config.load_style("default", repo.path).text == "user's default"
    write(repo.path / ".xenagos" / "styles" / "default" / "style.md", "repository's default")
    assert config.load_style("default", repo.path).text == "repository's default"
    with pytest.raises(config.ConfigError, match="narration style 'missing' was not found in"):
        config.load_style("missing", repo.path)


def test_style_hash_follows_its_text_and_limits(repo: FixtureRepo, user: Path) -> None:
    folder = user / "styles" / "mine"
    write(folder / "style.md", "Plain.")
    first = config.load_style("mine", repo.path)
    write(folder / "limits.toml", "max_words_per_step = 10\n")
    second = config.load_style("mine", repo.path)
    assert first.hash != second.hash
    assert second.limits.max_words_per_step == 10
    write(folder / "limits.toml", "max_wordz = 10\n")
    with pytest.raises(config.ConfigError, match=r"max_wordz: is not a limit xenagos knows"):
        config.load_style("mine", repo.path)


# 5.4a Settings for agents


@pytest.fixture
def reviews(state_home: Path) -> Iterator[None]:
    yield
    for entry in registry.live_entries():
        registry.stop(entry)


@pytest.mark.usefixtures("reviews")
@pytest.mark.parametrize(("agent_open", "opened"), [("window", True), ("link", False)])
def test_agent_open_decides_whether_a_window_opens(
    repo: FixtureRepo,
    user: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    agent_open: str,
    opened: bool,
) -> None:
    write(user / "config.toml", f'agent_open = "{agent_open}"\n')
    windows: list[str] = []
    monkeypatch.setattr(cli.webbrowser, "open", windows.append)
    monkeypatch.setenv("CLAUDE_CODE_SESSION_ID", "session-one")
    assert cli.main(["open", "-C", str(repo.path)]) == 0
    out = capsys.readouterr().out
    assert "Viewer: http://127.0.0.1:" in out
    assert bool(windows) is opened


def test_started_session_carries_the_configured_name_and_mode(
    target: ReviewTarget, repo: FixtureRepo, fake_claude: FakeClaude
) -> None:
    write(repo.path / ".xenagos" / "config.toml", '[session]\nname = "xen {repo} {branch}"\npermission_mode = "plan"\n')
    client(target).post("/api/agent/request", json={"kind": "walkthrough"})
    [start] = fake_claude.calls("--bg")
    assert start["argv"][1:5] == ["-n", "xen repo feature", "--permission-mode", "plan"]


# 5.5 Built-in styles


def worked_example(style: config.Style) -> list[str]:
    section = style.text.split("### Worked example", 1)[1].split("###", 1)[0]
    return [row.split("|")[3].strip() for row in section.splitlines() if re.match(r"^\| \d+ \|", row)]


@pytest.mark.parametrize("name", ["default", "terse"])
def test_built_in_worked_examples_pass_their_own_limits(name: str) -> None:
    style = config.load_style(name)
    examples = worked_example(style)
    assert len(examples) >= 3
    assert narration.check(Plan.model_validate(plan_with(*examples)), style) == []


def test_the_default_styles_bad_example_breaks_its_limits() -> None:
    style = config.load_style("default")
    bad = re.search(r'### The same step, done badly\n\n"(.+?)"', style.text, re.DOTALL)
    assert bad is not None
    problems = narration.check(Plan.model_validate(plan_with(" ".join(bad.group(1).split()))), style)
    assert any("'line 133'" in problem for problem in problems)


# 5.6 Narration checks


@pytest.mark.parametrize(
    ("text", "what"),
    [
        ("## The new loop\nIt keeps going.", "a heading"),
        ("It keeps going.\n```\ncode\n```", "a code fence"),
        ("The `retry` counter starts at zero.", "inline code"),
        ("It keeps going.\n- one thing\n- another", "a list item"),
        ("See [the docs](https://example.com) for more.", "a link"),
        ("It is <b>new</b> now.", "an HTML tag"),
        ("This is **new** now.", "bold text"),
    ],
)
def test_markup_is_refused_under_any_style(target: ReviewTarget, text: str, what: str) -> None:
    answer = client(target).put("/api/plan", json=plan_with(text))
    assert answer.status_code == 422
    problems = answer.json()["problems"]
    assert f'section 2 ("A test and a constant to build on"), step 1: narration contains {what}' in problems[0]


def test_line_number_is_refused_under_the_default_style(target: ReviewTarget) -> None:
    answer = client(target).put("/api/plan", json=plan_with("Look at line 3, where the constant starts."))
    assert answer.status_code == 422
    assert answer.json()["problems"] == [
        "section 2 (\"A test and a constant to build on\"), step 1: narration contains 'line 3', which "
        'style "default" forbids (forbid: \\bline\\s+\\d+)'
    ]


def test_the_same_text_passes_under_a_style_with_empty_limits(
    target: ReviewTarget, repo: FixtureRepo, user: Path
) -> None:
    write(user / "styles" / "free" / "style.md", "Say anything plain.")
    write(user / "styles" / "free" / "limits.toml", "")
    write(repo.path / ".xenagos" / "config.toml", '[narration]\nstyle = "free"\n')
    answer = client(target).put("/api/plan", json=plan_with("Look at line 3, where the constant starts."))
    assert answer.status_code == 200, answer.text
    assert answer.json()["style"]["name"] == "free"


def test_length_limits_name_the_step_and_the_limit(target: ReviewTarget, repo: FixtureRepo) -> None:
    write(repo.path / ".xenagos" / "config.toml", '[narration]\nstyle = "terse"\n')
    answer = client(target).put("/api/plan", json=plan_with("One. Two.", " ".join(["word"] * 30) + "."))
    problems = answer.json()["problems"]
    assert 'step 1: narration has 2 sentences; style "terse" allows 1 (max_sentences_per_step)' in problems[0]
    assert 'step 2: narration has 30 words; style "terse" allows 25 (max_words_per_step)' in problems[1]
    many = plan_with(*["Short." for _ in range(7)])
    assert (
        'has 7 steps; style "terse" allows 6 (max_steps_per_section)'
        in client(target).put("/api/plan", json=many).json()["problems"][0]
    )


def test_counting_sentences_and_words() -> None:
    assert narration.sentences("One. Two! Three? Four") == 4
    assert narration.sentences("Version 1.2 is out.") == 1
    assert narration.words("I didn't wrap it - not yet.") == 6


# 5.7 The guide


def test_guide_includes_the_active_style_and_follows_a_change(
    repo: FixtureRepo, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.chdir(repo.path)
    assert cli.main(["guide"]) == 0
    out = capsys.readouterr().out
    assert "## Narration style: default" in out
    assert "at most 3 sentences per step; at most 70 words per step" in out
    assert "You are the author of this change" in out
    write(repo.path / ".xenagos" / "config.toml", '[narration]\nstyle = "terse"\n')
    assert cli.main(["guide"]) == 0
    out = capsys.readouterr().out
    assert "## Narration style: terse" in out
    assert "You are a senior colleague in a hurry." in out


# 5.8 Re-narration under another style


def test_renarration_is_checked_against_and_recorded_with_the_active_style(
    target: ReviewTarget, repo: FixtureRepo
) -> None:
    api = client(target)
    first = api.put("/api/plan", json=plan_with("I added one constant. Nothing reads it yet.")).json()
    assert first["style"] == {"name": "default", "hash": config.load_style("default").hash}
    write(repo.path / ".xenagos" / "config.toml", '[narration]\nstyle = "terse"\n')
    template = api.get("/api/plan/without-narration").json()
    texts = iter(["Old greeting, same for every build.", "New text names the feature.", "Picture of both."])
    for section in template["sections"]:
        for step in section["steps"]:
            step["narration"] = "A constant nothing reads yet." if section is template["sections"][1] else next(texts)
    too_long = json.loads(json.dumps(template))
    too_long["sections"][1]["steps"][0]["narration"] = "I added one constant. Nothing reads it yet."
    refused = api.put("/api/plan/narration", json=too_long)
    assert refused.status_code == 422
    assert 'style "terse" allows 1 (max_sentences_per_step)' in refused.json()["problems"][0]
    accepted = api.put("/api/plan/narration", json=template)
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["style"] == {"name": "terse", "hash": config.load_style("terse").hash}
    assert [s["steps"][0]["target"] for s in accepted.json()["sections"]] == [
        s["steps"][0]["target"] for s in first["sections"]
    ]
