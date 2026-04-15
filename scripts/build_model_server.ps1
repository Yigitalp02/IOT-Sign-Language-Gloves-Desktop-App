# Build the model server exe (called automatically by `pnpm build` via prebuild hook).
# Requires the iot-sign-glove/.venv to exist with all packages installed.
# Run manually once if you want to rebuild without a full app build:
#   powershell -ExecutionPolicy Bypass -File scripts\build_model_server.ps1

$ProjectRoot  = Split-Path -Parent $PSScriptRoot
$VenvPython   = Join-Path $ProjectRoot "iot-sign-glove\.venv\Scripts\python.exe"
$BuildScript  = Join-Path $ProjectRoot "iot-sign-glove\build_model_server.py"
# --onedir output: a directory, not a single file
$OutDir       = Join-Path $ProjectRoot "iot-sign-glove\dist\serve_local_model_one"
$DestDir      = Join-Path $ProjectRoot "src-tauri\resources\model-server"

Write-Host ""
Write-Host "=== Model Server Build ===" -ForegroundColor Cyan

if (!(Test-Path $VenvPython)) {
    Write-Host "WARNING: Python venv not found at $VenvPython" -ForegroundColor Yellow
    Write-Host "         Skipping model server build (dev-mode fallback will be used)." -ForegroundColor Yellow
    Write-Host "         To enable bundled server, run:"
    Write-Host "           cd iot-sign-glove"
    Write-Host "           python -m venv .venv"
    Write-Host "           .\.venv\Scripts\python.exe -m pip install -r requirements.txt"
    Write-Host ""
    exit 0   # non-fatal – the app still works in dev mode
}

Write-Host "Python: $VenvPython"
Write-Host "Script: $BuildScript"
Write-Host ""

& $VenvPython $BuildScript
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Model server build failed (exit $LASTEXITCODE)." -ForegroundColor Red
    Write-Host "       The Tauri app will fall back to the .venv Python at runtime." -ForegroundColor Yellow
    exit 0   # non-fatal
}

if (Test-Path $OutDir) {
    Write-Host "Built: $OutDir\" -ForegroundColor Green
    # build_model_server.py already copied to src-tauri/resources/model-server/
    if (Test-Path $DestDir) {
        Write-Host "Installed to: $DestDir\" -ForegroundColor Green
    }
} else {
    Write-Host "WARNING: Expected output not found at $OutDir" -ForegroundColor Yellow
}
Write-Host ""
