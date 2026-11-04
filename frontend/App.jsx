import React, { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import SpringButton from './SpringButton.jsx';
import { API_BASE, apiRequest, clearAccountSession, getApiToken } from './api.js';
import { QRCodeSVG } from 'qrcode.react';
import PROFILES from './profiles.js';
import TouchVolumePill from './VolumeControl.jsx';
import SportsScores from './SportsScores.jsx';
import {
  Activity, CalendarDays, Check, ChevronDown, ChevronRight, Clock3, LoaderCircle,
  Headphones, Mic, Pause, Play, Plus, RefreshCw, Shapes, SkipBack, SkipForward,
  Users, Volume2, Wifi, Pencil, Trash2, X, Save, Music2, Gamepad2,
  Globe2, Code2, Folder, FileText,
} from 'lucide-react';
import {
  ArrowClockwise, ArrowCounterClockwise, Check as PhosphorCheck, CircleHalf,
  ClipboardText, Copy as PhosphorCopy, Crop as PhosphorCrop, Eye as PhosphorEye,
  GameController, GitBranch as PhosphorGitBranch, Lightning, LockKey, SlidersHorizontal,
  Sparkle, SpeakerHigh, Stack, Sun as PhosphorSun, TerminalWindow, VideoCamera,
} from '@phosphor-icons/react';

const LAUNCHER_APPS = [
  { id: 'spotify', label: 'Spotify', Icon: Music2 },
  { id: 'discord', label: 'Discord', Icon: Gamepad2 },
  { id: 'chrome', label: 'Chrome', Icon: Globe2 },
  { id: 'edge', label: 'Edge', Icon: Globe2 },
  { id: 'vscode', label: 'VS Code', Icon: Code2 },
  { id: 'explorer', label: 'Explorer', Icon: Folder },
  { id: 'notepad', label: 'Notepad', Icon: FileText },
];
const SOUNDBOARD_PRESETS = [
  { id: 'notification', label: 'Notification' },
  { id: 'alert', label: 'Alert' },
  { id: 'error', label: 'Error' },
  { id: 'question', label: 'Question' },
];
const SAFE_SHORTCUTS = [
  ['alt+f10', 'Alt + F10'], ['alt+r', 'Alt + R'], ['f15', 'F15'],
  ['windows+print screen', 'Windows + Print Screen'], ['windows+l', 'Windows + L'],
  ['shift+m', 'Shift + M'], ['m', 'M'], ['r', 'R'], ['v', 'V'],
  ['ctrl+shift+c', 'Ctrl + Shift + C'], ['ctrl+shift+v', 'Ctrl + Shift + V'],
  ['ctrl+`', 'Ctrl + `'], ['ctrl+z', 'Ctrl + Z'], ['ctrl+shift+z', 'Ctrl + Shift + Z'],
  ['ctrl+shift+g', 'Ctrl + Shift + G'], ['ctrl+shift+p', 'Ctrl + Shift + P'], ['ctrl+s', 'Ctrl + S'],
  ['duck_spotify', 'Duck Spotify to 15%'],
];
function formatShortcutLabel(shortcut) {
  const formatKey = (part) => part === 'windows' ? 'Win' : part === 'ctrl' ? 'Ctrl' : part.charAt(0).toUpperCase() + part.slice(1);
  return SAFE_SHORTCUTS.find(([value]) => value === shortcut)?.[1]
    || shortcut.split(',').map((chord) => chord.trim().split('+').map(formatKey).join(' + ')).join(' → ');
}

function loadProfiles() {
  const defaults = Object.values(PROFILES);
  try {
    const saved = JSON.parse(window.localStorage.getItem('pulsedeck-profiles') || 'null');
    if (!Array.isArray(saved)) return defaults;
    const savedById = new Map(saved.filter((item) => item && typeof item.id === 'string').map((item) => [item.id, item]));
    const merged = defaults.map((base) => {
      const custom = savedById.get(base.id);
      savedById.delete(base.id);
      if (!custom) return base;
      const customMacros = Array.isArray(custom.macros) ? custom.macros : [];
      return { ...base, ...custom, icon: base.icon, macros: customMacros.map((macro) => ({
        ...base.macros.find((item) => item.id === macro.id), ...macro,
        icon: base.macros.find((item) => item.id === macro.id)?.icon || Shapes,
      })) };
    });
    savedById.forEach((item) => {
      if (!item || typeof item.label !== 'string' || !Array.isArray(item.macros)) return;
      merged.push({ ...item, icon: Shapes, macros: item.macros.map((macro) => ({ ...macro, icon: Shapes })) });
    });
    return merged;
  } catch { return defaults; }
}

const PHOSPHOR_PROFILE_ICONS = {
  windows: Globe2,
  gaming: GameController,
  photo: SlidersHorizontal,
  dev: TerminalWindow,
};
const PHOSPHOR_MACRO_ICONS = {
  clip_60s: VideoCamera,
  audio_duck: SpeakerHigh,
  nvidia_overlay: Lightning,
  screenshot: PhosphorEye,
  lock_pc: LockKey,
  lr_radial: PhosphorSun,
  lr_linear: Stack,
  lr_crop: PhosphorCrop,
  lr_bw: CircleHalf,
  lr_copy: PhosphorCopy,
  lr_paste: ClipboardText,
  dev_term: TerminalWindow,
  dev_undo: ArrowCounterClockwise,
  dev_redo: ArrowClockwise,
  dev_git: PhosphorGitBranch,
  dev_cmd: Sparkle,
  dev_save: PhosphorCheck,
};

const formatMediaTime = (seconds) => {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
};

const WAVEFORM_PEAKS = [0.42, 0.76, 0.58, 1, 0.48, 0.86, 0.62, 0.94, 0.4];
function AudioWaveform({ active }) {
  return (
    <div className={`audio-waveform${active ? ' is-active' : ''}`} aria-hidden="true">
      {WAVEFORM_PEAKS.map((peak, index) => (
        <motion.span
          key={index}
          animate={{ scaleY: active ? [0.16, peak, Math.max(0.24, peak * 0.48), 0.16] : 0.12 }}
          transition={active
            ? { duration: 0.72 + (index % 4) * 0.13, delay: index * 0.045, repeat: Infinity, ease: 'easeInOut' }
            : { type: 'spring', stiffness: 380, damping: 26 }}
          style={{ transformOrigin: '50% 100%' }}
        />
      ))}
    </div>
  );
}

export default function PulseDeck() {
  const [profiles, setProfiles] = useState(loadProfiles);
  const [launcherApps, setLauncherApps] = useState(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem('pulsedeck-launcher-apps') || 'null');
      if (Array.isArray(saved)) {
        const selected = saved.filter((id, index) => typeof id === 'string' && saved.indexOf(id) === index);
        return selected;
      }
    } catch {}
    return ['spotify', 'discord', 'chrome', 'vscode', 'explorer', 'notepad'];
  });
  const [launcherEditing, setLauncherEditing] = useState(false);
  const [appCatalog, setAppCatalog] = useState(LAUNCHER_APPS);
  const [activeProfile, setActiveProfile] = useState('windows');
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [profileDraft, setProfileDraft] = useState(null);
  const [recordingShortcutIndex, setRecordingShortcutIndex] = useState(null);
  const [recordWinModifier, setRecordWinModifier] = useState(false);
  const [autoSwitch, setAutoSwitch] = useState(true);
  const [showConnection, setShowConnection] = useState(() => !getApiToken());
  const [connectionUrls, setConnectionUrls] = useState([]);
  const iconPack = 'phosphor';
  const [clockNow, setClockNow] = useState(() => new Date());
  const [isPlaying, setIsPlaying] = useState(null);
  const [track, setTrack] = useState({ title: 'Waiting for Spotify', artist: 'Open Spotify on your PC', artwork: '' });
  const [spotifyConnection, setSpotifyConnection] = useState({ configured: false, connected: false });
  const [mediaTimeline, setMediaTimeline] = useState({ position: 0, duration: 0, seekMin: 0, seekMax: 0, seekable: false, updatedAt: Date.now() });
  const [online, setOnline] = useState(false);
  const [discordAvailable, setDiscordAvailable] = useState(false);
  const [discordVoice, setDiscordVoice] = useState({ configured: false, connection: 'disabled', guild: null, channel: null, members: [] });
  const [discordRpc, setDiscordRpc] = useState({ configured: false, connected: false, username: null, mute: null, deaf: null, channel: null, error: null });
  const [discordRpcConnecting, setDiscordRpcConnecting] = useState(false);
  const [discordRpcConnectError, setDiscordRpcConnectError] = useState('');
  const [discordControlOverrides, setDiscordControlOverrides] = useState({ mute: null, deafen: null });
  const [toast, setToast] = useState('Connecting to PC…');
  const [busyMacroId, setBusyMacroId] = useState(null);

  const [volumes, setVolumes] = useState({ apps: [], master: null });
  const [customSounds, setCustomSounds] = useState([]);
  const [soundNameDraft, setSoundNameDraft] = useState('');
  const [soundUploading, setSoundUploading] = useState(false);
  const [soundboardEditing, setSoundboardEditing] = useState(false);
  const [visibleBuiltinSoundIds, setVisibleBuiltinSoundIds] = useState(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem('pulsedeck-visible-builtin-sounds') || 'null');
      if (Array.isArray(saved)) return SOUNDBOARD_PRESETS.map((sound) => sound.id).filter((id) => saved.includes(id));
    } catch {}
    return SOUNDBOARD_PRESETS.map((sound) => sound.id);
  });
  const [editingSoundId, setEditingSoundId] = useState(null);
  const [editingSoundName, setEditingSoundName] = useState('');
  const [apiToken, setApiToken] = useState(getApiToken);
  const volumeTimers = useRef({});
  const pendingVolumes = useRef({});
  const volumeRevisions = useRef({});
  const pendingPlayback = useRef(null);
  const pendingSeek = useRef(null);
  const discordControlRevisions = useRef({ mute: 0, deafen: 0 });
  const seekTimer = useRef(null);

  useEffect(() => {
    if (!apiToken) window.location.replace('/account');
  }, [apiToken]);

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('spotify');
    if (!result) return;
    setToast(result === 'connected' ? 'Spotify connected' : result === 'denied' ? 'Spotify connection cancelled' : 'Spotify connection failed');
    window.history.replaceState({}, '', `${window.location.pathname}${window.location.hash}`);
  }, []);

  useEffect(() => {
    if (!showConnection) return undefined;
    let active = true;
    let fetching = false;
    let serverInstanceId = null;
    let pairingCode = '';
    let pairingCodeRefreshAt = 0;
    const refreshPairingCode = async () => {
      if (!apiToken) {
        setConnectionUrls([]);
        return;
      }
      if (fetching) return;
      fetching = true;
      try {
        const addressesResponse = await fetch(`${API_BASE}/api/connect-info`, { cache: 'no-store' });
        if (!addressesResponse.ok) throw new Error('Could not get connection addresses');
        const addresses = await addressesResponse.json();
        const serverRestarted = serverInstanceId !== null && serverInstanceId !== addresses.server_instance_id;
        serverInstanceId = addresses.server_instance_id;
        if (!pairingCode || serverRestarted || Date.now() >= pairingCodeRefreshAt) {
          const pairing = await apiRequest('/api/auth/pairing', { method: 'POST', body: {} });
          pairingCode = pairing.code;
          pairingCodeRefreshAt = Date.now() + 300_000;
        }
        if (active) {
          setConnectionUrls((addresses.urls || []).map((url) => ({
            url,
            pairingUrl: `${url}/#pair=${encodeURIComponent(pairingCode)}`,
          })));
        }
      } catch {
        if (active) setConnectionUrls([]);
      } finally {
        fetching = false;
      }
    };
    refreshPairingCode();
    const refreshTimer = window.setInterval(refreshPairingCode, 5_000);
    return () => {
      active = false;
      window.clearInterval(refreshTimer);
    };
  }, [showConnection, apiToken]);

  const profile = profiles.find((item) => item.id === activeProfile) || profiles[0] || PROFILES.windows;
  const layoutClass = 'grid-cols-1';
  const clockTime = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(clockNow);
  const clockSeconds = new Intl.DateTimeFormat(undefined, { second: '2-digit' }).format(clockNow);
  const clockDate = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).format(clockNow);
  const spotifyVolume = volumes.apps.find((audioApp) => audioApp.process?.toLowerCase() === 'spotify.exe' || audioApp.name?.toLowerCase() === 'spotify');
  const estimatedPosition = mediaTimeline.position + (isPlaying === true ? Math.max(0, (Date.now() - mediaTimeline.updatedAt) / 1000) : 0);
  const currentPosition = Math.min(mediaTimeline.duration, estimatedPosition);
  const seekMin = Math.min(mediaTimeline.seekMin, mediaTimeline.duration);
  const seekMax = Math.max(seekMin, Math.min(mediaTimeline.duration, mediaTimeline.seekMax || mediaTimeline.duration));
  const displayedSeekPosition = Math.max(seekMin, Math.min(seekMax, currentPosition));
  const discordSelfVoice = discordVoice.members.find((member) => member.is_self);
  const observedDiscordMicMuted = discordRpc.connected ? Boolean(discordRpc.mute) : discordSelfVoice ? discordSelfVoice.self_muted || discordSelfVoice.server_muted : null;
  const observedDiscordDeafened = discordRpc.connected ? Boolean(discordRpc.deaf) : discordSelfVoice ? discordSelfVoice.self_deafened || discordSelfVoice.server_deafened : null;
  const discordMicMuted = discordControlOverrides.mute ?? observedDiscordMicMuted;
  const discordDeafened = discordControlOverrides.deafen ?? observedDiscordDeafened;

  useEffect(() => {
    if (!discordRpc.connected && !discordSelfVoice) return;
    setDiscordControlOverrides((current) => ({
      mute: current.mute === observedDiscordMicMuted ? null : current.mute,
      deafen: current.deafen === observedDiscordDeafened ? null : current.deafen,
    }));
  }, [discordSelfVoice?.self_muted, discordSelfVoice?.server_muted, discordSelfVoice?.self_deafened, discordSelfVoice?.server_deafened, discordRpc.connected, discordRpc.mute, discordRpc.deaf]);

  const logoutAccount = async () => {
    try { await apiRequest('/api/auth/logout', { method: 'POST', body: {} }); } catch { /* Clear the local session even if the PC is offline. */ }
    clearAccountSession();
    setApiToken('');
    setOnline(false);
    window.location.replace('/account');
  };

  useEffect(() => {
    let active = true;
    let inFlight = false;
    const fetchStatus = async () => {
      if (!apiToken) {
        setOnline(false);
        return;
      }
      if (inFlight) return;
      inFlight = true;
      try {
        const data = await apiRequest('/api/status');
        if (!active) return;
        setOnline(true);
        try {
          const spotifyStatus = await apiRequest('/api/spotify/status');
          if (active) setSpotifyConnection(spotifyStatus);
        } catch { /* Windows media controls work even when OAuth is not configured. */ }
        setDiscordAvailable(Boolean(data.discord?.available));
        setDiscordVoice(data.discord?.voice || { configured: false, connection: 'disabled', guild: null, channel: null, members: [] });
        setDiscordRpc(data.discord?.rpc || { configured: false, connected: false, username: null, mute: null, deaf: null, channel: null, error: null });
        if (data.spotify) {
          setTrack({
            title: data.spotify.title || 'Not Playing',
            artist: data.spotify.artist || 'Spotify',
            artwork: data.spotify.artwork || '',
          });
          if (typeof data.spotify.is_playing === 'boolean') {
            const playing = data.spotify.is_playing;
            const pending = pendingPlayback.current;
            if (!pending || pending.expiresAt <= Date.now() || pending.value === playing) {
              pendingPlayback.current = null;
              setIsPlaying(playing);
            }
          } else if (!pendingPlayback.current || pendingPlayback.current.expiresAt <= Date.now()) {
            pendingPlayback.current = null;
            setIsPlaying(null);
          }
          const observedPosition = Number.isFinite(data.spotify.position) ? data.spotify.position : 0;
          const pending = pendingSeek.current;
          let position = observedPosition;
          if (pending && pending.expiresAt > Date.now() && Math.abs(observedPosition - pending.value) > 1) {
            position = pending.value;
          } else if (pending) {
            pendingSeek.current = null;
          }
          setMediaTimeline({
            position,
            duration: Number.isFinite(data.spotify.duration) ? Math.max(0, data.spotify.duration) : 0,
            seekMin: Number.isFinite(data.spotify.seek_min) ? Math.max(0, data.spotify.seek_min) : 0,
            seekMax: Number.isFinite(data.spotify.seek_max) ? Math.max(0, data.spotify.seek_max) : 0,
            seekable: Boolean(data.spotify.seekable),
            updatedAt: Date.now(),
          });
        }
        if (data.volumes) {
          setVolumes(() => {
            const apps = (data.volumes.apps || []).map((audioApp) => {
              const observed = Math.round(audioApp.volume * 100);
              const pending = pendingVolumes.current[audioApp.id];
              if (pending && pending.expiresAt > Date.now() && observed !== pending.value) {
                return { ...audioApp, volume: pending.value };
              }
              if (pending) delete pendingVolumes.current[audioApp.id];
              return { ...audioApp, volume: observed };
            });
            const observedMaster = data.volumes.master == null ? null : Math.round(data.volumes.master * 100);
            const pendingMaster = pendingVolumes.current.master;
            let master = observedMaster;
            if (pendingMaster && pendingMaster.expiresAt > Date.now() && observedMaster !== pendingMaster.value) {
              master = pendingMaster.value;
            } else if (pendingMaster) {
              delete pendingVolumes.current.master;
            }
            return { apps, master };
          });
        }
        if (data.active_app) {
          if (autoSwitch) {
            const activeApp = data.active_app.toLowerCase();
            const matched = profiles.find((item) => (item.matchApps || []).includes(activeApp));
            if (matched) setActiveProfile(matched.id);
            else if (activeApp === 'desktop') setActiveProfile('windows');
          }
        }
      } catch (error) {
        if (!active) return;
        setOnline(false);
        setDiscordAvailable(false);
        setDiscordVoice((current) => ({ ...current, connection: 'host-offline', guild: null, channel: null, members: [] }));
        setDiscordRpc((current) => ({ ...current, connected: false }));
        const tokenRejected = /401|sign in|token rejected/i.test(error?.message || '');
        if (tokenRejected) {
          clearAccountSession();
          setApiToken('');
          setToast('Sign in again to control this PC');
          return;
        }
        setToast(!apiToken
          ? 'Create an account or sign in to connect'
          : tokenRejected
            ? 'Host token rejected'
            : 'Host unavailable — start the PulseDeck backend');
      } finally {
        inFlight = false;
      }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [autoSwitch, apiToken, profiles]);

  useEffect(() => {
    if (!online || !discordRpc.connected) return undefined;
    let active = true;
    let inFlight = false;
    const refreshDiscordRpc = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const state = await apiRequest('/api/discord/rpc/status');
        if (active) setDiscordRpc(state);
      } catch { /* The regular host status poll handles reconnect and error state. */ }
      finally { inFlight = false; }
    };
    refreshDiscordRpc();
    const interval = window.setInterval(refreshDiscordRpc, 750);
    return () => { active = false; window.clearInterval(interval); };
  }, [online, apiToken, discordRpc.connected]);

  useEffect(() => {
    if (!online) return undefined;
    let active = true;
    let retryTimer;
    const loadSounds = async () => {
      try {
        const data = await apiRequest('/api/soundboard');
        if (active) setCustomSounds(Array.isArray(data.sounds) ? data.sounds : []);
      } catch (error) {
        if (!active) return;
        setToast(error.message || 'Could not load saved sounds');
        retryTimer = setTimeout(loadSounds, 5000);
      }
    };
    loadSounds();
    return () => { active = false; clearTimeout(retryTimer); };
  }, [online]);

  useEffect(() => {
    if (!online) return undefined;
    let active = true;
    apiRequest('/api/apps').then((data) => {
      if (active && Array.isArray(data.apps)) setAppCatalog(data.apps);
    }).catch(() => {});
    return () => { active = false; };
  }, [online]);

  useEffect(() => {
    try { window.localStorage.setItem('pulsedeck-visible-builtin-sounds', JSON.stringify(visibleBuiltinSoundIds)); }
    catch { /* Keep preset visibility in memory if local storage is unavailable. */ }
  }, [visibleBuiltinSoundIds]);

  useEffect(() => () => {
    Object.values(volumeTimers.current).forEach(clearTimeout);
    clearTimeout(seekTimer.current);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setClockNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      const serializable = profiles.map(({ icon, ...item }) => ({
        ...item,
        macros: item.macros.map(({ icon: macroIcon, ...macro }) => macro),
      }));
      window.localStorage.setItem('pulsedeck-profiles', JSON.stringify(serializable));
    } catch { /* Keep profile edits in memory when browser storage is unavailable. */ }
  }, [profiles]);

  const openProfileEditor = (item = null) => {
    setRecordingShortcutIndex(null);
    setRecordWinModifier(false);
    setProfileDraft(item ? {
      id: item.id, label: item.label, app: item.app || '',
      matchApps: (item.matchApps || []).join(', '),
      macros: item.macros.map(({ id, label, sub, shortcut }) => ({ id, label, sub, shortcut })),
    } : { id: '', label: '', app: '', matchApps: '', macros: [] });
    setProfileEditorOpen(true);
  };

  const startShortcutRecording = async (index) => {
    if (recordingShortcutIndex !== null) {
      try { await apiRequest('/api/shortcuts/record/stop', { method: 'POST', body: {} }); } catch { /* Stop locally even if the host disconnected. */ }
      setRecordingShortcutIndex(null);
      return;
    }
    try {
      await apiRequest('/api/shortcuts/record/start', { method: 'POST', body: {} });
      setRecordingShortcutIndex(index);
      setRecordWinModifier(false);
      setToast('Recording · use Win toggle if the Windows key is not detected');
    } catch (error) {
      setToast(error.message || 'Could not start shortcut recording');
    }
  };

  const stopShortcutRecording = async () => {
    try { await apiRequest('/api/shortcuts/record/stop', { method: 'POST', body: {} }); } catch { /* Stop locally even if the host disconnected. */ }
    setRecordingShortcutIndex(null);
    setRecordWinModifier(false);
    setToast('Shortcut recording cancelled');
  };

  const toggleRecordWinModifier = async () => {
    const win = !recordWinModifier;
    try {
      const result = await apiRequest('/api/shortcuts/record/modifier', { method: 'POST', body: { win } });
      setRecordWinModifier(Boolean(result.win));
      setToast(result.win ? 'Win will be added to the next chord' : 'Win modifier cleared');
    } catch (error) {
      setToast(error.message || 'Could not set the Win modifier');
    }
  };

  const closeProfileEditor = () => {
    setProfileEditorOpen(false);
    if (recordingShortcutIndex !== null) stopShortcutRecording();
  };

  useEffect(() => {
    if (recordingShortcutIndex === null) return undefined;
    let active = true;
    let pollTimer;
    const pollRecording = async () => {
      try {
        const status = await apiRequest('/api/shortcuts/record/status');
        if (!active) return;
        setRecordWinModifier(Boolean(status.force_windows_modifier));
        if (status.active) {
          const capturedSteps = [...(status.strokes || []), ...(status.current_stroke ? [status.current_stroke] : [])];
          if (capturedSteps.length) setToast(`Recording · ${formatShortcutLabel(capturedSteps.join(', '))}`);
          pollTimer = window.setTimeout(pollRecording, 100);
          return;
        }
        if (status.shortcut) {
          const shortcut = status.shortcut;
          setProfileDraft((draft) => draft && ({
            ...draft,
            macros: draft.macros.map((macro, index) => index === recordingShortcutIndex ? {
              ...macro,
              shortcut,
              sub: !macro.sub || macro.sub === formatShortcutLabel(macro.shortcut) ? formatShortcutLabel(shortcut) : macro.sub,
            } : macro),
          }));
          setToast(`Recorded ${formatShortcutLabel(shortcut)}`);
        } else if (status.error) setToast(status.error);
        else if (status.cancelled) setToast('Shortcut recording cancelled');
        setRecordingShortcutIndex(null);
        setRecordWinModifier(false);
      } catch (error) {
        if (active) {
          setToast(error.message || 'Shortcut recording stopped');
          setRecordingShortcutIndex(null);
        }
      }
    };
    pollRecording();
    return () => {
      active = false;
      window.clearTimeout(pollTimer);
      apiRequest('/api/shortcuts/record/stop', { method: 'POST', body: {} }).catch(() => {});
    };
  }, [recordingShortcutIndex]);

  const saveProfileDraft = (event) => {
    event.preventDefault();
    const label = profileDraft.label.trim();
    if (!label || !profileDraft.macros.length || profileDraft.macros.some((macro) => !macro.shortcut)) return;
    const id = profileDraft.id || `custom-${Date.now().toString(36)}`;
    const existing = profiles.find((item) => item.id === id);
    const macros = profileDraft.macros.map((macro, index) => {
      const original = existing?.macros.find((item) => item.id === macro.id);
      const shortcutLabel = SAFE_SHORTCUTS.find(([value]) => value === macro.shortcut)?.[1] || macro.shortcut;
      return {
        ...original,
        id: macro.id || `custom-action-${Date.now().toString(36)}-${index}`,
        label: macro.label.trim(), sub: macro.sub.trim() || shortcutLabel,
        shortcut: macro.shortcut, icon: original?.icon || Shapes,
        color: original?.color || 'text-[#b4ff00]', bg: original?.bg || 'bg-[#b4ff00]/10 border-[#b4ff00]/20',
      };
    });
    const saved = {
      ...(existing || {}), id, label, app: profileDraft.app.trim() || `${label}.exe`,
      matchApps: profileDraft.matchApps.split(',').map((name) => name.trim().toLowerCase()).filter(Boolean),
      icon: existing?.icon || Shapes, accent: existing?.accent || 'from-[#b4ff00]/20 via-[#b4ff00]/10 to-transparent', macros,
    };
    setProfiles((current) => existing ? current.map((item) => item.id === id ? saved : item) : [...current, saved]);
    setActiveProfile(id);
    setAutoSwitch(false);
    setProfileEditorOpen(false);
    setRecordingShortcutIndex(null);
    setToast(`Profile saved · ${label}`);
  };

  const deleteProfile = (id) => {
    if (Object.prototype.hasOwnProperty.call(PROFILES, id)) return;
    setProfiles((current) => current.filter((item) => item.id !== id));
    if (activeProfile === id) setActiveProfile('windows');
    setProfileEditorOpen(false);
    setRecordingShortcutIndex(null);
    setToast('Custom profile deleted');
  };

  const triggerBackend = async (endpoint, payload = {}) => {
    try {
      await apiRequest(endpoint, { method: 'POST', body: payload });
      return true;
    } catch (error) {
      setToast(error.message || 'Command failed');
      return false;
    }
  };

  const fireMacro = async (macro) => {
    setBusyMacroId(macro.id);
    if (navigator.vibrate) navigator.vibrate(20);
    setToast(`${macro.label} · ${macro.sub}`);
    try {
      if (macro.shortcut === 'duck_spotify') handleVolume('spotify', 15);
      else {
        const ok = await triggerBackend('/api/hotkey', { shortcut: macro.shortcut, label: macro.label });
        if (ok && macro.shortcut === 'windows+print screen') setToast('Screenshot saved to Pictures\\Screenshots');
        else if (ok && macro.shortcut === 'windows+l') setToast('Locking PC');
      }
    } finally {
      window.setTimeout(() => setBusyMacroId((current) => current === macro.id ? null : current), 240);
    }
  };

  const launchApp = async (appItem) => {
    setToast(`Opening ${appItem.label}…`);
    if (await triggerBackend('/api/apps/open', { app_id: appItem.id })) {
      setToast(`${appItem.label} opened`);
    }
  };

  const playSound = async (sound) => {
    setToast(`Playing ${sound.label} on your PC`);
    if (await triggerBackend('/api/soundboard/play', { sound_id: sound.id })) {
      setToast(`${sound.label} played on your PC`);
    }
  };

  const uploadSound = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    const fileType = file.name.toLowerCase().endsWith('.mp3') ? 'mp3' : file.name.toLowerCase().endsWith('.wav') ? 'wav' : null;
    if (!fileType) {
      setToast('Choose a WAV or MP3 audio file');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setToast('Sound files must be 10 MB or smaller');
      return;
    }
    const name = soundNameDraft.trim() || file.name.replace(/\.(wav|mp3)$/i, '').trim();
    if (!name) {
      setToast('Enter a name for this sound');
      return;
    }
    setSoundUploading(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read that audio file'));
        reader.readAsDataURL(file);
      });
      const audioBase64 = String(dataUrl).split(',')[1];
      const result = await apiRequest('/api/soundboard/upload', {
        method: 'POST', body: { name, audio_base64: audioBase64, file_type: fileType }, timeoutMs: 30000,
      });
      setCustomSounds((current) => [...current, result.sound].sort((a, b) => a.name.localeCompare(b.name)));
      setSoundNameDraft('');
      setToast(`${result.sound.name} added to the soundboard`);
    } catch (error) {
      setToast(error.message || 'Could not add that sound');
    } finally {
      setSoundUploading(false);
    }
  };

  const removeCustomSound = async (sound) => {
    if (await triggerBackend('/api/soundboard/delete', { sound_id: sound.id })) {
      setCustomSounds((current) => current.filter((item) => item.id !== sound.id));
      setToast(`${sound.name} removed`);
    }
  };

  const removeBuiltinSound = (soundId) => {
    setVisibleBuiltinSoundIds((current) => current.filter((id) => id !== soundId));
  };

  const restoreBuiltinSound = (soundId) => {
    setVisibleBuiltinSoundIds((current) => current.includes(soundId) ? current : [...current, soundId]);
  };

  const saveCustomSoundName = async (sound) => {
    const name = editingSoundName.trim();
    if (!name) return;
    try {
      const result = await apiRequest('/api/soundboard/rename', { method: 'POST', body: { sound_id: sound.id, name } });
      setCustomSounds((current) => current.map((item) => item.id === sound.id ? result.sound : item).sort((a, b) => a.name.localeCompare(b.name)));
      setEditingSoundId(null);
      setEditingSoundName('');
      setToast('Sound renamed');
    } catch (error) {
      setToast(error.message || 'Could not rename the sound');
    }
  };

  const saveLauncherApps = (nextApps) => {
    setLauncherApps(nextApps);
    window.localStorage.setItem('pulsedeck-launcher-apps', JSON.stringify(nextApps));
  };

  const handleMedia = (action, label) => {
    if (navigator.vibrate) navigator.vibrate(15);
    const previousPlaying = isPlaying;
    if (action === 'play_pause') {
      const nextPlaying = !previousPlaying;
      pendingPlayback.current = { value: nextPlaying, expiresAt: Date.now() + 5000 };
      setIsPlaying(nextPlaying);
    }
    setToast(label);
    triggerBackend('/api/media', { action }).then((ok) => {
      if (!ok && action === 'play_pause') {
        pendingPlayback.current = null;
        setIsPlaying(previousPlaying);
      }
    });
  };

  const connectSpotify = async () => {
    try {
      const { url } = await apiRequest('/api/spotify/connect', { method: 'POST', body: {} });
      window.location.assign(url);
    } catch (error) {
      setToast(error.message || 'Could not start Spotify authorization');
    }
  };

  const handleDiscord = (action, label) => {
    if (navigator.vibrate) navigator.vibrate(15);
    setToast(label);
    const control = action === 'mute' || action === 'deafen' ? action : null;
    const revision = control ? ++discordControlRevisions.current[control] : null;
    if (control) {
      const currentValue = control === 'mute' ? discordMicMuted : discordDeafened;
      setDiscordControlOverrides((current) => ({ ...current, [control]: !Boolean(currentValue) }));
    }
    triggerBackend('/api/discord', { action }).then((ok) => {
      if (!ok && control && discordControlRevisions.current[control] === revision) {
        setDiscordControlOverrides((current) => ({ ...current, [control]: null }));
      }
    });
  };

  const connectDiscordRpc = async () => {
    if (discordRpcConnecting) return;
    setDiscordRpcConnecting(true);
    setDiscordRpcConnectError('');
    setToast('Waiting for Discord authorization… Approve the prompt in Discord Desktop.');
    try {
      const result = await apiRequest('/api/discord/rpc/connect', { method: 'POST', body: {}, timeoutMs: 180_000 });
      // The authorization response confirms the token was saved. Update the
      // UI immediately instead of waiting for the next host status poll.
      setDiscordRpc((current) => ({
        ...current,
        configured: true,
        connected: true,
        username: result.username || current.username,
        error: null,
      }));
      setDiscordRpcConnectError('');
      setToast(`Discord local RPC connected${result.username ? ` as ${result.username}` : ''}`);
      try {
        const state = await apiRequest('/api/discord/rpc/status');
        setDiscordRpc(state);
      } catch { /* Keep the successful authorization state; polling will retry. */ }
    } catch (error) {
      setDiscordRpcConnectError(error.message || 'Discord local RPC could not connect');
      setToast(error.message || 'Discord local RPC could not connect');
    } finally {
      setDiscordRpcConnecting(false);
    }
  };

  const handleVolume = (target, val) => {
    const revision = (volumeRevisions.current[target] || 0) + 1;
    volumeRevisions.current[target] = revision;
    pendingVolumes.current[target] = { revision, value: val, expiresAt: Date.now() + 5000 };
    setVolumes((current) => ({
      ...current,
      master: target === 'master' ? val : current.master,
      apps: current.apps.map((audioApp) => audioApp.id === target ? { ...audioApp, volume: val } : audioApp),
    }));
    clearTimeout(volumeTimers.current[target]);
    volumeTimers.current[target] = setTimeout(() => {
      triggerBackend('/api/volume', { target, level: val / 100 }).then((ok) => {
        if (volumeRevisions.current[target] !== revision) return;
        if (!ok) delete pendingVolumes.current[target];
      });
    }, 180);
  };

  const handleSeek = (position) => {
    const value = Number(position);
    pendingSeek.current = { value, expiresAt: Date.now() + 5000 };
    setMediaTimeline((current) => ({ ...current, position: value, updatedAt: Date.now() }));
    clearTimeout(seekTimer.current);
    seekTimer.current = setTimeout(() => {
      triggerBackend('/api/media', { action: 'seek', position: value }).then((ok) => {
        if (!ok) pendingSeek.current = null;
      });
    }, 220);
  };

  const frameWidth = 'max-w-[1440px]';

  return (
    <main data-theme="dark" className="deck-shell min-h-screen overflow-x-clip px-3 py-4 text-zinc-100 sm:px-6 sm:py-6 lg:px-10 lg:py-8">
      <div className="deck-orb deck-orb-one" />
      <div className="deck-orb deck-orb-two" />
      <div className={`deck-content relative z-10 mx-auto flex min-h-[calc(100vh-2rem)] w-full flex-col ${frameWidth}`}>
        <header className="mb-5 flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.07] pb-5 sm:mb-7 sm:pb-6">
          <div className="flex items-center gap-3">
            <div className="brand-mark"><Activity className="h-5 w-5" /></div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold tracking-[0.2em] text-white">PULSE<span className="brand-accent" style={{ color: '#b4ff00' }}>DECK</span></h1>
                <span className="rounded-full border border-white/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-zinc-500">BETA</span>
              </div>
              <p className="mt-0.5 text-[11px] text-zinc-500">Desktop control surface</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <motion.div className="host-status" role="status" aria-live="polite" layout transition={{ type: 'spring', stiffness: 420, damping: 32 }}>
              <span className={`status-led ${online ? 'is-online' : ''}`} />
              <AnimatePresence mode="wait" initial={false}>
                <motion.span key={online ? 'online' : 'offline'} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.16 }}>
                  {online ? 'HOST CONNECTED' : 'HOST OFFLINE'}
                </motion.span>
              </AnimatePresence>
            </motion.div>
            <SpringButton
              type="button"
              aria-label="Toggle automatic profile switching"
              aria-pressed={autoSwitch}
              title="Switch profiles based on the focused PC app"
              onClick={() => {
                const next = !autoSwitch;
                setAutoSwitch(next);
                setToast(next ? 'Automatic profile switching on' : 'Automatic profile switching off');
              }}
              className={`icon-button ${autoSwitch ? 'icon-button-active' : ''}`}
            >
              <RefreshCw className="h-4 w-4" />
            </SpringButton>
            <SpringButton
              type="button"
              className={`icon-button ${showConnection ? 'icon-button-active' : ''}`}
              aria-label={showConnection ? 'Hide connection settings' : 'Show connection settings'}
              aria-expanded={showConnection}
              aria-controls="connection-settings"
              title={showConnection ? 'Hide connection settings' : 'Show connection settings'}
              onClick={() => setShowConnection((visible) => !visible)}
            >
              <ChevronDown className={`h-4 w-4 transition-transform ${showConnection ? 'rotate-180' : ''}`} />
            </SpringButton>
          </div>
        </header>

        <AnimatePresence initial={false}>
        {showConnection && <motion.section id="connection-settings" className="connection-bar mb-5 sm:mb-7" initial={{ opacity: 0, height: 0, y: -10 }} animate={{ opacity: 1, height: 'auto', y: 0 }} exit={{ opacity: 0, height: 0, y: -8 }} transition={{ type: 'spring', stiffness: 320, damping: 30 }} style={{ overflow: 'hidden' }}>
          <div className="flex min-w-0 items-center gap-3">
            <div className={`connection-icon ${online ? 'connected' : ''}`}><Wifi className="h-4 w-4" /></div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Connection</p>
              <p className="mt-0.5 truncate text-xs text-zinc-300">{online ? `Connected · ${toast}` : toast}</p>
            </div>
          </div>
          <div className="connection-actions">
            <a href="/account?recovery=setup" className="connection-action">Recovery email</a>
            <SpringButton type="button" className="connection-action" onClick={logoutAccount}>Sign out</SpringButton>
          </div>
          <div className="flex w-full flex-wrap items-center gap-4 border-t border-white/[0.06] pt-3">
            <div className="min-w-[180px] flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Open on your phone</p>
              <p className="mt-1 text-[10px] text-zinc-400">Scan within 5 minutes. Phone sign-in ends when the server restarts; keep this QR private.</p>
            </div>
            {connectionUrls.length ? connectionUrls.map(({ url, pairingUrl }) => (
              <a key={url} href={pairingUrl} className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-black/20 p-2 transition hover:border-[#b4ff00]/30" title={`Pair phone with ${url}`}>
                <span className="rounded-md bg-white p-1"><QRCodeSVG value={pairingUrl} size={76} level="M" /></span>
                <span className="max-w-[150px] break-all text-[10px] text-zinc-300">{url}</span>
              </a>
            )) : <span className="text-[10px] text-zinc-500">{apiToken ? 'Preparing a secure pairing QR…' : 'Sign in on this PC to create a phone pairing QR.'}</span>}
          </div>
        </motion.section>}
        </AnimatePresence>

        <nav className="mb-5 flex items-center gap-1.5 overflow-x-auto pb-1 sm:mb-7" aria-label="Control profiles">
          <span className="mr-2 hidden text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600 sm:inline">Workspace</span>
          {profiles.map((item) => {
            const Icon = iconPack === 'phosphor' ? PHOSPHOR_PROFILE_ICONS[item.id] || item.icon : item.icon;
            const selected = activeProfile === item.id;
            return (
              <motion.button
                type="button"
                key={item.id}
                layout
                transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.96, y: 1 }}
                aria-pressed={selected}
                onClick={() => {
                  setAutoSwitch(false);
                  setActiveProfile(item.id);
                  setToast(`Profile selected · ${item.label}`);
                }}
                className={`profile-tab ${selected ? 'profile-tab-selected' : ''}`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{item.label}</span>
                {selected && <motion.span layoutId="profile-tab-indicator" className="profile-tab-dot" transition={{ type: 'spring', stiffness: 500, damping: 34 }} />}
              </motion.button>
            );
          })}
          <SpringButton type="button" className="profile-tab profile-manage-button" onClick={() => openProfileEditor(profile)} title="Edit the selected profile and its shortcuts">
            <Pencil className="h-3.5 w-3.5" /><span>Manage</span>
          </SpringButton>
          <SpringButton type="button" className="profile-tab profile-add-button" onClick={() => openProfileEditor()} title="Add a work profile">
            <Plus className="h-3.5 w-3.5" /><span>Add profile</span>
          </SpringButton>
          <SportsScores />
        </nav>

        {profileEditorOpen && profileDraft && <div className="profile-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeProfileEditor(); }}>
          <section className="profile-editor surface-card" role="dialog" aria-modal="true" aria-labelledby="profile-editor-title">
            <div className="profile-editor-heading">
              <div><p className="eyebrow">WORKSPACE SETUP</p><h2 id="profile-editor-title">{profileDraft.id ? 'Edit profile' : 'Create profile'}</h2></div>
              <SpringButton type="button" className="icon-button" onClick={closeProfileEditor} aria-label="Close profile editor"><X className="h-4 w-4" /></SpringButton>
            </div>
            <form onSubmit={saveProfileDraft}>
              <div className="profile-editor-fields">
                <label>Profile name<input required maxLength="32" value={profileDraft.label} onChange={(event) => setProfileDraft((draft) => ({ ...draft, label: event.target.value }))} placeholder="e.g. Writing" /></label>
                <label>Primary app<input maxLength="80" value={profileDraft.app} onChange={(event) => setProfileDraft((draft) => ({ ...draft, app: event.target.value }))} placeholder="e.g. Word.exe" /></label>
                <label className="profile-app-matches">Auto-switch app names<input value={profileDraft.matchApps} onChange={(event) => setProfileDraft((draft) => ({ ...draft, matchApps: event.target.value }))} placeholder="word.exe, winword.exe (comma separated)" /><small>Use executable names. Leave blank to select this profile manually.</small></label>
              </div>
              <div className="profile-shortcut-heading"><div><h3>Shortcut cards</h3><p>Enter the sequence and pause 4 seconds to finish. Use Win toggle if the Windows key is not detected. Keyboard input is blocked; Escape cancels.</p></div>
                <SpringButton type="button" className="editor-add-action" onClick={() => setProfileDraft((draft) => ({ ...draft, macros: [...draft.macros, { id: '', label: '', sub: '', shortcut: '' }] }))}><Plus className="h-3.5 w-3.5" /> Add shortcut</SpringButton>
              </div>
              <div className="profile-shortcut-list">
                {profileDraft.macros.map((macro, index) => <div className={`profile-shortcut-row ${recordingShortcutIndex === index ? 'profile-shortcut-recording' : ''}`} key={macro.id || `new-${index}`}>
                  <label>Card name<input required maxLength="40" value={macro.label} onChange={(event) => setProfileDraft((draft) => ({ ...draft, macros: draft.macros.map((item, i) => i === index ? { ...item, label: event.target.value } : item) }))} placeholder="e.g. Save document" /></label>
                  <label>Hint<input maxLength="40" value={macro.sub} onChange={(event) => setProfileDraft((draft) => ({ ...draft, macros: draft.macros.map((item, i) => i === index ? { ...item, sub: event.target.value } : item) }))} placeholder="Shown under the card name" /></label>
                  <label>Action<div className="shortcut-recorder-controls">
                    <select value={macro.shortcut} onChange={(event) => setProfileDraft((draft) => ({ ...draft, macros: draft.macros.map((item, i) => i === index ? {
                      ...item,
                      shortcut: event.target.value,
                      sub: !item.sub || item.sub === formatShortcutLabel(item.shortcut) ? formatShortcutLabel(event.target.value) : item.sub,
                    } : item) }))}>
                      <option value="" disabled>Choose or record</option>
                      {SAFE_SHORTCUTS.map(([value, text]) => <option value={value} key={value}>{text}</option>)}
                      {macro.shortcut && !SAFE_SHORTCUTS.some(([value]) => value === macro.shortcut) && <option value={macro.shortcut}>{formatShortcutLabel(macro.shortcut)}</option>}
                    </select>
                    <SpringButton type="button" className={`shortcut-record-button ${recordingShortcutIndex === index ? 'shortcut-recording-active' : ''}`} onClick={() => recordingShortcutIndex === index ? stopShortcutRecording() : startShortcutRecording(index)} aria-pressed={recordingShortcutIndex === index}>{recordingShortcutIndex === index ? 'Cancel' : 'Record'}</SpringButton>
                    {recordingShortcutIndex === index && <SpringButton type="button" className={`shortcut-win-toggle ${recordWinModifier ? 'shortcut-win-selected' : ''}`} onClick={toggleRecordWinModifier} aria-pressed={recordWinModifier}>Win</SpringButton>}
                  </div></label>
                  <SpringButton type="button" className="editor-remove-action" aria-label={`Remove ${macro.label || 'shortcut'}`} onClick={() => setProfileDraft((draft) => ({ ...draft, macros: draft.macros.filter((_, i) => i !== index) }))}><Trash2 className="h-4 w-4" /></SpringButton>
                </div>)}
                {profileDraft.macros.length === 0 && <p className="profile-editor-empty">Add at least one shortcut card to save this profile.</p>}
              </div>
              <div className="profile-editor-footer">
                {profileDraft.id && !Object.prototype.hasOwnProperty.call(PROFILES, profileDraft.id) && <SpringButton type="button" className="editor-delete-profile" onClick={() => deleteProfile(profileDraft.id)}><Trash2 className="h-3.5 w-3.5" /> Delete profile</SpringButton>}
                <SpringButton type="button" className="editor-cancel" onClick={closeProfileEditor}>Cancel</SpringButton>
                <SpringButton type="submit" className="editor-save" disabled={recordingShortcutIndex !== null || !profileDraft.label.trim() || profileDraft.macros.length === 0 || profileDraft.macros.some((macro) => !macro.shortcut)}><Save className="h-3.5 w-3.5" /> Save profile</SpringButton>
              </div>
            </form>
          </section>
        </div>}

        <motion.div layout className={`deck-layout grid flex-1 gap-4 ${layoutClass}`} transition={{ type: 'spring', stiffness: 300, damping: 32 }}>
          <section className="flex min-w-0 flex-col gap-4" aria-label="Media and audio controls">
            <motion.article layout className={`surface-card player-card${isPlaying === true ? ' player-card-streaming' : ''}`} whileTap={{ scale: 0.998 }} transition={{ type: 'spring', stiffness: 420, damping: 28 }}>
              {track.artwork && <div className="player-art-backdrop" style={{ backgroundImage: `url("${track.artwork}")` }} />}
              <div className="player-heading relative z-10 flex items-center justify-between">
                <div className="eyebrow"><span className={`status-led ${isPlaying ? 'is-online' : ''}`} /> MUSIC</div>
                <div className="flex items-center gap-2">
                  <span className="spotify-tag"><span className="spotify-mark">◖</span> SPOTIFY</span>
                  <AudioWaveform active={isPlaying === true} />
                  {!spotifyConnection.connected && <SpringButton type="button" onClick={connectSpotify} className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-200 hover:bg-emerald-400/20">{spotifyConnection.configured ? 'Connect Spotify' : 'Set up Spotify'}</SpringButton>}
                </div>
              </div>
              <div className="player-main relative z-10 mt-5 flex min-w-0 items-center gap-4">
                {track.artwork ? (
                  <div className={`album-disc${isPlaying === true ? ' album-disc-playing' : ''}`}>
                  <motion.img
                    key={`${track.title}-${track.artist}-${track.artwork}`}
                    src={track.artwork}
                    alt={`${track.title} album artwork`}
                    onError={() => setTrack((current) => ({ ...current, artwork: '' }))}
                    className="album-art"
                    initial={{ opacity: 0, scale: 0.88, rotate: -4 }}
                    animate={{ opacity: 1, scale: 1, rotate: 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 24 }}
                  />
                  </div>
                ) : (
                  <div className="album-art album-art-placeholder"><Wifi className="h-7 w-7 rotate-45" /></div>
                )}
                <div className="min-w-0">
                  <h2 className="track-title">{track.title}</h2>
                  <p className="mt-1 truncate text-sm text-zinc-400">{track.artist}</p>
                  {!spotifyConnection.connected && <SpringButton type="button" onClick={connectSpotify} className="mt-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-200 hover:bg-emerald-400/20">{spotifyConnection.configured ? 'Connect Spotify' : 'Set up Spotify'}</SpringButton>}
                </div>
              </div>
              <div className="player-footer relative z-10 mt-5 flex items-center justify-between border-t border-white/10 pt-4">
                <span className="text-[10px] text-zinc-500">{isPlaying === null ? 'Playback state unavailable' : isPlaying ? 'Playing on your PC' : 'Playback paused'}</span>
                <label className="player-volume" title={spotifyVolume ? `Spotify volume ${spotifyVolume.volume}%` : 'Open Spotify to enable its volume control'}>
                  <Volume2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <motion.input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    aria-label="Spotify volume"
                    aria-valuetext={spotifyVolume ? `${spotifyVolume.volume}%` : 'Spotify is unavailable'}
                    value={spotifyVolume?.volume ?? 0}
                    disabled={!online || !spotifyVolume}
                    onChange={(event) => spotifyVolume && handleVolume(spotifyVolume.id, Number(event.target.value))}
                    style={{ '--volume-level': `${spotifyVolume?.volume ?? 0}%` }}
                    className="player-volume-range"
                    whileTap={{ scale: 1.015 }}
                    transition={{ type: 'spring', stiffness: 480, damping: 24 }}
                  />
                  <span className="player-volume-value">{spotifyVolume ? `${spotifyVolume.volume}%` : '—'}</span>
                </label>
                <div className="flex items-center gap-2">
                  <motion.button type="button" aria-label="Previous Spotify track" title="Previous track" onClick={() => handleMedia('prev', 'Spotify · Previous track')} className="transport-button" whileHover={{ y: -1 }} whileTap={{ scale: 0.9, y: 1 }} transition={{ type: 'spring', stiffness: 480, damping: 25 }}>
                    <SkipBack className="h-4 w-4" />
                  </motion.button>
                  <motion.button type="button" aria-label={isPlaying ? 'Pause Spotify' : 'Play Spotify'} title={isPlaying ? 'Pause' : 'Play'} onClick={() => handleMedia('play_pause', isPlaying ? 'Spotify · Pause' : 'Spotify · Play')} className="transport-primary" whileHover={{ y: -2, scale: 1.035 }} whileTap={{ scale: 0.92, y: 1 }} transition={{ type: 'spring', stiffness: 520, damping: 22 }}>
                    {isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
                  </motion.button>
                  <motion.button type="button" aria-label="Next Spotify track" title="Next track" onClick={() => handleMedia('next', 'Spotify · Next track')} className="transport-button" whileHover={{ y: -1 }} whileTap={{ scale: 0.9, y: 1 }} transition={{ type: 'spring', stiffness: 480, damping: 25 }}>
                    <SkipForward className="h-4 w-4" />
                  </motion.button>
                </div>
              </div>
              <div className="player-timeline relative z-10" aria-label="Spotify playback position">
                <div className="player-timeline-times">
                  <span>{formatMediaTime(currentPosition)}</span>
                  <span>{mediaTimeline.duration ? `-${formatMediaTime(mediaTimeline.duration - currentPosition)}` : '--:--'}</span>
                </div>
                <motion.input
                  type="range"
                  min={seekMin}
                  max={seekMax || 1}
                  step="1"
                  value={displayedSeekPosition}
                  disabled={!online || !mediaTimeline.seekable || mediaTimeline.duration <= 0}
                  aria-label="Seek Spotify track"
                  aria-valuetext={`${formatMediaTime(currentPosition)} of ${formatMediaTime(mediaTimeline.duration)}`}
                  onChange={(event) => handleSeek(event.target.value)}
                  style={{ '--seek-progress': `${mediaTimeline.duration ? (displayedSeekPosition / mediaTimeline.duration) * 100 : 0}%` }}
                  className="player-seek-range"
                  whileTap={{ scaleY: 1.25 }}
                  transition={{ type: 'spring', stiffness: 480, damping: 24 }}
                />
              </div>
            </motion.article>

            <article className="surface-card soundboard-pane p-4 sm:p-5" aria-label="Soundboard">
              <div className="section-heading mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="section-icon icon-cyan"><Volume2 className="h-4 w-4" /></div>
                  <div><h2 className="section-title">Soundboard</h2></div>
                </div>
                <SpringButton type="button" className="launcher-edit-toggle" onClick={() => { setSoundboardEditing((editing) => !editing); setEditingSoundId(null); }} aria-pressed={soundboardEditing}>
                  {soundboardEditing ? <Check className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                  <span>{soundboardEditing ? 'Done' : 'Edit'}</span>
                </SpringButton>
              </div>
              {soundboardEditing && <div className="soundboard-upload-row">
                <input className="soundboard-name-input" type="text" value={soundNameDraft} maxLength={40} onChange={(event) => setSoundNameDraft(event.target.value)} placeholder="Sound name (optional)" aria-label="Name for your sound" disabled={!online || soundUploading} />
                <label className={`soundboard-upload-button ${!online || soundUploading || customSounds.length >= 24 ? 'is-disabled' : ''}`}>
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{soundUploading ? 'Adding…' : 'Add sound'}</span>
                  <input type="file" accept=".wav,.mp3,audio/wav,audio/x-wav,audio/mpeg" onChange={uploadSound} disabled={!online || soundUploading || customSounds.length >= 24} aria-label="Choose a WAV or MP3 sound to upload" />
                </label>
              </div>}
              <div className="soundboard-grid">
                {SOUNDBOARD_PRESETS.map((sound) => ({ ...sound, name: sound.label, builtin: true, visible: visibleBuiltinSoundIds.includes(sound.id) }))
                  .concat(customSounds.map((sound) => ({ ...sound, label: sound.name, builtin: false, visible: true })))
                  .filter((sound) => sound.visible || soundboardEditing)
                  .map((sound) => (
                  <div className="soundboard-item" key={sound.id}>
                    {sound.builtin && !sound.visible ? (
                      <SpringButton type="button" className="soundboard-restore-button" onClick={() => restoreBuiltinSound(sound.id)} title={`Add ${sound.name} back to the soundboard`}>
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Add {sound.name}</span>
                      </SpringButton>
                    ) : !sound.builtin && editingSoundId === sound.id ? (
                      <div className="soundboard-edit-row">
                        <input autoFocus className="soundboard-edit-input" type="text" value={editingSoundName} maxLength={40} onChange={(event) => setEditingSoundName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveCustomSoundName(sound); if (event.key === 'Escape') setEditingSoundId(null); }} aria-label={`Edit ${sound.name} name`} />
                        <SpringButton type="button" className="soundboard-edit-action" onClick={() => saveCustomSoundName(sound)} disabled={!online || !editingSoundName.trim()} aria-label="Save sound name"><Check className="h-3.5 w-3.5" /></SpringButton>
                        <SpringButton type="button" className="soundboard-edit-action" onClick={() => setEditingSoundId(null)} aria-label="Cancel sound name edit"><X className="h-3.5 w-3.5" /></SpringButton>
                      </div>
                    ) : (
                      <>
                        <SpringButton type="button" className="soundboard-button" onClick={() => playSound({ ...sound, label: sound.name })} disabled={!online} title={`Play ${sound.name} on your PC`}>
                          <Play className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>{sound.name}</span>
                        </SpringButton>
                        {soundboardEditing && <div className="soundboard-actions">
                          {sound.builtin ? (
                            <SpringButton type="button" className="soundboard-edit-action soundboard-delete-action" onClick={() => removeBuiltinSound(sound.id)} aria-label={`Remove ${sound.name} from soundboard`} title={`Remove ${sound.name} from soundboard`}><Trash2 className="h-3 w-3" /></SpringButton>
                          ) : <>
                            <SpringButton type="button" className="soundboard-edit-action" onClick={() => { setEditingSoundId(sound.id); setEditingSoundName(sound.name); }} aria-label={`Edit ${sound.name}`} title={`Edit ${sound.name}`}><Pencil className="h-3 w-3" /></SpringButton>
                            <SpringButton type="button" className="soundboard-edit-action soundboard-delete-action" onClick={() => removeCustomSound(sound)} disabled={!online} aria-label={`Remove ${sound.name}`} title={`Remove ${sound.name}`}><Trash2 className="h-3 w-3" /></SpringButton>
                          </>}
                        </div>}
                      </>
                    )}
                  </div>
                ))}
              </div>
              {customSounds.length === 0 && visibleBuiltinSoundIds.length === 0 && !soundboardEditing && <p className="soundboard-empty-note">No sounds yet. Choose Edit to add a sound or restore a preset.</p>}
              {customSounds.length >= 24 && <p className="soundboard-limit-note">You’ve reached the 24 custom sound limit.</p>}
            </article>

            <article className="surface-card volume-mixer-pane p-4 sm:p-5">
              <div className="section-heading mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="section-icon icon-cyan"><Volume2 className="h-4 w-4" /></div>
                  <div><h2 className="section-title">Volume mixer</h2></div>
                </div>
                <span className="tiny-label">LIVE</span>
              </div>
              <div className="flex flex-col gap-2.5">
                {volumes.apps.map((audioApp, index) => (
                  <TouchVolumePill
                    key={audioApp.id}
                    label={audioApp.name}
                    target={audioApp.id}
                    value={audioApp.volume}
                    onChange={handleVolume}
                    colorClass={['bg-emerald-400/20', 'bg-violet-400/20', 'bg-sky-400/20', 'bg-amber-400/20'][index % 4]}
                    icon={Volume2}
                  />
                ))}
                {volumes.apps.length === 0 && <p className="rounded-xl border border-dashed border-white/10 px-3 py-3 text-[11px] text-zinc-500">No active app audio sessions</p>}
                <TouchVolumePill label="Master output" target="master" value={volumes.master} onChange={handleVolume} colorClass="bg-cyan-400/20" icon={Volume2} />
              </div>
            </article>
          </section>

          <aside className="time-pane surface-card" aria-label="Local date and time">
            <div className="time-pane-label"><Clock3 className="h-3.5 w-3.5" /> LOCAL TIME</div>
            <div className="time-center">
              <div className="clock-orbit" style={{ '--clock-sweep': `${clockNow.getSeconds() * 6}deg` }}>
                <div className="time-readout" aria-live="off">
                  <span>{clockTime}</span>
                  <span key={clockSeconds} className="time-seconds">:{clockSeconds}</span>
                </div>
              </div>
              <div className="time-period">24-HOUR FORMAT</div>
            </div>
            <div className="time-date-block">
              <div className="time-rule" />
              <div className="time-date-icon"><CalendarDays className="h-4 w-4" /></div>
              <div className="time-weekday">{clockDate.split(',')[0]}</div>
              <div className="time-date">{clockDate.includes(',') ? clockDate.slice(clockDate.indexOf(',') + 2) : clockDate}</div>
              <div id="sports-score-slot" />
            </div>
          </aside>

          <section className="shortcut-discord-stack flex min-w-0 flex-col gap-4" aria-label="Shortcuts, apps, and Discord controls">
            <motion.div layout className="surface-card shortcut-panel flex min-w-0 flex-col p-4 sm:p-5 lg:p-6" aria-label={`${profile.label} shortcuts`} transition={{ type: 'spring', stiffness: 300, damping: 32 }}>
              <div className="section-heading mb-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="section-icon icon-cyan"><Shapes className="h-4 w-4" /></div>
                  <div className="min-w-0"><h2 className="section-title">Shortcuts</h2><p className="section-subtitle truncate">{profile.label} workspace</p></div>
                </div>
                <SpringButton type="button" className="shortcut-edit-button" onClick={() => openProfileEditor(profile)} aria-label={`Edit ${profile.label} app shortcuts`} title="Edit app shortcuts"><Pencil className="h-3.5 w-3.5" /></SpringButton>
              </div>
              <AnimatePresence mode="wait" initial={false}>
              <motion.div key={profile.id} layout className="macro-grid grid flex-1 content-start gap-3 sm:grid-cols-2 xl:grid-cols-3" initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -14 }} transition={{ type: 'spring', stiffness: 340, damping: 30 }}>
                {profile.macros.map((macro, index) => {
                  const Icon = iconPack === 'phosphor' ? PHOSPHOR_MACRO_ICONS[macro.id] || macro.icon : macro.icon;
                  return (
                    <SpringButton
                      type="button"
                      key={macro.id}
                      onClick={(event) => {
                        void fireMacro(macro);
                        // Clear the browser's pressed/focus styling after a pointer activation.
                        if (event.detail > 0) event.currentTarget.blur();
                      }}
                      className="macro-card group"
                      disabled={!online || busyMacroId === macro.id}
                      style={{ '--macro-delay': `${index * 35}ms` }}
                    >
                      <div className={`macro-icon ${macro.bg}`}><Icon className={`h-[18px] w-[18px] ${macro.color}`} {...(iconPack === 'phosphor' ? { weight: 'regular' } : {})} /></div>
                      <div className="min-w-0 flex-1 pr-4">
                        <div className="truncate text-sm font-semibold text-zinc-100">{macro.label}</div>
                        <div className="mt-1 truncate font-mono text-[11px] text-zinc-400">{macro.sub}</div>
                      </div>
                      {busyMacroId === macro.id ? <LoaderCircle className="macro-arrow h-4 w-4 animate-spin" /> : <ChevronRight className="macro-arrow h-4 w-4" />}
                    </SpringButton>
                  );
                })}
              </motion.div>
              </AnimatePresence>
            </motion.div>

            <article className="surface-card app-launcher-pane" aria-label="Apps">
              <div className="app-launcher-heading">
                <div className="section-icon icon-cyan"><Shapes className="h-4 w-4" /></div>
                <div><h2 className="section-title">Apps</h2><p className="section-subtitle">On your PC</p></div>
              </div>
              <div className="app-launcher-grid">
                {launcherApps.map((id) => {
                  const app = appCatalog.find((item) => item.id === id);
                  if (!app) return null;
                  const label = app.label || id;
                  const Icon = app.Icon || LAUNCHER_APPS.find((item) => item.id === id)?.Icon || Shapes;
                  return (
                  <SpringButton type="button" key={id} className="app-launcher-button" onClick={() => launcherEditing ? saveLauncherApps(launcherApps.filter((appId) => appId !== id)) : launchApp({ id, label })} disabled={!launcherEditing && !online} aria-label={launcherEditing ? `Remove ${label}` : `Open ${label} on your PC`} title={launcherEditing ? `Remove ${label}` : `Open ${label}`}>
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span>{label}</span>
                    {launcherEditing && <X className="launcher-remove-icon h-3 w-3" aria-hidden="true" />}
                  </SpringButton>
                ); })}
                {launcherEditing && launcherApps.length < appCatalog.length && (
                  <label className="launcher-add-wrap">
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    <select aria-label="Add an app" value="" onChange={(event) => event.target.value && saveLauncherApps([...launcherApps, event.target.value])}>
                      <option value="" disabled>Add app</option>
                      {appCatalog.filter((app) => !launcherApps.includes(app.id)).map((app) => <option key={app.id} value={app.id}>{app.label}</option>)}
                    </select>
                  </label>
                )}
              </div>
              <SpringButton type="button" className="launcher-edit-toggle" onClick={() => setLauncherEditing((editing) => !editing)} aria-pressed={launcherEditing}>
                {launcherEditing ? <Check className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                <span>{launcherEditing ? 'Done' : 'Edit'}</span>
              </SpringButton>
            </article>

            <motion.article layout className={`surface-card discord-panel p-4 sm:p-5 lg:p-6${discordRpc.connected ? ' discord-panel-rpc-active' : ''}`} aria-label="Discord voice controls" whileTap={{ scale: 0.998 }} transition={{ type: 'spring', stiffness: 420, damping: 28 }}>
              <div className="section-heading mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="section-icon icon-violet"><Headphones className="h-4 w-4" /></div>
                  <div><h2 className="section-title">Discord</h2><p className="section-subtitle">Desktop voice controls</p></div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`tiny-label ${discordAvailable ? 'discord-ready' : ''}`}>{discordAvailable ? 'READY' : 'OFFLINE'}</span>
                  {discordRpc.connected
                    ? <span className="text-[9px] font-semibold text-emerald-300">RPC ON</span>
                    : <SpringButton type="button" disabled={discordRpcConnecting} onClick={connectDiscordRpc} className="rounded-full border border-violet-400/30 bg-violet-400/10 px-2.5 py-1 text-[10px] font-semibold text-violet-200 hover:bg-violet-400/20 disabled:cursor-wait disabled:opacity-60">{discordRpcConnecting ? 'Waiting for Discord…' : discordRpc.username ? 'Reconnect RPC' : 'Connect RPC'}</SpringButton>}
                </div>
              </div>
              <div className="discord-controls grid grid-cols-2 gap-2">
                <motion.button layout type="button" className={`discord-control-button ${discordMicMuted || discordDeafened ? 'discord-control-active' : ''}`} aria-pressed={discordMicMuted || discordDeafened || undefined} disabled={!online || !discordAvailable || Boolean(discordSelfVoice?.server_muted)} onClick={() => handleDiscord('mute', 'Discord · Toggle microphone mute')} whileHover={!online || !discordAvailable ? undefined : { y: -1 }} whileTap={!online || !discordAvailable ? undefined : { scale: 0.97, y: 1 }} transition={{ type: 'spring', stiffness: 460, damping: 28 }}>
                  <Mic className="h-4 w-4" />
                  <AnimatePresence mode="wait" initial={false}><motion.span key={discordSelfVoice?.server_muted ? 'server-muted' : discordMicMuted ? 'muted' : 'unmuted'} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.14 }}>{discordSelfVoice?.server_muted ? 'Server muted' : discordMicMuted === null ? 'Toggle mute' : discordMicMuted ? 'Unmute mic' : 'Mute mic'}</motion.span></AnimatePresence>
                </motion.button>
                <motion.button layout type="button" className={`discord-control-button ${discordDeafened ? 'discord-control-active' : ''}`} aria-pressed={discordDeafened ?? undefined} disabled={!online || !discordAvailable || Boolean(discordSelfVoice?.server_deafened)} onClick={() => handleDiscord('deafen', 'Discord · Toggle deafen')} whileHover={!online || !discordAvailable ? undefined : { y: -1 }} whileTap={!online || !discordAvailable ? undefined : { scale: 0.97, y: 1 }} transition={{ type: 'spring', stiffness: 460, damping: 28 }}>
                  <Headphones className="h-4 w-4" />
                  <AnimatePresence mode="wait" initial={false}><motion.span key={discordSelfVoice?.server_deafened ? 'server-deafened' : discordDeafened ? 'deafened' : 'undeafened'} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.14 }}>{discordSelfVoice?.server_deafened ? 'Server deafened' : discordDeafened === null ? 'Toggle deafen' : discordDeafened ? 'Undeafen' : 'Deafen'}</motion.span></AnimatePresence>
                </motion.button>
              </div>
              <div className="discord-voice-status" aria-live="polite">
                {!discordVoice.configured ? (
                  <p className="discord-empty-state">{discordRpc.connected ? 'Discord RPC controls your mic and deafen. The optional bot adds server voice status and member lists.' : discordRpc.error ? `RPC authorization exists, but the local connection is unavailable: ${discordRpc.error}` : discordRpc.username ? `Authorized as ${discordRpc.username}, but RPC is offline. Open Discord desktop on the PC running the PulseDeck backend, then reconnect.` : 'Connect RPC for direct Discord mic and deafen controls. The optional bot adds server voice status and member lists.'}</p>
                ) : discordVoice.connection === 'error' ? (
                  <p className="discord-empty-state">Discord monitor could not connect. Check the bot token and enabled intents.</p>
                ) : discordVoice.connection !== 'connected' ? (
                  <p className="discord-empty-state">{discordVoice.connection === 'host-offline' ? 'Host connection unavailable.' : 'Connecting to Discord voice status…'}</p>
                ) : discordVoice.channel ? (
                  <>
                    <div className="discord-channel-name">
                      <Users className="h-3.5 w-3.5" />
                      <span className="truncate">{discordVoice.guild} <span className="text-zinc-600">/</span> {discordVoice.channel}</span>
                      <span className="ml-auto shrink-0 text-[9px] text-zinc-500">{discordVoice.members.length} here</span>
                    </div>
                    <div className="discord-member-list" aria-label="People in your voice channel">
                      {discordVoice.members.map((member, index) => (
                        <div className="discord-member" key={`${member.name}-${index}`}>
                          <span className={`discord-member-dot ${member.is_self ? 'discord-member-self' : ''}`} />
                          <span className="min-w-0 flex-1 truncate">{member.name}{member.is_self && <span className="ml-1.5 text-[8px] font-semibold uppercase tracking-wider text-[#b4ff00]">You</span>}</span>
                          {(member.self_muted || member.server_muted) && <span className="discord-member-state" title={member.server_muted ? 'Server muted' : 'Self muted'}>MUTED</span>}
                          {(member.self_deafened || member.server_deafened) && <span className="discord-member-state" title={member.server_deafened ? 'Server deafened' : 'Self deafened'}>DEAF</span>}
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="discord-empty-state">You’re not in a server voice channel visible to the bot.</p>
                )}
              </div>
              {discordRpcConnectError && <p className="discord-empty-state mt-2 text-rose-300" role="alert">RPC connection failed: {discordRpcConnectError}</p>}
            </motion.article>
          </section>
        </motion.div>
      </div>
    </main>
  );
}
