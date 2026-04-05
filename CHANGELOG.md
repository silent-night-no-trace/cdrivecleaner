# Changelog

All notable changes to this project will be documented in this file.

The format is inspired by Keep a Changelog, but this repository is still in a pre-release hardening phase and has not yet published a formal public release.

Versioning policy for the first formal public release is documented in `docs/VERSIONING_AND_RELEASE_POLICY.en.md`.

## [Unreleased]

### Added

- Root MIT `LICENSE`
- Bilingual public-facing `README.md` / `README.zh-CN.md`
- Contribution, code of conduct, and security policy documents in English and Chinese
- Open-source readiness and current status snapshot documents
- Benchmark reporting improvements including CSV outputs and aggregate summaries
- Full-scan tree performance improvements across merge, search, indexing, and windowed rendering paths
- Windows CI coverage for the desktop e2e self-test plus artifact upload for UI run outputs

### Changed

- Root workspace package name aligned from a legacy internal name to `cdrivecleaner`
- Public documentation language cleaned up to reduce internal-only wording
- Repository baseline prepared for future public open-source publication
- Default local app data directory renamed to `CDriveCleaner` with best-effort migration from the legacy folder name
- Portable Windows build helpers now rely on `LLVM_MINGW_BIN` / PATH instead of machine-local absolute toolchain paths

## [0.1.0] - 2026-04-04

### Added

- Initial Rust + Tauri + React workspace baseline
- Desktop app shell with Home, Results, Categories, History, and Settings flows
- Shared Rust core, CLI utilities, contracts, regression tooling, and full-scan stress harness

### Notes

- This entry represents the current repository baseline rather than a signed public release.
