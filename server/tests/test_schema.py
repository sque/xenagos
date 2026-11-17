from pathlib import Path

from xenagos.schema import render

COMMITTED = Path(__file__).resolve().parents[2] / "web" / "src" / "generated" / "schema.json"


def test_committed_schema_matches_the_models() -> None:
    assert COMMITTED.read_text() == render(), "the plan or API models changed: run `make types` and commit"
