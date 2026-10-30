from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


# Keep the executable shortcuts explicit. The browser's macro list is not a security boundary.
ALLOWED_SHORTCUTS = {
    "alt+f10", "alt+r", "f15", "windows+print screen", "windows+l",
    "shift+m", "m", "r", "v", "ctrl+shift+c", "ctrl+shift+v",
    "ctrl+`",
    "ctrl+z", "ctrl+shift+z", "ctrl+shift+g", "ctrl+shift+p", "ctrl+s",
}


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid")


class HotkeyPayload(Payload):
    shortcut: str = Field(min_length=1, max_length=40)
    label: str = Field(default="", max_length=80)


class AppLaunchPayload(Payload):
    app_id: str = Field(min_length=1, max_length=32)


class MediaPayload(Payload):
    action: Literal["play_pause", "next", "prev", "seek"]
    position: Optional[float] = Field(default=None, ge=0, le=86400, allow_inf_nan=False)


class DiscordPayload(Payload):
    action: Literal["mute", "deafen"]


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
