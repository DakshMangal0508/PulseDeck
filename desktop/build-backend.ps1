$ErrorActionPreference = 'Stop'

$desktopRoot = $PSScriptRoot
$projectRoot = Split-Path -Parent $desktopRoot
$python = Join-Path $projectRoot '.venv\Scripts\python.exe'
$server = Join-Path $projectRoot 'backend\Server.py'
$dist = Join-Path $desktopRoot 'backend-dist'
$work = Join-Path $desktopRoot 'build'

if (-not (Test-Path -LiteralPath $python)) {
    throw "PulseDeck's project virtual environment was not found: $python"
}
if (-not (Test-Path -LiteralPath $server)) {
    throw "PulseDeck's backend was not found: $server"
}

& $python -m PyInstaller `
    --noconfirm `
    --clean `
    --onedir `
    --noconsole `
    --name PulseDeckHost `
    --distpath $dist `
    --workpath $work `
    --specpath $desktopRoot `
    --paths (Join-Path $projectRoot 'backend') `
    --collect-all winrt `
    --collect-all discord `
    --collect-all pycaw `
    $server

if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller failed with exit code $LASTEXITCODE"
}

Write-Output "Packaged PulseDeck backend at $(Join-Path $dist 'PulseDeckHost')"
