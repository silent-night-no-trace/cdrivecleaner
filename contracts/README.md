# Canonical Contracts

These files define the semantic contracts for the current Rust-based implementation.

## Purpose

- Freeze the domain language before implementation drifts
- Normalize payload shapes to camelCase for the new app boundary
- Preserve old behavior without dragging old code forward

## Fixtures

- `categories.json`: category metadata registry payload
- `scan-safe-default.json`: canonical scan response for a controlled safe-default fixture case
- `clean-safe-default.json`: canonical cleanup response for a controlled safe-default fixture case
- `elevation.json`: canonical admin-elevation response
- `history.json`: canonical persisted history response

The canonical location for category metadata is `contracts/fixtures/categories.json`. Do not duplicate the exported payload at the repository root.

## Schema policy

- Frontend/backend contracts use camelCase
- Category IDs remain stable identifiers across the old and new implementations
- Old Python CLI envelopes may be transformed before comparison; these fixtures describe the current contract surface, not the old transport wrapper verbatim
