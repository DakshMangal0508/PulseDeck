$ErrorActionPreference = 'Stop'

$projectRoot = $PSScriptRoot
$python = Join-Path $projectRoot '.venv\Scripts\python.exe'

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
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $projectRoot 'backend.log') `
    -RedirectStandardError (Join-Path $projectRoot 'backend-error.log')

Write-Output 'PulseDeck started in the background at http://localhost:8000.'
