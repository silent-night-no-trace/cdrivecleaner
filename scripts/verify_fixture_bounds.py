from __future__ import annotations

import json
import sys
from pathlib import Path


def _is_within_root(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("Usage: python verify_fixture_bounds.py <fixture-root> <artifact.json>", file=sys.stderr)
        return 2

    root = Path(argv[0])
    artifact = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
    touched_paths = artifact.get("touchedPaths", []) if isinstance(artifact, dict) else []

    if not isinstance(touched_paths, list):
        print("Artifact does not contain a valid 'touchedPaths' list.", file=sys.stderr)
        return 1

    invalid = [item for item in touched_paths if not isinstance(item, str) or not _is_within_root(Path(item), root)]
    if invalid:
        print("Found out-of-bounds paths:", file=sys.stderr)
        for item in invalid:
            print(f"- {item}", file=sys.stderr)
        return 1

    print(f"All touched paths are within {root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
