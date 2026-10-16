# PulseDeck

PulseDeck is a React control panel for media keys, approved keyboard shortcuts, and Windows audio volume. The FastAPI host runs on the Windows PC; open the Vite frontend from that PC or another device on the same trusted network. When a Spotify track changes, the host can request album artwork from Apple's iTunes Search API and caches the result in memory.

## Requirements

- Windows 10/11
- Python 3.10 or newer
- Node.js 18 or newer

## Start the Windows host

In PowerShell, from this folder:

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
$pulseDeckToken = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:PULSEDECK_API_TOKEN = $pulseDeckToken
Write-Host "PulseDeck token: $pulseDeckToken"
$env:PULSEDECK_ALLOWED_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"
python Server.py
```

Keep the token printed in PowerShell available for the browser. Paste it into the **Host token** field in PulseDeck. The token is saved in that browser's local storage. If you close the terminal, generate a new token and restart the host.

The host requires the token for status reads and actions. It accepts only the shortcuts listed in `validation.py`, known media actions, and Windows audio session identifiers returned by the status endpoint, plus the master volume target. The Audio Mix panel lists apps that currently have an active Windows audio session; an app disappears when its session stops producing audio.

The track card and transport buttons use Spotify's Windows media session for track metadata and playback commands. Artwork comes from the media session when available, with an iTunes Search lookup fallback. If Windows does not expose Spotify's media session, the host can read metadata from Spotify's window title and send playback keys only while Spotify is focused. Run the host in the signed-in desktop session; restricted or service-run processes cannot access the user's media session.

The Discord panel detects the Discord desktop process and sends the Windows chords for Toggle Mute (`Ctrl+Shift+M`) and Toggle Deafen (`Ctrl+Shift+D`). For background operation, configure these as Discord desktop keybind actions under **User Settings > Keybinds**. The host can send the chord but cannot confirm Discord handled it. The active voice channel and participant list are read by an optional Discord bot connection, not from the desktop client's private data.

### Enable Discord voice status

1. Create a Discord application and bot in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Under **Bot**, enable the **Server Members Intent**. Install the bot into each server whose voice channels you want to monitor, granting it **View Channels** access. It does not need permission to connect to or speak in voice channels.
3. In Discord, enable Developer Mode and copy your user ID. In the same PowerShell session used to start the host, set:

```powershell
$env:PULSEDECK_DISCORD_BOT_TOKEN = "paste-the-bot-token-here"
$env:PULSEDECK_DISCORD_USER_ID = "your-discord-user-id"
```

Restart `Server.py`. The host then watches voice-state updates in servers where the bot is installed and shows the matching user's current server voice channel and participants. The panel refreshes from the host status endpoint. Keep the bot token private. Direct-message and group-call voice participants are not available through this bot integration.

Album artwork is optional. The host sends the artist and track title to Apple's iTunes Search API when it first sees a track; it caches successful lookups in memory and retries failed or empty lookups after five minutes. Artwork lookup needs internet access, but status and controls continue to work if the lookup fails.

## Start the frontend

In a second PowerShell terminal from this folder:

```powershell
npm install
npm run dev -- --host 0.0.0.0
```

Open the Vite URL in a browser. The frontend connects to port 8000 on the same hostname used to open the page.

Use the header controls to switch between dark and light themes and between the Lucide and Phosphor shortcut icon packs. Both preferences are saved in that browser.

For phone access, use the laptop's LAN IP in the frontend URL and allow that exact origin in the host environment before starting `Server.py`:

```powershell
$env:PULSEDECK_ALLOWED_ORIGINS = "http://192.168.1.15:5173"
```

Replace the example IP with the laptop's current address. You can include multiple exact origins as a comma-separated list. The host binds to all interfaces for LAN access; use Windows Firewall to limit port 8000 to your private network.

## Network security

PulseDeck uses a shared API token and an exact CORS origin allowlist. The development host uses plain HTTP, so the token and commands are not encrypted on the network. Use it only on a trusted, firewalled network. Do not expose port 8000 to the public internet; use HTTPS through a properly configured reverse proxy if remote access is needed.

## Troubleshooting

- **Host token required:** set `PULSEDECK_API_TOKEN` in the same PowerShell terminal before running `python Server.py`, then paste that value into the UI.
- **Token rejected:** the UI token and current server token must match. Clear the field and paste the current value again.
- **Browser reports the host offline:** confirm both processes are running, use `http://` for the Vite page, and verify that Windows Firewall allows port 8000 on the private network.
- **Browser reports an origin error:** add the exact page origin (scheme, host, and port) to `PULSEDECK_ALLOWED_ORIGINS`, then restart the host.
- **App volume is unavailable:** start audio in that app so Windows creates an active audio session.

## Checks

```powershell
npm run check
```

This builds the frontend and runs the backend payload validation unit tests.
