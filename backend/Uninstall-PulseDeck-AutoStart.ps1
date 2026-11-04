$ErrorActionPreference = 'Stop'
Unregister-ScheduledTask -TaskName 'PulseDeck' -Confirm:$false -ErrorAction SilentlyContinue
Write-Output 'PulseDeck automatic startup has been removed.'
