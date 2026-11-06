import hmac
import asyncio
import base64
import ctypes
import hashlib
import ipaddress
import io
import json
import os
import secrets
import socket
import sqlite3
import smtplib
import subprocess
import threading
import time
import urllib.parse
import urllib.request
import urllib.error
import winreg
import winsound
import wave
import uuid
import re
from email.message import EmailMessage
import win32con
from contextlib import asynccontextmanager, contextmanager
import keyboard
import psutil
import uvicorn
import win32gui
import win32process
from comtypes import CoInitialize, CoUninitialize
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse
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
    is_custom_shortcut,
    DiscordPayload,
    HotkeyPayload,
    MediaPayload,
    SoundRenamePayload,
    ShortcutRecordingModifierPayload,
    SoundboardPayload,
    SoundUploadPayload,
    VolumePayload,
)


def load_backend_env():
    """Load local backend settings without overriding process environment."""
    config_dir = os.getenv("PULSEDECK_CONFIG_DIR", "").strip()
    if config_dir:
        os.makedirs(config_dir, exist_ok=True)
        env_path = os.path.join(config_dir, ".env")
        if not os.path.exists(env_path):
            with open(env_path, "x", encoding="utf-8") as env_file:
                env_file.write(
                    "# Gmail SMTP for PulseDeck recovery email. Add your Gmail address and app password.\n"
                    "PULSEDECK_SMTP_HOST=smtp.gmail.com\n"
                    "PULSEDECK_SMTP_PORT=587\n"
                    "PULSEDECK_SMTP_USERNAME=\n"
                    "PULSEDECK_SMTP_PASSWORD=\n"
                    "PULSEDECK_SMTP_FROM=\n"
                    "PULSEDECK_SMTP_USE_SSL=false\n"
                    "PULSEDECK_SMTP_STARTTLS=true\n"
                )
    else:
        env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    try:
        with open(env_path, "r", encoding="utf-8-sig") as env_file:
            for line in env_file:
                stripped = line.strip()
                if not stripped or stripped.startswith("#") or "=" not in stripped:
                    continue
                name, value = stripped.split("=", 1)
                name = name.strip()
                value = value.strip()
                if name and name not in os.environ:
                    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
                        value = value[1:-1]
                    os.environ[name] = value
    except FileNotFoundError:
        pass


load_backend_env()


DISCORD_BOT_TOKEN = "".join(
    character
    for character in os.getenv("PULSEDECK_DISCORD_BOT_TOKEN", "")
    if not character.isspace() and ord(character) >= 32 and ord(character) != 127
)
DISCORD_USER_ID_VALUE = os.getenv("PULSEDECK_DISCORD_USER_ID", "").strip()
DISCORD_USER_ID = int(DISCORD_USER_ID_VALUE) if DISCORD_USER_ID_VALUE.isdecimal() else None
FRONTEND_PUBLIC_URL = os.getenv("PULSEDECK_FRONTEND_URL", "").strip().rstrip("/")
SMTP_HOST = os.getenv("PULSEDECK_SMTP_HOST", "").strip()
SMTP_PORT = int(os.getenv("PULSEDECK_SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("PULSEDECK_SMTP_USERNAME", "").strip()
SMTP_PASSWORD = os.getenv("PULSEDECK_SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("PULSEDECK_SMTP_FROM", SMTP_USERNAME).strip()
SMTP_USE_SSL = os.getenv("PULSEDECK_SMTP_USE_SSL", "false").strip().casefold() in {"1", "true", "yes", "on"}
SMTP_STARTTLS = os.getenv("PULSEDECK_SMTP_STARTTLS", "true").strip().casefold() in {"1", "true", "yes", "on"}
EMAIL_RECOVERY_CONFIGURED = bool(SMTP_HOST and SMTP_FROM and (SMTP_USE_SSL or SMTP_STARTTLS))
ALLOW_REMOTE_ACCOUNT_SETUP = os.getenv("PULSEDECK_ALLOW_REMOTE_SETUP", "false").strip().casefold() in {"1", "true", "yes", "on"}
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
            member_cache_flags=discord.MemberCacheFlags(voice=True),
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
AUTH_DIR = os.path.abspath(os.getenv(
    "PULSEDECK_DATA_DIR",
    os.path.join(os.environ["LOCALAPPDATA"], "PulseDeck")
    if os.environ.get("LOCALAPPDATA")
    else os.path.join(os.path.expanduser("~"), ".pulsedeck"),
))
os.makedirs(AUTH_DIR, exist_ok=True)
AUTH_DB_PATH = os.path.join(AUTH_DIR, "accounts.sqlite3")
AUTH_SESSIONS: dict[str, str] = {}
AUTH_SESSION_TYPES: dict[str, str] = {}
AUTH_ATTEMPTS: dict[str, list[float]] = {}
AUTH_PAIRINGS: dict[str, tuple[str, float]] = {}
RECOVERY_REQUEST_ATTEMPTS: dict[str, list[float]] = {}
AUTH_LOCK = threading.Lock()
PAIRING_LOCK = threading.Lock()
PAIRING_TTL_SECONDS = 300
SERVER_INSTANCE_ID = uuid.uuid4().hex
PASSWORD_HASH_ROUNDS = 310_000

SPOTIFY_CLIENT_ID = os.getenv("PULSEDECK_SPOTIFY_CLIENT_ID", "").strip()
SPOTIFY_CLIENT_SECRET = os.getenv("PULSEDECK_SPOTIFY_CLIENT_SECRET", "").strip()
SPOTIFY_REDIRECT_URI = os.getenv(
    "PULSEDECK_SPOTIFY_REDIRECT_URI",
    "http://127.0.0.1:8000/api/spotify/callback",
).strip()
SPOTIFY_SCOPES = "user-read-playback-state user-read-currently-playing user-modify-playback-state"
SPOTIFY_OAUTH_STATES: dict[str, float] = {}
SPOTIFY_LOCK = threading.Lock()


class AccountCredentials(BaseModel):
    username: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=10, max_length=256)
    email: str | None = Field(default=None, max_length=254)


class RecoveryRequest(BaseModel):
    identifier: str = Field(min_length=3, max_length=254)


class RecoveryCompletion(BaseModel):
    token: str = Field(min_length=32, max_length=128)
    password: str = Field(min_length=10, max_length=256)


class RecoveryEmailRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)


class RecoveryEmailVerification(BaseModel):
    token: str = Field(min_length=32, max_length=128)


class AccountProfileUpdate(BaseModel):
    username: str = Field(min_length=1, max_length=254)
    display_name: str = Field(default="", max_length=80)
    email: str = Field(default="", max_length=254)
    phone_number: str = Field(default="", max_length=32)
    profile_photo: str | None = Field(default=None, max_length=1_500_000)


class PairingRequest(BaseModel):
    code: str = Field(min_length=32, max_length=64)


@contextmanager
def auth_db():
    connection = sqlite3.connect(AUTH_DB_PATH, timeout=5)
    try:
        connection.execute(
            "CREATE TABLE IF NOT EXISTS account (id INTEGER PRIMARY KEY CHECK (id = 1), username TEXT NOT NULL UNIQUE, salt BLOB NOT NULL, password_hash BLOB NOT NULL, email TEXT, email_verified INTEGER NOT NULL DEFAULT 0)"
        )
        connection.execute("CREATE UNIQUE INDEX IF NOT EXISTS account_username_unique_nocase ON account(username COLLATE NOCASE)")
        account_columns = {row[1] for row in connection.execute("PRAGMA table_info(account)")}
        if "email" not in account_columns:
            connection.execute("ALTER TABLE account ADD COLUMN email TEXT")
        if "email_verified" not in account_columns:
            connection.execute("ALTER TABLE account ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0")
        for column in ("display_name", "account_email", "phone_number", "profile_photo"):
            if column not in account_columns:
                connection.execute(f"ALTER TABLE account ADD COLUMN {column} TEXT")
        connection.execute(
            "UPDATE account SET account_email = username WHERE account_email IS NULL AND instr(username, '@') > 1 AND instr(username, '.') > instr(username, '@')"
        )
        connection.execute(
            "CREATE TABLE IF NOT EXISTS api_sessions (token_hash TEXT PRIMARY KEY, username TEXT NOT NULL, created_at REAL NOT NULL, session_type TEXT NOT NULL DEFAULT 'pc')"
        )
        connection.execute(
            "CREATE TABLE IF NOT EXISTS spotify_credentials (id INTEGER PRIMARY KEY CHECK (id = 1), access_token TEXT NOT NULL, refresh_token TEXT NOT NULL, expires_at REAL NOT NULL)"
        )
        connection.execute(
            "CREATE TABLE IF NOT EXISTS account_recovery_tokens (token_hash TEXT PRIMARY KEY, account_id INTEGER NOT NULL, purpose TEXT NOT NULL, email TEXT, created_at REAL NOT NULL, expires_at REAL NOT NULL)"
        )
        session_columns = {row[1] for row in connection.execute("PRAGMA table_info(api_sessions)")}
        if "session_type" not in session_columns:
            connection.execute(
                "ALTER TABLE api_sessions ADD COLUMN session_type TEXT NOT NULL DEFAULT 'legacy'"
            )
        for column, declaration in (
            ("device_id", "TEXT"),
            ("device_name", "TEXT"),
            ("last_seen", "REAL"),
        ):
            if column not in session_columns:
                connection.execute(f"ALTER TABLE api_sessions ADD COLUMN {column} {declaration}")
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


with auth_db() as auth_connection:
    AUTH_SESSIONS.update(auth_connection.execute(
        "SELECT token_hash, username FROM api_sessions WHERE session_type = 'pc'"
    ).fetchall())
    AUTH_SESSION_TYPES.update(auth_connection.execute(
        "SELECT token_hash, session_type FROM api_sessions WHERE session_type = 'pc'"
    ).fetchall())


def password_digest(password: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_HASH_ROUNDS)


EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
RECOVERY_TOKEN_TTL = 30 * 60


def normalize_email(value: str) -> str:
    email = value.strip().casefold()
    if len(email) > 254 or not EMAIL_PATTERN.fullmatch(email):
        raise HTTPException(status_code=422, detail="Enter a valid email address")
    return email


def send_account_email(recipient: str, subject: str, body: str) -> None:
    if not EMAIL_RECOVERY_CONFIGURED:
        raise HTTPException(status_code=503, detail="Email recovery is not configured on this PulseDeck host")
    message = EmailMessage()
    message["From"] = SMTP_FROM
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(body)
    try:
        if SMTP_USE_SSL:
            with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=15) as server:
                if SMTP_USERNAME:
                    server.login(SMTP_USERNAME, SMTP_PASSWORD)
                server.send_message(message)
        else:
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as server:
                server.ehlo()
                if SMTP_STARTTLS:
                    server.starttls()
                    server.ehlo()
                if SMTP_USERNAME:
                    server.login(SMTP_USERNAME, SMTP_PASSWORD)
                server.send_message(message)
    except Exception as error:
        print(f"PulseDeck email delivery failed: {type(error).__name__}")
        raise HTTPException(status_code=503, detail="PulseDeck could not send email. Check its SMTP settings.") from error


def create_recovery_token(connection, account_id: int, purpose: str, email: str | None = None) -> str:
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = time.time()
    connection.execute(
        "INSERT INTO account_recovery_tokens (token_hash, account_id, purpose, email, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
        (token_hash, account_id, purpose, email, now, now + RECOVERY_TOKEN_TTL),
    )
    return token


def account_link_base(request: Request) -> str:
    if FRONTEND_PUBLIC_URL:
        return FRONTEND_PUBLIC_URL
    base_url = str(request.base_url).rstrip("/")
    parsed = urllib.parse.urlsplit(base_url)
    if parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
        return base_url
    local_addresses = set()
    for interface_addresses in psutil.net_if_addrs().values():
        for address in interface_addresses:
            if address.family != socket.AF_INET:
                continue
            try:
                candidate = ipaddress.ip_address(address.address)
            except ValueError:
                continue
            if candidate.is_private and not candidate.is_loopback and not candidate.is_link_local:
                local_addresses.add(str(candidate))
    if not local_addresses:
        return base_url
    port = f":{parsed.port}" if parsed.port else ""
    return f"{parsed.scheme}://{sorted(local_addresses)[0]}{port}"


def issue_session(
    username: str,
    *,
    persistent: bool = True,
    session_type: str = "pc",
    device_id: str | None = None,
    device_name: str | None = None,
) -> str:
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    with AUTH_LOCK:
        if persistent:
            with auth_db() as connection:
                connection.execute(
                    "INSERT INTO api_sessions (token_hash, username, created_at, session_type, device_id, device_name, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (token_hash, username, time.time(), session_type, device_id, device_name, time.time() if session_type == "phone" else None),
                )
        AUTH_SESSIONS[token_hash] = username
        AUTH_SESSION_TYPES[token_hash] = session_type
    return token



ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "PULSEDECK_ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://tauri.localhost",
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

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.abspath(os.getenv(
    "PULSEDECK_FRONTEND_DIR",
    os.path.join(BACKEND_DIR, "..", "frontend", "dist"),
))
FRONTEND_ASSETS_DIR = os.path.join(FRONTEND_DIR, "assets")
if os.path.isdir(FRONTEND_ASSETS_DIR):
    app.mount("/assets", StaticFiles(directory=FRONTEND_ASSETS_DIR), name="frontend-assets")


def request_is_from_host(request: Request) -> bool:
    if not request.client:
        return False
    try:
        peer = ipaddress.ip_address(request.client.host.split("%", 1)[0])
    except ValueError:
        return False
    if peer.is_loopback:
        return True
    if isinstance(peer, ipaddress.IPv6Address) and peer.ipv4_mapped:
        peer = peer.ipv4_mapped
    for interface_addresses in psutil.net_if_addrs().values():
        for address in interface_addresses:
            if address.family not in (socket.AF_INET, socket.AF_INET6):
                continue
            try:
                local = ipaddress.ip_address(address.address.split("%", 1)[0])
            except ValueError:
                continue
            if isinstance(local, ipaddress.IPv6Address) and local.ipv4_mapped:
                local = local.ipv4_mapped
            if peer == local:
                return True
    return False


def require_token(request: Request, x_api_token: str | None = Header(default=None)):
    if x_api_token:
        token_hash = hashlib.sha256(x_api_token.encode("utf-8")).hexdigest()
        username = AUTH_SESSIONS.get(token_hash)
        if username:
            if AUTH_SESSION_TYPES.get(token_hash) == "phone":
                with auth_db() as connection:
                    connection.execute("UPDATE api_sessions SET last_seen = ? WHERE token_hash = ?", (time.time(), token_hash))
            return username
        with auth_db() as connection:
            row = connection.execute(
                "SELECT username, session_type FROM api_sessions WHERE token_hash = ?",
                (token_hash,),
            ).fetchone()
            if row and row[1] == "phone":
                connection.execute("UPDATE api_sessions SET last_seen = ? WHERE token_hash = ?", (time.time(), token_hash))
        if row and row[1] in {"pc", "phone"}:
            AUTH_SESSIONS[token_hash] = row[0]
            AUTH_SESSION_TYPES[token_hash] = row[1]
            return row[0]
        if row and row[1] == "legacy" and request_is_from_host(request):
            with AUTH_LOCK, auth_db() as connection:
                connection.execute(
                    "UPDATE api_sessions SET session_type = 'pc' WHERE token_hash = ?",
                    (token_hash,),
                )
                AUTH_SESSIONS[token_hash] = row[0]
                AUTH_SESSION_TYPES[token_hash] = "pc"
            return row[0]
        if API_TOKEN and hmac.compare_digest(x_api_token, API_TOKEN):
            return "legacy"
    raise HTTPException(status_code=401, detail="Sign in to control this PC")


def require_pc_session(request: Request, x_api_token: str | None = Header(default=None)):
    username = require_token(request, x_api_token)
    if x_api_token:
        token_hash = hashlib.sha256(x_api_token.encode("utf-8")).hexdigest()
        if AUTH_SESSION_TYPES.get(token_hash) == "phone":
            raise HTTPException(status_code=403, detail="Only the PC can manage paired phones")
    return username


@app.get("/", include_in_schema=False)
def serve_frontend():
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if not os.path.isfile(index_path):
        raise HTTPException(status_code=404, detail="PulseDeck's frontend is deployed separately")
    return FileResponse(index_path)


@app.get("/account", include_in_schema=False)
def serve_account_page():
    return serve_frontend()


@app.get("/api/auth/status")
def get_auth_status(request: Request):
    with auth_db() as connection:
        account = connection.execute("SELECT email, email_verified FROM account WHERE id = 1").fetchone()
    from_host = request_is_from_host(request)
    return {
        "account_configured": account is not None,
        "can_create_account": from_host or ALLOW_REMOTE_ACCOUNT_SETUP,
        "can_reset_password": from_host,
        "email_recovery_configured": EMAIL_RECOVERY_CONFIGURED,
        "recovery_email_verified": bool(account and account[0] and account[1]),
    }


def account_profile_result(row):
    display_name = row[3]
    if not display_name:
        display_name = (row[6] or row[0] or "").split("@", 1)[0].replace(".", " ").replace("_", " ").replace("-", " ").strip()
    return {
        "username": row[0],
        "email": row[6] or "",
        "recovery_email": row[1] or "",
        "recovery_email_verified": bool(row[2]),
        "email_recovery_configured": EMAIL_RECOVERY_CONFIGURED,
        "display_name": display_name,
        "phone_number": row[4] or "",
        "profile_photo": row[5],
    }


@app.get("/api/account/profile")
def get_account_profile(username: str = Depends(require_token)):
    if username == "legacy":
        raise HTTPException(status_code=403, detail="Sign in with your PulseDeck account to view the profile")
    with auth_db() as connection:
        row = connection.execute(
            "SELECT username, email, email_verified, display_name, phone_number, profile_photo, account_email FROM account WHERE id = 1"
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="PulseDeck account not found")
    return account_profile_result(row)


@app.post("/api/account/profile")
def update_account_profile(payload: AccountProfileUpdate, username: str = Depends(require_token)):
    if username == "legacy":
        raise HTTPException(status_code=403, detail="Sign in with your PulseDeck account to update the profile")
    requested_username = payload.username.strip()
    if not requested_username:
        raise HTTPException(status_code=422, detail="Username is required")
    display_name = payload.display_name.strip()
    contact_email = normalize_email(payload.email) if payload.email.strip() else ""
    phone_number = payload.phone_number.strip()
    profile_photo = payload.profile_photo
    if profile_photo:
        match = re.fullmatch(r"data:image/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})", profile_photo)
        if not match:
            raise HTTPException(status_code=422, detail="Use a PNG, JPEG, or WebP profile photo")
        try:
            photo_bytes = base64.b64decode(match.group(1), validate=True)
        except ValueError as error:
            raise HTTPException(status_code=422, detail="The profile photo could not be read") from error
        if not photo_bytes or len(photo_bytes) > 1024 * 1024:
            raise HTTPException(status_code=422, detail="The profile photo must be smaller than 1 MB")
    with AUTH_LOCK, auth_db() as connection:
        account = connection.execute("SELECT username FROM account WHERE id = 1").fetchone()
        if not account:
            raise HTTPException(status_code=404, detail="PulseDeck account not found")
        current_username = account[0]
        existing_usernames = connection.execute("SELECT username FROM account WHERE id != 1").fetchall()
        if any(existing[0].casefold() == requested_username.casefold() for existing in existing_usernames):
            raise HTTPException(status_code=409, detail="That username is already in use")
        cursor = connection.execute(
            "UPDATE account SET username = ?, display_name = ?, account_email = ?, phone_number = ?, profile_photo = ? WHERE id = 1",
            (requested_username, display_name, contact_email, phone_number, profile_photo),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="PulseDeck account not found")
        row = connection.execute(
            "SELECT username, email, email_verified, display_name, phone_number, profile_photo, account_email FROM account WHERE id = 1"
        ).fetchone()
        if current_username != requested_username:
            connection.execute("UPDATE api_sessions SET username = ? WHERE username = ?", (requested_username, current_username))
            for token_hash, session_username in list(AUTH_SESSIONS.items()):
                if session_username == current_username:
                    AUTH_SESSIONS[token_hash] = requested_username
            for pairing_code, (owner, expires_at) in list(AUTH_PAIRINGS.items()):
                if owner == current_username:
                    AUTH_PAIRINGS[pairing_code] = (requested_username, expires_at)
    return account_profile_result(row)


@app.get("/api/connect-info")
def get_connect_info():
    if FRONTEND_PUBLIC_URL:
        urls = [FRONTEND_PUBLIC_URL]
    else:
        addresses = set()
        for interface_addresses in psutil.net_if_addrs().values():
            for address in interface_addresses:
                if address.family != socket.AF_INET:
                    continue
                try:
                    ip = ipaddress.ip_address(address.address)
                except ValueError:
                    continue
                if ip.is_private and not ip.is_loopback and not ip.is_link_local:
                    addresses.add(str(ip))
        urls = [f"http://{address}:8000" for address in sorted(addresses)]
    return {
        "urls": urls,
        "server_instance_id": SERVER_INSTANCE_ID,
    }


@app.post("/api/auth/register")
def register_account(credentials: AccountCredentials, request: Request):
    if not request_is_from_host(request) and not ALLOW_REMOTE_ACCOUNT_SETUP:
        raise HTTPException(status_code=403, detail="Create the PulseDeck account from the PC running PulseDeck.")
    username = credentials.username.strip()
    if not username:
        raise HTTPException(status_code=422, detail="Username is required")
    email = normalize_email(credentials.email) if credentials.email else None
    if email and not EMAIL_RECOVERY_CONFIGURED:
        raise HTTPException(status_code=503, detail="Configure SMTP on the PulseDeck host before adding recovery email")
    verification_required = False
    with AUTH_LOCK, auth_db() as connection:
        if connection.execute("SELECT 1 FROM account WHERE id = 1").fetchone():
            raise HTTPException(status_code=409, detail="An account is already set up on this PC")
        if email:
            challenge = create_recovery_token(connection, 1, "verify_email", email)
            link_base = account_link_base(request)
            send_account_email(
                email,
                "Verify your PulseDeck recovery email",
                f"Open this link to verify the recovery email for PulseDeck:\n\n{link_base}/account#verify-email={urllib.parse.quote(challenge)}\n\nThis link expires in 30 minutes. If you did not create this account, you can ignore this email.",
            )
            verification_required = True
        salt = secrets.token_bytes(16)
        connection.execute(
            "INSERT INTO account (id, username, salt, password_hash, email, email_verified) VALUES (1, ?, ?, ?, ?, 0)",
            (username, salt, password_digest(credentials.password, salt), email),
        )
    return {"token": issue_session(username), "username": username, "remember": True, "email_verification_required": verification_required, "email": email}


@app.post("/api/auth/login")
def login_account(credentials: AccountCredentials, request: Request):
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
    return {"token": issue_session(username, persistent=True), "username": username, "remember": True}


@app.post("/api/auth/reset")
def reset_account_password(credentials: AccountCredentials, request: Request):
    if not request_is_from_host(request):
        raise HTTPException(status_code=403, detail="For security, reset the password from the PC running PulseDeck.")
    requested_username = credentials.username.strip()
    with AUTH_LOCK:
        with auth_db() as connection:
            row = connection.execute("SELECT username FROM account WHERE id = 1").fetchone()
            if not row or not hmac.compare_digest(row[0].casefold().encode("utf-8"), requested_username.casefold().encode("utf-8")):
                raise HTTPException(status_code=404, detail="Account not found on this PC")
            username = row[0]
            salt = secrets.token_bytes(16)
            connection.execute(
                "UPDATE account SET salt = ?, password_hash = ? WHERE id = 1",
                (salt, password_digest(credentials.password, salt)),
            )
            connection.execute("DELETE FROM api_sessions")
            connection.execute("DELETE FROM account_recovery_tokens")
        AUTH_SESSIONS.clear()
        AUTH_SESSION_TYPES.clear()
    return {"token": issue_session(username), "username": username, "remember": True}


@app.get("/api/auth/recovery/status")
def get_recovery_status(username: str = Depends(require_token)):
    with auth_db() as connection:
        row = connection.execute("SELECT email, email_verified FROM account WHERE id = 1").fetchone()
    email = row[0] if row else None
    masked = None
    if email and "@" in email:
        local, domain = email.split("@", 1)
        masked = f"{local[:1]}{'*' * max(2, min(len(local) - 1, 6))}@{domain}"
    return {"email_recovery_configured": EMAIL_RECOVERY_CONFIGURED, "email_verified": bool(row and row[1]), "email_masked": masked}


@app.post("/api/auth/recovery/email")
def set_recovery_email(payload: RecoveryEmailRequest, request: Request, username: str = Depends(require_token)):
    if not EMAIL_RECOVERY_CONFIGURED:
        raise HTTPException(status_code=503, detail="Email recovery is not configured on this PulseDeck host")
    email = normalize_email(payload.email)
    link_base = account_link_base(request)
    with AUTH_LOCK, auth_db() as connection:
        duplicate = connection.execute("SELECT id FROM account WHERE lower(email) = ? AND id != 1", (email,)).fetchone()
        if duplicate:
            raise HTTPException(status_code=409, detail="That email address is already used by another account")
        connection.execute("DELETE FROM account_recovery_tokens WHERE account_id = 1 AND purpose = 'verify_email'")
        token = create_recovery_token(connection, 1, "verify_email", email)
        connection.execute("UPDATE account SET email = ?, email_verified = 0 WHERE id = 1", (email,))
        send_account_email(
            email,
            "Verify your PulseDeck recovery email",
            f"Open this link to verify the recovery email for PulseDeck:\n\n{link_base}/account#verify-email={urllib.parse.quote(token)}\n\nThis link expires in 30 minutes. If you did not request this, you can ignore this email.",
        )
    return {"status": "verification_sent"}


@app.post("/api/auth/recovery/verify-email")
def verify_recovery_email(payload: RecoveryEmailVerification):
    token_hash = hashlib.sha256(payload.token.encode("utf-8")).hexdigest()
    with AUTH_LOCK, auth_db() as connection:
        row = connection.execute(
            "SELECT account_id, email, expires_at FROM account_recovery_tokens WHERE token_hash = ? AND purpose = 'verify_email'",
            (token_hash,),
        ).fetchone()
        if not row or row[2] <= time.time():
            raise HTTPException(status_code=400, detail="This email verification link has expired or was already used")
        account_id, email, _expires_at = row
        connection.execute("UPDATE account SET email = ?, email_verified = 1 WHERE id = ?", (email, account_id))
        connection.execute("DELETE FROM account_recovery_tokens WHERE token_hash = ?", (token_hash,))
    return {"status": "email_verified"}


@app.post("/api/auth/recovery/request")
def request_password_recovery(payload: RecoveryRequest, request: Request):
    generic_response = {"status": "if_recovery_email_is_verified_a_link_was_sent"}
    if not EMAIL_RECOVERY_CONFIGURED:
        raise HTTPException(status_code=503, detail="Email recovery is not configured on this PulseDeck host")
    client_key = request.client.host if request.client else "unknown"
    now = time.time()
    recent = [stamp for stamp in RECOVERY_REQUEST_ATTEMPTS.get(client_key, []) if now - stamp < 3600]
    if len(recent) >= 5:
        RECOVERY_REQUEST_ATTEMPTS[client_key] = recent
        return generic_response
    recent.append(now)
    RECOVERY_REQUEST_ATTEMPTS[client_key] = recent
    identifier = payload.identifier.strip().casefold()
    token = None
    email = None
    with AUTH_LOCK, auth_db() as connection:
        row = connection.execute(
            "SELECT id, username, email FROM account WHERE lower(username) = ? OR lower(email) = ?",
            (identifier, identifier),
        ).fetchone()
        if row:
            account_id, _username, email = row
            verified = connection.execute("SELECT email_verified FROM account WHERE id = ?", (account_id,)).fetchone()
            if email and verified and verified[0]:
                connection.execute("DELETE FROM account_recovery_tokens WHERE account_id = ? AND purpose = 'reset_password'", (account_id,))
                token = create_recovery_token(connection, account_id, "reset_password")
    if token and email:
        link_base = account_link_base(request)
        try:
            send_account_email(
                email,
                "Reset your PulseDeck password",
                f"Open this link to reset your PulseDeck password:\n\n{link_base}/account#recover={urllib.parse.quote(token)}\n\nThis one-time link expires in 30 minutes. If you did not request a reset, ignore this email; your password will not change.",
            )
        except HTTPException:
            with AUTH_LOCK, auth_db() as connection:
                connection.execute("DELETE FROM account_recovery_tokens WHERE token_hash = ?", (hashlib.sha256(token.encode("utf-8")).hexdigest(),))
    return generic_response


@app.post("/api/auth/recovery/complete")
def complete_password_recovery(payload: RecoveryCompletion):
    token_hash = hashlib.sha256(payload.token.encode("utf-8")).hexdigest()
    with AUTH_LOCK, auth_db() as connection:
        row = connection.execute(
            "SELECT account_id, expires_at FROM account_recovery_tokens WHERE token_hash = ? AND purpose = 'reset_password'",
            (token_hash,),
        ).fetchone()
        if not row or row[1] <= time.time():
            raise HTTPException(status_code=400, detail="This password reset link has expired or was already used")
        account_id = row[0]
        account = connection.execute("SELECT username FROM account WHERE id = ?", (account_id,)).fetchone()
        if not account:
            raise HTTPException(status_code=400, detail="The account for this reset link no longer exists")
        username = account[0]
        salt = secrets.token_bytes(16)
        connection.execute(
            "UPDATE account SET salt = ?, password_hash = ? WHERE id = ?",
            (salt, password_digest(payload.password, salt), account_id),
        )
        connection.execute("DELETE FROM api_sessions")
        connection.execute("DELETE FROM account_recovery_tokens WHERE account_id = ?", (account_id,))
        AUTH_SESSIONS.clear()
        AUTH_SESSION_TYPES.clear()
    return {"token": issue_session(username), "username": username, "remember": True}


@app.post("/api/auth/logout")
def logout_account(x_api_token: str | None = Header(default=None)):
    if x_api_token:
        token_hash = hashlib.sha256(x_api_token.encode("utf-8")).hexdigest()
        with AUTH_LOCK, auth_db() as connection:
            connection.execute("DELETE FROM api_sessions WHERE token_hash = ?", (token_hash,))
            AUTH_SESSIONS.pop(token_hash, None)
            AUTH_SESSION_TYPES.pop(token_hash, None)
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


def discover_start_menu_apps():
    """Return launchable shortcuts from the current and common Windows Start Menus."""
    roots = {
        os.path.join(os.environ.get("APPDATA", ""), "Microsoft", "Windows", "Start Menu", "Programs"),
        os.path.join(os.environ.get("PROGRAMDATA", "C:\\ProgramData"), "Microsoft", "Windows", "Start Menu", "Programs"),
    }
    apps = []
    seen = set()
    for root in roots:
        if not os.path.isdir(root):
            continue
        for directory, _, filenames in os.walk(root):
            for filename in filenames:
                if not filename.lower().endswith((".lnk", ".url")):
                    continue
                shortcut = os.path.abspath(os.path.join(directory, filename))
                normalized = os.path.normcase(shortcut)
                if normalized in seen:
                    continue
                seen.add(normalized)
                app_id = "shortcut-" + hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:32]
                apps.append({"id": app_id, "label": os.path.splitext(filename)[0], "shortcut": shortcut})
    apps.sort(key=lambda item: item["label"].casefold())
    return apps


@app.post("/api/auth/pairing")
def create_pairing_code(request: Request, username: str = Depends(require_token)):
    if not request_is_from_host(request) and not ALLOW_REMOTE_ACCOUNT_SETUP:
        raise HTTPException(status_code=403, detail="Generate a phone pairing QR from the PC running PulseDeck.")
    code = secrets.token_urlsafe(32)
    code_hash = hashlib.sha256(code.encode("utf-8")).hexdigest()
    now = time.time()
    expires_at = now + PAIRING_TTL_SECONDS
    with PAIRING_LOCK:
        expired = [key for key, (owner, expiry) in AUTH_PAIRINGS.items() if expiry <= now or owner == username]
        for key in expired:
            AUTH_PAIRINGS.pop(key, None)
        AUTH_PAIRINGS[code_hash] = (username, expires_at)
    return {"code": code, "expires_in": PAIRING_TTL_SECONDS}


def phone_device_name(user_agent: str) -> str:
    lowered = user_agent.casefold()
    if "ipad" in lowered:
        return "iPad"
    if "iphone" in lowered:
        return "iPhone"
    if "android" in lowered:
        return "Android phone"
    return "Phone"


@app.post("/api/auth/pair")
def pair_phone(pairing: PairingRequest, request: Request):
    code_hash = hashlib.sha256(pairing.code.encode("utf-8")).hexdigest()
    with PAIRING_LOCK:
        entry = AUTH_PAIRINGS.pop(code_hash, None)
    if not entry or entry[1] <= time.time():
        raise HTTPException(status_code=401, detail="This pairing QR has expired or was already used. Refresh it on the PC.")
    username = entry[0]
    device_name = phone_device_name(request.headers.get("user-agent", ""))
    device_id = uuid.uuid4().hex
    token = issue_session(username, persistent=True, session_type="phone", device_id=device_id, device_name=device_name)
    return {"token": token, "username": username, "remember": True, "device_id": device_id, "device_name": device_name}


@app.get("/api/phones")
def get_connected_phones(username: str = Depends(require_pc_session)):
    now = time.time()
    with auth_db() as connection:
        rows = connection.execute(
            "SELECT device_id, device_name, created_at, last_seen FROM api_sessions WHERE username = ? AND session_type = 'phone' ORDER BY created_at DESC",
            (username,),
        ).fetchall()
    return {
        "phones": [
            {
                "id": row[0],
                "name": row[1] or "Phone",
                "paired_at": row[2],
                "last_seen": row[3],
                "connected": row[3] is not None and now - row[3] <= 45,
            }
            for row in rows
        ]
    }


@app.post("/api/phones/{device_id}/remove")
def remove_connected_phone(device_id: str, username: str = Depends(require_pc_session)):
    with AUTH_LOCK, auth_db() as connection:
        rows = connection.execute(
            "SELECT token_hash FROM api_sessions WHERE username = ? AND session_type = 'phone' AND device_id = ?",
            (username, device_id),
        ).fetchall()
        if not rows:
            raise HTTPException(status_code=404, detail="That phone is no longer paired")
        connection.execute(
            "DELETE FROM api_sessions WHERE username = ? AND session_type = 'phone' AND device_id = ?",
            (username, device_id),
        )
        for (token_hash,) in rows:
            AUTH_SESSIONS.pop(token_hash, None)
            AUTH_SESSION_TYPES.pop(token_hash, None)
    return {"status": "removed", "device_id": device_id}


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
        return read_spotify_window_track() or spotify_current_track() or track

    properties = await session.try_get_media_properties_async()
    title = (properties.title or "").strip()
    artist = (properties.artist or "").strip()
    if not title:
        # An idle Windows media session can exist while Spotify's Web API still
        # reports the user's current or paused track.
        return spotify_current_track() or track
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
        if fallback:
            return fallback
        api_track = spotify_current_track()
        return api_track or {
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


def spotify_token_row():
    with auth_db() as connection:
        row = connection.execute(
            "SELECT access_token, refresh_token, expires_at FROM spotify_credentials WHERE id = 1"
        ).fetchone()
    return row


def spotify_save_tokens(payload, previous_refresh=""):
    refresh_token = payload.get("refresh_token") or previous_refresh
    if not payload.get("access_token") or not refresh_token:
        raise RuntimeError("Spotify did not return the required tokens")
    expires_at = time.time() + max(60, int(payload.get("expires_in", 3600)) - 30)
    with auth_db() as connection:
        connection.execute(
            "INSERT INTO spotify_credentials (id, access_token, refresh_token, expires_at) VALUES (1, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET access_token=excluded.access_token, refresh_token=excluded.refresh_token, expires_at=excluded.expires_at",
            (payload["access_token"], refresh_token, expires_at),
        )


def spotify_access_token():
    if not SPOTIFY_CLIENT_ID or not SPOTIFY_CLIENT_SECRET:
        return None
    row = spotify_token_row()
    if not row:
        return None
    access_token, refresh_token, expires_at = row
    if expires_at > time.time():
        return access_token
    encoded = base64.b64encode(f"{SPOTIFY_CLIENT_ID}:{SPOTIFY_CLIENT_SECRET}".encode()).decode()
    headers = {"Authorization": f"Basic {encoded}", "Content-Type": "application/x-www-form-urlencoded"}
    request = urllib.request.Request(
        "https://accounts.spotify.com/api/token",
        data=urllib.parse.urlencode({"grant_type": "refresh_token", "refresh_token": refresh_token}).encode(),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
        spotify_save_tokens(payload, refresh_token)
        return payload["access_token"]
    except Exception as exc:
        print(f"Spotify token refresh failed: {exc}")
        return None


def spotify_api_call(method, path, payload=None):
    token = spotify_access_token()
    if not token:
        return None
    url = f"https://api.spotify.com/v1{path}"
    headers = {"Accept": "application/json", "Authorization": f"Bearer {token}"}
    body = None
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            raw = response.read()
        return json.loads(raw.decode("utf-8")) if raw else {}
    except urllib.error.HTTPError as exc:
        if exc.code == 204:
            return {}
        if exc.code == 401:
            return None
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Spotify API returned HTTP {exc.code}: {detail[:300]}") from exc


def spotify_current_track():
    try:
        data = spotify_api_call("GET", "/me/player/currently-playing")
        item = (data or {}).get("item")
        if not item:
            return None
        images = item.get("album", {}).get("images", [])
        return {
            "title": item.get("name") or "Not Playing",
            "artist": ", ".join(artist.get("name", "") for artist in item.get("artists", []) if artist.get("name")) or "Spotify",
            "is_playing": bool(data.get("is_playing")),
            "device_id": (data.get("device") or {}).get("id"),
            "artwork": images[0].get("url", "") if images else "",
            "position": max(0, data.get("progress_ms") or 0) / 1000,
            "duration": max(0, item.get("duration_ms") or 0) / 1000,
            "seek_min": 0,
            "seek_max": max(0, item.get("duration_ms") or 0) / 1000,
            "seekable": True,
        }
    except Exception:
        return None


def spotify_api_control(action, position_seconds=None):
    devices_result = spotify_api_call("GET", "/me/player/devices")
    devices = (devices_result or {}).get("devices", [])
    # This host controls the PC, so never redirect playback to a phone or a
    # speaker simply because it is the first Spotify Connect device returned.
    device = next((
        item for item in devices
        if item.get("type", "").casefold() == "computer" and item.get("id") and not item.get("is_restricted")
    ), None)
    if not device:
        try:
            os.startfile("spotify:")
            time.sleep(2)
            devices_result = spotify_api_call("GET", "/me/player/devices")
            devices = (devices_result or {}).get("devices", [])
            device = next((
                item for item in devices
                if item.get("type", "").casefold() == "computer" and item.get("id") and not item.get("is_restricted")
            ), None)
        except (OSError, RuntimeError):
            device = None
    if not device:
        raise RuntimeError("Spotify desktop is not available as a playback device. Open Spotify on this PC and try again; PulseDeck will not send music to your phone.")

    current = spotify_current_track()
    if current and current.get("device_id") != device["id"]:
        # If Spotify is playing elsewhere, move that same playback to this PC.
        spotify_api_call("PUT", "/me/player", {"device_ids": [device["id"]], "play": True})
        if action == "play_pause":
            return True
        current["is_playing"] = True
    if action == "play_pause":
        if current and current["is_playing"]:
            method, path = "PUT", "/me/player/pause"
        else:
            method, path = "PUT", "/me/player/play"
    elif action in {"next", "prev"}:
        method = "POST"
        path = "/me/player/next" if action == "next" else "/me/player/previous"
    elif action == "seek":
        method = "PUT"
        path = f"/me/player/seek?position_ms={max(0, int(position_seconds or 0) * 1000)}"
    else:
        return False

    path += ("&" if "?" in path else "?") + urllib.parse.urlencode({"device_id": device["id"]})
    return spotify_api_call(method, path) is not None


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
        if level == 0:
            volume.SetMute(1, None)
        elif volume.GetMute():
            volume.SetMute(0, None)
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



@app.get("/api/spotify/status", dependencies=[Depends(require_token)])
def spotify_connection_status():
    return {"configured": bool(SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET), "connected": bool(spotify_token_row())}


@app.post("/api/spotify/connect", dependencies=[Depends(require_token)])
def spotify_connect_url():
    if not SPOTIFY_CLIENT_ID or not SPOTIFY_CLIENT_SECRET:
        raise HTTPException(status_code=503, detail="Set PULSEDECK_SPOTIFY_CLIENT_ID and PULSEDECK_SPOTIFY_CLIENT_SECRET first")
    state = secrets.token_urlsafe(32)
    with SPOTIFY_LOCK:
        now = time.time()
        SPOTIFY_OAUTH_STATES.clear()
        SPOTIFY_OAUTH_STATES[state] = now + 600
    query = urllib.parse.urlencode({
        "client_id": SPOTIFY_CLIENT_ID,
        "response_type": "code",
        "redirect_uri": SPOTIFY_REDIRECT_URI,
        "scope": SPOTIFY_SCOPES,
        "state": state,
    })
    return {"url": f"https://accounts.spotify.com/authorize?{query}"}


def spotify_frontend_redirect(result: str):
    base = FRONTEND_PUBLIC_URL or ""
    return RedirectResponse(url=f"{base}/?spotify={urllib.parse.quote(result)}", status_code=303)


@app.get("/api/spotify/callback")
def spotify_oauth_callback(code: str = "", state: str = "", error: str = ""):
    with SPOTIFY_LOCK:
        expires_at = SPOTIFY_OAUTH_STATES.pop(state, 0)
    if not state or expires_at < time.time():
        return spotify_frontend_redirect("failed")
    if error or not code:
        return spotify_frontend_redirect("denied")
    encoded = base64.b64encode(f"{SPOTIFY_CLIENT_ID}:{SPOTIFY_CLIENT_SECRET}".encode()).decode()
    request = urllib.request.Request(
        "https://accounts.spotify.com/api/token",
        data=urllib.parse.urlencode({
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": SPOTIFY_REDIRECT_URI,
        }).encode(),
        headers={"Authorization": f"Basic {encoded}", "Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
        spotify_save_tokens(payload)
    except Exception as exc:
        print(f"Spotify authorization failed: {exc}")
        return spotify_frontend_redirect("failed")
    return spotify_frontend_redirect("connected")


@app.post("/api/spotify/disconnect", dependencies=[Depends(require_token)])
def spotify_disconnect():
    with auth_db() as connection:
        connection.execute("DELETE FROM spotify_credentials WHERE id = 1")
    return {"status": "ok"}


SPORTS_FOOTBALL_LEAGUES = {
    "eng.1", "esp.1", "ger.1", "ita.1", "fra.1", "uefa.champions",
    "usa.1", "fifa.world", "uefa.europa", "ind.1",
}
SPORTS_CACHE = {}


def normalized_football_score(competitor):
    score = competitor.get("score")
    if isinstance(score, dict):
        return score.get("displayValue") or score.get("value") or "\u2014"
    return score if score is not None else "\u2014"



def fetch_sports_json(url: str, cache_key: str, ttl: int = 60):
    cached = SPORTS_CACHE.get(cache_key)
    now = time.monotonic()
    if cached and cached[0] > now:
        return cached[1]
    try:
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
                "Accept": "application/json",
                "Referer": "https://www.espncricinfo.com/" if "espncricinfo.com" in url else "https://www.espn.com/",
            },
        )
        with urllib.request.urlopen(request, timeout=5.0) as response:
            data = json.loads(response.read().decode("utf-8"))
        if len(SPORTS_CACHE) >= 40:
            SPORTS_CACHE.pop(next(iter(SPORTS_CACHE)))
        SPORTS_CACHE[cache_key] = (now + ttl, data)
        return data
    except Exception as exc:
        if cached:
            return cached[1]
        raise HTTPException(status_code=502, detail="Sports scores are temporarily unavailable") from exc


@app.get("/api/sports/football/teams", dependencies=[Depends(require_token)])
def get_football_teams(league: str):
    if league not in SPORTS_FOOTBALL_LEAGUES:
        raise HTTPException(status_code=422, detail="Choose a supported football league")
    url = f"https://site.api.espn.com/apis/site/v2/sports/soccer/{league}/teams?limit=1000"
    data = fetch_sports_json(url, f"football-teams:{league}", ttl=86400)
    teams = []
    for sport in data.get("sports", []):
        for league_data in sport.get("leagues", []):
            for entry in league_data.get("teams", []):
                team = entry.get("team", {})
                if team.get("id") and team.get("displayName"):
                    teams.append({"id": str(team["id"]), "name": team["displayName"]})
    teams.sort(key=lambda team: team["name"].casefold())
    return {"teams": teams}


@app.get("/api/sports/football/score", dependencies=[Depends(require_token)])
def get_football_score(league: str, team: str):
    if league not in SPORTS_FOOTBALL_LEAGUES or not team.isdecimal():
        raise HTTPException(status_code=422, detail="Choose a supported football team")
    def normalize_event(event):
        competition = (event.get("competitions") or [{}])[0]
        competitors = competition.get("competitors", [])
        if not any(str(item.get("id")) == team for item in competitors):
            return None
        status = competition.get("status", {}).get("type", {})
        return {
            "id": str(event.get("id", "")),
            "name": event.get("shortName") or event.get("name", ""),
            "date": event.get("date"),
            "status": status.get("shortDetail") or status.get("detail") or "Scheduled",
            "state": status.get("state", "pre"),
            "teams": [{
                "id": str(item.get("id", "")),
                "name": item.get("team", {}).get("shortDisplayName") or item.get("team", {}).get("displayName", ""),
                "score": "" if status.get("state") == "pre" else normalized_football_score(item),
                "logo": item.get("team", {}).get("logo") or f"https://a.espncdn.com/i/teamlogos/soccer/500/{item.get('id', '')}.png",
                "homeAway": item.get("homeAway", ""),
            } for item in competitors],
            "url": f"https://www.espn.com/soccer/match/_/gameId/{event.get('id', '')}",
        }

    schedule_url = f"https://site.api.espn.com/apis/site/v2/sports/soccer/{league}/teams/{team}/schedule"
    schedule = fetch_sports_json(schedule_url, f"football-schedule:{league}:{team}", ttl=300)
    matches = [match for event in schedule.get("events", []) if (match := normalize_event(event))]
    live = sorted((item for item in matches if item["state"] == "in"), key=lambda item: item.get("date") or "")
    today = time.strftime("%Y-%m-%d", time.gmtime())
    upcoming = sorted((item for item in matches if item["state"] == "pre" and (item.get("date") or "") >= today), key=lambda item: item.get("date") or "")
    if not live and not upcoming:
        for day_offset in range(0, 31):
            date = time.strftime("%Y%m%d", time.gmtime(time.time() + day_offset * 86400))
            url = f"https://site.api.espn.com/apis/site/v2/sports/soccer/{league}/scoreboard?dates={date}"
            scoreboard = fetch_sports_json(url, f"football-scoreboard:{league}:{date}", ttl=120)
            future_matches = [match for event in scoreboard.get("events", []) if (match := normalize_event(event)) and match["state"] in {"in", "pre"}]
            if future_matches:
                live = sorted((item for item in future_matches if item["state"] == "in"), key=lambda item: item.get("date") or "")
                upcoming = sorted((item for item in future_matches if item["state"] == "pre"), key=lambda item: item.get("date") or "")
                break
    matches = live + upcoming
    return {"matches": matches[:3], "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}


@app.get("/api/sports/cricket/score", dependencies=[Depends(require_token)])
def get_cricket_score(team: str):
    if not team or len(team) > 80:
        raise HTTPException(status_code=422, detail="Choose a cricket team")
    url = "https://site.api.espn.com/apis/personalized/v2/scoreboard/header?sport=cricket&region=in&tz=Asia%2FCalcutta"
    data = fetch_sports_json(url, "cricket-scoreboard-header", ttl=60)
    needle = team.casefold()
    matches = []
    for sport in data.get("sports", []):
        for league in sport.get("leagues", []):
            for event in league.get("events", []):
                competitors = event.get("competitors", [])
                if not any(needle in str(item.get("displayName", "")).casefold() for item in competitors):
                    continue
                state = str(event.get("status", "")).casefold()
                full_status = event.get("fullStatus") or {}
                score_rows = [{
                    "name": item.get("displayName") or item.get("name", ""),
                    "score": "" if state == "pre" else str(item.get("score", "")),
                    "logo": item.get("logo", ""),
                } for item in competitors]
                matches.append({
                    "id": str(event.get("id", "")),
                    "name": event.get("name") or event.get("shortName") or "Cricket",
                    "date": event.get("date"),
                    "status": full_status.get("longSummary") or full_status.get("summary") or event.get("summary") or state.title(),
                    "state": state,
                    "teams": score_rows,
                    "url": event.get("link", ""),
                })
    live = sorted((item for item in matches if item["state"] == "in"), key=lambda item: item.get("date") or "")
    today = time.strftime("%Y-%m-%d", time.gmtime())
    upcoming = sorted((item for item in matches if item["state"] == "pre" and (item.get("date") or "") >= today), key=lambda item: item.get("date") or "")
    return {"matches": (live + upcoming)[:3], "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}


SHORTCUT_RECORDING_TIMEOUT_SECONDS = 20
_shortcut_recording_lock = threading.RLock()
_shortcut_recording = {
    "active": False,
    "shortcut": None,
    "cancelled": False,
    "error": None,
    "hook": None,
    "timer": None,
    "idle_timer": None,
    "pressed": set(),
    "modifiers": {},
    "current_stroke": None,
    "strokes": [],
    "force_windows_modifier": False,
    "finish_when_released": False,
}


def _recording_modifier_name(key_name, scan_code=None):
    aliases = {
        "ctrl": "ctrl", "left ctrl": "ctrl", "right ctrl": "ctrl",
        "alt": "alt", "left alt": "alt", "right alt": "alt",
        "shift": "shift", "left shift": "shift", "right shift": "shift",
        "windows": "windows", "win": "windows", "left win": "windows", "right win": "windows",
        "left windows": "windows", "right windows": "windows", "meta": "windows", "super": "windows",
    }
    if abs(scan_code or 0) in {91, 92, 57435, 57436}:
        return "windows"
    return aliases.get((key_name or "").lower())


def _finish_shortcut_recording(cancelled=False, error=None):
    with _shortcut_recording_lock:
        if not _shortcut_recording["active"]:
            return
        _shortcut_recording["active"] = False
        if cancelled:
            _shortcut_recording["cancelled"] = True
        if error:
            _shortcut_recording["error"] = error
        hook = _shortcut_recording["hook"]
        timer = _shortcut_recording["timer"]
        idle_timer = _shortcut_recording["idle_timer"]
        _shortcut_recording["hook"] = None
        _shortcut_recording["timer"] = None
        _shortcut_recording["idle_timer"] = None
        _shortcut_recording["pressed"].clear()
        _shortcut_recording["modifiers"].clear()

    if timer and timer is not threading.current_thread():
        timer.cancel()
    if idle_timer and idle_timer is not threading.current_thread():
        idle_timer.cancel()
    if hook:
        keyboard.unhook(hook)


def _finalize_shortcut_sequence():
    with _shortcut_recording_lock:
        if not _shortcut_recording["active"] or _shortcut_recording["pressed"] or not _shortcut_recording["strokes"]:
            return
        _shortcut_recording["shortcut"] = ", ".join(_shortcut_recording["strokes"])
    _finish_shortcut_recording()


def _schedule_shortcut_sequence_finish():
    timer = threading.Timer(4, _finalize_shortcut_sequence)
    timer.daemon = True
    with _shortcut_recording_lock:
        if not _shortcut_recording["active"]:
            return
        previous = _shortcut_recording["idle_timer"]
        _shortcut_recording["idle_timer"] = timer
    if previous:
        previous.cancel()
    timer.start()


def _capture_shortcut_event(event):
    finish = False
    with _shortcut_recording_lock:
        if not _shortcut_recording["active"]:
            return True

        scan_code = event.scan_code
        key_name = (event.name or "").lower()
        if event.event_type == keyboard.KEY_DOWN:
            if scan_code not in _shortcut_recording["pressed"]:
                idle_timer = _shortcut_recording["idle_timer"]
                _shortcut_recording["idle_timer"] = None
                if idle_timer:
                    idle_timer.cancel()
                _shortcut_recording["pressed"].add(scan_code)
                modifier = _recording_modifier_name(key_name, scan_code)
                if modifier:
                    _shortcut_recording["modifiers"][scan_code] = modifier
                elif key_name in {"esc", "escape"}:
                    _shortcut_recording["cancelled"] = True
                    _shortcut_recording["finish_when_released"] = True
                elif _shortcut_recording["current_stroke"] is None and not _shortcut_recording["finish_when_released"]:
                    active_modifiers = set(_shortcut_recording["modifiers"].values())
                    if _shortcut_recording["force_windows_modifier"]:
                        active_modifiers.add("windows")
                        _shortcut_recording["force_windows_modifier"] = False
                    ordered_modifiers = [name for name in ("ctrl", "alt", "shift", "windows") if name in active_modifiers]
                    candidate = "+".join((*ordered_modifiers, key_name))
                    if is_custom_shortcut(candidate):
                        _shortcut_recording["current_stroke"] = candidate
                    else:
                        _shortcut_recording["error"] = "That key cannot be used for a shortcut"
                    _shortcut_recording["finish_when_released"] = True
                elif _shortcut_recording["current_stroke"] is not None:
                    _shortcut_recording["error"] = "Press one non-modifier key per step"
                    _shortcut_recording["finish_when_released"] = True
        else:
            _shortcut_recording["pressed"].discard(scan_code)
            _shortcut_recording["modifiers"].pop(scan_code, None)
            if not _shortcut_recording["pressed"] and (_shortcut_recording["cancelled"] or _shortcut_recording["error"]):
                _shortcut_recording["current_stroke"] = None
                finish = True
            elif not _shortcut_recording["pressed"] and _shortcut_recording["current_stroke"]:
                _shortcut_recording["strokes"].append(_shortcut_recording["current_stroke"])
                _shortcut_recording["current_stroke"] = None
                _shortcut_recording["finish_when_released"] = False
                if len(_shortcut_recording["strokes"]) >= 5:
                    _shortcut_recording["shortcut"] = ", ".join(_shortcut_recording["strokes"])
                    finish = True

        if _shortcut_recording["finish_when_released"] and not _shortcut_recording["pressed"]:
            finish = True
        schedule_finish = not _shortcut_recording["pressed"] and bool(_shortcut_recording["strokes"]) and not finish

    if finish:
        threading.Timer(0.02, _finish_shortcut_recording).start()
    elif schedule_finish:
        _schedule_shortcut_sequence_finish()
    # Suppress all physical keyboard events until the chord is complete or recording ends.
    return False


def _timeout_shortcut_recording():
    _finish_shortcut_recording(cancelled=True, error="Shortcut recording timed out")


def _send_windows_shortcut_sequence(shortcut):
    class KeyboardInput(ctypes.Structure):
        _fields_ = (
            ("virtual_key", ctypes.c_ushort),
            ("scan_code", ctypes.c_ushort),
            ("flags", ctypes.c_ulong),
            ("time", ctypes.c_ulong),
            ("extra_info", ctypes.c_size_t),
        )

    class MouseInput(ctypes.Structure):
        _fields_ = (
            ("x", ctypes.c_long), ("y", ctypes.c_long),
            ("mouse_data", ctypes.c_ulong), ("flags", ctypes.c_ulong),
            ("time", ctypes.c_ulong), ("extra_info", ctypes.c_size_t),
        )

    class InputUnion(ctypes.Union):
        _fields_ = (("keyboard", KeyboardInput), ("mouse", MouseInput))

    class Input(ctypes.Structure):
        _fields_ = (("type", ctypes.c_ulong), ("payload", InputUnion))

    modifier_vks = {"ctrl": 0x11, "alt": 0x12, "shift": 0x10, "windows": 0x5B}
    key_up = 0x0002
    send_input = ctypes.windll.user32.SendInput
    send_input.argtypes = (ctypes.c_uint, ctypes.POINTER(Input), ctypes.c_int)
    send_input.restype = ctypes.c_uint

    steps = [step.strip() for step in shortcut.split(",")]
    for step_index, step in enumerate(steps):
        parts = [part.strip() for part in step.split("+")]
        modifiers = [modifier_vks[part] for part in parts[:-1]]
        key_codes = keyboard.key_to_scan_codes(parts[-1])
        key_vk = keyboard._winkeyboard.scan_code_to_vk.get(key_codes[0]) if key_codes else None
        if not key_vk:
            raise ValueError(f"No Windows virtual key found for {parts[-1]}")
        virtual_keys = [*modifiers, key_vk]
        events = (Input * (len(virtual_keys) * 2))(
            *(
                [Input(type=1, payload=InputUnion(keyboard=KeyboardInput(vk, 0, 0, 0, 0))) for vk in virtual_keys]
                + [Input(type=1, payload=InputUnion(keyboard=KeyboardInput(vk, 0, key_up, 0, 0))) for vk in reversed(virtual_keys)]
            )
        )
        sent = send_input(len(events), events, ctypes.sizeof(Input))
        if sent != len(events):
            raise OSError(f"Windows accepted {sent} of {len(events)} shortcut key events")
        if step_index < len(steps) - 1:
            time.sleep(0.15)


@app.post("/api/shortcuts/record/start", dependencies=[Depends(require_token)])
def start_shortcut_recording():
    with _shortcut_recording_lock:
        if _shortcut_recording["active"]:
            raise HTTPException(status_code=409, detail="Shortcut recording is already active")
        _shortcut_recording.update({
            "active": True,
            "shortcut": None,
            "cancelled": False,
            "error": None,
            "hook": None,
            "timer": None,
            "idle_timer": None,
            "pressed": set(),
            "modifiers": {},
            "current_stroke": None,
            "strokes": [],
            "force_windows_modifier": False,
            "finish_when_released": False,
        })
        try:
            hook = keyboard.hook(_capture_shortcut_event, suppress=True)
            timer = threading.Timer(SHORTCUT_RECORDING_TIMEOUT_SECONDS, _timeout_shortcut_recording)
            timer.daemon = True
            _shortcut_recording["hook"] = hook
            _shortcut_recording["timer"] = timer
            timer.start()
        except Exception as exc:
            _shortcut_recording["active"] = False
            _shortcut_recording["hook"] = None
            _shortcut_recording["timer"] = None
            raise HTTPException(status_code=502, detail="Could not start keyboard recording") from exc
    return {"status": "recording", "timeout_seconds": SHORTCUT_RECORDING_TIMEOUT_SECONDS}


@app.get("/api/shortcuts/record/status", dependencies=[Depends(require_token)])
def shortcut_recording_status():
    with _shortcut_recording_lock:
        return {
            "active": _shortcut_recording["active"],
            "shortcut": _shortcut_recording["shortcut"],
            "strokes": list(_shortcut_recording["strokes"]),
            "current_stroke": _shortcut_recording["current_stroke"],
            "force_windows_modifier": _shortcut_recording["force_windows_modifier"],
            "cancelled": _shortcut_recording["cancelled"],
            "error": _shortcut_recording["error"],
        }


@app.post("/api/shortcuts/record/modifier", dependencies=[Depends(require_token)])
def set_shortcut_recording_modifier(data: ShortcutRecordingModifierPayload):
    with _shortcut_recording_lock:
        if not _shortcut_recording["active"]:
            raise HTTPException(status_code=409, detail="Shortcut recording is not active")
        _shortcut_recording["force_windows_modifier"] = data.win
    return {"status": "ok", "win": data.win}


@app.post("/api/shortcuts/record/stop", dependencies=[Depends(require_token)])
def stop_shortcut_recording():
    _finish_shortcut_recording(cancelled=True)
    return {"status": "stopped"}


@app.post("/api/hotkey", dependencies=[Depends(require_token)])
def trigger_hotkey(data: HotkeyPayload):
    shortcut = data.shortcut.strip().lower()
    if shortcut not in ALLOWED_SHORTCUTS and not is_custom_shortcut(shortcut):
        raise HTTPException(status_code=422, detail="Shortcut is not allowed")
    try:
        if shortcut == "windows+l":
            if not ctypes.windll.user32.LockWorkStation():
                raise OSError("Windows could not lock the workstation")
        elif shortcut == "windows+print screen":
            import win32api
            import win32con
            import win32gui
            import win32ui

            left = win32api.GetSystemMetrics(76)  # SM_XVIRTUALSCREEN
            top = win32api.GetSystemMetrics(77)  # SM_YVIRTUALSCREEN
            width = win32api.GetSystemMetrics(78)  # SM_CXVIRTUALSCREEN
            height = win32api.GetSystemMetrics(79)  # SM_CYVIRTUALSCREEN
            if width <= 0 or height <= 0:
                raise OSError("Windows did not report a usable screen size")

            screenshot_dir = os.path.join(os.path.expanduser("~"), "Pictures", "Screenshots")
            os.makedirs(screenshot_dir, exist_ok=True)
            stamp = time.strftime("%Y%m%d-%H%M%S")
            screenshot_path = os.path.join(screenshot_dir, f"PulseDeck-{stamp}-{time.time_ns() % 1_000_000_000:09d}.bmp")
            desktop = win32gui.GetDesktopWindow()
            desktop_dc_handle = win32gui.GetWindowDC(desktop)
            screen_dc = None
            memory_dc = None
            bitmap = None
            try:
                screen_dc = win32ui.CreateDCFromHandle(desktop_dc_handle)
                memory_dc = screen_dc.CreateCompatibleDC()
                bitmap = win32ui.CreateBitmap()
                bitmap.CreateCompatibleBitmap(screen_dc, width, height)
                memory_dc.SelectObject(bitmap)
                memory_dc.BitBlt((0, 0), (width, height), screen_dc, (left, top), win32con.SRCCOPY)
                bitmap.SaveBitmapFile(memory_dc, screenshot_path)
            finally:
                if memory_dc:
                    memory_dc.DeleteDC()
                if screen_dc:
                    screen_dc.DeleteDC()
                if desktop_dc_handle:
                    win32gui.ReleaseDC(desktop, desktop_dc_handle)
                if bitmap:
                    win32gui.DeleteObject(bitmap.GetHandle())
            return {"status": "ok", "shortcut": shortcut, "screenshot": screenshot_path}
        elif [step.strip() for step in shortcut.split(",")] == ["windows+x", "u", "u"]:
            subprocess.Popen(
                ["shutdown.exe", "/s", "/t", "0"],
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            return {"status": "ok", "shortcut": shortcut, "action": "shutdown"}
        elif any("windows" in step.split("+") for step in shortcut.split(",")):
            _send_windows_shortcut_sequence(shortcut)
        else:
            keyboard.send(shortcut)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Windows could not send the shortcut") from exc
    return {"status": "ok", "shortcut": shortcut}


@app.get("/api/apps", dependencies=[Depends(require_token)])
def list_apps():
    apps = [{"id": app_id, "label": launcher["label"]} for app_id, launcher in APP_LAUNCHERS.items()]
    apps.extend({"id": app["id"], "label": app["label"]} for app in discover_start_menu_apps())
    return {"apps": apps}


@app.post("/api/apps/open", dependencies=[Depends(require_token)])
def open_app(data: AppLaunchPayload):
    launcher = APP_LAUNCHERS.get(data.app_id)
    if not launcher:
        shortcut = next((item for item in discover_start_menu_apps() if item["id"] == data.app_id), None)
        if not shortcut:
            raise HTTPException(status_code=422, detail="App is not available in the Start Menu")
        try:
            os.startfile(shortcut["shortcut"])
        except OSError as exc:
            raise HTTPException(status_code=502, detail=f"Windows could not open {shortcut['label']}") from exc
        return {"status": "ok", "app_id": data.app_id}
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

    try:
        if spotify_api_control(data.action, data.position):
            return {"status": "ok", "action": data.action, "target": "spotify-web-api"}
    except Exception as exc:
        print(f"Spotify Web API control failed: {exc}")
        message = str(exc)
        if "HTTP 403" in message:
            raise HTTPException(status_code=403, detail="Spotify rejected playback control. Check that your account supports Web API playback controls and PulseDeck has playback control permission.") from exc
        if "HTTP 404" in message:
            raise HTTPException(status_code=409, detail="Spotify has no track or playlist selected to resume. Open Spotify, choose a song or playlist, and start it once; PulseDeck can then control playback.") from exc
        if "No Spotify playback device" in message:
            raise HTTPException(status_code=409, detail=message) from exc
        if "Spotify desktop is not available" in message:
            raise HTTPException(status_code=409, detail=message) from exc

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

    if data.action == "disconnect":
        if not DISCORD_VOICE_STATUS["configured"] or DISCORD_BOT is None or not DISCORD_BOT.is_ready():
            raise HTTPException(status_code=409, detail="Discord voice status bot is not connected")
        if DISCORD_USER_ID is None:
            raise HTTPException(status_code=409, detail="Discord user ID is not configured")

        async def disconnect_user():
            for guild in DISCORD_BOT.guilds:
                member = guild.get_member(DISCORD_USER_ID)
                if member and member.voice and member.voice.channel:
                    if not member.voice.channel.permissions_for(guild.me).move_members:
                        raise PermissionError("The Discord bot needs Move Members permission in this server")
                    await member.move_to(None, reason="Disconnected by PulseDeck")
                    return True
            return False

        try:
            disconnected = asyncio.run_coroutine_threadsafe(
                disconnect_user(), DISCORD_BOT.loop
            ).result(timeout=8)
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail="Discord could not disconnect you from voice") from exc
        if not disconnected:
            raise HTTPException(status_code=409, detail="You are no longer in a server voice channel")
        return {"status": "ok", "action": "disconnect"}

    if not is_discord_running():
        raise HTTPException(status_code=409, detail="Discord is not running on the host PC")
    shortcut = "caps lock+tab" if data.action == "mute" else "ctrl+alt+shift+f11"
    caps_lock_was_on = bool(ctypes.windll.user32.GetKeyState(0x14) & 1) if data.action == "mute" else None
    try:
        keyboard.send(shortcut)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Windows could not send the Discord hotkey") from exc
    finally:
        caps_lock_is_on = bool(ctypes.windll.user32.GetKeyState(0x14) & 1) if data.action == "mute" else None
        if data.action == "mute" and caps_lock_is_on != caps_lock_was_on:
            keyboard.send("caps lock")
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
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
