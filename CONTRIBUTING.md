# Contributing

Thanks for your interest in contributing to `CDriveCleaner`.

## Development basics

- Install dependencies with `pnpm install`
- On a clean machine, install the Playwright browser once with `pnpm --filter desktop exec playwright install chromium`
- Run desktop tests with `pnpm test`
- Run desktop build with `pnpm build`
- Run end-to-end UI validation with `pnpm e2e`
- Run Rust tests with `cargo test --workspace`

Portable Windows packaging notes:

- `pnpm --filter desktop tauri:build:portable` expects `LLVM_MINGW_BIN` to point at an `llvm-mingw` `bin` directory for runtime DLL staging.
- Runtime history / export data defaults to `LOCALAPPDATA\\CDriveCleaner`; a best-effort migration from the legacy `LOCALAPPDATA\\CDriveCleanerGreenfield` path happens automatically when no override env vars are set.

## Expected workflow

1. Open an issue or discussion for large changes.
2. Keep pull requests focused and reviewable.
3. Run the relevant tests before opening a PR.
4. Update docs when behavior, UX, or workflows change.

## Scope notes

- The current project is centered on Windows cleanup workflows.
- Safety and explainability matter more than aggressive deletion automation.
- Performance regressions around full-scan trees should be treated seriously.

## Pull request checklist

- Code builds locally.
- Relevant tests pass.
- Docs are updated if needed.
- No generated local artifacts are included unintentionally.

## Communication

Please be specific about:

- what changed
- why it changed
- how you verified it
