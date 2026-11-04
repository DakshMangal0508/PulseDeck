import re
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


# Keep presets explicit and custom actions limited to one validated key chord.
ALLOWED_SHORTCUTS = {
    "alt+f10", "alt+r", "f15", "windows+print screen", "windows+l",
    "shift+m", "m", "r", "v", "ctrl+shift+c", "ctrl+shift+v",
    "ctrl+`",
    "ctrl+z", "ctrl+shift+z", "ctrl+shift+g", "ctrl+shift+p", "ctrl+s",
}

SHORTCUT_MODIFIERS = ("ctrl", "alt", "shift", "windows")
SHORTCUT_KEY_NAMES = {
    "space", "enter", "tab", "esc", "escape", "backspace", "delete", "insert",
    "home", "end", "page up", "page down", "up", "down", "left", "right",
    "print screen", "caps lock", "num lock", "scroll lock", "pause", "`",
    "-", "=", "[", "]", "\\", ";", "'", ",", ".", "/",
}


def _is_custom_shortcut_chord(chord: str) -> bool:
    parts = [part.strip().lower() for part in chord.split("+")]
    if not parts or any(not part for part in parts):
        return False
    key = parts[-1]
    modifiers = parts[:-1]
    if len(modifiers) > len(SHORTCUT_MODIFIERS) or len(set(modifiers)) != len(modifiers):
        return False
    if any(modifier not in SHORTCUT_MODIFIERS for modifier in modifiers):
        return False
    valid_key = (
        re.fullmatch(r"[a-z0-9]", key)
        or re.fullmatch(r"f(?:[1-9]|1[0-9]|2[0-4])", key)
        or key in SHORTCUT_KEY_NAMES
    )
    return bool(valid_key)


def is_custom_shortcut(shortcut: str) -> bool:
    """Accept one chord or a short comma-separated sequence of chords."""
    chords = [chord.strip() for chord in shortcut.split(",")]
    return 1 <= len(chords) <= 5 and all(_is_custom_shortcut_chord(chord) for chord in chords)


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid")


class HotkeyPayload(Payload):
    shortcut: str = Field(min_length=1, max_length=40)
    label: str = Field(default="", max_length=80)


class ShortcutRecordingModifierPayload(Payload):
    win: bool


class AppLaunchPayload(Payload):
    app_id: str = Field(min_length=1, max_length=64)


class MediaPayload(Payload):
    action: Literal["play_pause", "next", "prev", "seek"]
    position: Optional[float] = Field(default=None, ge=0, le=86400, allow_inf_nan=False)


class DiscordPayload(Payload):
    action: Literal["mute", "deafen", "disconnect"]


class VolumePayload(Payload):
    target: str = Field(min_length=1, max_length=1024)
    level: float = Field(ge=0, le=1, allow_inf_nan=False)


class SoundboardPayload(Payload):
    sound_id: str = Field(min_length=1, max_length=36)


class SoundUploadPayload(Payload):
    name: str = Field(min_length=1, max_length=40)
    audio_base64: str = Field(min_length=1, max_length=14_000_000)
    file_type: Literal["wav", "mp3"]


class SoundRenamePayload(Payload):
    sound_id: str = Field(min_length=1, max_length=36)
    name: str = Field(min_length=1, max_length=40)
