$ErrorActionPreference = 'Stop'

& (Join-Path $PSScriptRoot 'Start-PulseDeck.ps1')

$url = 'http://localhost:8000'
$deadline = (Get-Date).AddSeconds(15)
while ((Get-Date) -lt $deadline) {
    try {
        Invoke-WebRequest -Uri "$url/api/auth/status" -TimeoutSec 2 -UseBasicParsing | Out-Null
        Start-Process $url
        exit 0
    } catch {
        Start-Sleep -Milliseconds 500
    }
}

Start-Process $url
