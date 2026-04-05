# CDriveCleaner Current Architecture

## Decision

Start a new implementation from 0 to 1.

Do not continue investing in the existing Python desktop shell as the main product direction.

The new implementation should use explicit frontend-backend separation so UI quality, state ownership, and system execution concerns are naturally isolated.

## Why pivot now

The current repository has valuable logic, but the user experience and architecture direction are no longer aligned with the product goal.

The Python codebase proves several things well:

- The cleanup domain model is valid
- The CLI contract is valid
- The category and safety rules are valid
- The elevation boundary is valid

But the current stack is a poor fit if the priority order becomes:

1. Better UI quality
2. Stronger long-term maintainability
3. Clear frontend-backend separation
4. Better runtime performance and packaging

That combination points away from Python + Qt as the primary product stack.

## Recommended stack

### Frontend

- Tauri shell
- React + TypeScript
- Zustand for app state
- TanStack Query only if async backend calls become numerous
- App-local CSS plus lightweight shared desktop UI primitives

### Backend

- Rust
- Tokio for async orchestration only if needed later
- Serde for request/response contracts
- Walkdir and standard filesystem APIs for scanning and deletion primitives
- Explicit command handlers for scan, clean, preview, history, and diagnostics

### Packaging

- Windows-first Tauri build
- MSI/NSIS packaging
- Signed executable path planned early

## Why this stack

### Compared with staying on Python + Qt

- Better UI ceiling
- Cleaner separation between interaction layer and system layer
- Smaller runtime footprint and cleaner packaging path
- Stronger long-term architecture for a product that wants polished desktop UX

### Compared with Electron

- Better performance and smaller bundle size
- Stronger system-layer language for filesystem and safety-sensitive work
- More appropriate for a local Windows tool than a Chromium-heavy shell

### Compared with C#/.NET

- C# remains a valid Windows-only option, but this proposal favors a stronger separation between a modern web-style frontend and a native systems backend
- If the priority is native Windows integration above all else, C#/.NET should be reconsidered
- If the priority is frontend flexibility plus strong backend safety, Tauri + Rust is the better fit

## Architecture boundaries

### Frontend owns

- Navigation and page composition
- User-facing state and interaction flow
- Result presentation and filtering
- Selection workflow
- History and export initiation
- Localization and theming
- Persisted UI preferences such as locale, theme, category filters, prepared selections, and results workspace memory
- Session-scoped loaded-tree search (`fullScanQuery`) because it only applies to currently loaded full-scan nodes

### Backend owns

- Category registry and metadata
- Scan execution
- Cleanup execution
- Preview path generation
- Elevation analysis
- Audit/history persistence
- Safety enforcement
- Command validation

### Shared contract owns

- Category metadata schema
- Scan result schema
- Clean result schema
- Error and warning schema
- History entry schema
- Capability schema for admin-required actions

## Transport model

Use typed Tauri commands with strict request/response models.

Current backend commands exposed by the desktop shell include:

- `list_categories`
- `get_history`
- `get_settings_metadata`
- `get_scheduled_scan_plan`
- `save_scheduled_scan_plan`
- `set_scheduled_scan_plan_enabled`
- `delete_scheduled_scan_plan`
- `export_scan_report`
- `export_history`
- `analyze_elevation`
- `restart_as_administrator`
- `scan_safe_defaults`
- `scan_categories`
- `clean_safe_defaults`
- `clean_categories`
- `scan_full_tree`
- `expand_full_scan_node`

No raw path deletion commands should exist in the frontend API.

The backend must continue to accept category IDs and internally own all filesystem traversal.

The current desktop implementation also exposes bounded selected-path preview/delete commands for already-loaded full-scan nodes. Treat that area as an implementation hardening hotspot until the architecture rule and implementation are reconciled explicitly.

## Product surface for the current v1 direction

### Page 1: Home

- Safe reclaim summary
- Last scan summary
- Quick scan
- Quick clean when fresh scan exists
- Short trust indicators only

### Page 2: Results

- Main results table
- Detail panel
- Risk/admin/warnings surface
- Clean selected
- Export scan report
- Full-scan analysis surface with treemap / large-file context over already-loaded tree data

### Page 3: Categories

- Search
- Filter
- Grouping
- Selection presets

### Page 4: History

- Recent operations
- Export history
- Failure/warning visibility

### Page 5: Settings

- Theme
- Language
- Version
- Log location
- Bounded scheduled scan plan management

### Current desktop preference boundary

- Persisted in `appState`: locale, theme, category filter, prepared category selections, `resultsMode`, `lastListResultsMode`, and `listResultsSort`
- Intentionally session-only: `fullScanQuery`, because its filter semantics depend on whichever nodes are currently loaded into the in-memory full-scan tree
- Full-scan preview affordances such as top-file / top-path summaries are also limited to whatever descendants are currently loaded into the in-memory tree

### Current status snapshot

- The desktop shell already includes Home, Results, Categories, History, and Settings as active pages.
- Results already ships list sorting, export actions, full-scan tree workflows, treemap analysis, and top-file / top-path review over loaded tree data.
- Settings already ships theme/language preferences, version/log metadata, and bounded scheduled scan plan management.
- The current rewrite should therefore be treated as a late-MVP / pre-release-hardening codebase rather than an early architecture spike.

## Reuse policy from the existing repo

Do not copy the current Python GUI design directly.

Do reuse these as reference assets:

- Category definitions and semantics
- CLI output semantics
- Elevation decision rules
- Test scenarios and acceptance logic
- Safety constraints and path rules

This is a semantic migration, not a file migration.

## Delivery strategy

### Phase 0: semantic freeze

- Freeze current domain semantics from the Python project
- Write canonical JSON schemas for categories, scan results, clean results, and history

### Phase 1: backend MVP

- Build Rust category registry and models
- Implement scan for safe-default categories first
- Implement cleanup for safe-default categories first
- Implement preview generation and history persistence
- Implement elevation analysis

### Phase 2: frontend MVP

- Build Home and Results first
- Wire typed backend commands
- Add clear empty, loading, success, and warning states

### Phase 3: advanced workflow pages

- Categories page
- History page
- Settings page

### Phase 4: parity and packaging

- Verify category parity with the old repo
- Verify scan/clean parity on fixture directories
- Add Windows packaging and signing pipeline

## Acceptance criteria

The current Rust + Tauri + React direction is correct only if:

1. Frontend never owns filesystem deletion logic
2. Backend never trusts raw paths from the UI
3. Scan-before-clean remains mandatory
4. Safe-default flow is clearer than in the Python version
5. Result review is the dominant user decision surface
6. UI state ownership is explicit and page-local where possible
7. Packaging and startup are visibly better than the Python build path

## Risks

- Rust + Tauri is a bigger up-front build cost than continuing Python
- The rewrite must not drift into rebuilding every old feature before MVP ships
- If the team lacks Rust frontend/backend discipline, separation alone will not save the architecture
- The current rewrite can regress domain rules unless the old repo is treated as a semantic oracle

## Recommendation

If the product priority has shifted to polished UX, stronger architectural separation, and better runtime quality, the current rewrite direction is justified.

The recommended direction is:

- New repo or new top-level application for the product shell
- Tauri + React + TypeScript frontend
- Rust backend with strict command contracts
- Existing Python repository kept as a semantic reference and test oracle during migration
