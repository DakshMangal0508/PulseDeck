import unittest
import re
from pathlib import Path

from pydantic import ValidationError

from validation import ALLOWED_SHORTCUTS, HotkeyPayload, MediaPayload, VolumePayload


class PayloadValidationTests(unittest.TestCase):
    def test_volume_is_bounded_and_only_known_fields_are_accepted(self):
        self.assertEqual(VolumePayload(target="master", level=0.5).level, 0.5)
        for level in (-0.01, 1.01, float("nan")):
            with self.subTest(level=level), self.assertRaises(ValidationError):
                VolumePayload(target="master", level=level)
        with self.assertRaises(ValidationError):
            VolumePayload(target="master", level=0.5, command="anything")
        with self.assertRaises(ValidationError):
            VolumePayload(target="", level=0.5)

    def test_payload_size_and_required_fields(self):
        with self.assertRaises(ValidationError):
            HotkeyPayload(shortcut="")
        with self.assertRaises(ValidationError):
            HotkeyPayload(shortcut="ctrl+s", label="x" * 81)
        with self.assertRaises(ValidationError):
            MediaPayload()
        with self.assertRaises(ValidationError):
            MediaPayload(action="launch")
        with self.assertRaises(ValidationError):
            VolumePayload(level=0.5)

    def test_all_frontend_shortcuts_are_allowlisted(self):
        self.assertTrue({
            "alt+f10", "alt+r", "f15", "windows+print screen", "windows+l",
            "shift+m", "m", "r", "v", "ctrl+shift+c", "ctrl+shift+v",
            "ctrl+`",
            "ctrl+z", "ctrl+shift+z", "ctrl+shift+g", "ctrl+shift+p", "ctrl+s",
        }.issubset(ALLOWED_SHORTCUTS))

    def test_profile_shortcuts_match_the_backend_allowlist(self):
        profile_source = Path(__file__).parents[1].joinpath("profiles.js").read_text(encoding="utf-8")
        shortcuts = set(re.findall(r"shortcut:\s*'([^']+)'", profile_source)) - {"duck_spotify"}
        self.assertTrue(shortcuts)
        self.assertTrue(shortcuts.issubset(ALLOWED_SHORTCUTS), shortcuts - ALLOWED_SHORTCUTS)
        self.assertNotIn("After Effects", profile_source)

if __name__ == "__main__":
    unittest.main()
