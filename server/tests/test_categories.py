from pathlib import Path

import pytest

from tests.conftest import FixtureRepo, init_repo
from xenagos.categories import by_rules, categorize


@pytest.mark.parametrize(
    ("path", "category"),
    [
        ("src/app.py", "code"),
        ("uv.lock", "generated"),
        ("web/package-lock.json", "generated"),
        ("go.sum", "generated"),
        ("tests/test_app.py", "tests"),
        ("server/tests/data/plan-sample.json", "tests"),
        ("src/test_helpers.py", "tests"),
        ("pkg/core_test.go", "tests"),
        ("web/src/App.test.tsx", "tests"),
        ("web/src/stage.browser.test.ts", "tests"),
        ("lib/thing.spec.js", "tests"),
        ("spec/models/user_spec.rb", "tests"),
        ("src/main/java/FooTest.java", "tests"),
        ("conftest.py", "tests"),
        ("openspec/specs/plan/spec.md", "code"),
        ("src/contest.py", "code"),
        ("src/latest.py", "code"),
    ],
)
def test_rules_by_name(path: str, category: str) -> None:
    assert by_rules(path) == category


@pytest.fixture
def mixed(tmp_path: Path) -> FixtureRepo:
    r = init_repo(tmp_path / "mixed")
    r.commit("base", {"README.md": "x\n"})
    r.commit(
        "head",
        {
            ".gitattributes": "gen/** linguist-generated\nproto/*_pb2.py linguist-generated=true\n"
            "gen/keep.py -linguist-generated\n",
            "src/app.py": "a = 1\n",
            "tests/test_app.py": "def test(): pass\n",
            "uv.lock": "lock\n",
            "gen/client.py": "generated = True\n",
            "gen/keep.py": "kept = True\n",
            "proto/core_pb2.py": "p = 1\n",
            "proto/core.py": "q = 1\n",
        },
    )
    return r


def test_categories_follow_attributes_at_the_head(mixed: FixtureRepo) -> None:
    paths = ["src/app.py", "tests/test_app.py", "uv.lock", "gen/client.py", "gen/keep.py", "proto/core_pb2.py",
             "proto/core.py", ".gitattributes"]  # fmt: skip
    assert categorize(mixed.path, mixed.ids["head"], paths) == {
        "src/app.py": "code",
        "tests/test_app.py": "tests",
        "uv.lock": "generated",
        "gen/client.py": "generated",
        "gen/keep.py": "code",
        "proto/core_pb2.py": "generated",
        "proto/core.py": "code",
        ".gitattributes": "code",
    }


def test_attributes_are_read_from_the_revision_not_the_checkout(mixed: FixtureRepo) -> None:
    (mixed.path / ".gitattributes").write_text("src/** linguist-generated\n")
    assert categorize(mixed.path, mixed.ids["head"], ["src/app.py"]) == {"src/app.py": "code"}
    assert categorize(mixed.path, mixed.ids["base"], ["gen/client.py"]) == {"gen/client.py": "code"}


def test_override_wins_over_every_rule(mixed: FixtureRepo) -> None:
    overrides = {"uv.lock": "code", "gen/client.py": "tests", "src/app.py": "generated"}
    result = categorize(mixed.path, mixed.ids["head"], ["uv.lock", "gen/client.py", "src/app.py"], overrides)  # type: ignore[arg-type]
    assert result == overrides
