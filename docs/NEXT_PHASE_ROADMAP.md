# CDriveCleaner Next-Phase Roadmap

## Goal

Turn the current Rust + Tauri + React app from a late-MVP feature baseline into a release-ready daily-use product without weakening the existing safety model.

## Status note

- The baseline slices that originally motivated Phases 1-5 now exist in the desktop app in at least an initial shipped form: Settings persists theme/locale and result preferences, Results supports sorting/export/treemap/top-file-top-path review, History export is wired, and a bounded scheduled scan plan exists.
- Read the phase sections below as deepening and hardening tracks, not as a list of untouched feature gaps.

The roadmap below follows the current product constraints:

- scan-before-clean remains mandatory
- frontend does not own raw filesystem cleanup logic
- scheduled automation must stay within bounded safe scopes
- analysis features should build on the existing full-scan tree instead of introducing a parallel model

## Recommended next tranche

1. Verification hardening around `pnpm e2e` and `pnpm qa:full-regression`
2. CLI parity for category selection, machine-friendly status codes, and log output
3. Contract / fixture coverage for newer desktop flows such as export, scheduled plans, and full-scan tree workflows
4. Packaging, signing, and release automation
5. Deeper polish for the already-shipped desktop UX slices
6. Scheduled cleanup only after the earlier hardening work proves stable

## Why this order now

- `Verification hardening` comes first because the desktop already spans scan, clean, export, full-scan analysis, and scheduled scan flows.
- `CLI parity` is still behind the shared core and desktop shell, so automation semantics need to catch up before the product can feel complete.
- `Contract coverage` keeps the rewrite anchored to explicit schemas as the desktop surface grows.
- `Packaging/signing` should follow once behavior and regression confidence are stable.
- `UX polish` remains valuable, but it should refine already-shipped slices instead of hiding core release gaps.
- `Scheduled cleanup` is still the highest trust-risk item and should stay last.

## How to read the remaining phases

The phase breakdown below is still useful as a product map, but most of these slices now have working implementations. Use each phase as a checklist for polish, hardening, and remaining gaps rather than assuming the feature is absent.

## Phase status overview

### Largely complete

- Phase 1: Settings + Persistence Foundation
- Phase 2: Result Sorting + Top-File / Top-Path Preview
- Phase 3: Scan / History Export

### Active hardening / polish

- Phase 4: Treemap / Large-File Analysis View
- Phase 5: Scheduled Scan (Safe Scope Only)

### Not started by design

- Phase 6: Scheduled Cleanup (Optional, Last)

## Phase 1: Settings + Persistence Foundation (`Largely complete`)

### Product goal

Make the app feel stateful and repeatable across launches.

### Current state

- Theme, locale, category filter, prepared selections, results workspace memory, and list-result sort already persist in the desktop shell.
- The remaining work in this phase is mostly preference-schema hardening and keeping session-only state boundaries explicit.

### Scope

- Keep persisted locale selection reliable across releases
- Keep theme preference support reliable across releases
- Preserve and evolve the UI-level preferences that already fit the product:
  - category filters
  - prepared category selections
  - results workspace preference (`resultsMode` / `lastListResultsMode`)
- Keep `fullScanQuery` session-scoped because it only filters nodes already loaded into the in-memory full-scan tree
- Keep Settings responsible for:
  - theme
  - language
  - version
  - log location

### Existing foundations

- `apps/desktop/src/pages/SettingsPage.tsx` now exposes theme, language, version, and log location
- `apps/desktop/src/state/appState.ts` now persists locale, theme, category filter, prepared categories, and results workspace preferences in Zustand
- `apps/desktop/src/lib/i18n.ts` already includes the current Settings copy and result-workspace labels
- `docs/CURRENT_ARCHITECTURE.md` already defines Settings as owning theme, language, version, and log location

### Main files likely involved

- `apps/desktop/src/state/appState.ts`
- `apps/desktop/src/pages/SettingsPage.tsx`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/styles.css`
- `apps/desktop/src/lib/i18n.ts`
- `apps/desktop/src-tauri/src/lib.rs` (only if version/log path are surfaced from backend)

### Implementation notes

- Prefer a lightweight persisted UI preference store before adding more settings UI
- Keep the stored schema explicit and versionable
- Treat version and log location as display-only initially; they do not need a full settings backend model
- Do not persist `fullScanQuery` until full-scan data itself becomes durable; loaded-node filtering is session-only by design

### Acceptance criteria

- Locale survives restart
- Theme survives restart
- Category filter survives restart
- Prepared category selections survive restart
- Results workspace preference survives restart
- Loaded-tree search remains session-only and resets with each in-memory full-scan session
- Settings page shows theme, language, version, and log location clearly
- No filesystem cleanup behavior changes as part of this phase

## Phase 2: Result Sorting + Top-File / Top-Path Preview (`Largely complete`)

### Product goal

Make scan results easier to inspect before the user decides to clean or delete anything.

### Current state

- Category result sorting and loaded-tree top-file / top-path review already exist in Results.
- The remaining work here is polish: keep large-tree performance healthy and improve explainability without changing cleanup semantics.

### Scope

- Keep sortable list results for category-based scans stable
- Keep read-only top-file / top-path previews from full-scan results stable
- Preserve result ordering options such as:
  - reclaimable bytes
  - candidate file count
  - warning severity / risk emphasis
- Keep the existing list-results sort preference persistence healthy
- Preserve current warning and confirmation behavior

### Existing foundations

- `apps/desktop/src/pages/ResultsPage.tsx` already supports multiple result modes and detail panels
- `apps/desktop/src/lib/fullScanTree.ts` already computes `largestChildren` and tree summaries
- `apps/desktop/src/lib/warnings.ts` already provides warning sorting/grouping behavior
- `docs/TECHNICAL_DESIGN.md` and `docs/IMPLEMENTATION_PLAN.md` already mention result sorting and top-file/path preview as intended UX

### Main files likely involved

- `apps/desktop/src/pages/ResultsPage.tsx`
- `apps/desktop/src/lib/fullScanTree.ts`
- `apps/desktop/src/lib/warnings.ts`
- `apps/desktop/src/state/appState.ts`
- `apps/desktop/src/lib/i18n.ts`
- possibly `apps/desktop/src/components/` if preview widgets are extracted

### Implementation notes

- Keep this phase read-only from a cleanup-policy perspective
- Build previews from current full-scan tree data instead of adding new scan commands
- Keep `listResultsSort` persisted through the existing Zustand preference store
- Keep top-file / top-path preview explicitly limited to currently loaded descendants until more of the full tree is materialized client-side

### Acceptance criteria

- Category results can be sorted without changing cleanup semantics
- The selected list sort preference survives restart
- Full-scan results expose top-file/top-path summaries for the selected context
- Existing delete preview / confirmation flows still behave the same
- Large-tree performance remains acceptable after the extra result UI is added

## Phase 3: Scan / History Export (`Largely complete`)

### Product goal

Let users carry scan and history results out of the app for review, comparison, or support.

### Current state

- JSON export for scan results and history is already wired through the desktop shell and shared core.
- The main remaining question is whether extra export surfaces such as CSV are worth the maintenance cost.

### Scope

- Keep export of current scan results reliable
- Keep export of history entries reliable
- Continue with stable machine-friendly formats:
  - JSON first
  - CSV second if useful for spreadsheet workflows

### Existing foundations

- `crates/core` already persists history
- `apps/desktop/src/pages/HistoryPage.tsx` already displays history entries
- `apps/desktop/src/lib/contracts.ts` already defines scan and history response shapes
- `docs/CURRENT_ARCHITECTURE.md` already names `export_scan_report` and `export_history` as intended backend commands

### Main files likely involved

- `apps/desktop/src/pages/HistoryPage.tsx`
- `apps/desktop/src/pages/ResultsPage.tsx`
- `apps/desktop/src/lib/api.ts`
- `apps/desktop/src-tauri/src/lib.rs`
- `crates/core/src/lib.rs`
- `contracts/schemas/*.json`

### Implementation notes

- Export the same data the user is reviewing, not a hidden alternate report model
- Prefer explicit filenames with timestamps
- Avoid implying rollback or recovery; exports are records, not undo points

### Acceptance criteria

- User can export the current scan result from Results
- User can export history from History page
- Export payloads match current contract semantics
- Exported output remains valid for both English and Chinese UI sessions

## Phase 4: Treemap / Large-File Analysis View (`Active hardening / polish`)

### Product goal

Give users a faster visual answer to "what is using my space?" and complement the existing full-scan tree.

### Current state

- A read-only loaded-tree treemap plus large-file / large-path analysis already ships in Results.
- The next step is to deepen drill-down, hover context, and usability polish without creating a parallel scan model.

### Scope

- Add a treemap or equivalent rectangular storage view
- Add a dedicated large-file / large-path analysis surface
- Support drill-down from summary into tree context

### Existing foundations

- `scan_full_tree` and `expand_full_scan_node` already provide hierarchical size data
- `FullScanTreeNode` already includes `sizeBytes`, warnings, and children
- `apps/desktop/src/lib/fullScanTree.ts` already computes summary data from the tree
- Competitor research shows treemap + drill-down + top-list pairing is the baseline expectation
- Initial shipped slice already adds a read-only loaded-tree treemap and large-file/path analysis surface in Results; future work can deepen this with hover details and richer drill-down

### Main files likely involved

- `apps/desktop/src/pages/ResultsPage.tsx`
- `apps/desktop/src/lib/fullScanTree.ts`
- `apps/desktop/src/components/`
- `apps/desktop/src/styles.css`
- possibly new visualization-focused helper modules

### Implementation notes

- Start with a rectangular treemap, drill-down, and hover details
- Reuse full-scan data already loaded by the app
- Keep delete actions routed through the existing preview / confirmation flow

### Acceptance criteria

- User can identify top storage consumers more quickly than with the tree alone
- Treemap and large-file analysis stay in sync with the current full-scan result
- Visualization does not bypass existing warning and preview surfaces

## Phase 5: Scheduled Scan (Safe Scope Only) (`Active hardening / polish`)

### Product goal

Turn the app from an occasional manual cleaner into a repeatable maintenance tool without introducing unattended deletion risk.

### Current state

- The desktop app already supports a bounded persisted scheduled scan plan and Windows Task Scheduler registration.
- The remaining work is operational hardening: clearer audit surfaces, stronger admin-category labeling, and confidence around real-world schedule behavior.

### Scope

- Schedule scan-only jobs for:
  - safe defaults
  - explicit prepared presets
- Show next run / last run state in UI
- Log scheduled executions into existing history if appropriate

### Existing foundations

- `docs/PRD.md` explicitly positions the CLI as usable for scripting and scheduled use
- Category presets already exist in `CategoriesPage`
- History persistence already exists in core
- Elevation analysis already exists and can gate admin-only plans
- Initial shipped slice now includes a single daily bounded scan plan backed by persisted plan state and Windows Task Scheduler registration through the desktop executable

### Main files likely involved

- `apps/desktop/src/pages/SettingsPage.tsx`
- `apps/desktop/src/pages/HistoryPage.tsx`
- `apps/desktop/src/state/appState.ts`
- `apps/desktop/src-tauri/src/lib.rs`
- `crates/core/src/lib.rs`
- platform-specific scheduling integration (likely Windows Task Scheduler wrapper)

### Implementation notes

- Keep this phase scan-only
- Only schedule bounded plans: safe defaults or a saved prepared preset
- Surface clearly when a scheduled plan contains admin-required categories
- Do not schedule raw-path or full-scan deletion actions

### Acceptance criteria

- User can create, inspect, enable, and disable a scheduled scan plan
- Scheduled runs are visible in the product history or audit surface
- Admin-required plans are clearly labeled and never silently downgrade behavior

## Phase 6: Scheduled Cleanup (Optional, Last) (`Not started by design`)

### Product goal

Only if the earlier phases prove stable and the product direction explicitly supports unattended cleanup.

### Current state

- Treat this as intentionally deferred work. The repo should not imply that unattended cleanup is already in flight.

### Scope

- Limited scheduled cleanup for:
  - safe defaults only, or
  - a tightly bounded prepared preset with explicit trust language

### Why it is last

- It creates the highest trust and safety risk
- It raises stale-state questions: the user may be approving a plan long before execution
- It interacts heavily with elevation, warnings, and audit expectations

### Acceptance criteria

- Cleanup automation remains bounded and understandable
- Scheduled cleanup never expands into arbitrary path deletion or full-scan tree deletion
- Audit trail is explicit enough that users can understand what ran and why

## What should stay out of scope for now

- Registry cleaning
- Arbitrary raw-path cleanup in the main category workflow
- Secure wipe / free-space wipe
- Defrag / trim / system tuning bundles
- Broad privacy-suite behavior such as deep cookie/history scrubbing beyond the current bounded cleanup model

## Suggested delivery grouping

### Group A: Release confidence

- Verification hardening around `pnpm e2e` and `pnpm qa:full-regression`
- CLI parity and machine-friendly automation semantics
- Contract / fixture coverage for export, scheduled-plan, and full-scan tree flows

This group closes the biggest confidence gap between the shared core, desktop shell, and release workflow.

### Group B: Ship readiness

- Packaging, signing, and release automation
- Phase 4 polish for treemap / large-file analysis
- Phase 5 polish for bounded scheduled scans

This group makes the existing product surface easier to trust, distribute, and operate.

### Group C: Optional trust-heavy expansion

- Phase 6

Only take this on if the product intentionally shifts toward more hands-off cleanup.
