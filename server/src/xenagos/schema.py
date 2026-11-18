"""Export the JSON Schema shared with the viewer: `python -m xenagos.schema > web/src/generated/schema.json`.

The viewer generates its TypeScript types from that file (web/scripts/generate-types.mjs). Both generated files are
committed; `tests/test_schema.py` and `npm run check:types` fail when either is stale.
"""

import json
from typing import Any

from pydantic.json_schema import models_json_schema

from xenagos.api import (
    AgentRequest,
    AgentStatus,
    AskedQuestion,
    CategoryChange,
    ChangedFile,
    CommitInfo,
    Coverage,
    Delivery,
    FileView,
    PlanRejection,
    Question,
    RepositoryTree,
    ReviewInfo,
    SessionChoiceItem,
    Show,
    TargetStatus,
    VoiceRequest,
)
from xenagos.plan import Plan


def export() -> dict[str, Any]:
    _, schema = models_json_schema(
        [
            (Plan, "validation"),
            (ReviewInfo, "serialization"),
            (FileView, "serialization"),
            (PlanRejection, "serialization"),
            (AgentStatus, "serialization"),
            (Question, "validation"),
            (AgentRequest, "validation"),
            (Delivery, "serialization"),
            (Show, "serialization"),
            (VoiceRequest, "validation"),
            (TargetStatus, "serialization"),
            (AskedQuestion, "serialization"),
            (SessionChoiceItem, "serialization"),
            (ChangedFile, "serialization"),
            (CommitInfo, "serialization"),
            (CategoryChange, "validation"),
            (Coverage, "serialization"),
            (RepositoryTree, "serialization"),
        ],
        title="xenagos",
    )
    for definition in schema["$defs"].values():
        for prop in definition.get("properties", {}).values():
            # Property titles are derived from the key and would become one type alias per property.
            prop.pop("title", None)
    return schema


def render() -> str:
    return json.dumps(export(), indent=2, sort_keys=True) + "\n"


if __name__ == "__main__":
    print(render(), end="")
