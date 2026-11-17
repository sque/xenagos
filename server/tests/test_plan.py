import copy
import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from xenagos.plan import CodeTarget, Plan, VisualTarget

SAMPLE = json.loads((Path(__file__).parent / "data" / "plan-sample.json").read_text())


def sample() -> dict[str, Any]:
    result: dict[str, Any] = copy.deepcopy(SAMPLE)
    return result


def rejected(plan: dict[str, Any]) -> str:
    with pytest.raises(ValidationError) as error:
        Plan.model_validate(plan)
    return str(error.value)


def test_valid_sample_is_accepted() -> None:
    plan = Plan.model_validate(SAMPLE)
    assert [s.role for s in plan.sections] == ["core", "support"]
    first = plan.sections[0].steps
    assert isinstance(first[0].target, CodeTarget)
    assert first[0].target.side == "base"
    assert first[1].target == CodeTarget(
        path="app.py", start_line=1, end_line=1, start_col=7, end_col=19, expect="feature one"
    )
    assert isinstance(first[2].target, VisualTarget)


def test_json_round_trip_keeps_camel_case() -> None:
    dumped = Plan.model_validate(SAMPLE).model_dump(mode="json", by_alias=True, exclude_none=True)
    assert dumped["sections"][0]["steps"][0]["target"]["startLine"] == 1
    assert Plan.model_validate(dumped) == Plan.model_validate(SAMPLE)


def test_missing_role_is_rejected() -> None:
    plan = sample()
    del plan["sections"][0]["role"]
    assert "sections.0.role" in rejected(plan)


def test_empty_title_is_rejected() -> None:
    plan = sample()
    plan["sections"][1]["title"] = "   "
    assert "sections.1.title" in rejected(plan)


def test_step_without_target_is_rejected() -> None:
    plan = sample()
    del plan["sections"][0]["steps"][1]["target"]
    assert "sections.0.steps.1.target" in rejected(plan)


def test_step_without_form_is_rejected() -> None:
    plan = sample()
    del plan["sections"][0]["steps"][0]["form"]
    assert "sections.0.steps.0.form" in rejected(plan)


def test_target_naming_an_undeclared_visual_element_is_rejected() -> None:
    plan = sample()
    plan["sections"][0]["steps"][2]["target"]["element"] = "middle"
    assert "step 3 targets greeting#middle, but this section declares no such element" in rejected(plan)


def test_target_naming_another_sections_visual_is_rejected() -> None:
    plan = sample()
    plan["sections"][1]["steps"][0]["target"] = {"visual": "greeting", "element": "after"}
    assert "declares no such visual" in rejected(plan)


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"startLine": 3, "endLine": 2}, "endLine is before startLine"),
        ({"startCol": 4}, "give both startCol and endCol"),
        ({"startCol": 9, "endCol": 2}, "endCol is before startCol"),
        ({"path": "/etc/passwd"}, "relative to the repository root"),
        ({"path": "../outside.py"}, "relative to the repository root"),
        ({"side": "left"}, "'base' or 'head'"),
        ({"startLine": 0}, "greater than 0"),
        ({"startline": 1}, "Extra inputs are not permitted"),
    ],
)
def test_malformed_code_target_is_rejected(change: dict[str, Any], message: str) -> None:
    plan = sample()
    plan["sections"][1]["steps"][0]["target"].update(change)
    assert message in rejected(plan)


def test_visual_ids_are_restricted_and_unique() -> None:
    plan = sample()
    plan["sections"][0]["visuals"][0]["elements"][0]["id"] = 'x"><script>'
    assert "elements.0.id" in rejected(plan)
    plan = sample()
    plan["sections"][1]["visuals"] = [copy.deepcopy(plan["sections"][0]["visuals"][0])]
    assert "visual id 'greeting' is used more than once" in rejected(plan)


def test_orientation_names_its_document_only_when_taken_from_one() -> None:
    plan = sample()
    plan["orientation"]["source"] = "document"
    assert "name a document exactly when source is 'document'" in rejected(plan)
    plan["orientation"]["document"] = "docs/why.md"
    Plan.model_validate(plan)


def test_section_needs_a_step_and_plan_needs_a_section() -> None:
    plan = sample()
    plan["sections"][1]["steps"] = []
    assert "sections.1.steps" in rejected(plan)
    assert "sections" in rejected({"orientation": SAMPLE["orientation"], "sections": []})
