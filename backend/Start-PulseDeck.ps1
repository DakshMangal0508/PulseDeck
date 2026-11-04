$ErrorActionPreference = 'Stop'

$backendRoot = $PSScriptRoot
$workspaceRoot = Split-Path -Parent $backendRoot
$python = Join-Path $workspaceRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) {
    $python = Join-Path $backendRoot '.venv\Scripts\python.exe'
}

if (-not (Test-Path -LiteralPath $python)) {
    throw "PulseDeck's virtual environment was not found. Run the setup commands in README.md first."
}

$listener = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
if ($listener) {
    Write-Output "PulseDeck is already listening on port 8000 (PID $($listener.OwningProcess))."
    exit 0
}

Start-Process -FilePath $python `
    -ArgumentList 'Server.py' `
    -WorkingDirectory $backendRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $backendRoot 'backend.log') `
    -RedirectStandardError (Join-Path $backendRoot 'backend-error.log')

Write-Output 'PulseDeck started in the background at http://localhost:8000.'
