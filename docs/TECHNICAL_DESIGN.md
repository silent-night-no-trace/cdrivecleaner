# CDriveCleaner Technical Design

> Legacy Python semantic/core design reference.
> Current primary product architecture lives under `docs/CURRENT_ARCHITECTURE.md` and the current workspace root.
> Current validation commands live under `README.md` and `docs/IMPLEMENTATION_PLAN.md`; do not treat the testing or packaging sections in this file as the active Rust + Tauri workflow.

## Architecture summary

The legacy Python implementation uses one shared Python package and two thin frontends.

- `cdrivecleaner/`: category definitions, scan and clean orchestration, path safety, elevation analysis, logging contracts
- `cdrivecleaner/cli.py`: argument parsing and terminal rendering
- `archive/legacy_python_shell/cdrivecleaner/gui_qt.py`: archived PySide6 Fluent-style desktop UI over the same shared core

## Core design

### Category registry

Each cleanup category is a first-class object with the following metadata:

- Stable ID
- Display name
- Short description
- Risk tier
- `RequiresAdmin`
- `IncludedInSafeDefaults`
- Supported OS notes
- Scan implementation
- Cleanup implementation

This keeps GUI and CLI behavior aligned and makes it safe to add more categories later.

### Execution flow

1. Load the category registry
2. Select categories
3. Scan selected categories
4. Present reclaimable-space estimate
5. Re-validate selected categories immediately before cleanup
6. Execute category cleanup and record per-category results

## Safety model

### Path safety rules

- Every file operation starts from a fixed allowlisted root
- Reparse points are ignored to avoid escaping the intended subtree
- Files are only deleted if the resolved full path still belongs to the allowed root set
- Access denied and file-in-use failures are treated as skip events, not fatal errors

### Risk tiers

- `SafeDefault`: cache or temp data that users reasonably expect can be removed
- `SafeButAdmin`: bounded system cleanup that requires elevation
- `Advanced`: heavier or slower operations that should stay out of MVP

## Privilege separation

The first iteration keeps scanning non-elevated. When the selected categories include admin-only operations, the product should relaunch the cleanup execution path with elevation. The elevated path should accept only category IDs and should perform its own enumeration. It must never trust a precomputed manifest from the non-elevated process.

The shared core now exposes an elevation analysis helper so both CLI and GUI can decide whether the selected categories can run immediately or need a privileged relaunch path.

## Logging

Each run should generate:

- Start time and selected categories
- Scan results
- Cleanup result per category
- Number of deleted files
- Bytes reclaimed
- Warnings and skipped items

The core should emit run events through an interface, while each host decides whether to write those events to disk, show them in the UI, or ignore them.

The archived Qt GUI used category metadata such as group labels, badges, and safety notes to render a richer desktop dashboard without changing the scan/clean core contract.

The localization boundary for that Python GUI pass was explicit: GUI strings and GUI-presented category labels could switch between English and Chinese at runtime, while CLI output remained stable English so existing JSON/automation behavior did not drift.

The latest archived GUI pass added purely presentational affordances on top of the shared core: quick actions for safe defaults, client-side result sorting, and a top-reclaimable summary. These remained GUI-only concerns and did not alter CLI JSON contracts.

The packaged `cleaner-gui` entry targeted the Qt GUI directly in the archived Python shell; the older Tk GUI had already been removed from that path.

The archived Qt GUI went beyond parity basics by adding category preview and top-file/path preview in the details area. These previews remained read-only UI affordances layered over the existing category/root definitions and did not change cleanup policy or CLI contracts.

## Testing strategy

### Unit tests

- Registry contains expected safe default categories
- Admin flags are set correctly
- Path helper rejects paths outside allowed roots

### Integration tests

- Temp-folder scan returns non-negative results
- Cleanup skips locked files without aborting the category
- Junctions are ignored during scan and delete

### Manual tests

- Windows 10 non-admin scan
- Windows 11 non-admin scan
- Admin cleanup of system temp
- Non-admin `clean` of `windows-temp` returns the admin-required status without deleting anything
- archived GUI scan, select, clean flow
- CLI `list`, `scan`, and `clean --all-safe`

## Packaging

Recommended first Python release outputs were:

- `cleaner.exe` built from the Python CLI
- `cleaner-gui.exe` built from the Python GUI

Suggested packaging path:

```powershell
pyinstaller --onefile -n cleaner -m cdrivecleaner.cli
pyinstaller --onefile -n cleaner-gui -m archive.legacy_python_shell.cdrivecleaner.gui_qt
```

The archived Python shell includes dedicated PyInstaller spec files and wrapper entry scripts under `archive/legacy_python_shell/packaging/` so packaged executables could launch through absolute package imports instead of raw module-relative entry files.

## Open design decisions for the next iteration

- Whether to add a dedicated elevated helper project or use self-relaunch
- Whether to store logs in `%LocalAppData%` or beside the executable
- Whether browser caches should be first-party adapters or opt-in plugins
