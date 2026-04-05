from __future__ import annotations

import argparse
from collections.abc import Iterable
from dataclasses import dataclass
import importlib
import json
import os
import sys
from pathlib import Path
from typing import Protocol, TypeAlias, cast

REPO_ROOT = Path(__file__).resolve().parents[1]

JSONValue: TypeAlias = (
    None | bool | int | float | str | list["JSONValue"] | dict[str, "JSONValue"]
)


class RiskTierProtocol(Protocol):
    @property
    def value(self) -> str: ...


class CategoryProtocol(Protocol):
    @property
    def id(self) -> str: ...

    @property
    def display_name(self) -> str: ...

    @property
    def description(self) -> str: ...

    @property
    def category_group(self) -> str: ...

    @property
    def badge_label(self) -> str: ...

    @property
    def safety_note(self) -> str: ...

    @property
    def risk_tier(self) -> RiskTierProtocol: ...

    @property
    def requires_admin(self) -> bool: ...

    @property
    def included_in_safe_defaults(self) -> bool: ...


class RegistryModuleProtocol(Protocol):
    ALL_CATEGORIES: Iterable[CategoryProtocol]


@dataclass(frozen=True)
class ExportArgs:
    command: str
    output: str | None
    input: str | None
    kind: str | None


def ensure_mapping(value: object, context: str) -> dict[str, JSONValue]:
    if not isinstance(value, dict):
        raise SystemExit(f"{context} must be a JSON object.")
    return cast(dict[str, JSONValue], value)


def resolve_reference_root() -> Path:
    from_env = os.environ.get("CDRIVECLEANER_REFERENCE_ROOT")
    if from_env:
        candidate = Path(from_env)
        if (candidate / "cdrivecleaner").exists():
            return candidate

    if (REPO_ROOT / "cdrivecleaner").exists():
        return REPO_ROOT

    raise RuntimeError(
        "Could not locate the Python reference workspace. Keep `cdrivecleaner/` in the current workspace or set `CDRIVECLEANER_REFERENCE_ROOT` explicitly."
    )


def load_reference_categories() -> Iterable[CategoryProtocol]:
    reference_root = resolve_reference_root()
    if str(reference_root) not in sys.path:
        sys.path.insert(0, str(reference_root))

    registry_module = importlib.import_module("cdrivecleaner.registry")
    registry = cast(
        RegistryModuleProtocol,
        cast(object, registry_module),
    )
    return registry.ALL_CATEGORIES


def export_categories(output_path: Path) -> None:
    all_categories = load_reference_categories()
    payload: list[dict[str, JSONValue]] = [
        {
            "id": category.id,
            "displayName": category.display_name,
            "description": category.description,
            "categoryGroup": category.category_group,
            "badgeLabel": category.badge_label,
            "safetyNote": category.safety_note,
            "riskTier": category.risk_tier.value,
            "requiresAdmin": category.requires_admin,
            "includedInSafeDefaults": category.included_in_safe_defaults,
        }
        for category in all_categories
    ]
    _ = output_path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def transform_payload(input_path: Path, output_path: Path, kind: str) -> None:
    payload = cast(object, json.loads(input_path.read_text(encoding="utf-8")))
    source = ensure_mapping(payload, "Input payload")

    result: dict[str, JSONValue]
    if kind == "scan":
        result = {
            "summary": source.get("summary", {}),
            "categories": source.get("categories", []),
        }
    elif kind == "clean":
        result = {
            "summary": source.get("summary", {}),
            "categories": source.get("categories", []),
        }
    elif kind == "elevation":
        result = {
            "isProcessElevated": bool(source.get("isProcessElevated", False)),
            "requiresElevation": bool(source.get("requiresElevation", False)),
            "adminCategoryIds": source.get("adminCategoryIds", []),
        }
    else:
        raise SystemExit(f"Unsupported kind: {kind}")

    _ = output_path.write_text(
        json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Export canonical contract fixtures from the Python reference app when it is explicitly available."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    categories = subparsers.add_parser("categories")
    _ = categories.add_argument("output")

    transform = subparsers.add_parser("transform")
    _ = transform.add_argument("kind", choices=["scan", "clean", "elevation"])
    _ = transform.add_argument("input")
    _ = transform.add_argument("output")
    return parser


def main() -> int:
    args_dict = cast(dict[str, object], vars(build_parser().parse_args()))
    args = ExportArgs(
        command=cast(str, args_dict["command"]),
        output=cast(str | None, args_dict.get("output")),
        input=cast(str | None, args_dict.get("input")),
        kind=cast(str | None, args_dict.get("kind")),
    )
    if args.command == "categories":
        if args.output is None:
            raise SystemExit("Missing output path for categories export.")
        export_categories(Path(args.output))
        return 0

    if args.command == "transform":
        if args.input is None or args.output is None or args.kind is None:
            raise SystemExit("Missing transform arguments.")
        transform_payload(Path(args.input), Path(args.output), args.kind)
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
