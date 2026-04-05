# Rust Spike

This repository now includes a minimal Rust spike under `rust_spike/fs-cleaner/`.

## Goal

Validate the lowest-risk Rust boundary for CDriveCleaner without touching the shipping Python CLI or Qt GUI.

## Shape

- Standalone Rust CLI, not a Python extension module
- JSON over stdin/stdout
- Scope limited to directory scan/delete behavior
- No production integration yet

## Request / Response

### Scan request

```json
{
  "action": "scan",
  "path": "C:\\Temp",
  "filters": {
    "patterns": ["*.tmp", "*.log"]
  }
}
```

### Scan response

```json
{
  "files": [
    { "path": "C:\\Temp\\trace.log", "size": 128 }
  ],
  "total_size": 128,
  "count": 1
}
```

### Delete request

```json
{
  "action": "delete",
  "paths": ["C:\\Temp\\trace.log"],
  "dry_run": false
}
```

### Delete response

```json
{
  "deleted": 1,
  "failed": []
}
```

## Why this boundary

- Keeps Python GUI and orchestration unchanged
- Avoids PyO3 or ABI coupling during the first spike
- Makes parity testing possible with subprocess calls and fixture directories
- Gives a realistic path for later filesystem-engine replacement below `coordinator.py`

## Local validation

This environment does not currently have `cargo` or `rustc`, so the spike could not be compiled here.

When a Rust toolchain is available, validate with:

```powershell
cargo test --manifest-path .\rust_spike\fs-cleaner\Cargo.toml
cargo build --release --manifest-path .\rust_spike\fs-cleaner\Cargo.toml
```
