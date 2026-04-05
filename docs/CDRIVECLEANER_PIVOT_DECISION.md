# CDriveCleaner Implementation Direction Note

## Direction

The project no longer treats the Python + PySide6 desktop shell as the primary long-term product implementation.

The preferred direction is the current Rust + Tauri + React implementation with:

- Rust core
- Tauri 2 desktop shell
- React + TypeScript frontend
- Strict typed UI/core boundary through Tauri commands

## Why this direction changed

The Python project is still valuable, but mainly as a reference implementation for domain behavior.

It remains useful for:

- category semantics
- cleanup safety rules
- CLI behavior
- elevation behavior
- acceptance tests and fixtures

It is no longer the preferred foundation for the long-term product shell because the current Rust + Tauri + React stack provides a better path for UI quality, performance, and architectural consistency.

## What this means in practice

### Stop treating these as the future product direction

- `docs/archive/CDRIVECLEANER_V2_REBOOT_PLAN.md`
- legacy internal reboot planning notes
- further Python GUI controller extraction as the main roadmap

These remain useful as fallback and architectural learning artifacts, but they are not the recommended primary path anymore.

### Treat these as the new primary direction

- `docs/CURRENT_ARCHITECTURE.md`
- the current Rust/Tauri implementation plan and active roadmap docs

## Non-goals for this direction

- Do not build a separate localhost backend service unless a later requirement proves it necessary
- Do not port Python GUI code file-by-file
- Do not widen product scope before the new MVP exists

## Recommended operating model

1. Freeze the current Python repo as a semantic oracle
2. Define canonical request/response fixtures from the existing app behavior
3. Build the Rust core and CLI first
4. Build the Tauri/React shell second
5. Compare against the Python app only for parity and quality benchmarks

## Final note

This document records an implementation-direction change, not a claim that the Python code is unusable.

The Python code proved the domain.
The current Rust + Tauri + React stack should ship the product.
