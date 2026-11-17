"""The skill shipped with xenagos (task 7.5) and how sessions get it."""

import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests.conftest import FakeClaude, FixtureRepo
from xenagos import claude, cli
from xenagos.access import SECRET_HEADER, Access
from xenagos.app import create_app
from xenagos.store import ReviewStore
from xenagos.target import resolve

SKILL = claude.plugin_dir() / "skills" / "xenagos" / "SKILL.md"


def test_plugin_is_a_claude_code_plugin_with_the_skill() -> None:
    manifest = json.loads((claude.plugin_dir() / ".claude-plugin" / "plugin.json").read_text())
    assert manifest["name"] == "xenagos"
    front = re.match(r"^---\nname: xenagos\ndescription: (.+?)\n---\n", SKILL.read_text(), re.DOTALL)
    assert front is not None
    assert "[xenagos review <id>]" in front.group(1)


def test_skill_names_every_agent_command_and_the_rules_for_fixes() -> None:
    text = SKILL.read_text()
    for command in (
        "xen open",
        "xen guide",
        "xen plan submit",
        "xen plan get --without-narration",
        "xen narration submit",
        "xen show",
        "xen step add",
        "xen visual add",
        "--review",
    ):
        assert command in text, command
    assert "do not commit" in text
    assert "not in the user's checkout" in text
    assert "Never say the change is correct" in text


def test_sessions_xenagos_starts_load_the_skill_and_find_xen(
    repo: FixtureRepo, fake_claude: FakeClaude, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target = resolve(repo.path)
    access = Access(review_id=target.review_id, port=40126, secret="s")
    api = TestClient(
        create_app(target, access, None, store=ReviewStore(target.review_id)),
        base_url="http://127.0.0.1:40126",
        headers={SECRET_HEADER: "s"},
    )
    api.post("/api/agent/request", json={"kind": "walkthrough"})
    [start] = fake_claude.calls("--bg")
    index = start["argv"].index("--plugin-dir")
    assert Path(start["argv"][index + 1]) == claude.plugin_dir()
    folder = claude.xen_folder()
    if folder is not None:
        assert claude.child_env()["PATH"].split(":")[0] == str(folder)


def test_skill_install_copies_it_and_keeps_a_different_one(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    skills = tmp_path / "skills"
    assert cli.main(["skill", "install", "--dir", str(skills)]) == 0
    installed = skills / "xenagos" / "SKILL.md"
    assert installed.read_text() == SKILL.read_text()
    assert cli.main(["skill", "install", "--dir", str(skills)]) == 0
    assert "already installed" in capsys.readouterr().out
    installed.write_text("mine")
    assert cli.main(["skill", "install", "--dir", str(skills)]) == 2
    assert "use --force" in capsys.readouterr().err
    assert installed.read_text() == "mine"
    assert cli.main(["skill", "install", "--dir", str(skills), "--force"]) == 0
    assert installed.read_text() == SKILL.read_text()
