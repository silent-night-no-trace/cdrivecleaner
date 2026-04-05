# Versioning and Release Policy

## Current baseline

- Workspace Rust version: `0.1.0`
- Desktop package version: `0.1.0`
- Tauri app version: `0.1.0`
- Current `CHANGELOG.md` entry `0.1.0` represents the repository baseline, not a signed public release.

## First formal public release target

The recommended first formal public release target is:

- `v0.2.0`

### Why `0.2.0` instead of `0.1.0`

- `0.1.0` is already being used as the internal baseline across the workspace.
- The repository has not yet shipped a signed public release, installer, or release automation baseline.
- Moving to `0.2.0` cleanly distinguishes the current internal baseline from the first externally announced release milestone.

## Recommended release sequence

1. `0.1.0`
   - Internal repository baseline
   - No claim of broad public distribution
2. `0.2.0-rc.1`, `0.2.0-rc.2`, ...
   - Public release candidates if external testing starts before the first stable release
3. `0.2.0`
   - First formal public release

## Version bump rules

Before `1.0.0`, use these practical rules:

- `patch` (`0.2.1`)
  - bug fixes
  - packaging/build fixes
  - docs-only corrections that do not change product scope
  - test/tooling fixes without meaningful user-visible capability changes
- `minor` (`0.3.0`)
  - meaningful user-facing workflow additions
  - CLI parity improvements that affect public capability
  - export/contract growth that external users or integrators should notice
  - release workflow changes that materially change how the project is consumed
- `pre-release` (`0.2.0-rc.1`)
  - public validation stage before the next minor release

## Files that must stay in sync

When cutting the first formal public release, update these together:

- `Cargo.toml` → `[workspace.package].version`
- `apps/desktop/package.json` → `version`
- `apps/desktop/src-tauri/tauri.conf.json` → `version`
- `CHANGELOG.md`
- `README.md`
- `README.zh-CN.md`
- Release notes / Git tag

## Release gates for `v0.2.0`

The first public release should not be tagged until these are true:

- `pnpm test` passes
- `pnpm build` passes
- `pnpm e2e` passes
- `cargo test --workspace` passes
- `pnpm qa:full-regression` is healthy on the maintainer machine
- README screenshots and installation instructions are current
- Basic CI is green
- Public repo policies are in place (`LICENSE`, `CONTRIBUTING`, `CODE_OF_CONDUCT`, `SECURITY`)
- Packaging/signing posture is explicitly documented, even if signing is still pending

## Tagging and release note conventions

- Git tags should use the form `v0.2.0`
- Pre-releases should use the form `v0.2.0-rc.1`
- `CHANGELOG.md` should be updated before creating the tag
- Public release notes should summarize:
  - product capabilities
  - known limitations
  - platform scope
  - verification status

## Practical note for the current repo

Until the first public release is actually cut, keep treating `0.1.0` as a repository baseline rather than a public promise of stability.
