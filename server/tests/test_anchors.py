import copy
import json
from pathlib import Path
from typing import Any

import pytest

from tests.conftest import FixtureRepo
from xenagos.anchors import check
from xenagos.diff import changes
from xenagos.plan import Plan
from xenagos.target import ReviewTarget, resolve

S1 = 'section 1 ("Greet with the feature\'s name")'
S2 = 'section 2 ("A test and a constant to build on")'
SAMPLE = json.loads((Path(__file__).parent / "data" / "plan-sample.json").read_text())


@pytest.fixture
def target(repo: FixtureRepo) -> ReviewTarget:
    return resolve(repo.path)


def problems(plan: dict[str, Any], target: ReviewTarget) -> list[str]:
    return [str(p) for p in check(Plan.model_validate(plan), target, changes(target.repo, target.base, target.head))]


def sample() -> dict[str, Any]:
    result: dict[str, Any] = copy.deepcopy(SAMPLE)
    return result


def step_target(plan: dict[str, Any], section: int, step: int) -> dict[str, Any]:
    result: dict[str, Any] = plan["sections"][section]["steps"][step]["target"]
    return result


def test_sample_plan_passes(target: ReviewTarget) -> None:
    assert problems(SAMPLE, target) == []


def test_target_past_end_of_file_is_named(target: ReviewTarget) -> None:
    plan = sample()
    step_target(plan, 1, 0).update({"startLine": 400, "endLine": 410, "expect": None})
    assert problems(plan, target) == [
        f"{S2}, step 1: lines 400-410 are past the end of lib.py, which has 1 line at the head revision"
    ]


def test_wrong_expect_is_named_with_what_is_there(target: ReviewTarget) -> None:
    plan = sample()
    step_target(plan, 0, 0)["expect"] = "feature one"  # that text is at head, but this step targets the base
    (problem,) = problems(plan, target)
    assert problem.startswith(f"{S1}, step 1: expected text 'feature one'")
    assert "line 1 reads \"print('two')\"" in problem


def test_hunk_claimed_twice_is_named(target: ReviewTarget) -> None:
    plan = sample()
    plan["sections"][1]["hunks"].append("app.py:h1")
    assert problems(plan, target) == [
        f"{S2}: claims app.py:h1 already claimed by section 1; each hunk belongs to one section"
    ]


def test_hunk_claimed_twice_in_one_section_and_unknown_hunk(target: ReviewTarget) -> None:
    plan = sample()
    plan["sections"][0]["hunks"] += ["app.py:h1", "app.py:h2"]
    assert problems(plan, target) == [
        f"{S1}: claims app.py:h1 again; each hunk belongs to one section",
        f"{S1}: claims app.py:h2, which is not a hunk of this diff",
    ]


def test_file_missing_at_the_targeted_side(target: ReviewTarget) -> None:
    plan = sample()
    step_target(plan, 1, 0)["side"] = "base"  # lib.py is new in this change
    assert problems(plan, target) == [f"{S2}, step 1: lib.py does not exist at the base revision"]


def test_columns_outside_the_line(target: ReviewTarget) -> None:
    plan = sample()
    step_target(plan, 0, 1).update({"startCol": 7, "endCol": 90})
    (problem,) = problems(plan, target)
    assert "columns 7-90 fall outside lines 1-1 of app.py" in problem


def test_expect_is_checked_inside_the_column_span(target: ReviewTarget) -> None:
    plan = sample()
    step_target(plan, 0, 1).update({"startCol": 1, "endCol": 5, "expect": "feature"})  # columns 1-5 are "print"
    (problem,) = problems(plan, target)
    assert "expected text 'feature' does not occur" in problem


def test_unchanged_code_can_be_targeted(target: ReviewTarget, repo: FixtureRepo) -> None:
    plan = sample()
    plan["sections"][1]["steps"].append(
        {"narration": "Untouched.", "form": "lines", "target": {"path": "app.py", "startLine": 1, "endLine": 1}}
    )
    step_target(plan, 0, 0)["side"] = "base"
    assert problems(plan, target) == []


def test_visual_links_are_checked(target: ReviewTarget) -> None:
    plan = sample()
    plan["sections"][0]["visuals"][0]["elements"][1]["link"]["path"] = "missing.py"
    assert problems(plan, target) == [
        f"{S1}, visual greeting, element after: missing.py does not exist at the head revision"
    ]


def test_all_problems_are_reported_together(target: ReviewTarget) -> None:
    plan = sample()
    step_target(plan, 1, 0).update({"startLine": 400, "endLine": 410})
    step_target(plan, 0, 0)["expect"] = "nope"
    plan["sections"][1]["hunks"].append("app.py:h1")
    assert len(problems(plan, target)) == 3
