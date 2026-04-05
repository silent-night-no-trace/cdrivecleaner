from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import cast

type JSONValue = None | bool | int | float | str | list[JSONValue] | dict[str, JSONValue]


def load_json(path: Path) -> JSONValue:
    return cast(JSONValue, json.loads(path.read_text(encoding="utf-8")))


def ensure_object(value: JSONValue, message: str) -> dict[str, JSONValue]:
    if not isinstance(value, dict):
        raise AssertionError(message)
    return value


def ensure_array(value: JSONValue, message: str) -> list[JSONValue]:
    if not isinstance(value, list):
        raise AssertionError(message)
    return value


def assert_has_keys(payload: dict[str, JSONValue], required: set[str], context: str) -> None:
    missing = sorted(required.difference(payload))
    if missing:
        raise AssertionError(f"{context} missing keys: {missing}")


def validate_warning_array(value: JSONValue, context: str) -> None:
    warnings = ensure_array(value, f"{context} warnings must be an array")
    for warning in warnings:
        warning_payload = ensure_object(warning, f"{context} warning must be an object")
        assert_has_keys(warning_payload, {"code", "severity", "message"}, f"{context} warning")


def validate_categories(base: Path) -> None:
    payload = ensure_array(load_json(base / "categories.json"), "categories.json must contain a non-empty array")
    if not payload:
        raise AssertionError("categories.json must contain a non-empty array")

    required = {
        "id",
        "displayName",
        "description",
        "categoryGroup",
        "badgeLabel",
        "safetyNote",
        "riskTier",
        "requiresAdmin",
        "includedInSafeDefaults",
    }
    for index, item in enumerate(payload):
        entry = ensure_object(item, f"category entry {index} must be an object")
        assert_has_keys(entry, required, f"category entry {index}")


def validate_scan(base: Path) -> None:
    payload = ensure_object(load_json(base / "scan-safe-default.json"), "scan-safe-default.json must be an object")
    summary = ensure_object(payload.get("summary"), "scan summary must be an object")
    categories = ensure_array(payload.get("categories"), "scan categories must be an array")
    assert_has_keys(summary, {"categoryCount", "totalEstimatedBytes", "totalCandidateFiles", "totalWarnings"}, "scan summary")
    for index, item in enumerate(categories):
        category = ensure_object(item, f"scan category {index} must be an object")
        validate_warning_array(category.get("warnings"), f"scan category {index}")


def validate_clean(base: Path) -> None:
    payload = ensure_object(load_json(base / "clean-safe-default.json"), "clean-safe-default.json must be an object")
    summary = ensure_object(payload.get("summary"), "clean summary must be an object")
    categories = ensure_array(payload.get("categories"), "clean categories must be an array")
    assert_has_keys(summary, {"categoryCount", "successfulCategories", "failedCategories", "totalFreedBytes", "totalDeletedFiles", "totalWarnings"}, "clean summary")
    for index, item in enumerate(categories):
        category = ensure_object(item, f"clean category {index} must be an object")
        validate_warning_array(category.get("warnings"), f"clean category {index}")


def validate_elevation(base: Path) -> None:
    payload = ensure_object(load_json(base / "elevation.json"), "elevation.json must be an object")
    assert_has_keys(payload, {"isProcessElevated", "requiresElevation", "adminCategoryIds"}, "elevation payload")


def validate_history(base: Path) -> None:
    payload = ensure_object(load_json(base / "history.json"), "history.json must be an object")
    entries = ensure_array(payload.get("entries"), "history entries must be an array")
    for index, item in enumerate(entries):
        entry = ensure_object(item, f"history entry {index} must be an object")
        assert_has_keys(entry, {"timestamp", "kind", "summary"}, f"history entry {index}")


def main(argv: list[str]) -> int:
    base = Path(argv[0]) if argv else Path(__file__).resolve().parents[1] / "contracts" / "fixtures"
    validate_categories(base)
    validate_scan(base)
    validate_clean(base)
    validate_elevation(base)
    validate_history(base)
    print(f"Contract fixtures validated: {base}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
