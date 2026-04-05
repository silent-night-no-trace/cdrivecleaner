param(
    [Parameter(Mandatory = $true)]
    [string]$Executable,
    [string]$CargoHome,
    [string]$RustupHome,
    [string]$Toolchain = 'stable-x86_64-pc-windows-gnullvm',
    [string]$LlvmMingwBin = $env:LLVM_MINGW_BIN,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
)

if ($CargoHome) {
    $env:CARGO_HOME = $CargoHome
    $env:PATH = "$CargoHome\bin;" + $env:PATH
}

if ($RustupHome) {
    $env:RUSTUP_HOME = $RustupHome
}

if ($Toolchain) {
    $env:RUSTUP_TOOLCHAIN = $Toolchain
}

if ($LlvmMingwBin) {
    $env:PATH = "$LlvmMingwBin;" + $env:PATH
}

if (-not $Executable) {
    throw 'Provide an executable to run inside the portable Rust environment.'
}

& $Executable @Arguments
exit $LASTEXITCODE
