param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Command
)

$ErrorActionPreference = 'Stop'

$cargoHome = $env:CARGO_HOME
$rustupHome = $env:RUSTUP_HOME
$llvmMingwBin = $env:LLVM_MINGW_BIN

# Prefer llvm-mingw tools first so windres/linking tools are deterministic.
$pathPrefix = @()
if ($cargoHome) {
  $env:CARGO_HOME = $cargoHome
  $pathPrefix += "$cargoHome\bin"
}
if ($llvmMingwBin) {
  if (-not (Test-Path $llvmMingwBin)) {
    throw "LLVM_MINGW_BIN is set but does not exist: $llvmMingwBin"
  }
  $pathPrefix += $llvmMingwBin
}
if ($pathPrefix.Count -gt 0) {
  $env:PATH = ($pathPrefix -join ';') + ";$env:PATH"
}
if ($rustupHome) {
  $env:RUSTUP_HOME = $rustupHome
}

$env:RUSTUP_TOOLCHAIN = 'stable-x86_64-pc-windows-gnullvm'
$env:CARGO_BUILD_TARGET = 'x86_64-pc-windows-gnullvm'

if (-not $Command -or $Command.Count -eq 0) {
  Write-Host 'Environment initialized for CDriveCleaner gnullvm build.'
  Write-Host 'Usage:'
  Write-Host '  pwsh -File .\cdrivecleaner-build-env.ps1 pnpm tauri:build:portable'
  Write-Host ''
  Write-Host 'Notes:'
  Write-Host '  - Set LLVM_MINGW_BIN to the llvm-mingw bin directory if you need runtime DLL staging.'
  exit 0
}

$cmd = $Command -join ' '
Write-Host "> $cmd"
Invoke-Expression $cmd
