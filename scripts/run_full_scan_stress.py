from __future__ import annotations

import argparse
import csv
import json
import os
import shutil
import subprocess
import tempfile
from collections.abc import Mapping
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import TypeAlias, cast


REPO_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_ROOT = REPO_ROOT / "output" / "full-scan-stress"
# For open-source portability, avoid hard-coded local toolchain paths.
# Use `cargo` from PATH (or set `CDRIVECLEANER_CARGO_EXE`) and optionally set
# `LLVM_MINGW_BIN` if your Windows runtime needs gnullvm DLLs on PATH.
BENCH_EXE = REPO_ROOT / "target" / "debug" / "full_scan_stress.exe"


@dataclass
class FixtureStats:
    directories: int = 0
    files: int = 0
    bytes: int = 0


@dataclass(frozen=True)
class StressArgs:
    root: Path | None
    label: str | None
    compare_to_label: str | None
    depth: int
    top_level_dirs: int
    dirs_per_dir: int
    files_per_dir: int
    file_size_bytes: int
    wide_dir_files: int
    wide_dir_dirs: int
    expand_limit: int
    repeat_expand: int
    scan_warn_ms: float
    expand_warn_ms: float
    rebuild_binary: bool
    keep_fixture: bool


JSONValue: TypeAlias = (
    None | bool | int | float | str | list["JSONValue"] | dict[str, "JSONValue"]
)
ReportDict: TypeAlias = dict[str, JSONValue]


def ensure_mapping(value: object, context: str) -> ReportDict:
    if not isinstance(value, dict):
        raise RuntimeError(f"{context} must be a JSON object")
    return cast(ReportDict, value)


def ensure_mapping_list(value: object, context: str) -> list[ReportDict]:
    if not isinstance(value, list):
        raise RuntimeError(f"{context} must be a JSON array")
    return [ensure_mapping(item, context) for item in cast(list[object], value)]


def as_float(value: JSONValue) -> float:
    return float(cast(float | int | str, value))


def load_latest_report() -> ReportDict | None:
    latest_path = OUTPUT_ROOT / "latest.json"
    if not latest_path.exists():
        return None
    try:
        return ensure_mapping(
            cast(object, json.loads(latest_path.read_text(encoding="utf-8"))),
            "latest report",
        )
    except (OSError, json.JSONDecodeError):
        return None


def load_previous_report_for_root(
    fixture_key: str, label: str | None = None
) -> ReportDict | None:
    if not OUTPUT_ROOT.exists():
        return None

    candidates = sorted(
        (path for path in OUTPUT_ROOT.iterdir() if path.is_dir()),
        key=lambda path: path.name,
        reverse=True,
    )

    for candidate in candidates:
        report_path = candidate / "report.json"
        if not report_path.exists():
            continue
        try:
            report = ensure_mapping(
                cast(object, json.loads(report_path.read_text(encoding="utf-8"))),
                f"previous report {report_path}",
            )
        except (OSError, json.JSONDecodeError):
            continue
        previous_key = report.get("fixtureKey")
        if isinstance(previous_key, str) and previous_key == fixture_key:
            if label is not None and report.get("label") != label:
                continue
            return report

    return None


def resolve_cargo_executable() -> str:
    from_env = os.environ.get("CDRIVECLEANER_CARGO_EXE")
    if from_env:
        return from_env
    cargo_from_path = shutil.which("cargo")
    if cargo_from_path:
        return cargo_from_path
    raise RuntimeError(
        "Could not locate cargo.exe. Set CDRIVECLEANER_CARGO_EXE or ensure cargo is available on PATH."
    )


def resolve_llvm_mingw_bin() -> str | None:
    from_env = os.environ.get("LLVM_MINGW_BIN") or os.environ.get(
        "CDRIVECLEANER_LLVM_MINGW_BIN"
    )
    if from_env:
        return from_env
    return None


def benchmark_build_env() -> dict[str, str]:
    env = os.environ.copy()
    env.setdefault("RUSTUP_TOOLCHAIN", "stable-x86_64-pc-windows-gnullvm")
    llvm_mingw_bin = resolve_llvm_mingw_bin()
    if llvm_mingw_bin:
        env["PATH"] = f"{llvm_mingw_bin};{env.get('PATH', '')}"
    return env


def parse_args() -> StressArgs:
    parser = argparse.ArgumentParser(
        description="Generate a large disposable tree and measure full-scan plus expand latency."
    )
    _ = parser.add_argument(
        "--root",
        type=Path,
        help="Benchmark an existing root instead of generating a disposable fixture tree.",
    )
    _ = parser.add_argument(
        "--label",
        help="Optional run label such as before-opt or after-opt for easier comparisons.",
    )
    _ = parser.add_argument(
        "--compare-to-label",
        help="Compare against the most recent prior run with this label for the same root.",
    )
    _ = parser.add_argument("--depth", type=int, default=4)
    _ = parser.add_argument("--top-level-dirs", type=int, default=6)
    _ = parser.add_argument("--dirs-per-dir", type=int, default=4)
    _ = parser.add_argument("--files-per-dir", type=int, default=12)
    _ = parser.add_argument("--file-size-bytes", type=int, default=16384)
    _ = parser.add_argument("--wide-dir-files", type=int, default=600)
    _ = parser.add_argument("--wide-dir-dirs", type=int, default=18)
    _ = parser.add_argument("--expand-limit", type=int, default=5)
    _ = parser.add_argument("--repeat-expand", type=int, default=3)
    _ = parser.add_argument("--scan-warn-ms", type=float, default=4000.0)
    _ = parser.add_argument("--expand-warn-ms", type=float, default=250.0)
    _ = parser.add_argument("--rebuild-binary", action="store_true")
    _ = parser.add_argument("--keep-fixture", action="store_true")

    namespace = cast(dict[str, object], vars(parser.parse_args()))
    return StressArgs(
        root=cast(Path | None, namespace["root"]),
        label=cast(str | None, namespace["label"]),
        compare_to_label=cast(str | None, namespace["compare_to_label"]),
        depth=cast(int, namespace["depth"]),
        top_level_dirs=cast(int, namespace["top_level_dirs"]),
        dirs_per_dir=cast(int, namespace["dirs_per_dir"]),
        files_per_dir=cast(int, namespace["files_per_dir"]),
        file_size_bytes=cast(int, namespace["file_size_bytes"]),
        wide_dir_files=cast(int, namespace["wide_dir_files"]),
        wide_dir_dirs=cast(int, namespace["wide_dir_dirs"]),
        expand_limit=cast(int, namespace["expand_limit"]),
        repeat_expand=cast(int, namespace["repeat_expand"]),
        scan_warn_ms=cast(float, namespace["scan_warn_ms"]),
        expand_warn_ms=cast(float, namespace["expand_warn_ms"]),
        rebuild_binary=cast(bool, namespace["rebuild_binary"]),
        keep_fixture=cast(bool, namespace["keep_fixture"]),
    )


def write_file(path: Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    _ = path.write_bytes(b"x" * size)


def create_files(
    directory: Path, files_per_dir: int, base_size: int, stats: FixtureStats
) -> None:
    for index in range(files_per_dir):
        size = base_size + (index % 5) * 1024
        write_file(directory / f"blob-{index:04}.bin", size)
        stats.files += 1
        stats.bytes += size


def build_branch(
    root: Path,
    depth: int,
    dirs_per_dir: int,
    files_per_dir: int,
    base_size: int,
    stats: FixtureStats,
) -> None:
    create_files(root, files_per_dir, base_size, stats)
    if depth <= 0:
        return

    for index in range(dirs_per_dir):
        child = root / f"dir-{depth:02}-{index:02}"
        child.mkdir(parents=True, exist_ok=True)
        stats.directories += 1
        build_branch(
            child, depth - 1, dirs_per_dir, files_per_dir, base_size + 2048, stats
        )


def build_fixture_tree(root: Path, args: StressArgs) -> FixtureStats:
    stats = FixtureStats(directories=1)

    for index in range(args.top_level_dirs):
        branch = root / f"branch-{index:02}"
        branch.mkdir(parents=True, exist_ok=True)
        stats.directories += 1
        build_branch(
            branch,
            args.depth - 1,
            args.dirs_per_dir,
            args.files_per_dir,
            args.file_size_bytes + index * 1024,
            stats,
        )

    wide = root / "hot-wide"
    wide.mkdir(parents=True, exist_ok=True)
    stats.directories += 1
    create_files(wide, args.wide_dir_files, args.file_size_bytes * 2, stats)
    for index in range(args.wide_dir_dirs):
        subdir = wide / f"bucket-{index:03}"
        subdir.mkdir(parents=True, exist_ok=True)
        stats.directories += 1
        create_files(
            subdir, max(8, args.files_per_dir // 2), args.file_size_bytes, stats
        )

    deep = root / "deep-focus"
    deep.mkdir(parents=True, exist_ok=True)
    stats.directories += 1
    current = deep
    for depth_index in range(args.depth * 2):
        create_files(
            current,
            max(4, args.files_per_dir // 3),
            args.file_size_bytes + depth_index * 512,
            stats,
        )
        child = current / f"deep-{depth_index:02}"
        child.mkdir(parents=True, exist_ok=True)
        stats.directories += 1
        current = child

    return stats


def ensure_benchmark_binary(rebuild: bool) -> None:
    if BENCH_EXE.exists() and not rebuild:
        return

    command = [
        resolve_cargo_executable(),
        "build",
        "-p",
        "cdrivecleaner-cli",
        "--bin",
        "full_scan_stress",
    ]
    completed = subprocess.run(
        command,
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=benchmark_build_env(),
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            completed.stderr.strip()
            or completed.stdout.strip()
            or "Failed to build full_scan_stress.exe"
        )


def run_benchmark(root: Path, args: StressArgs) -> ReportDict:
    env = benchmark_build_env()

    completed = subprocess.run(
        [
            str(BENCH_EXE),
            "--root",
            str(root),
            "--expand-limit",
            str(args.expand_limit),
            "--repeat-expand",
            str(args.repeat_expand),
        ],
        cwd=REPO_ROOT,
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
            or "Benchmark execution failed"
        )
    return cast(ReportDict, json.loads(completed.stdout))


def build_issues(
    benchmark: ReportDict, scan_warn_ms: float, expand_warn_ms: float
) -> list[str]:
    issues: list[str] = []
    scan = ensure_mapping(benchmark["scan"], "benchmark.scan")
    scan_elapsed = as_float(scan["elapsed_ms"])
    if scan_elapsed > scan_warn_ms:
        issues.append(
            f"Full scan latency is high: {scan_elapsed:.2f} ms > {scan_warn_ms:.2f} ms"
        )

    for expand in ensure_mapping_list(benchmark["expand"], "benchmark.expand"):
        first = as_float(expand["first_elapsed_ms"])
        if first > expand_warn_ms:
            issues.append(
                f"Expand latency is high for {expand['path']}: first run {first:.2f} ms > {expand_warn_ms:.2f} ms"
            )

    return issues


def get_scan_summary_value(
    summary: Mapping[str, object], camel_key: str, snake_key: str
) -> object:
    if camel_key in summary:
        return summary[camel_key]
    return summary[snake_key]


def format_fixture_value(value: int | None) -> str:
    return "unknown" if value is None else str(value)


def median(values: list[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2 == 0:
        return (ordered[middle - 1] + ordered[middle]) / 2.0
    return ordered[middle]


def stddev(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    variance = sum((value - mean) ** 2 for value in values) / len(values)
    return variance**0.5


def build_expand_summary(expand_items: list[ReportDict]) -> ReportDict:
    first_runs = [as_float(item["first_elapsed_ms"]) for item in expand_items]
    averages = [as_float(item["average_elapsed_ms"]) for item in expand_items]
    slowest = max(
        expand_items,
        key=lambda item: as_float(item["first_elapsed_ms"]),
        default=None,
    )
    return {
        "targetCount": len(expand_items),
        "firstRunMeanMs": sum(first_runs) / len(first_runs) if first_runs else 0.0,
        "firstRunMedianMs": median(first_runs),
        "averageRunMeanMs": sum(averages) / len(averages) if averages else 0.0,
        "slowestFirstRunMs": as_float(slowest["first_elapsed_ms"]) if slowest else 0.0,
        "slowestPath": slowest["path"] if slowest else None,
    }


def build_fixture_key(root: Path, args: StressArgs) -> str:
    if args.root is not None:
        return f"root:{root}"
    return ":".join(
        [
            "generated",
            f"depth={args.depth}",
            f"top={args.top_level_dirs}",
            f"dirs={args.dirs_per_dir}",
            f"files={args.files_per_dir}",
            f"file_size={args.file_size_bytes}",
            f"wide_files={args.wide_dir_files}",
            f"wide_dirs={args.wide_dir_dirs}",
            f"expand_limit={args.expand_limit}",
            f"repeat_expand={args.repeat_expand}",
        ]
    )


SUMMARY_CSV_FIELDS = [
    "runId",
    "label",
    "fixtureKey",
    "fixtureRoot",
    "status",
    "scanWarnMs",
    "expandWarnMs",
    "scanElapsedMs",
    "progressEventCount",
    "scanningEventCount",
    "estimatedBytes",
    "candidateFiles",
    "warningCount",
    "expandTargetCount",
    "expandFirstRunMeanMs",
    "expandFirstRunMedianMs",
    "expandAverageRunMeanMs",
    "slowestPath",
    "slowestFirstRunMs",
    "previousRunId",
    "previousLabel",
    "scanDeltaMs",
    "expandFirstRunMeanDeltaMs",
]

EXPAND_CSV_FIELDS = [
    "runId",
    "label",
    "path",
    "name",
    "sizeBytes",
    "firstElapsedMs",
    "averageElapsedMs",
    "minElapsedMs",
    "maxElapsedMs",
    "loadedChildCount",
    "warningCount",
    "childrenLoaded",
]

AGGREGATE_CSV_FIELDS = [
    "fixtureKey",
    "fixtureRoot",
    "runCount",
    "latestRunId",
    "latestLabel",
    "scanMeanMs",
    "scanMedianMs",
    "scanStddevMs",
    "scanMinMs",
    "scanMaxMs",
    "expandFirstRunMeanMs",
    "expandFirstRunMedianMs",
    "expandFirstRunStddevMs",
    "expandFirstRunMinMs",
    "expandFirstRunMaxMs",
]


def build_summary_csv_row(report: ReportDict) -> ReportDict:
    benchmark = ensure_mapping(report["benchmark"], "report.benchmark")
    scan = ensure_mapping(benchmark["scan"], "report.benchmark.scan")
    scan_summary = ensure_mapping(scan["summary"], "report.benchmark.scan.summary")
    expand_summary = ensure_mapping(report["expandSummary"], "report.expandSummary")
    thresholds = ensure_mapping(report["thresholds"], "report.thresholds")
    comparison = (
        ensure_mapping(report["comparison"], "report.comparison")
        if report.get("comparison") is not None
        else None
    )
    return {
        "runId": report["runId"],
        "label": report.get("label") or "unlabeled",
        "fixtureKey": report["fixtureKey"],
        "fixtureRoot": report["fixtureRoot"],
        "status": "PASS"
        if not cast(list[JSONValue], report["issues"])
        else "ATTENTION",
        "scanWarnMs": thresholds["scanWarnMs"],
        "expandWarnMs": thresholds["expandWarnMs"],
        "scanElapsedMs": as_float(scan["elapsed_ms"]),
        "progressEventCount": scan["progress_event_count"],
        "scanningEventCount": scan["scanning_event_count"],
        "estimatedBytes": get_scan_summary_value(
            scan_summary, "totalEstimatedBytes", "total_estimated_bytes"
        ),
        "candidateFiles": get_scan_summary_value(
            scan_summary, "totalCandidateFiles", "total_candidate_files"
        ),
        "warningCount": get_scan_summary_value(
            scan_summary, "totalWarnings", "total_warnings"
        ),
        "expandTargetCount": expand_summary["targetCount"],
        "expandFirstRunMeanMs": expand_summary["firstRunMeanMs"],
        "expandFirstRunMedianMs": expand_summary["firstRunMedianMs"],
        "expandAverageRunMeanMs": expand_summary["averageRunMeanMs"],
        "slowestPath": expand_summary["slowestPath"],
        "slowestFirstRunMs": expand_summary["slowestFirstRunMs"],
        "previousRunId": comparison["previousRunId"] if comparison else None,
        "previousLabel": comparison["previousLabel"] if comparison else None,
        "scanDeltaMs": comparison["scanDeltaMs"] if comparison else None,
        "expandFirstRunMeanDeltaMs": comparison["expandFirstRunMeanDeltaMs"]
        if comparison
        else None,
    }


def build_expand_csv_rows(report: ReportDict) -> list[ReportDict]:
    benchmark = ensure_mapping(report["benchmark"], "report.benchmark")
    return [
        {
            "runId": report["runId"],
            "label": report.get("label") or "unlabeled",
            "path": item["path"],
            "name": item["name"],
            "sizeBytes": item["size_bytes"],
            "firstElapsedMs": item["first_elapsed_ms"],
            "averageElapsedMs": item["average_elapsed_ms"],
            "minElapsedMs": item["min_elapsed_ms"],
            "maxElapsedMs": item["max_elapsed_ms"],
            "loadedChildCount": item["loaded_child_count"],
            "warningCount": item["warning_count"],
            "childrenLoaded": item["children_loaded"],
        }
        for item in ensure_mapping_list(benchmark["expand"], "report.benchmark.expand")
    ]


def load_history_rows() -> list[ReportDict]:
    history_path = OUTPUT_ROOT / "history.csv"
    if not history_path.exists():
        return []
    try:
        with history_path.open("r", encoding="utf-8", newline="") as handle:
            return [cast(ReportDict, dict(row)) for row in csv.DictReader(handle)]
    except OSError:
        return []


def build_aggregate_summary(rows: list[ReportDict]) -> ReportDict | None:
    if not rows:
        return None
    ordered = sorted(rows, key=lambda row: str(row["runId"]))
    latest = ordered[-1]
    scan_values = [as_float(row["scanElapsedMs"]) for row in ordered]
    expand_values = [as_float(row["expandFirstRunMeanMs"]) for row in ordered]
    return {
        "fixtureKey": latest["fixtureKey"],
        "fixtureRoot": latest["fixtureRoot"],
        "runCount": len(ordered),
        "latestRunId": latest["runId"],
        "latestLabel": latest["label"],
        "scanMeanMs": sum(scan_values) / len(scan_values),
        "scanMedianMs": median(scan_values),
        "scanStddevMs": stddev(scan_values),
        "scanMinMs": min(scan_values),
        "scanMaxMs": max(scan_values),
        "expandFirstRunMeanMs": sum(expand_values) / len(expand_values),
        "expandFirstRunMedianMs": median(expand_values),
        "expandFirstRunStddevMs": stddev(expand_values),
        "expandFirstRunMinMs": min(expand_values),
        "expandFirstRunMaxMs": max(expand_values),
    }


def write_csv(path: Path, fieldnames: list[str], rows: list[ReportDict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({field: row.get(field) for field in fieldnames})


def append_history_row(path: Path, fieldnames: list[str], row: ReportDict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    file_exists = path.exists()
    with path.open("a", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        if not file_exists:
            writer.writeheader()
        writer.writerow({field: row.get(field) for field in fieldnames})


def markdown_report(report: ReportDict) -> str:
    benchmark = ensure_mapping(report["benchmark"], "report.benchmark")
    scan = ensure_mapping(benchmark["scan"], "report.benchmark.scan")
    scan_summary = ensure_mapping(scan["summary"], "report.benchmark.scan.summary")
    fixture_stats = ensure_mapping(report["fixtureStats"], "report.fixtureStats")
    expand_items = ensure_mapping_list(benchmark["expand"], "report.benchmark.expand")
    issues = cast(list[str], report["issues"])
    lines = [
        "# Full Scan Stress Report",
        "",
        f"- Run ID: `{report['runId']}`",
        f"- Root: `{report['fixtureRoot']}`",
        f"- Label: `{report.get('label') or 'unlabeled'}`",
        f"- Status: {'PASS' if not report['issues'] else 'ATTENTION'}",
        "",
        "## Fixture",
        "",
        f"- Directories: {format_fixture_value(cast(int | None, fixture_stats['directories']))}",
        f"- Files: {format_fixture_value(cast(int | None, fixture_stats['files']))}",
        f"- Bytes: {format_fixture_value(cast(int | None, fixture_stats['bytes']))}",
        "",
        "## Scan",
        "",
        f"- Full scan elapsed: {as_float(scan['elapsed_ms']):.2f} ms",
        f"- Progress events: {scan['progress_event_count']}",
        f"- Scanning events: {scan['scanning_event_count']}",
        f"- Estimated bytes: {get_scan_summary_value(scan_summary, 'totalEstimatedBytes', 'total_estimated_bytes')}",
        f"- Candidate files: {get_scan_summary_value(scan_summary, 'totalCandidateFiles', 'total_candidate_files')}",
        "",
        "## Expand Targets",
        "",
    ]

    top_slowest = sorted(
        expand_items,
        key=lambda item: as_float(item["first_elapsed_ms"]),
        reverse=True,
    )

    lines.extend(["## Slowest first-expand targets", ""])
    for index, expand in enumerate(top_slowest[:5], start=1):
        lines.append(
            f"{index}. `{expand['path']}` - {expand['first_elapsed_ms']:.2f} ms"
        )
    lines.append("")

    expand_summary = ensure_mapping(report["expandSummary"], "report.expandSummary")
    lines.extend(
        [
            "## Expand Summary",
            "",
            f"- Target count: {expand_summary['targetCount']}",
            f"- First-run mean: {as_float(expand_summary['firstRunMeanMs']):.2f} ms",
            f"- First-run median: {as_float(expand_summary['firstRunMedianMs']):.2f} ms",
            f"- Mean of per-target averages: {as_float(expand_summary['averageRunMeanMs']):.2f} ms",
            f"- Slowest target: `{expand_summary['slowestPath']}` at {as_float(expand_summary['slowestFirstRunMs']):.2f} ms",
            "",
        ]
    )

    previous_value = report.get("comparison")
    if previous_value is not None:
        previous = ensure_mapping(previous_value, "report.comparison")
        lines.extend(
            [
                "## Compared to previous run",
                "",
                f"- Previous run: `{previous['previousRunId']}`",
                f"- Previous label: `{previous['previousLabel']}`",
                f"- Scan delta: {as_float(previous['scanDeltaMs']):+.2f} ms",
                f"- Expand first-run mean delta: {as_float(previous['expandFirstRunMeanDeltaMs']):+.2f} ms",
            ]
        )
        for item in ensure_mapping_list(
            previous.get("expandDelta", []), "report.comparison.expandDelta"
        ):
            lines.append(
                f"- {item['name']}: first-expand delta {item['deltaMs']:+.2f} ms ({item['currentMs']:.2f} ms vs {item['previousMs']:.2f} ms)"
            )
        lines.append("")

    for expand in expand_items:
        lines.extend(
            [
                f"### {expand['name']}",
                f"- Path: `{expand['path']}`",
                f"- First run: {expand['first_elapsed_ms']:.2f} ms",
                f"- Average: {expand['average_elapsed_ms']:.2f} ms",
                f"- Min/Max: {expand['min_elapsed_ms']:.2f} / {expand['max_elapsed_ms']:.2f} ms",
                f"- Loaded children: {expand['loaded_child_count']}",
                f"- Runs: {', '.join(f'{as_float(value):.2f}' for value in cast(list[JSONValue], expand['run_elapsed_ms']))}",
                "",
            ]
        )

    aggregate_summary_value = report.get("aggregateSummary")
    if aggregate_summary_value is not None:
        aggregate = ensure_mapping(aggregate_summary_value, "report.aggregateSummary")
        lines.extend(
            [
                "## Multi-run Summary",
                "",
                f"- Runs tracked: {aggregate['runCount']}",
                f"- Latest run: `{aggregate['latestRunId']}` ({aggregate['latestLabel']})",
                f"- Scan mean / median / stddev: {as_float(aggregate['scanMeanMs']):.2f} / {as_float(aggregate['scanMedianMs']):.2f} / {as_float(aggregate['scanStddevMs']):.2f} ms",
                f"- Scan min / max: {as_float(aggregate['scanMinMs']):.2f} / {as_float(aggregate['scanMaxMs']):.2f} ms",
                f"- Expand first-run mean / median / stddev: {as_float(aggregate['expandFirstRunMeanMs']):.2f} / {as_float(aggregate['expandFirstRunMedianMs']):.2f} / {as_float(aggregate['expandFirstRunStddevMs']):.2f} ms",
                f"- Expand first-run min / max: {as_float(aggregate['expandFirstRunMinMs']):.2f} / {as_float(aggregate['expandFirstRunMaxMs']):.2f} ms",
                "",
            ]
        )

    lines.append("## Issues")
    lines.append("")
    if issues:
        lines.extend(f"- {issue}" for issue in issues)
    else:
        lines.append("- None")
    lines.append("")
    return "\n".join(lines)


def write_reports(run_dir: Path, report: ReportDict, markdown: str) -> None:
    summary_row = build_summary_csv_row(report)
    expand_rows = build_expand_csv_rows(report)
    aggregate_summary = (
        ensure_mapping(report["aggregateSummary"], "report.aggregateSummary")
        if report.get("aggregateSummary") is not None
        else None
    )
    run_dir.mkdir(parents=True, exist_ok=True)
    _ = (run_dir / "report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    _ = (run_dir / "summary.md").write_text(markdown, encoding="utf-8")
    write_csv(run_dir / "summary.csv", SUMMARY_CSV_FIELDS, [summary_row])
    write_csv(run_dir / "expand-targets.csv", EXPAND_CSV_FIELDS, expand_rows)
    if aggregate_summary is not None:
        write_csv(
            run_dir / "aggregate-summary.csv", AGGREGATE_CSV_FIELDS, [aggregate_summary]
        )
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    _ = (OUTPUT_ROOT / "latest.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    _ = (OUTPUT_ROOT / "latest.md").write_text(markdown, encoding="utf-8")
    write_csv(OUTPUT_ROOT / "latest-summary.csv", SUMMARY_CSV_FIELDS, [summary_row])
    write_csv(OUTPUT_ROOT / "latest-expand-targets.csv", EXPAND_CSV_FIELDS, expand_rows)
    if aggregate_summary is not None:
        write_csv(
            OUTPUT_ROOT / "latest-aggregate-summary.csv",
            AGGREGATE_CSV_FIELDS,
            [aggregate_summary],
        )
    append_history_row(OUTPUT_ROOT / "history.csv", SUMMARY_CSV_FIELDS, summary_row)


def build_comparison(
    current_report: ReportDict, previous_report: ReportDict | None
) -> ReportDict | None:
    if not previous_report:
        return None

    current_benchmark = ensure_mapping(current_report["benchmark"], "current.benchmark")
    previous_benchmark = ensure_mapping(
        previous_report["benchmark"], "previous.benchmark"
    )
    current_scan = as_float(
        ensure_mapping(current_benchmark["scan"], "current.benchmark.scan")[
            "elapsed_ms"
        ]
    )
    previous_scan = as_float(
        ensure_mapping(previous_benchmark["scan"], "previous.benchmark.scan")[
            "elapsed_ms"
        ]
    )
    previous_expand = {
        str(item["path"]): item
        for item in ensure_mapping_list(
            previous_benchmark.get("expand", []), "previous.benchmark.expand"
        )
    }
    expand_delta: list[ReportDict] = []
    for item in ensure_mapping_list(
        current_benchmark.get("expand", []), "current.benchmark.expand"
    ):
        previous = previous_expand.get(str(item["path"]))
        if not previous:
            continue
        expand_delta.append(
            {
                "path": item["path"],
                "name": item["name"],
                "currentMs": as_float(item["first_elapsed_ms"]),
                "previousMs": as_float(previous["first_elapsed_ms"]),
                "deltaMs": as_float(item["first_elapsed_ms"])
                - as_float(previous["first_elapsed_ms"]),
            }
        )

    expand_delta.sort(key=lambda item: abs(as_float(item["deltaMs"])), reverse=True)
    expand_delta_json: list[JSONValue] = [
        cast(JSONValue, item) for item in expand_delta[:5]
    ]
    current_expand_items = ensure_mapping_list(
        current_benchmark.get("expand", []), "current.benchmark.expand"
    )
    previous_expand_items = ensure_mapping_list(
        previous_benchmark.get("expand", []), "previous.benchmark.expand"
    )
    current_first_run_mean = (
        sum(as_float(item["first_elapsed_ms"]) for item in current_expand_items)
        / len(current_expand_items)
        if current_expand_items
        else 0.0
    )
    previous_first_run_mean = (
        sum(as_float(item["first_elapsed_ms"]) for item in previous_expand_items)
        / len(previous_expand_items)
        if previous_expand_items
        else 0.0
    )
    return {
        "previousRunId": previous_report.get("runId"),
        "previousLabel": previous_report.get("label") or "unlabeled",
        "scanDeltaMs": current_scan - previous_scan,
        "expandFirstRunMeanDeltaMs": current_first_run_mean - previous_first_run_mean,
        "expandDelta": expand_delta_json,
    }


def main() -> int:
    args = parse_args()
    ensure_benchmark_binary(args.rebuild_binary)

    run_id = datetime.now().strftime("%Y-%m-%dT%H-%M-%S-%f")
    run_dir = OUTPUT_ROOT / run_id

    fixture_root: Path
    fixture_stats: FixtureStats | None
    temp_dir: tempfile.TemporaryDirectory[str] | None = None

    if args.root is not None:
        fixture_root = args.root.resolve()
        fixture_stats = None
    else:
        temp_dir = tempfile.TemporaryDirectory(prefix="cdrivecleaner-full-scan-stress-")
        fixture_root = Path(temp_dir.name) / "stress-root"
        fixture_root.mkdir(parents=True, exist_ok=True)
        fixture_stats = build_fixture_tree(fixture_root, args)

    fixture_key = build_fixture_key(fixture_root, args)
    previous_report = load_previous_report_for_root(fixture_key, args.compare_to_label)

    benchmark = run_benchmark(fixture_root, args)
    issues = build_issues(benchmark, args.scan_warn_ms, args.expand_warn_ms)
    issue_values: list[JSONValue] = [issue for issue in issues]
    expand_summary = build_expand_summary(
        ensure_mapping_list(benchmark.get("expand", []), "benchmark.expand")
    )
    report: ReportDict = {
        "runId": run_id,
        "label": args.label,
        "fixtureKey": fixture_key,
        "fixtureRoot": str(fixture_root),
        "fixtureStats": (
            {"directories": None, "files": None, "bytes": None}
            if fixture_stats is None
            else asdict(fixture_stats)
        ),
        "thresholds": {
            "scanWarnMs": args.scan_warn_ms,
            "expandWarnMs": args.expand_warn_ms,
        },
        "benchmark": benchmark,
        "expandSummary": expand_summary,
        "issues": issue_values,
    }
    comparison = build_comparison(report, previous_report)
    if comparison is not None:
        report["comparison"] = comparison
    summary_row = build_summary_csv_row(report)
    history_rows = [
        row for row in load_history_rows() if row.get("fixtureKey") == fixture_key
    ]
    history_rows = [
        row for row in history_rows if row.get("runId") != summary_row["runId"]
    ]
    history_rows.append(summary_row)
    aggregate_summary = build_aggregate_summary(history_rows)
    if aggregate_summary is not None:
        report["aggregateSummary"] = aggregate_summary
    markdown = markdown_report(report)
    write_reports(run_dir, report, markdown)

    print(markdown)
    print(f"\nJSON report: {run_dir / 'report.json'}")
    print(f"Summary CSV: {run_dir / 'summary.csv'}")
    print(f"Expand CSV: {run_dir / 'expand-targets.csv'}")

    if temp_dir is not None and args.keep_fixture:
        kept_root = run_dir / "fixture-root"
        if kept_root.exists():
            shutil.rmtree(kept_root)
        _ = shutil.copytree(fixture_root, kept_root)
        print(f"Fixture copied to: {kept_root}")

    if temp_dir is not None:
        temp_dir.cleanup()

    return 1 if issues else 0


if __name__ == "__main__":
    raise SystemExit(main())
