@echo off
setlocal
set "RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnullvm"
set "CARGO_BUILD_TARGET=x86_64-pc-windows-gnullvm"
if defined LLVM_MINGW_BIN (
  set "PATH=%LLVM_MINGW_BIN%;%PATH%"
)
pnpm tauri:build:portable
exit /b %ERRORLEVEL%
