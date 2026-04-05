from __future__ import annotations

import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import TypedDict, cast


class ScanSummary(TypedDict):
    categoryCount: int
    totalEstimatedBytes: int
    totalCandidateFiles: int
    totalWarnings: int


class CleanSummary(TypedDict):
    categoryCount: int
    successfulCategories: int
    failedCategories: int
    totalFreedBytes: int
    totalDeletedFiles: int
    totalWarnings: int


class HistoryRecord(TypedDict):
    kind: str


class HistoryPayload(TypedDict):
    entries: list[HistoryRecord]


REPO_ROOT = Path(__file__).resolve().parents[1]
CLI_EXE = REPO_ROOT / "target" / "debug" / "cdrivecleaner-cli.exe"


def write_file(path: Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    _ = path.write_bytes(b"x" * size)


def build_fixture_tree(root: Path) -> tuple[Path, Path]:
    user_temp = root / "temp-root"
    local_app_data = root / "local-app-data"
    explorer = local_app_data / "Microsoft" / "Windows" / "Explorer"
    shader = local_app_data / "D3DSCache"

    for index in range(3):
        write_file(user_temp / f"temp-{index:02}.bin", 12_000)
    for index in range(2):
        write_file(explorer / f"thumb-{index:02}.db", 30_000)
    for index in range(4):
        write_file(shader / f"shader-{index:02}.cache", 40_000)
    write_file(shader / "locked.bin", 4_096)

    return user_temp, local_app_data


def run_cli(*args: str, env: dict[str, str]) -> dict[str, object]:
    if not CLI_EXE.exists():
        build_cli_binary()

    completed = subprocess.run(
        [str(CLI_EXE), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=env,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            completed.stderr.strip()
            or completed.stdout.strip()
            or f"CLI failed with exit code {completed.returncode}"
        )
    return cast(dict[str, object], json.loads(completed.stdout))


def build_cli_binary() -> None:
    completed = subprocess.run(
        [
            "cargo",
            "build",
            "-p",
            "cdrivecleaner-cli",
        ],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    if completed.returncode != 0 or not CLI_EXE.exists():
        raise RuntimeError(
            completed.stderr.strip()
            or completed.stdout.strip()
            or f"Failed to build CLI binary: {CLI_EXE}"
        )


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="cdrivecleaner-smoke-") as tmp:
        root = Path(tmp)
        user_temp, local_app_data = build_fixture_tree(root)

        env = os.environ.copy()
        env["TEMP"] = str(user_temp)
        env["TMP"] = str(user_temp)
        env["LOCALAPPDATA"] = str(local_app_data)
        env["CDRIVECLEANER_HISTORY_PATH"] = str(
            local_app_data / "CDriveCleaner" / "history.json"
        )

        llvm_mingw_bin = env.get("LLVM_MINGW_BIN")
        if llvm_mingw_bin:
            env["PATH"] = f"{llvm_mingw_bin};{env.get('PATH', '')}"

        before_scan = run_cli("scan", "--all-safe", "--json", env=env)
        clean = run_cli("clean", "--all-safe", "--json", env=env)
        after_scan = run_cli("scan", "--all-safe", "--json", env=env)

        before_summary = cast(ScanSummary, before_scan["summary"])
        clean_summary = cast(CleanSummary, clean["summary"])
        after_summary = cast(ScanSummary, after_scan["summary"])

        assert before_summary["categoryCount"] == 3, before_summary
        assert before_summary["totalEstimatedBytes"] == 256_000, before_summary
        assert before_summary["totalCandidateFiles"] == 9, before_summary
        assert before_summary["totalWarnings"] == 1, before_summary

        assert clean_summary["categoryCount"] == 3, clean_summary
        assert clean_summary["successfulCategories"] == 2, clean_summary
        assert clean_summary["failedCategories"] == 1, clean_summary
        assert (
            clean_summary["totalFreedBytes"] == before_summary["totalEstimatedBytes"]
        ), clean_summary
        assert (
            clean_summary["totalDeletedFiles"] == before_summary["totalCandidateFiles"]
        ), clean_summary
        assert clean_summary["totalWarnings"] == 1, clean_summary

        assert after_summary["categoryCount"] == 3, after_summary
        assert after_summary["totalEstimatedBytes"] == 0, after_summary
        assert after_summary["totalCandidateFiles"] == 0, after_summary
        assert after_summary["totalWarnings"] == 1, after_summary

        history_path = local_app_data / "CDriveCleaner" / "history.json"
        history: HistoryPayload | None = None
        if history_path.exists():
            history = cast(
                HistoryPayload, json.loads(history_path.read_text(encoding="utf-8"))
            )

        print(
            json.dumps(
                {
                    "beforeScan": before_scan,
                    "clean": clean,
                    "afterScan": after_scan,
                    "history": history,
                },
                indent=2,
                ensure_ascii=False,
            )
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
