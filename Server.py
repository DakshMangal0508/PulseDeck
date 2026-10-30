import hmac
import asyncio
import base64
import ctypes
import hashlib
import io
import json
import os
import secrets
import sqlite3
import subprocess
import threading
import time
import urllib.parse
import urllib.request
import winreg
import winsound
import wave
import uuid
from contextlib import asynccontextmanager, contextmanager
import keyboard
import psutil
import uvicorn
import win32gui
import win32process
from comtypes import CoInitialize, CoUninitialize
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware
from pycaw.pycaw import AudioUtilities
from winrt.windows.media.control import GlobalSystemMediaTransportControlsSessionManager as MediaManager
from winrt.windows.media.control import GlobalSystemMediaTransportControlsSessionPlaybackStatus
from winrt.windows.storage.streams import Buffer, DataReader, InputStreamOptions

try:
    import discord
except ImportError:
    discord = None

from validation import (
    AppLaunchPayload,
    ALLOWED_SHORTCUTS,
    DiscordPayload,
    HotkeyPayload,
    MediaPayload,
    SoundRenamePayload,
    SoundboardPayload,
    SoundUploadPayload,
    VolumePayload,
)


DISCORD_BOT_TOKEN = os.getenv("PULSEDECK_DISCORD_BOT_TOKEN", "").strip()
DISCORD_USER_ID_VALUE = os.getenv("PULSEDECK_DISCORD_USER_ID", "").strip()
DISCORD_USER_ID = int(DISCORD_USER_ID_VALUE) if DISCORD_USER_ID_VALUE.isdecimal() else None
DISCORD_VOICE_STATUS = {
    "configured": bool(DISCORD_BOT_TOKEN and DISCORD_USER_ID),
    "connection": "disabled" if not (DISCORD_BOT_TOKEN and DISCORD_USER_ID) else "connecting",
    "guild": None,
    "channel": None,
    "members": [],
}
DISCORD_BOT = None


def refresh_discord_voice_status(bot):
    if not bot.is_ready() or DISCORD_USER_ID is None:
        return

    for guild in bot.guilds:
        member = guild.get_member(DISCORD_USER_ID)
        channel = member.voice.channel if member and member.voice else None
        if not channel:
            continue

        members = sorted(
            [
                {
                    "name": voice_member.display_name,
                    "is_self": voice_member.id == DISCORD_USER_ID,
                    "self_muted": voice_member.voice.self_mute,
                    "self_deafened": voice_member.voice.self_deaf,
                    "server_muted": voice_member.voice.mute,
                    "server_deafened": voice_member.voice.deaf,
                }
                for voice_member in channel.members
                if voice_member.voice is not None
            ],
            key=lambda voice_member: (not voice_member["is_self"], voice_member["name"].casefold()),
        )
        DISCORD_VOICE_STATUS.update({
            "configured": True,
            "connection": "connected",
            "guild": guild.name,
            "channel": channel.name,
            "members": members,
        })
        return

    DISCORD_VOICE_STATUS.update({
        "configured": True,
        "connection": "connected",
        "guild": None,
        "channel": None,
        "members": [],
    })


@asynccontextmanager
async def lifespan(_app):
    global DISCORD_BOT
    bot_task = None
    if DISCORD_VOICE_STATUS["configured"] and discord is None:
        DISCORD_VOICE_STATUS.update({"connection": "error"})
    elif DISCORD_VOICE_STATUS["configured"]:
        intents = discord.Intents.none()
        intents.guilds = True
        intents.members = True
        intents.voice_states = True
        DISCORD_BOT = discord.Client(
            intents=intents,
            member_cache_flags=discord.MemberCacheFlags.voice(),
        )

        @DISCORD_BOT.event
        async def on_ready():
            refresh_discord_voice_status(DISCORD_BOT)

        @DISCORD_BOT.event
        async def on_voice_state_update(member, _before, _after):
            refresh_discord_voice_status(DISCORD_BOT)

        @DISCORD_BOT.event
        async def on_member_update(_before, _after):
            refresh_discord_voice_status(DISCORD_BOT)

        @DISCORD_BOT.event
        async def on_disconnect():
            DISCORD_VOICE_STATUS.update({
                "connection": "reconnecting",
                "guild": None,
                "channel": None,
                "members": [],
            })

        bot_task = asyncio.create_task(DISCORD_BOT.start(DISCORD_BOT_TOKEN))

        def record_bot_failure(task):
            if task.cancelled():
                return
            error = task.exception()
            if error:
                DISCORD_VOICE_STATUS.update({"connection": "error"})
                print(f"Discord voice monitor stopped: {error}")

        bot_task.add_done_callback(record_bot_failure)

    yield

    if DISCORD_BOT:
        await DISCORD_BOT.close()
    if bot_task:
        try:
            await asyncio.wait_for(bot_task, timeout=5)
        except (asyncio.CancelledError, asyncio.TimeoutError, Exception):
            bot_task.cancel()


API_TOKEN = os.getenv("PULSEDECK_API_TOKEN", "")
AUTH_SESSION_KEY = secrets.token_hex(32)
AUTH_DIR = (
    os.path.join(os.environ["LOCALAPPDATA"], "PulseDeck")
    if os.environ.get("LOCALAPPDATA")
    else os.path.join(os.path.expanduser("~"), ".pulsedeck")
)
os.makedirs(AUTH_DIR, exist_ok=True)
AUTH_DB_PATH = os.path.join(AUTH_DIR, "accounts.sqlite3")
AUTH_SESSIONS: dict[str, str] = {}
AUTH_ATTEMPTS: dict[str, list[float]] = {}
AUTH_LOCK = threading.Lock()
PASSWORD_HASH_ROUNDS = 310_000


class AccountCredentials(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=10, max_length=256)


@contextmanager
def auth_db():
    connection = sqlite3.connect(AUTH_DB_PATH, timeout=5)
    try:
        connection.execute(
            "CREATE TABLE IF NOT EXISTS account (id INTEGER PRIMARY KEY CHECK (id = 1), username TEXT NOT NULL UNIQUE, salt BLOB NOT NULL, password_hash BLOB NOT NULL)"
        )
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


with auth_db() as auth_connection:
    pass


def password_digest(password: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_HASH_ROUNDS)


def issue_session(username: str) -> str:
    token = secrets.token_urlsafe(32)
    AUTH_SESSIONS[hashlib.sha256(token.encode("utf-8")).hexdigest()] = username
    return token

ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "PULSEDECK_ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]

app = FastAPI(title="PulseDeck Host Server", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-API-Token"],
)

FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")
FRONTEND_ASSETS_DIR = os.path.join(FRONTEND_DIR, "assets")
if os.path.isdir(FRONTEND_ASSETS_DIR):
    app.mount("/assets", StaticFiles(directory=FRONTEND_ASSETS_DIR), name="frontend-assets")


@app.get("/", include_in_schema=False)
def serve_frontend():
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if not os.path.isfile(index_path):
        raise HTTPException(status_code=404, detail="Build the web app with npm run build first")
    return FileResponse(index_path)


@app.get("/api/auth/status")
def get_auth_status():
    with auth_db() as connection:
        configured = connection.execute("SELECT 1 FROM account WHERE id = 1").fetchone() is not None
    return {"account_configured": configured}


@app.post("/api/auth/register")
def register_account(credentials: AccountCredentials):
    username = credentials.username.strip()
    if len(username) < 3:
        raise HTTPException(status_code=422, detail="Username must contain at least 3 characters")
    with AUTH_LOCK, auth_db() as connection:
        if connection.execute("SELECT 1 FROM account WHERE id = 1").fetchone():
            raise HTTPException(status_code=409, detail="An account is already set up on this PC")
        salt = secrets.token_bytes(16)
        connection.execute(
            "INSERT INTO account (id, username, salt, password_hash) VALUES (1, ?, ?, ?)",
            (username, salt, password_digest(credentials.password, salt)),
        )
    return {"token": issue_session(username), "username": username}


@app.post("/api/auth/login")
def login_account(credentials: AccountCredentials):
    client_key = "local"  # The PC hosts a single local account.
    now = time.monotonic()
    recent_attempts = [stamp for stamp in AUTH_ATTEMPTS.get(client_key, []) if now - stamp < 60]
    if len(recent_attempts) >= 8:
        AUTH_ATTEMPTS[client_key] = recent_attempts
        raise HTTPException(status_code=429, detail="Too many login attempts. Wait one minute and try again.")
    with auth_db() as connection:
        row = connection.execute("SELECT username, salt, password_hash FROM account WHERE id = 1").fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Create an account on this PC first")
    username, salt, expected_hash = row
    supplied_hash = password_digest(credentials.password, salt)
    supplied_username = credentials.username.strip().casefold().encode("utf-8")
    if not hmac.compare_digest(username.casefold().encode("utf-8"), supplied_username) or not hmac.compare_digest(supplied_hash, expected_hash):
        recent_attempts.append(now)
        AUTH_ATTEMPTS[client_key] = recent_attempts
        raise HTTPException(status_code=401, detail="Username or password is incorrect")
    AUTH_ATTEMPTS.pop(client_key, None)
    return {"token": issue_session(username), "username": username}


@app.post("/api/auth/logout")
def logout_account(x_api_token: str | None = Header(default=None)):
    if x_api_token:
        AUTH_SESSIONS.pop(hashlib.sha256(x_api_token.encode("utf-8")).hexdigest(), None)
    return {"status": "ok"}

ARTWORK_CACHE: dict[str, tuple[str, float | None]] = {}
SOUNDBOARD_DIR = (
    os.path.join(os.environ["LOCALAPPDATA"], "PulseDeck", "sounds")
    if os.environ.get("LOCALAPPDATA")
    else os.path.join(os.path.expanduser("~"), ".pulsedeck", "sounds")
)
BUILTIN_SOUNDS = {
    "notification": winsound.MB_ICONASTERISK,
    "alert": winsound.MB_ICONEXCLAMATION,
    "error": winsound.MB_ICONHAND,
    "question": winsound.MB_ICONQUESTION,
}
SOUNDBOARD_MCI_LOCK = threading.Lock()


def play_mp3_with_windows_media(path: str) -> None:
    mci = ctypes.windll.winmm.mciSendStringW
    mci.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_uint, ctypes.c_void_p]
    mci.restype = ctypes.c_uint
    with SOUNDBOARD_MCI_LOCK:
        mci("stop pulsedeck_sound", None, 0, None)
        mci("close pulsedeck_sound", None, 0, None)
        result = mci(f'open "{path}" type mpegvideo alias pulsedeck_sound', None, 0, None)
        if result:
            raise RuntimeError("Windows could not open the MP3 file")
        result = mci("play pulsedeck_sound", None, 0, None)
        if result:
            mci("close pulsedeck_sound", None, 0, None)
            raise RuntimeError("Windows could not play the MP3 file")

# Launch targets are fixed here so a browser request can never supply a command or path.
APP_LAUNCHERS = {
    "spotify": {"label": "Spotify", "protocol": "spotify:"},
    "discord": {"label": "Discord", "protocol": "discord:"},
    "chrome": {
        "label": "Chrome", "executable": "chrome.exe",
        "paths": [
            os.path.join(os.environ.get("LOCALAPPDATA", ""), "Google", "Chrome", "Application", "chrome.exe"),
            os.path.join(os.environ.get("PROGRAMFILES", "C:\\Program Files"), "Google", "Chrome", "Application", "chrome.exe"),
            os.path.join(os.environ.get("PROGRAMFILES(X86)", "C:\\Program Files (x86)"), "Google", "Chrome", "Application", "chrome.exe"),
        ],
    },
    "edge": {
        "label": "Edge", "executable": "msedge.exe",
        "paths": [
            os.path.join(os.environ.get("PROGRAMFILES(X86)", "C:\\Program Files (x86)"), "Microsoft", "Edge", "Application", "msedge.exe"),
            os.path.join(os.environ.get("PROGRAMFILES", "C:\\Program Files"), "Microsoft", "Edge", "Application", "msedge.exe"),
        ],
    },
    "vscode": {
        "label": "VS Code", "executable": "Code.exe",
        "paths": [
            os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "Microsoft VS Code", "Code.exe"),
            os.path.join(os.environ.get("PROGRAMFILES", "C:\\Program Files"), "Microsoft VS Code", "Code.exe"),
        ],
    },
    "explorer": {"label": "Explorer", "paths": [os.path.join(os.environ.get("WINDIR", "C:\\Windows"), "explorer.exe")]},
    "notepad": {"label": "Notepad", "paths": [os.path.join(os.environ.get("WINDIR", "C:\\Windows"), "System32", "notepad.exe")]},
}


def resolve_launcher_executable(app_id: str) -> str | None:
    launcher = APP_LAUNCHERS[app_id]
    for candidate in launcher.get("paths", []):
        if candidate and os.path.isfile(candidate):
            return candidate

    executable = launcher.get("executable")
    if executable:
        app_path_key = rf"Software\Microsoft\Windows\CurrentVersion\App Paths\{executable}"
        for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            try:
                with winreg.OpenKey(hive, app_path_key) as key:
                    registered_path, _ = winreg.QueryValueEx(key, None)
                registered_path = registered_path.strip().strip('"')
                if os.path.isfile(registered_path):
                    return registered_path
            except (OSError, ValueError):
                continue
    return None


def require_token(x_api_token: str | None = Header(default=None)):
    if x_api_token:
        token_hash = hashlib.sha256(x_api_token.encode("utf-8")).hexdigest()
        if token_hash in AUTH_SESSIONS:
            return AUTH_SESSIONS[token_hash]
        if API_TOKEN and hmac.compare_digest(x_api_token, API_TOKEN):
            return "legacy"
    raise HTTPException(status_code=401, detail="Sign in to control this PC")


def fetch_album_art(artist: str, title: str) -> str:
    """Look up cover artwork in the iTunes Search API and cache the result."""
    cache_key = f"{artist} - {title}".casefold()
    cached = ARTWORK_CACHE.get(cache_key)
    now = time.monotonic()
    if cached and (cached[1] is None or cached[1] > now):
        return cached[0]
    if cached:
        del ARTWORK_CACHE[cache_key]

    artwork = ""
    try:
        query = urllib.parse.quote(f"{artist} {title}")
        url = f"https://itunes.apple.com/search?term={query}&media=music&entity=song&limit=1"
        request = urllib.request.Request(url, headers={"User-Agent": "PulseDeck/1.0"})
        with urllib.request.urlopen(request, timeout=2.0) as response:
            data = json.loads(response.read().decode("utf-8"))
        if data.get("resultCount", 0) > 0:
            artwork = data["results"][0].get("artworkUrl100", "").replace("100x100bb", "300x300bb")
    except Exception:
        # Album art is optional; status and controls should keep working offline.
        pass

    # Keep memory use bounded if Spotify reports many tracks during a long session.
    if len(ARTWORK_CACHE) >= 100:
        ARTWORK_CACHE.pop(next(iter(ARTWORK_CACHE)))
    # Keep misses briefly so a network outage does not trigger a request every poll.
    expires_at = None if artwork else now + 300
    ARTWORK_CACHE[cache_key] = (artwork, expires_at)
    return artwork


async def get_spotify_session():
    """Find Spotify's Windows media session, independent of the foreground app."""
    manager = await MediaManager.request_async()
    sessions = manager.get_sessions()
    for session in sessions:
        if "spotify" in (session.source_app_user_model_id or "").casefold():
            return session
    return None


def media_time_seconds(value):
    """Convert a WinRT TimeSpan to seconds across supported Python projections."""
    if value is None:
        return None
    total_seconds = getattr(value, "total_seconds", None)
    if callable(total_seconds):
        return float(total_seconds())
    ticks = getattr(value, "duration", None)
    if ticks is not None:
        return float(ticks) / 10_000_000
    if isinstance(value, (int, float)):
        return float(value) / 10_000_000
    return None


def add_spotify_timeline(track, session):
    """Attach timeline data when Spotify exposes a usable media timeline."""
    try:
        timeline = session.get_timeline_properties()
        start = media_time_seconds(timeline.start_time)
        end = media_time_seconds(timeline.end_time)
        position = media_time_seconds(timeline.position)
        min_seek = media_time_seconds(timeline.min_seek_time)
        max_seek = media_time_seconds(timeline.max_seek_time)
        if start is None or end is None or position is None or end <= start:
            return

        duration = end - start
        track.update({
            "position": max(0.0, min(duration, position - start)),
            "duration": duration,
            "seek_min": max(0.0, (min_seek - start) if min_seek is not None else 0.0),
            "seek_max": min(duration, (max_seek - start) if max_seek is not None else duration),
        })
        controls = session.get_playback_info().controls
        track["seekable"] = bool(controls.is_playback_position_enabled) and track["seek_max"] > track["seek_min"]
    except Exception:
        # Some media providers expose track metadata without a timeline.
        pass


async def read_spotify_track():
    track = {
        "title": "Not Playing", "artist": "Spotify Paused", "is_playing": False,
        "artwork": "", "position": 0, "duration": 0, "seek_min": 0,
        "seek_max": 0, "seekable": False,
    }
    session = await get_spotify_session()
    if not session:
        return read_spotify_window_track() or track

    properties = await session.try_get_media_properties_async()
    title = (properties.title or "").strip()
    artist = (properties.artist or "").strip()
    if title:
        track["title"] = title
        track["artist"] = artist or "Spotify"
    track["is_playing"] = (
        session.get_playback_info().playback_status
        == GlobalSystemMediaTransportControlsSessionPlaybackStatus.PLAYING
    )
    add_spotify_timeline(track, session)

    thumbnail = properties.thumbnail
    if thumbnail:
        try:
            stream = await thumbnail.open_read_async()
            size = min(int(stream.size), 5 * 1024 * 1024)
            if size:
                buffer = Buffer(size)
                await stream.read_async(buffer, size, InputStreamOptions.NONE)
                reader = DataReader.from_buffer(buffer)
                image_bytes = bytearray(size)
                reader.read_bytes(image_bytes)
                mime = stream.content_type or "image/jpeg"
                track["artwork"] = f"data:{mime};base64,{base64.b64encode(image_bytes).decode('ascii')}"
        except Exception:
            # Metadata and playback should remain available if artwork cannot be read.
            pass
    if not track["artwork"] and title and artist:
        track["artwork"] = fetch_album_art(artist, title)
    return track


def read_spotify_window_track():
    """Fallback for Spotify clients that expose their track only in the window title."""
    result = None

    def inspect_window(hwnd, _):
        nonlocal result
        if not win32gui.IsWindowVisible(hwnd):
            return
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        pid &= 0xFFFFFFFF
        try:
            if psutil.Process(pid).name().lower() != "spotify.exe":
                return
            text = win32gui.GetWindowText(hwnd).strip()
            if text:
                result = text
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass

    try:
        win32gui.EnumWindows(inspect_window, None)
    except Exception:
        return None
    if not result:
        return None

    title = result.removesuffix(" - Spotify").strip()
    for separator in (" - ", " — ", " • "):
        if separator in title:
            song, artist = (part.strip() for part in title.split(separator, 1))
            if song and artist:
                return {
                    "title": song,
                    "artist": artist,
                    # Window titles provide metadata, not playback state. Keep the
                    # state unknown so the UI does not incorrectly report paused.
                    "is_playing": None,
                    "artwork": fetch_album_art(artist, song),
                    "position": 0,
                    "duration": 0,
                    "seek_min": 0,
                    "seek_max": 0,
                    "seekable": False,
                }
    return None


def get_spotify_track():
    """Read Spotify's media metadata and cover art from its Windows media session."""
    try:
        return asyncio.run(read_spotify_track())
    except Exception:
        fallback = read_spotify_window_track()
        return fallback or {
            "title": "Not Playing", "artist": "Spotify Paused", "is_playing": False,
            "artwork": "", "position": 0, "duration": 0, "seek_min": 0,
            "seek_max": 0, "seekable": False,
        }


async def control_spotify_session(action: str, position_seconds=None) -> bool:
    session = await get_spotify_session()
    if not session:
        return False
    if action == "play_pause":
        return await session.try_toggle_play_pause_async()
    elif action == "next":
        return await session.try_skip_next_async()
    elif action == "seek":
        if position_seconds is None:
            return False
        if not session.get_playback_info().controls.is_playback_position_enabled:
            return False
        timeline = session.get_timeline_properties()
        start = media_time_seconds(timeline.start_time) or 0.0
        min_seek = media_time_seconds(timeline.min_seek_time)
        max_seek = media_time_seconds(timeline.max_seek_time)
        target = start + max(0.0, position_seconds)
        if min_seek is not None:
            target = max(target, min_seek)
        if max_seek is not None:
            target = min(target, max_seek)
        target_ticks = int(target * 10_000_000)
        return await session.try_change_playback_position_async(target_ticks)
    return await session.try_skip_previous_async()


def get_active_app():
    try:
        hwnd = win32gui.GetForegroundWindow()
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        pid &= 0xFFFFFFFF
        return psutil.Process(pid).name()
    except (psutil.NoSuchProcess, psutil.AccessDenied, OSError, ValueError):
        return "Desktop"


def is_discord_running() -> bool:
    discord_processes = {"discord.exe", "discordptb.exe", "discordcanary.exe", "discorddevelopment.exe"}
    try:
        return any(
            (process.info.get("name") or "").lower() in discord_processes
            for process in psutil.process_iter(["name"])
        )
    except (psutil.Error, OSError):
        return False


APP_DISPLAY_NAMES = {
    "chrome.exe": "Google Chrome",
    "msedge.exe": "Microsoft Edge",
    "firefox.exe": "Firefox",
    "code.exe": "Visual Studio Code",
    "spotify.exe": "Spotify",
    "discord.exe": "Discord",
    "vlc.exe": "VLC media player",
    "wallpaper64.exe": "Wallpaper Engine",
}


def audio_session_key(session) -> str:
    identifier = session.InstanceIdentifier
    key = API_TOKEN or AUTH_SESSION_KEY
    return hmac.new(key.encode("utf-8"), identifier.encode("utf-8"), "sha256").hexdigest()


def get_session_volumes():
    apps = []
    master_level = None
    CoInitialize()
    try:
        for session in AudioUtilities.GetAllSessions():
            try:
                if not session.Process:
                    continue
                process_name = session.Process.name().lower()
                if process_name in {"audiodg.exe", "system"}:
                    continue
                # Keep Spotify available in the mixer while paused; its Windows session
                # often remains present but transitions to the inactive state.
                if session.State != 1 and process_name != "spotify.exe":
                    continue
                name = APP_DISPLAY_NAMES.get(
                    process_name,
                    os.path.splitext(os.path.basename(process_name))[0].replace("_", " ").title(),
                )
                apps.append({
                    "id": audio_session_key(session),
                    "name": name,
                    "process": process_name,
                    "volume": round(session.SimpleAudioVolume.GetMasterVolume(), 3),
                })
            except Exception:
                # A stale or inaccessible session should not hide other sessions.
                continue
        try:
            device = AudioUtilities.GetSpeakers()
            master = device.EndpointVolume
            master_level = round(master.GetMasterVolumeLevelScalar(), 3)
        except Exception:
            pass
    finally:
        CoUninitialize()
    return {"apps": apps, "master": master_level}


def set_session_volume(session_id: str, level: float) -> bool:
    level = max(0.0, min(1.0, level))
    CoInitialize()
    try:
        for session in AudioUtilities.GetAllSessions():
            try:
                if hmac.compare_digest(audio_session_key(session), session_id):
                    session.SimpleAudioVolume.SetMasterVolume(level, None)
                    return True
            except Exception:
                continue
    finally:
        CoUninitialize()
    return False


def set_master_volume(level: float):
    level = max(0.0, min(1.0, level))
    CoInitialize()
    try:
        device = AudioUtilities.GetSpeakers()
        volume = device.EndpointVolume
        volume.SetMasterVolumeLevelScalar(level, None)
    finally:
        CoUninitialize()


@app.get("/api/status", dependencies=[Depends(require_token)])
def get_live_status():
    return {
        "spotify": get_spotify_track(),
        "active_app": get_active_app(),
        "volumes": get_session_volumes(),
        "discord": {
            "available": is_discord_running(),
            "voice": {**DISCORD_VOICE_STATUS, "members": list(DISCORD_VOICE_STATUS["members"])},
        },
    }


@app.post("/api/hotkey", dependencies=[Depends(require_token)])
def trigger_hotkey(data: HotkeyPayload):
    shortcut = data.shortcut.strip().lower()
    if shortcut not in ALLOWED_SHORTCUTS:
        raise HTTPException(status_code=422, detail="Shortcut is not allowed")
    try:
        keyboard.send(shortcut)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Windows could not send the shortcut") from exc
    return {"status": "ok", "shortcut": shortcut}


@app.post("/api/apps/open", dependencies=[Depends(require_token)])
def open_app(data: AppLaunchPayload):
    launcher = APP_LAUNCHERS.get(data.app_id)
    if not launcher:
        raise HTTPException(status_code=422, detail="App is not in the launch allowlist")
    try:
        protocol = launcher.get("protocol")
        if protocol:
            os.startfile(protocol)
        else:
            executable = resolve_launcher_executable(data.app_id)
            if not executable:
                raise HTTPException(status_code=404, detail=f"{launcher['label']} was not found on this PC")
            subprocess.Popen([executable], close_fds=True)
    except HTTPException:
        raise
    except OSError as exc:
        raise HTTPException(status_code=502, detail=f"Windows could not open {launcher['label']}") from exc
    return {"status": "ok", "app_id": data.app_id}


@app.get("/api/soundboard", dependencies=[Depends(require_token)])
def list_soundboard_sounds():
    os.makedirs(SOUNDBOARD_DIR, exist_ok=True)
    custom_sounds = []
    for filename in os.listdir(SOUNDBOARD_DIR):
        sound_id, extension = os.path.splitext(filename)
        if extension.lower() not in (".wav", ".mp3"):
            continue
        try:
            uuid.UUID(sound_id)
        except ValueError:
            continue
        name_path = os.path.join(SOUNDBOARD_DIR, f"{sound_id}.json")
        try:
            with open(name_path, "r", encoding="utf-8") as sound_file:
                name = json.load(sound_file).get("name", sound_id)
        except (OSError, ValueError, AttributeError):
            name = sound_id
        custom_sounds.append({"id": sound_id, "name": name})
    custom_sounds.sort(key=lambda sound: sound["name"].casefold())
    return {"sounds": custom_sounds}


@app.post("/api/soundboard/upload", dependencies=[Depends(require_token)])
def upload_soundboard_sound(data: SoundUploadPayload):
    name = data.name.strip()
    if not name or not all(character.isprintable() for character in name):
        raise HTTPException(status_code=422, detail="Enter a printable sound name")

    try:
        audio_data = base64.b64decode(data.audio_base64, validate=True)
    except (ValueError, base64.binascii.Error) as exc:
        raise HTTPException(status_code=422, detail="The uploaded sound is not valid base64 data") from exc
    if len(audio_data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Sound files must be 10 MB or smaller")

    extension = f".{data.file_type}"
    if data.file_type == "wav":
        try:
            with wave.open(io.BytesIO(audio_data), "rb") as wav_file:
                if wav_file.getcomptype() != "NONE":
                    raise HTTPException(status_code=422, detail="Use an uncompressed PCM WAV file")
                if wav_file.getnchannels() not in (1, 2) or wav_file.getsampwidth() not in (1, 2):
                    raise HTTPException(status_code=422, detail="WAV files must be mono or stereo, 8-bit or 16-bit PCM")
                if not 8000 <= wav_file.getframerate() <= 48000:
                    raise HTTPException(status_code=422, detail="WAV sample rate must be between 8 kHz and 48 kHz")
                if wav_file.getnframes() / wav_file.getframerate() > 60:
                    raise HTTPException(status_code=422, detail="WAV clips must be 60 seconds or shorter")
        except (wave.Error, EOFError) as exc:
            raise HTTPException(status_code=422, detail="Choose a valid PCM WAV file") from exc
    else:
        frame_start = 0
        if audio_data.startswith(b"ID3") and len(audio_data) >= 10:
            tag_size = ((audio_data[6] & 0x7F) << 21) | ((audio_data[7] & 0x7F) << 14) | ((audio_data[8] & 0x7F) << 7) | (audio_data[9] & 0x7F)
            frame_start = 10 + tag_size + (10 if audio_data[5] & 0x10 else 0)
        has_mpeg_frame = any(
            audio_data[index] == 0xFF and audio_data[index + 1] & 0xE0 == 0xE0
            for index in range(frame_start, min(len(audio_data) - 1, frame_start + 65536))
        )
        if not has_mpeg_frame:
            raise HTTPException(status_code=422, detail="Choose a valid MP3 audio file")

    os.makedirs(SOUNDBOARD_DIR, exist_ok=True)
    existing_count = sum(1 for filename in os.listdir(SOUNDBOARD_DIR) if filename.lower().endswith((".wav", ".mp3")))
    if existing_count >= 24:
        raise HTTPException(status_code=409, detail="The soundboard can store up to 24 custom sounds")

    sound_id = uuid.uuid4().hex
    sound_path = os.path.join(SOUNDBOARD_DIR, f"{sound_id}{extension}")
    name_path = os.path.join(SOUNDBOARD_DIR, f"{sound_id}.json")
    try:
        with open(sound_path, "wb") as sound_file:
            sound_file.write(audio_data)
        with open(name_path, "w", encoding="utf-8") as name_file:
            json.dump({"name": name}, name_file, ensure_ascii=False)
    except OSError as exc:
        for path in (sound_path, name_path):
            try:
                os.remove(path)
            except OSError:
                pass
        raise HTTPException(status_code=500, detail="Could not save the sound on this PC") from exc
    return {"status": "ok", "sound": {"id": sound_id, "name": name}}


@app.post("/api/soundboard/play", dependencies=[Depends(require_token)])
def play_soundboard(data: SoundboardPayload):
    try:
        if data.sound_id in BUILTIN_SOUNDS:
            winsound.MessageBeep(BUILTIN_SOUNDS[data.sound_id])
        else:
            sound_id = uuid.UUID(data.sound_id).hex
            wav_path = os.path.join(SOUNDBOARD_DIR, f"{sound_id}.wav")
            mp3_path = os.path.join(SOUNDBOARD_DIR, f"{sound_id}.mp3")
            sound_path = wav_path if os.path.isfile(wav_path) else mp3_path
            if not os.path.isfile(sound_path):
                raise HTTPException(status_code=404, detail="That sound is not on the soundboard")
            if sound_path.lower().endswith(".mp3"):
                play_mp3_with_windows_media(sound_path)
            else:
                winsound.PlaySound(sound_path, winsound.SND_FILENAME | winsound.SND_ASYNC)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Sound ID is not valid") from exc
    except (OSError, RuntimeError) as exc:
        raise HTTPException(status_code=502, detail="Windows could not play the sound") from exc
    return {"status": "ok", "sound_id": data.sound_id}


@app.post("/api/soundboard/delete", dependencies=[Depends(require_token)])
def delete_soundboard_sound(data: SoundboardPayload):
    try:
        sound_id = uuid.UUID(data.sound_id).hex
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Only uploaded sounds can be removed") from exc
    sound_removed = False
    try:
        for extension in (".wav", ".mp3"):
            path = os.path.join(SOUNDBOARD_DIR, f"{sound_id}{extension}")
            try:
                os.remove(path)
                sound_removed = True
            except FileNotFoundError:
                pass
        if not sound_removed:
            raise HTTPException(status_code=404, detail="That sound is not on the soundboard")
        try:
            os.remove(os.path.join(SOUNDBOARD_DIR, f"{sound_id}.json"))
        except FileNotFoundError:
            pass
    except OSError as exc:
        raise HTTPException(status_code=500, detail="Could not remove the sound from this PC") from exc
    return {"status": "ok", "sound_id": sound_id}


@app.post("/api/soundboard/rename", dependencies=[Depends(require_token)])
def rename_soundboard_sound(data: SoundRenamePayload):
    name = data.name.strip()
    if not name or not all(character.isprintable() for character in name):
        raise HTTPException(status_code=422, detail="Enter a printable sound name")
    try:
        sound_id = uuid.UUID(data.sound_id).hex
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Only uploaded sounds can be renamed") from exc
    wav_path = os.path.join(SOUNDBOARD_DIR, f"{sound_id}.wav")
    mp3_path = os.path.join(SOUNDBOARD_DIR, f"{sound_id}.mp3")
    if not os.path.isfile(wav_path) and not os.path.isfile(mp3_path):
        raise HTTPException(status_code=404, detail="That sound is not on the soundboard")
    name_path = os.path.join(SOUNDBOARD_DIR, f"{sound_id}.json")
    try:
        with open(name_path, "w", encoding="utf-8") as name_file:
            json.dump({"name": name}, name_file, ensure_ascii=False)
    except OSError as exc:
        raise HTTPException(status_code=500, detail="Could not rename the sound") from exc
    return {"status": "ok", "sound": {"id": sound_id, "name": name}}


@app.post("/api/media", dependencies=[Depends(require_token)])
def trigger_media(data: MediaPayload):
    try:
        if asyncio.run(control_spotify_session(data.action, data.position)):
            response = {"status": "ok", "action": data.action, "target": "spotify-session"}
            if data.action == "seek":
                response["position"] = data.position
            return response
    except HTTPException:
        raise
    except Exception:
        # Some Windows setups do not expose the media-session service to this host.
        pass

    if data.action == "seek":
        raise HTTPException(
            status_code=409,
            detail="Spotify's Windows media session does not expose seeking right now.",
        )

    if get_active_app().lower() != "spotify.exe":
        raise HTTPException(
            status_code=409,
            detail="Spotify's Windows media session is unavailable. Focus Spotify on the PC and try again.",
        )
    mapping = {"play_pause": "play/pause media", "next": "next track", "prev": "previous track"}
    try:
        keyboard.send(mapping[data.action])
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Windows could not control Spotify playback") from exc
    return {"status": "ok", "action": data.action, "target": "focused-spotify"}


@app.post("/api/discord", dependencies=[Depends(require_token)])
def trigger_discord(data: DiscordPayload):
    if not is_discord_running():
        raise HTTPException(status_code=409, detail="Discord is not running on the host PC")
    shortcut = "ctrl+shift+m" if data.action == "mute" else "ctrl+shift+d"
    try:
        keyboard.send(shortcut)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Windows could not send the Discord hotkey") from exc
    return {"status": "ok", "action": data.action, "shortcut": shortcut}


@app.post("/api/volume", dependencies=[Depends(require_token)])
def adjust_volume(data: VolumePayload):
    try:
        if data.target == "master":
            set_master_volume(data.level)
        else:
            if not set_session_volume(data.target, data.level):
                raise HTTPException(status_code=404, detail="That app is no longer using audio")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Windows could not change the requested volume") from exc
    return {"status": "ok", "target": data.target, "level": data.level}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
