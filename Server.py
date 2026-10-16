import hmac
import asyncio
import base64
import json
import os
import time
import urllib.parse
import urllib.request
from contextlib import asynccontextmanager
import keyboard
import psutil
import uvicorn
import win32gui
import win32process
from comtypes import CoInitialize, CoUninitialize
from fastapi import Depends, FastAPI, Header, HTTPException
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
    ALLOWED_SHORTCUTS,
    DiscordPayload,
    HotkeyPayload,
    MediaPayload,
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
if not API_TOKEN:
    raise RuntimeError("Set PULSEDECK_API_TOKEN before starting PulseDeck.")

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

ARTWORK_CACHE: dict[str, tuple[str, float | None]] = {}


def require_token(x_api_token: str | None = Header(default=None)):
    if not x_api_token or not hmac.compare_digest(x_api_token, API_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid or missing API token")


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
    return hmac.new(API_TOKEN.encode("utf-8"), identifier.encode("utf-8"), "sha256").hexdigest()


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
