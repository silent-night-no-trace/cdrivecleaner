from __future__ import annotations

import os
from pathlib import Path
from shutil import copy2


llvm_mingw_env = os.environ.get("LLVM_MINGW_BIN")
if not llvm_mingw_env:
    raise RuntimeError(
        "LLVM_MINGW_BIN is not set. Point it at the llvm-mingw 'bin' directory "
        "(it must contain libunwind.dll and libwinpthread-1.dll)."
    )

LLVM_MINGW_BIN = Path(llvm_mingw_env)
TARGET_DIR = Path(__file__).resolve().parents[1] / "target"
EXECUTABLE_NAME = "cdrivecleaner-desktop.exe"
WEBVIEW_LOADER_NAME = "WebView2Loader.dll"
PORTABLE_DIR = TARGET_DIR / "portable" / "cdrivecleaner-desktop"

# Keep this intentionally small: copy only the runtime DLLs that the current gnullvm build
# has proven to need at execution time, plus the common MinGW pthread runtime.
RUNTIME_DLLS = [
    "libunwind.dll",
    "libwinpthread-1.dll",
]


def release_directories() -> list[Path]:
    candidates = {TARGET_DIR / "release"}

    for executable in TARGET_DIR.rglob(EXECUTABLE_NAME):
        if executable.parent.name == "release":
            candidates.add(executable.parent)

    return sorted(candidates)


def portable_source_directory(release_dirs: list[Path]) -> Path | None:
    for release_dir in release_dirs:
        if (release_dir / EXECUTABLE_NAME).exists():
            return release_dir
    return None


def main() -> int:
    release_dirs = release_directories()
    staged_targets: list[Path] = []

    for release_dir in release_dirs:
        release_dir.mkdir(parents=True, exist_ok=True)
        for dll_name in RUNTIME_DLLS:
            source = LLVM_MINGW_BIN / dll_name
            target = release_dir / dll_name
            if not source.exists():
                raise FileNotFoundError(f"Missing runtime DLL: {source}")
            copy2(source, target)
        staged_targets.append(release_dir)

    source_dir = portable_source_directory(release_dirs)
    if source_dir is not None:
        PORTABLE_DIR.mkdir(parents=True, exist_ok=True)
        for file_name in [EXECUTABLE_NAME, WEBVIEW_LOADER_NAME, *RUNTIME_DLLS]:
            source = source_dir / file_name
            if not source.exists():
                raise FileNotFoundError(f"Missing portable runtime file: {source}")
            copy2(source, PORTABLE_DIR / file_name)

    print("Staged runtime DLLs into:")
    for release_dir in staged_targets:
        print(f"- {release_dir}")
        for dll_name in RUNTIME_DLLS:
            print(f"  - {dll_name}")
    if source_dir is not None:
        print(f"Portable folder ready at: {PORTABLE_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
