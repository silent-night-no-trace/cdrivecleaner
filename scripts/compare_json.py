from __future__ import annotations

import json
import sys
from pathlib import Path


def load_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("Usage: python compare_json.py <left.json> <right.json>", file=sys.stderr)
        return 2

    left_path = Path(argv[0])
    right_path = Path(argv[1])
    left = load_json(left_path)
    right = load_json(right_path)

    if left != right:
        print(f"JSON mismatch: {left_path} != {right_path}", file=sys.stderr)
        return 1

    print(f"JSON match: {left_path} == {right_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
