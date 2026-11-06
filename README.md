# PulseDeck

PulseDeck is a React control panel for Spotify playback, Discord voice controls, approved keyboard shortcuts, Windows audio volume, and app launching. The frontend and FastAPI backend live in separate folders and can be built and deployed independently. The backend still needs a signed-in Windows desktop to control Windows audio, apps, and keys. When a Spotify track changes, the host can request album artwork from Apple's iTunes Search API and caches the result in memory.

## Repository layout

- `frontend/` — React, Vite, and static-host build files.
- `backend/` — FastAPI server, Windows integrations, Python requirements, and its launcher scripts.
- `backend/Server.py` serves `frontend/dist` when it exists, so the combined local setup remains available.

## Requirements

- Windows 10/11
- Python 3.10 or newer
- Node.js 18 or newer

## Build and run PulseDeck

From the repository root, install backend dependencies and build the frontend:

```powershell
py -m venv .venv
.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
Push-Location frontend
npm ci
npm run build
Pop-Location
.venv\Scripts\python.exe backend\Server.py
```

For local use, the backend serves the built interface and API on port 8000. PulseDeck opens a separate account page for setup and sign-in. Create the single account there the first time with a username and a password of at least 10 characters. The PC remembers its sign-in across Windows restarts. For a split deployment, remote first-time account setup is disabled by default; enable it with `PULSEDECK_ALLOW_REMOTE_SETUP=true` only while setting up a private deployment.

Keep the backend running in your signed-in Windows session. To start it hidden, run `backend\Start-PulseDeck.ps1`; logs go to `backend\backend.log` and `backend\backend-error.log`. To start it at Windows sign-in, run `backend\Install-PulseDeck-AutoStart.ps1`; remove the task with `backend\Uninstall-PulseDeck-AutoStart.ps1`. The app is available at `http://localhost:8000` and, on the same trusted network, from your phone. Windows media and volume controls require the backend to run as your signed-in user, not as a Windows service.

## Windows desktop app (Tauri v2)

The Tauri v2 Windows app has been built and installed for the current Windows user. Open **PulseDeck** from the Start menu; on first launch, create the local PulseDeck account. The app starts its bundled backend and opens the dashboard with a left-side connected phone panel beside the PulseDeck controls. The current QR-linked browser can report pairing/online status only; battery, network details, and a user-shared wallpaper preview depend on the future phone app.

To rebuild the Windows installer, install Rust with the MSVC toolchain, the Visual Studio C++ Build Tools and Windows SDK, then install the Tauri CLI with `cargo install tauri-cli --version "^2" --locked`. From `desktop/`, run `cargo tauri dev` for development or `cargo tauri build` to create the NSIS installer. Installer signing and optional Windows sign-in startup remain later setup work.

## Deploy the frontend and backend separately

### Frontend

Deploy the `frontend/` folder as a static site. Use `npm ci` as the install command and `npm run build` as the build command; publish `dist/`. Set `VITE_API_BASE_URL` to the backend's HTTPS URL, for example `https://api.example.com`. The static host must rewrite `/account` and other non-file paths to `/index.html` for client-side routing. A sample variable file is in `frontend/.env.example`.

### Backend

Deploy the `backend/` folder to a **Windows host or Windows VM** that runs in the signed-in desktop session. This backend uses Windows APIs for audio, keyboard, app launching, and media controls, so a generic Linux Python container cannot provide those features. Set `PULSEDECK_ALLOWED_ORIGINS` to the exact frontend origin (scheme and host), `PULSEDECK_FRONTEND_URL` to the public frontend URL, and `PULSEDECK_ALLOW_REMOTE_SETUP=true` if the first account will be created through the separately hosted frontend. Add other comma-separated frontend origins if needed. A sample is in `backend/.env.example`; configure these values in the platform's environment settings.

Mount persistent storage and set `PULSEDECK_DATA_DIR` to it. PulseDeck stores the account database, OAuth refresh tokens, and uploaded sounds there; ephemeral storage loses them when the service is replaced. Use HTTPS for both sites and keep the backend private behind an authenticated HTTPS proxy or VPN. A public frontend calling a plain HTTP backend will be blocked by browsers as mixed content.

For Spotify OAuth, set `PULSEDECK_SPOTIFY_REDIRECT_URI` to `https://api.example.com/api/spotify/callback` and register that exact URL in the Spotify Developer Dashboard. 
The host still accepts only the shortcuts listed in `backend/validation.py`, known media actions, and Windows audio session identifiers returned by the status endpoint, plus the master volume target. The Volume mixer lists apps that currently have an active Windows audio session; an app disappears when its session stops producing audio.

### Account recovery

PulseDeck stores a salted password hash in its local SQLite account database; it never stores the account password in plaintext. For the installed Windows app, SMTP settings live in `%LOCALAPPDATA%\com.pulsedeck.desktop\PulseDeck\.env`. PulseDeck creates a Gmail-ready template there the first time it starts. Set `PULSEDECK_SMTP_USERNAME` and `PULSEDECK_SMTP_FROM` to your Gmail address, and `PULSEDECK_SMTP_PASSWORD` to a Google app password. Keep that app password in this local file; do not commit or share it. Restart PulseDeck after saving.

For Gmail, enable 2-Step Verification on the Google account and create an app password. Use `smtp.gmail.com`, port `587`, `PULSEDECK_SMTP_USE_SSL=false`, and `PULSEDECK_SMTP_STARTTLS=true`. Google may hide app passwords for accounts using certain security configurations. `PULSEDECK_FRONTEND_URL` must be the reachable frontend URL so email links open the correct site; for local use, leave it unset to use the backend URL.

New accounts can add an optional recovery email during setup. Existing users can sign in on the PC, open **Connection → Recovery email**, and verify an address. From then on, **Forgot password?** emails a one-time link that expires in 30 minutes; using it signs out existing devices. If email recovery is unavailable, the password can only be reset locally from the PC running PulseDeck.

The track card and transport buttons use Spotify's Windows media session for track metadata and playback commands. Artwork comes from the media session when available, with an iTunes Search lookup fallback. If Windows does not expose Spotify's media session, the host can read metadata from Spotify's window title and send Windows media keys while Spotify is running. Run the host in the signed-in desktop session; restricted or service-run processes cannot access the user's media session.

### Optional Spotify Web API connection

The Spotify Web API can provide current-track metadata and playback controls when the Windows media session is unavailable. Create an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), add `http://127.0.0.1:8000/api/spotify/callback` as its redirect URI for local use, then set these variables in the PowerShell session that starts PulseDeck:

```powershell
$env:PULSEDECK_SPOTIFY_CLIENT_ID = "your-client-id"
$env:PULSEDECK_SPOTIFY_CLIENT_SECRET = "your-client-secret"
```

For a separate deployment, use the public HTTPS callback described above. Restart the host, open PulseDeck, and choose **Connect** on the Spotify card. Approve the requested playback read and control access. PulseDeck stores the refresh token in its data directory and refreshes access tokens automatically. Keep the client secret private. Spotify account and app restrictions may apply to playback controls.


### Discord mute and deafen

Discord mute and deafen use keyboard shortcuts and do not require Discord authorization. In Discord **Settings → Keybinds**, set **Toggle Mute** to `Caps Lock + Tab` and **Toggle Deafen** to `Ctrl + Alt + Shift + F11`. Leave Discord open on the PC running PulseDeck. The buttons send these shortcuts; Discord does not report the resulting state unless the optional voice status bot is configured.

### Optional Discord voice status

1. Create your own Discord application in the [Discord Developer Portal](https://discord.com/developers/applications), then open its **Bot** page and add a bot. PulseDeck needs this private helper bot; you do not need to find or add a public third-party bot.
2. On the **Bot** page, enable **Server Members Intent**. PulseDeck uses the bot to find your member and read voice-state updates. Discord describes this as a privileged intent; for a small personal bot you can enable it in the Developer Portal.
3. Invite the bot to each server where you use voice. In the install/OAuth2 settings, use the `bot` scope and grant **View Channels**. Also grant **Move Members** if you want the Disconnect button to work. The bot does not need **Connect** or **Speak**; it will not join or listen to the call. You need permission to manage the server to add the bot.
4. In Discord, enable Developer Mode and copy your user ID. In the same PowerShell session used to start the host, set:

```powershell
$env:PULSEDECK_DISCORD_BOT_TOKEN = "paste-the-bot-token-here"
$env:PULSEDECK_DISCORD_USER_ID = "your-discord-user-id"
```

Restart the backend from that PowerShell session. For example, after stopping the old host, run `backend\Start-PulseDeck.ps1` there so the hidden server inherits those two environment variables. When the bot can see your configured account in a server voice channel, the Discord panel appears with its controls and participant list. **Move Members** is required only for disconnecting you. Keep the bot token private. Direct-message and group-call voice participants are not available through this bot integration.

Album artwork is optional. The host sends the artist and track title to Apple's iTunes Search API when it first sees a track; it caches successful lookups in memory and retries failed or empty lookups after five minutes. Artwork lookup needs internet access, but status and controls continue to work if the lookup fails.

## Connect your phone on the same Wi-Fi

1. Connect your phone and PC to the same trusted Wi-Fi network.
2. On the PC, create the account the first time, then sign in. The PC remembers its sign-in across PulseDeck and Windows restarts.
3. Expand PulseDeck's connection panel and scan a QR code with your phone. The one-use pairing code signs the phone in and keeps it signed in until the server restarts. Codes expire after five minutes and refresh while the panel is open. Keep the QR visible only to people you trust.
4. If you open PulseDeck directly on your phone instead, sign in on its account page. Manual phone sign-in lasts for that browser session; after closing the browser, sign in again or scan the PC's QR code. QR-paired phone sessions last until the server restarts, including when the phone browser is closed and reopened.

The account password is hashed and stored in the PC's local PulseDeck data folder. Use **Sign out** on a device to revoke that device's session.

The PC must stay awake and connected to Wi-Fi while you use the phone controls.

If Windows Firewall prompts you, allow Python on **private networks only**. The host binds to all network interfaces for same-Wi-Fi access. Do not forward port 8000 from your router or use the app on an untrusted public Wi-Fi network: local HTTP does not encrypt the password or control traffic.

During development, run `npm run dev -- --host 0.0.0.0` from `frontend/`. For phone access to that development page, add its exact origin (including the PC's IP and port 5173) to `PULSEDECK_ALLOWED_ORIGINS` before starting the backend.

PulseDeck uses its dark theme and Phosphor shortcut icons by default.

Sports scores are optional. Choose **Add team score** below the date to follow a football or cricket team; football also asks for a league. The selection is saved in that browser, refreshes every minute, and can be changed or removed from the score card. Scores come from ESPN's public football scoreboard and ESPNcricinfo's current-match feed, so a score appears only when the selected team has a recent/upcoming football fixture or a current cricket match in the feed. The PC host needs internet access while the feature is in use.

Use **Manage** beside the workspace tabs to rename the selected profile, edit or remove its shortcut cards, and set app names for automatic profile switching. **Add profile** creates another workspace. Profile edits are saved in that browser's local storage. Choose a preset action or record a sequence of up to five key chords with Ctrl, Alt, Shift, and Win modifiers. If the host does not detect the Windows key, click **Win** to add it to the next chord. While recording, keyboard input is suppressed on the host PC so the chord does not also trigger its normal action. Pause for four seconds to finish; press Escape to cancel. Recording automatically stops after 20 seconds. Arbitrary text is not accepted.

The **Open apps** pane launches built-in apps and shortcuts discovered from the host's Windows Start Menu. Select **Edit**, then **Add app** to choose another entry; the app list comes from the host and your selected launcher list is saved in that browser. Built-in launch requests use a fixed application allowlist; Start Menu entries launch only their discovered shortcut.

## Network security

PulseDeck uses a local account and session token. In the combined local setup, port 8000 uses plain HTTP; use it only on a trusted, firewalled private network and do not forward the port from your router. For separate hosting, use HTTPS for both frontend and backend and keep the backend behind an authenticated HTTPS proxy or VPN. Keep account credentials and platform secrets private.

## Troubleshooting

- **Phone cannot connect locally:** confirm the phone and PC are on the same Wi-Fi, open the PC's current IPv4 address on port 8000, and allow Python through Windows Firewall on private networks.
- **Phone sign-in required after a server restart:** scan a fresh QR from the PC. The PC's remembered sign-in survives server restarts.
- **Page not found in combined local mode:** run `npm run build` from `frontend/` before starting the backend.
- **App volume is unavailable:** start audio in that app so Windows creates an active audio session.
- **Discord voice status does not update:** check that the bot token and user ID are set, Server Members Intent is enabled, the bot can view the server voice channel, and the host can make outbound TCP connections to `discord.com` on port 443. A firewall, endpoint security product, VPN, or managed network may block that connection. Set Discord keybinds to Caps Lock + Tab for mute and Ctrl + Alt + Shift + F11 for deafen; leave Discord open on the host PC.

## Checks

```powershell
cd frontend
npm run check
```

This builds the frontend and runs the backend payload validation unit tests.

