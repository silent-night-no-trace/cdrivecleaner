@echo off
setlocal
set "RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnullvm"
set "CARGO_BUILD_TARGET=x86_64-pc-windows-gnullvm"

if defined CARGO_HOME (
  set "PATH=%CARGO_HOME%\bin;%PATH%"
)

if defined LLVM_MINGW_BIN (
  set "PATH=%LLVM_MINGW_BIN%;%PATH%"
)

if "%~1"=="" (
  echo Environment initialized for CDriveCleaner gnullvm build.
  echo Usage:
  echo   .\cdrivecleaner-build-env.cmd pnpm tauri:build:portable
  echo.
  echo Notes:
  echo   - Set LLVM_MINGW_BIN to the llvm-mingw bin directory if you need runtime DLL staging.
  exit /b 0
)

%*
exit /b %ERRORLEVEL%
