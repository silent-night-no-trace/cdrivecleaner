# CDriveCleaner PRD

## Product goal

Build a small Windows 10/11 cleanup utility focused on reclaiming space from the system drive, with both a GUI executable and a CLI executable backed by the same cleanup engine.

## Problem statement

Windows users often lose C drive space to temporary files, stale caches, thumbnails, error reports, and update-related leftovers. Existing tools are frequently too aggressive, too opaque, or too broad. The product should make it easy to identify reclaimable space, explain the risk of each cleanup category, and run only bounded cleanup actions.

## Target users

- Power users who want a lightweight local cleaner
- Developers and IT-minded users who want a scriptable CLI
- General Windows users who prefer a guided GUI flow

## Non-goals

- Registry cleaning
- Arbitrary folder deletion
- System tuning or debloating
- Driver cleanup, restore-point deletion, or hibernation tuning in MVP

## Success criteria

- Users can run a scan and see estimated reclaimable space per category
- Users can clean safe categories without reading documentation first
- GUI and CLI produce consistent category definitions and execution behavior
- Admin privileges are only requested when the selected categories require them

## MVP feature set

### Included

- Scan all registered cleanup categories
- Show category name, description, risk tier, privilege requirement, and estimated size
- Clean selected categories
- Persist a local text log for each run
- Provide a CLI for scripting and scheduled use
- Provide a GUI for interactive use

### MVP categories

- User temp files
- Windows temp files
- Thumbnail cache
- Current-user Windows Error Reporting queue, archive, and temp data
- Recycle Bin, off by default and clearly confirmed

### Deferred categories

- Delivery Optimization cache
- Browser-specific cache adapters
- `cleanmgr` presets
- `DISM /StartComponentCleanup`
- Scheduled cleanup policies
- MSI or `winget` packaging automation

## UX principles

- Show scan results before any delete action
- Label each category with a clear risk tier
- Require explicit user confirmation for irreversible categories like Recycle Bin
- Explain when admin rights are needed and why
- Report partial success instead of failing the whole run when some files are in use

## CLI requirements

- `list` to enumerate categories
- `scan` to inspect selected categories or all categories
- `clean` to execute selected categories
- `--all-safe` to select the safe default set
- `--json` for machine-readable output
- Stable CLI exit codes for success, failure, invalid input, and admin-required states

## GUI requirements

- Load categories from the shared registry
- Show reclaimable size after a scan
- Allow multi-select cleanup execution
- Surface warnings, execution status, and freed-space totals

## Execution semantics

- Recycle Bin scan should estimate size for the current user on the system drive before cleanup
- Admin-only categories should fail with an explicit status when launched without elevation
- Unknown category IDs should be treated as invalid input, not silently ignored

## Security constraints

- The cleanup engine must enumerate files itself from known roots
- The privileged path must only accept category IDs, never raw paths
- The engine must ignore junctions and other reparse-point escapes
- The product must skip in-use files rather than forcing deletion

## Rollout plan

### Phase 1

- Core registry, scanning model, safe deletion helpers, CLI, and tests

### Phase 2

- GUI shell and progress reporting

### Phase 3

- Admin-only categories and elevated execution path

### Phase 4

- Advanced Microsoft cleanup adapters and richer reporting
