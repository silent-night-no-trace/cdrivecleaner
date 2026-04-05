# CDriveCleaner Implementation Plan

## Delivery strategy

Build the shared Rust core first, ship the CLI second, and evolve the Tauri desktop shell after the command contracts and cleanup semantics are stable.

## Current status snapshot

- The workspace has moved beyond the original MVP sequencing: the Rust + Tauri + React shell already includes Home, Results, Categories, History, and Settings flows.
- Milestones 1-4 are largely represented in code today, including persisted desktop preferences, list-result sorting, full-scan tree analysis, export flows, and bounded scheduled scan plan management.
- Milestone 5 is only partially complete: elevation plumbing and scheduled scan support exist, but CLI automation parity, packaging/signing, and release automation are still open.
- The practical next tranche is release hardening: keep `pnpm e2e` healthy, finish CLI status-code/logging work, widen contract validation, and add Windows packaging/signing automation.

## Milestones

### Milestone 1: Core safety foundation

- Finalize category registry shape
- Add path-root enforcement helpers
- Ignore reparse points during traversal
- Add scan and cleanup result models
- Add unit tests for root validation and category metadata

### Milestone 2: MVP cleanup categories

- Finish `user-temp`
- Finish `windows-temp`
- Finish `thumbnail-cache`
- Decide whether `recycle-bin` should stay estimate-free in MVP or gain a Shell-based size estimate
- Refine Windows Error Reporting cleanup coverage beyond the initial queue and archive roots

### Milestone 3: CLI

- Harden argument parsing
- Add plain text output
- Expand JSON output with summary totals and machine-friendly status codes
- Add exit codes for partial failure and admin-required cases
- Add per-run log file output
- Keep invalid category IDs and admin-required states explicit for automation

### Milestone 4: GUI

- Replace the simple shell with a richer result grid
- Add category descriptions and warnings panel
- Add progress state and cancellation
- Add admin-required badges and relaunch prompt
- Persist GUI preferences such as language, theme, category filters, prepared selections, results workspace memory, and list sort preference
- Add runtime Chinese/English switching, sidebar search, and category filters without moving business logic out of the shared core
- Keep loaded-tree search session-only until full-scan data itself is durable across launches
- Add quick actions for safe defaults, result sorting, and recommendation summaries while keeping scan/clean orchestration in the shared coordinator

### Milestone 4B: Desktop UX refinement

- Polish the Settings, Results, Categories, and History flows in the Tauri shell
- Add explainability-oriented desktop affordances such as top-file/path preview, stronger review summaries, and keyboard shortcuts
- Keep desktop-only UX work inside React/Tauri while preserving the shared Rust core as the semantic source of truth

### Milestone 5: Elevation and packaging

- Implement self-relaunch or elevated helper path
- Restrict elevated executor to category IDs
- Publish self-contained Tauri desktop and CLI binaries
- Add Windows installer, signing, and optional `winget` manifest
- Reuse the shared elevation analysis helper from both CLI and desktop shell
- Keep packaged relaunch hints aligned with the actual executable name in packaged Tauri builds

## Suggested atomic commits

1. `docs: define MVP scope and technical design`
2. `core: add cleanup models and category registry`
3. `core: add safe directory scanning and path validation`
4. `cli: add list scan clean commands`
5. `gui: add initial Windows desktop shell`
6. `tests: add registry and path safety coverage`
7. `core: add logging and admin execution flow`

## Current validation commands

- `pnpm test`
- `pnpm build`
- `pnpm e2e`
- `pnpm qa:full-regression`
- `cargo test --workspace`

## Verification checkpoints

### After Milestone 1

- Core unit tests pass
- Path helper rejects escape paths

### After Milestone 2

- Scan and cleanup succeed on test temp directories
- Locked files are skipped, not fatal

### After Milestone 3

- `list`, `scan`, and `clean --all-safe` behave consistently
- CLI returns non-zero when a category fails

### After Milestone 4

- GUI displays the same categories as the CLI
- GUI scan results match CLI estimates on the same machine

### After Milestone 5

- Admin-only categories trigger elevation
- Non-admin categories remain runnable without UAC prompts

## Risks to track

- False-positive cleanup if category roots are widened casually
- Windows temp access differences between admin and standard users
- Browser cache adapters becoming fragile across version changes
- Advanced Microsoft cleanup commands taking a long time or changing system state
