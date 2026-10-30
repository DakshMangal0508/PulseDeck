# PulseDeck

PulseDeck is a React control panel for Spotify playback, Discord voice controls, approved keyboard shortcuts, Windows audio volume, and app launching. The FastAPI host runs on the Windows PC and serves the built interface to that PC or a phone on the same trusted network. When a Spotify track changes, the host can request album artwork from Apple's iTunes Search API and caches the result in memory.

## Requirements

- Windows 10/11
- Python 3.10 or newer
- Node.js 18 or newer

## Build and run PulseDeck

Build the web interface once, then start the small Windows host from PowerShell in this folder:

```powershell
py -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
npm install
npm run build
.venv\Scripts\python.exe Server.py
```

The host serves the built interface and its API on port 8000, so the Vite development server does not need to run. On first visit, create the PC's single account with a username and a password of at least 10 characters. The account is stored on that PC; sign in with the same credentials from your phone.

Keep the host running in your signed-in Windows session. To start it in the background so it stays up after closing VS Code, run `Start-PulseDeck.ps1` from this folder in PowerShell. It starts the host hidden and writes output to `backend.log` and `backend-error.log`. If PowerShell blocks the script, run `.venv\Scripts\python.exe Server.py` in a PowerShell window instead. You can then use PulseDeck at `http://localhost:8000` (or from your phone on the same network). Run the host again after signing in to Windows; Windows media and volume controls require it to run as your signed-in user, not as a Windows service.

The host still accepts only the shortcuts listed in `validation.py`, known media actions, and Windows audio session identifiers returned by the status endpoint, plus the master volume target. The Volume mixer lists apps that currently have an active Windows audio session; an app disappears when its session stops producing audio.

The track card and transport buttons use Spotify's Windows media session for track metadata and playback commands. Artwork comes from the media session when available, with an iTunes Search lookup fallback. If Windows does not expose Spotify's media session, the host can read metadata from Spotify's window title and send Windows media keys while Spotify is running. Run the host in the signed-in desktop session; restricted or service-run processes cannot access the user's media session.

The Discord panel detects the Discord desktop process and sends the Windows chords for Toggle Mute (`Caps Lock+Tab`) and Toggle Deafen (`Ctrl+Alt+Shift+F11`). Configure matching Discord desktop keybind actions under **User Settings > Keybinds**. PulseDeck restores the Caps Lock state after sending the mute chord and shows active button feedback after a panel click. The host cannot confirm that Discord handled the chord. An optional Discord bot reads voice state so changes made directly in Discord can also update the panel. The bot needs outbound HTTPS access to `discord.com` and access to your member's voice channel. When you are in a monitored server voice channel, the panel also offers **Disconnect from voice**; the bot needs **Move Members** permission in that server to disconnect your configured user.

### Enable Discord voice status

1. Create your own Discord application in the [Discord Developer Portal](https://discord.com/developers/applications), then open its **Bot** page and add a bot. PulseDeck needs this private helper bot; you do not need to find or add a public third-party bot.
2. On the **Bot** page, enable **Server Members Intent**. PulseDeck uses the bot to find your member and read voice-state updates. Discord describes this as a privileged intent; for a small personal bot you can enable it in the Developer Portal.
3. Invite the bot to each server where you use voice. In the install/OAuth2 settings, use the `bot` scope and grant **View Channels**. Also grant **Move Members** if you want the Disconnect button to work. The bot does not need **Connect** or **Speak**; it will not join or listen to the call. You need permission to manage the server to add the bot.
4. In Discord, enable Developer Mode and copy your user ID. In the same PowerShell session used to start the host, set:

```powershell
$env:PULSEDECK_DISCORD_BOT_TOKEN = "paste-the-bot-token-here"
$env:PULSEDECK_DISCORD_USER_ID = "your-discord-user-id"
```

Restart `Server.py` from that PowerShell session. For example, after stopping the old host, run `Start-PulseDeck.ps1` there so the hidden server inherits those two environment variables. When the bot can see your configured account in a server voice channel, the Discord panel appears with its controls and participant list. **Move Members** is required only for disconnecting you. Keep the bot token private. Direct-message and group-call voice participants are not available through this bot integration.

Album artwork is optional. The host sends the artist and track title to Apple's iTunes Search API when it first sees a track; it caches successful lookups in memory and retries failed or empty lookups after five minutes. Artwork lookup needs internet access, but status and controls continue to work if the lookup fails.

## Connect your phone on the same Wi-Fi

1. Connect your phone and PC to the same trusted Wi-Fi network.
2. Find the PC's IPv4 address with `ipconfig` in PowerShell.
3. On the phone, open `http://<PC-IP>:8000` (for example, `http://192.168.1.15:8000`).
4. Create the account on first use, then sign in. The account password is hashed and stored in the PC's local PulseDeck data folder.

The PC must stay awake and connected to Wi-Fi while you use the phone controls.

If Windows Firewall prompts you, allow Python on **private networks only**. The host binds to all network interfaces for same-Wi-Fi access. Do not forward port 8000 from your router or use the app on an untrusted public Wi-Fi network: local HTTP does not encrypt the password or control traffic.

During development, `npm run dev -- --host 0.0.0.0` is still available. For phone access to that development page, add its exact origin (including the PC's IP and port 5173) to `PULSEDECK_ALLOWED_ORIGINS` before starting `Server.py`.

Use the header controls to switch between dark and light themes and between the Lucide and Phosphor shortcut icon packs. Both preferences are saved in that browser. The dark canvas is plum (`#15011d`) with an orange signal accent; the light canvas is pale blue-violet (`#d2ddff`) with a purple accent. The browser theme color follows the selected theme.

Use **Manage** beside the workspace tabs to rename the selected profile, edit or remove its shortcut cards, and set app names for automatic profile switching. **Add profile** creates another workspace. Profile edits are saved in that browser's local storage. Shortcut actions are chosen from the host's approved list in `validation.py`; arbitrary key sequences are intentionally not accepted by the host.

The **Open apps** pane launches built-in apps and shortcuts discovered from the host's Windows Start Menu. Select **Edit**, then **Add app** to choose another entry; the app list comes from the host and your selected launcher list is saved in that browser. Built-in launch requests use a fixed application allowlist; Start Menu entries launch only their discovered shortcut.

## Network security

PulseDeck uses a local account and session token. The LAN connection uses plain HTTP, so account credentials and commands are not encrypted in transit. Use a trusted, firewalled private network, keep the first account credentials private, and never expose port 8000 to the public internet.

## Troubleshooting

- **Phone cannot connect:** confirm the phone and PC are on the same Wi-Fi, open the PC's current IPv4 address on port 8000, and allow Python through Windows Firewall on private networks.
- **Sign-in required again:** restart the server and sign in again; active sessions are cleared when the host restarts.
- **Page not found:** run `npm run build` before starting the host.
- **App volume is unavailable:** start audio in that app so Windows creates an active audio session.
- **Discord voice status does not update:** check that the bot token and user ID are set, Server Members Intent is enabled, the bot can view the server voice channel, and the host can make outbound TCP connections to `discord.com` on port 443. A firewall, endpoint security product, VPN, or managed network may block that connection. Mute/deafen keybinds must also be configured in Discord.

## Checks

```powershell
npm run check
```

This builds the frontend and runs the backend payload validation unit tests.

