$ErrorActionPreference = 'Stop'

$projectRoot = $PSScriptRoot
$launcher = Join-Path $projectRoot 'Start-PulseDeck.ps1'
if (-not (Test-Path -LiteralPath $launcher)) {
    throw "PulseDeck launcher was not found: $launcher"
}

$taskName = 'PulseDeck'
$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description 'Starts the PulseDeck host in the signed-in Windows session.' `
    -Force | Out-Null

Write-Output "PulseDeck will start when $env:USERNAME signs in to Windows."
