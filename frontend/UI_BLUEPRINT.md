# PulseDeck UI Blueprint

## Reference direction

Build PulseDeck as a compact, touch-first control deck. Use profile-based action grids and keep frequently used controls in stable locations. Elgato Stream Deck is a useful reference for organizing actions into profiles, layouts, and pages: [Elgato Stream Deck software](https://www.elgato.com/us/en/s/stream-deck-app). The open-source [sDeck project](https://github.com/itsiurisilva/sDeck) is closer to PulseDeck's phone/tablet use case, with local desktop controls, profiles, and volume controls.

These are interaction and layout references; the blueprint below is tailored to PulseDeck.

## Full-screen layout

```text
+------------------------------------------------------------------+
| PULSEDECK                Host status       Device / view controls |
+------------------------------------------------------------------+
| Connection state and host token                                  |
+------------------------------------------------------------------+
| Profiles: Gaming | Lightroom | Dev & Code                        |
+----------------------+----------------+--------------------------+
| MEDIA + AUDIO        | LOCAL TIME     | SHORTCUTS + APPS + DISCORD|
|                      |                |                          |
| Track + transport    | Time           | Compact touch pads      |
| Active app sessions  | Date           | 3 columns in landscape  |
| Master output        |                | 2 columns in portrait   |
+----------------------+----------------+--------------------------+
```

## Pane responsibilities

### Header and connection

Keep the product identity, host connection state, and view controls in a compact header. Put token entry and connection details in a separate strip. Keep profile tabs directly above the control panes.

### Media and audio

Keep the current track and playback buttons together. Show active Windows audio sessions followed by Master output. Each session control should have a clear app name, slider, and percentage, with enough height for touch.

### Local time

Use the device's local time and date. Treat the clock as a quiet orientation aid between the left mixer and right action grid, rather than a competing dashboard. Keep seconds and decorative effects subtle.

### Shortcuts, apps, and Discord

Use consistent pads with an icon, action name, and shortcut label. Keep the selected profile obvious. Make each pad at least 48 px tall, and make pressed/disabled states distinct. Keep auto-switch as a compact utility control. The app launcher includes built-in apps and host Start Menu entries, with an edit mode for choosing which appear. Discord mute/deafen buttons send the configured Discord keybinds and show immediate feedback; bot voice status is optional.

## Visual system

- Dark background: plum `#15011d` with subtle radial glows. The Add app picker uses a fine dotted texture.
- Light background: pale blue-violet with a purple accent.
- Surfaces: layered graphite cards in dark mode and light neutral cards in light mode.
- Dark signal accent: orange `#ff3d00`; light signal accent: purple `#ba55d3`.
- Status: green for connected/active; amber or rose for warnings and destructive actions.
- Typography: Doto for the deck, Silkscreen for section headings, and a readable system font for native app-picker options; use tabular numerals for time and percentages.
- Motion: brief press feedback and animated active states.
- Artwork: small thumbnail with restrained color tint, never a large decorative background.

## Responsive rules

- Landscape: preserve the three-pane layout; reduce gaps and padding before reducing text size.
- Portrait: stack media/audio, time, and actions in that order. Keep the clock compact.
- Narrow screens: preserve readable labels and touch targets; allow action content to scroll rather than shrinking controls below usable size.

## Current project fit

PulseDeck uses the three-pane structure, a date/time HUD, profile tabs, compact action pads, Spotify controls, dynamic audio-session sliders, a host-fed app picker, and Discord voice controls. Dark mode uses the plum canvas and orange accent; light mode uses a pale blue-violet canvas and purple accent. Continue checking pane balance and landscape/portrait behavior at phone-sized dimensions.
