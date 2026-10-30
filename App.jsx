import React, { useState, useEffect, useRef } from 'react';
import { apiRequest, authRequest, clearAccountSession, getAccountUsername, getApiToken, saveAccountSession } from './api.js';
import PROFILES from './profiles.js';
import TouchVolumePill from './VolumeControl.jsx';
import {
  Activity, CalendarDays, Check, ChevronDown, ChevronRight, Clock3, Moon as MoonIcon,
  Headphones, Mic, Pause, PhoneOff, Play, Plus, RefreshCw, Shapes, SkipBack, SkipForward,
  Sun as SunIcon, Users, Volume2, Wifi, Pencil, Trash2, X, Save, Music2, Gamepad2,
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
      const customMacros = Array.isArray(custom.macros) ? custom.macros.slice(0, 3) : [];
      return { ...base, ...custom, icon: base.icon, macros: customMacros.map((macro) => ({
        ...base.macros.find((item) => item.id === macro.id), ...macro,
        icon: base.macros.find((item) => item.id === macro.id)?.icon || Shapes,
      })) };
    });
    savedById.forEach((item) => {
      if (!item || typeof item.label !== 'string' || !Array.isArray(item.macros)) return;
      merged.push({ ...item, icon: Shapes, macros: item.macros.slice(0, 3).map((macro) => ({ ...macro, icon: Shapes })) });
    });
    return merged;
  } catch { return defaults; }
}

const PHOSPHOR_PROFILE_ICONS = {
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
  const [activeProfile, setActiveProfile] = useState('photo');
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [profileDraft, setProfileDraft] = useState(null);
  const [autoSwitch, setAutoSwitch] = useState(true);
  const [showConnection, setShowConnection] = useState(() => !getApiToken());
  const [accountConfigured, setAccountConfigured] = useState(null);
  const [accountUsername, setAccountUsername] = useState(getAccountUsername);
  const [accountPassword, setAccountPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [theme, setTheme] = useState(() => {
    try { return window.localStorage.getItem('pulsedeck-theme') === 'light' ? 'light' : 'dark'; }
    catch { return 'dark'; }
  });
  const [reduceMotion, setReduceMotion] = useState(() => {
    try { return window.localStorage.getItem('pulsedeck-reduced-motion') === 'true'; }
    catch { return false; }
  });
  const iconPack = 'phosphor';
  const [clockNow, setClockNow] = useState(() => new Date());
  const [isPlaying, setIsPlaying] = useState(null);
  const [track, setTrack] = useState({ title: 'Waiting for Spotify', artist: 'Open Spotify on your PC', artwork: '' });
  const [mediaTimeline, setMediaTimeline] = useState({ position: 0, duration: 0, seekMin: 0, seekMax: 0, seekable: false, updatedAt: Date.now() });
  const [online, setOnline] = useState(false);
  const [discordAvailable, setDiscordAvailable] = useState(false);
  const [discordVoice, setDiscordVoice] = useState({ configured: false, connection: 'disabled', guild: null, channel: null, members: [] });
  const [discordControlOverrides, setDiscordControlOverrides] = useState({ mute: null, deafen: null });
  const [toast, setToast] = useState('Connecting to PC…');
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
  const volumeMixerRef = useRef(null);
  const clockPaneRef = useRef(null);

  const profile = profiles.find((item) => item.id === activeProfile) || profiles[0] || PROFILES.photo;
  const layoutClass = 'grid-cols-1 lg:grid-cols-[minmax(280px,0.9fr)_minmax(175px,0.55fr)_minmax(0,1.4fr)]';
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
  const observedDiscordMicMuted = discordSelfVoice ? discordSelfVoice.self_muted || discordSelfVoice.server_muted : null;
  const observedDiscordDeafened = discordSelfVoice ? discordSelfVoice.self_deafened || discordSelfVoice.server_deafened : null;
  const discordMicMuted = discordControlOverrides.mute ?? observedDiscordMicMuted;
  const discordDeafened = discordControlOverrides.deafen ?? observedDiscordDeafened;

  useEffect(() => {
    if (!discordSelfVoice) return;
    setDiscordControlOverrides((current) => ({
      mute: current.mute === observedDiscordMicMuted ? null : current.mute,
      deafen: current.deafen === observedDiscordDeafened ? null : current.deafen,
    }));
  }, [discordSelfVoice?.self_muted, discordSelfVoice?.server_muted, discordSelfVoice?.self_deafened, discordSelfVoice?.server_deafened]);

  useEffect(() => {
    let active = true;
    authRequest('/api/auth/status')
      .then((data) => {
        if (!active) return;
        const configured = Boolean(data.account_configured);
        setAccountConfigured(configured);
        if (!apiToken) setToast(configured ? 'Sign in to control this PC' : 'Create the account for this PC');
      })
      .catch(() => { if (active) setAccountConfigured(false); });
    return () => { active = false; };
  }, []);

  const submitAccount = async (event) => {
    event.preventDefault();
    setAuthBusy(true);
    try {
      const endpoint = accountConfigured ? '/api/auth/login' : '/api/auth/register';
      const data = await authRequest(endpoint, { username: accountUsername, password: accountPassword });
      saveAccountSession(data.token, data.username);
      setApiToken(data.token);
      setAccountUsername(data.username);
      setAccountPassword('');
      setAccountConfigured(true);
      setToast('Signed in to this PC');
    } catch (error) {
      setToast(error.message || 'Could not sign in');
    } finally {
      setAuthBusy(false);
    }
  };

  const logoutAccount = async () => {
    try { await apiRequest('/api/auth/logout', { method: 'POST', body: {} }); } catch { /* Clear the local session even if the PC is offline. */ }
    clearAccountSession();
    setApiToken('');
    setAccountUsername('');
    setAccountPassword('');
    setOnline(false);
    setToast('Signed out');
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
        setDiscordAvailable(Boolean(data.discord?.available));
        setDiscordVoice(data.discord?.voice || { configured: false, connection: 'disabled', guild: null, channel: null, members: [] });
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
            const matched = profiles.find((item) => (item.matchApps || []).includes(data.active_app.toLowerCase()));
            if (matched) setActiveProfile(matched.id);
          }
        }
      } catch (error) {
        if (!active) return;
        setOnline(false);
        setDiscordAvailable(false);
        setDiscordVoice((current) => ({ ...current, connection: 'host-offline', guild: null, channel: null, members: [] }));
        const tokenRejected = /401|sign in|token rejected/i.test(error?.message || '');
        if (tokenRejected) {
          clearAccountSession();
          setApiToken('');
          setAccountUsername('');
          setAccountConfigured(true);
          setToast('Sign in again to control this PC');
          return;
        }
        setToast(!apiToken
          ? 'Create an account or sign in to connect'
          : tokenRejected
            ? 'Host token rejected'
            : 'Host unavailable — start Server.py');
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
    const clockPane = clockPaneRef.current;
    const volumeMixer = volumeMixerRef.current;
    if (!clockPane || !volumeMixer) return undefined;

    const updateClockHeight = () => {
      const shell = clockPane.closest('.deck-shell');
      if (window.innerWidth < 1024 || shell?.classList.contains('landscape-preview')) {
        clockPane.style.removeProperty('--clock-pane-height');
        return;
      }
      const height = volumeMixer.getBoundingClientRect().bottom - clockPane.getBoundingClientRect().top;
      clockPane.style.setProperty('--clock-pane-height', `${Math.max(0, height)}px`);
    };

    updateClockHeight();
    const resizeObserver = new ResizeObserver(updateClockHeight);
    resizeObserver.observe(volumeMixer);
    window.addEventListener('resize', updateClockHeight);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateClockHeight);
    };
  }, [volumes.apps.length]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = theme === 'light' ? '#d2ddff' : '#15011d';
    try { window.localStorage.setItem('pulsedeck-theme', theme); } catch { /* Keep the in-memory theme. */ }
  }, [theme]);

  useEffect(() => {
    try { window.localStorage.setItem('pulsedeck-reduced-motion', String(reduceMotion)); }
    catch { /* Keep the in-memory motion preference. */ }
  }, [reduceMotion]);

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
    setProfileDraft(item ? {
      id: item.id, label: item.label, app: item.app || '',
      matchApps: (item.matchApps || []).join(', '),
      macros: item.macros.slice(0, 3).map(({ id, label, sub, shortcut }) => ({ id, label, sub, shortcut })),
    } : { id: '', label: '', app: '', matchApps: '', macros: [] });
    setProfileEditorOpen(true);
  };

  const saveProfileDraft = (event) => {
    event.preventDefault();
    const label = profileDraft.label.trim();
    if (!label || !profileDraft.macros.length) return;
    const id = profileDraft.id || `custom-${Date.now().toString(36)}`;
    const existing = profiles.find((item) => item.id === id);
    const macros = profileDraft.macros.slice(0, 3).map((macro, index) => {
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
    setToast(`Profile saved · ${label}`);
  };

  const deleteProfile = (id) => {
    if (Object.prototype.hasOwnProperty.call(PROFILES, id)) return;
    setProfiles((current) => current.filter((item) => item.id !== id));
    if (activeProfile === id) setActiveProfile('photo');
    setProfileEditorOpen(false);
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

  const fireMacro = (macro) => {
    if (navigator.vibrate) navigator.vibrate(20);
    setToast(`${macro.label} · ${macro.sub}`);
    if (macro.shortcut === 'duck_spotify') handleVolume('spotify', 15);
    else triggerBackend('/api/hotkey', { shortcut: macro.shortcut, label: macro.label });
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
    <main data-theme={theme} data-reduced-motion={reduceMotion} className="deck-shell min-h-screen overflow-x-clip px-3 py-4 text-zinc-100 sm:px-6 sm:py-6 lg:px-10 lg:py-8">
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
            <div className="host-status" role="status" aria-live="polite">
              <span className={`status-led ${online ? 'is-online' : ''}`} />
              <span>{online ? 'HOST CONNECTED' : 'HOST OFFLINE'}</span>
            </div>
            <button
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
            </button>
            <button
              type="button"
              className={`icon-button ${showConnection ? 'icon-button-active' : ''}`}
              aria-label={showConnection ? 'Hide connection settings' : 'Show connection settings'}
              aria-expanded={showConnection}
              aria-controls="connection-settings"
              title={showConnection ? 'Hide connection settings' : 'Show connection settings'}
              onClick={() => setShowConnection((visible) => !visible)}
            >
              <ChevronDown className={`h-4 w-4 transition-transform ${showConnection ? 'rotate-180' : ''}`} />
            </button>
            <button
              type="button"
              className="icon-button theme-toggle"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
            </button>
            <button
              type="button"
              className={`icon-button motion-toggle ${reduceMotion ? 'icon-button-active' : ''}`}
              aria-label={reduceMotion ? 'Enable animations' : 'Reduce motion'}
              aria-pressed={reduceMotion}
              title={reduceMotion ? 'Enable animations' : 'Reduce motion'}
              onClick={() => setReduceMotion((current) => !current)}
            >
              {reduceMotion ? <Pause className="h-4 w-4" /> : <Activity className="h-4 w-4" />}
            </button>
          </div>
        </header>

        {showConnection && <section id="connection-settings" className="connection-bar mb-5 sm:mb-7">
          <div className="flex min-w-0 items-center gap-3">
            <div className={`connection-icon ${online ? 'connected' : ''}`}><Wifi className="h-4 w-4" /></div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Connection</p>
              <p className="mt-0.5 truncate text-xs text-zinc-300">{online ? `Connected · ${toast}` : toast}</p>
            </div>
          </div>
          {apiToken ? (
            <div className="flex min-w-[190px] flex-1 items-center justify-end gap-2 sm:max-w-[380px]">
              <span className="truncate text-[10px] text-zinc-500">{accountUsername ? `Signed in as ${accountUsername}` : 'Authenticated session'}</span>
              <button type="button" className="launcher-edit-toggle" onClick={logoutAccount}>Sign out</button>
            </div>
          ) : accountConfigured === null ? (
            <span className="text-[10px] text-zinc-500">Connecting to PC…</span>
          ) : (
            <form className="flex min-w-[190px] flex-1 flex-wrap items-center justify-end gap-2 sm:max-w-[520px]" onSubmit={submitAccount}>
              <label htmlFor="account-username" className="sr-only">Account username</label>
              <input id="account-username" className="token-input min-w-0 flex-1" type="text" autoComplete="username" minLength={3} maxLength={32} required value={accountUsername} onChange={(event) => setAccountUsername(event.target.value)} placeholder="Username" />
              <label htmlFor="account-password" className="sr-only">Account password</label>
              <input id="account-password" className="token-input min-w-0 flex-1" type="password" autoComplete={accountConfigured ? 'current-password' : 'new-password'} minLength={10} maxLength={256} required value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} placeholder={accountConfigured ? 'Password' : 'Create password'} />
              <button type="submit" className="launcher-edit-toggle" disabled={authBusy}>{authBusy ? 'Please wait…' : accountConfigured ? 'Sign in' : 'Create account'}</button>
            </form>
          )}
        </section>}

        <nav className="mb-5 flex items-center gap-1.5 overflow-x-auto pb-1 sm:mb-7" aria-label="Control profiles">
          <span className="mr-2 hidden text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600 sm:inline">Workspace</span>
          {profiles.map((item) => {
            const Icon = iconPack === 'phosphor' ? PHOSPHOR_PROFILE_ICONS[item.id] || item.icon : item.icon;
            const selected = activeProfile === item.id;
            return (
              <button
                type="button"
                key={item.id}
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
                {selected && <span className="profile-tab-dot" />}
              </button>
            );
          })}
          <button type="button" className="profile-tab profile-manage-button" onClick={() => openProfileEditor(profile)} title="Edit the selected profile and its shortcuts">
            <Pencil className="h-3.5 w-3.5" /><span>Manage</span>
          </button>
          <button type="button" className="profile-tab profile-add-button" onClick={() => openProfileEditor()} title="Add a work profile">
            <Plus className="h-3.5 w-3.5" /><span>Add profile</span>
          </button>
        </nav>

        {profileEditorOpen && profileDraft && <div className="profile-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setProfileEditorOpen(false); }}>
          <section className="profile-editor surface-card" role="dialog" aria-modal="true" aria-labelledby="profile-editor-title">
            <div className="profile-editor-heading">
              <div><p className="eyebrow">WORKSPACE SETUP</p><h2 id="profile-editor-title">{profileDraft.id ? 'Edit profile' : 'Create profile'}</h2></div>
              <button type="button" className="icon-button" onClick={() => setProfileEditorOpen(false)} aria-label="Close profile editor"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={saveProfileDraft}>
              <div className="profile-editor-fields">
                <label>Profile name<input required maxLength="32" value={profileDraft.label} onChange={(event) => setProfileDraft((draft) => ({ ...draft, label: event.target.value }))} placeholder="e.g. Writing" /></label>
                <label>Primary app<input maxLength="80" value={profileDraft.app} onChange={(event) => setProfileDraft((draft) => ({ ...draft, app: event.target.value }))} placeholder="e.g. Word.exe" /></label>
                <label className="profile-app-matches">Auto-switch app names<input value={profileDraft.matchApps} onChange={(event) => setProfileDraft((draft) => ({ ...draft, matchApps: event.target.value }))} placeholder="word.exe, winword.exe (comma separated)" /><small>Use executable names. Leave blank to select this profile manually.</small></label>
              </div>
              <div className="profile-shortcut-heading"><div><h3>Shortcut cards</h3><p>Choose from host-approved actions.</p></div>
                <button type="button" className="editor-add-action" disabled={profileDraft.macros.length >= 3} onClick={() => setProfileDraft((draft) => ({ ...draft, macros: [...draft.macros, { id: '', label: '', sub: '', shortcut: SAFE_SHORTCUTS[0][0] }] }))}><Plus className="h-3.5 w-3.5" /> Add shortcut</button>
              </div>
              <div className="profile-shortcut-list">
                {profileDraft.macros.map((macro, index) => <div className="profile-shortcut-row" key={macro.id || `new-${index}`}>
                  <label>Card name<input required maxLength="40" value={macro.label} onChange={(event) => setProfileDraft((draft) => ({ ...draft, macros: draft.macros.map((item, i) => i === index ? { ...item, label: event.target.value } : item) }))} placeholder="e.g. Save document" /></label>
                  <label>Hint<input maxLength="40" value={macro.sub} onChange={(event) => setProfileDraft((draft) => ({ ...draft, macros: draft.macros.map((item, i) => i === index ? { ...item, sub: event.target.value } : item) }))} placeholder="Shown under the card name" /></label>
                  <label>Action<select value={macro.shortcut} onChange={(event) => setProfileDraft((draft) => ({ ...draft, macros: draft.macros.map((item, i) => i === index ? { ...item, shortcut: event.target.value } : item) }))}>{SAFE_SHORTCUTS.map(([value, text]) => <option value={value} key={value}>{text}</option>)}</select></label>
                  <button type="button" className="editor-remove-action" aria-label={`Remove ${macro.label || 'shortcut'}`} onClick={() => setProfileDraft((draft) => ({ ...draft, macros: draft.macros.filter((_, i) => i !== index) }))}><Trash2 className="h-4 w-4" /></button>
                </div>)}
                {profileDraft.macros.length === 0 && <p className="profile-editor-empty">Add at least one shortcut card to save this profile.</p>}
              </div>
              <div className="profile-editor-footer">
                {profileDraft.id && !Object.prototype.hasOwnProperty.call(PROFILES, profileDraft.id) && <button type="button" className="editor-delete-profile" onClick={() => deleteProfile(profileDraft.id)}><Trash2 className="h-3.5 w-3.5" /> Delete profile</button>}
                <button type="button" className="editor-cancel" onClick={() => setProfileEditorOpen(false)}>Cancel</button>
                <button type="submit" className="editor-save" disabled={!profileDraft.label.trim() || profileDraft.macros.length === 0}><Save className="h-3.5 w-3.5" /> Save profile</button>
              </div>
            </form>
          </section>
        </div>}

        <div className={`deck-layout grid flex-1 gap-4 ${layoutClass}`}>
          <section className="flex min-w-0 flex-col gap-4" aria-label="Media and audio controls">
            <article className="surface-card player-card">
              {track.artwork && <div className="player-art-backdrop" style={{ backgroundImage: `url("${track.artwork}")` }} />}
              <div className="player-heading relative z-10 flex items-center justify-between">
                <div className="eyebrow"><span className={`status-led ${isPlaying ? 'is-online' : ''}`} /> MUSIC</div>
                <span className="spotify-tag"><span className="spotify-mark">◖</span> SPOTIFY</span>
              </div>
              <div className="player-main relative z-10 mt-5 flex min-w-0 items-center gap-4">
                {track.artwork ? (
                  <img src={track.artwork} alt={`${track.title} album artwork`} onError={() => setTrack((current) => ({ ...current, artwork: '' }))} className="album-art" />
                ) : (
                  <div className="album-art album-art-placeholder"><Wifi className="h-7 w-7 rotate-45" /></div>
                )}
                <div className="min-w-0">
                  <h2 className="track-title">{track.title}</h2>
                  <p className="mt-1 truncate text-sm text-zinc-400">{track.artist}</p>
                </div>
              </div>
              <div className="player-footer relative z-10 mt-5 flex items-center justify-between border-t border-white/10 pt-4">
                <span className="text-[10px] text-zinc-500">{isPlaying === null ? 'Playback state unavailable' : isPlaying ? 'Playing on your PC' : 'Playback paused'}</span>
                <label className="player-volume" title={spotifyVolume ? `Spotify volume ${spotifyVolume.volume}%` : 'Open Spotify to enable its volume control'}>
                  <Volume2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <input
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
                  />
                  <span className="player-volume-value">{spotifyVolume ? `${spotifyVolume.volume}%` : '—'}</span>
                </label>
                <div className="flex items-center gap-2">
                  <button type="button" aria-label="Previous Spotify track" title="Previous track" onClick={() => handleMedia('prev', 'Spotify · Previous track')} className="transport-button">
                    <SkipBack className="h-4 w-4" />
                  </button>
                  <button type="button" aria-label={isPlaying ? 'Pause Spotify' : 'Play Spotify'} title={isPlaying ? 'Pause' : 'Play'} onClick={() => handleMedia('play_pause', isPlaying ? 'Spotify · Pause' : 'Spotify · Play')} className="transport-primary">
                    {isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
                  </button>
                  <button type="button" aria-label="Next Spotify track" title="Next track" onClick={() => handleMedia('next', 'Spotify · Next track')} className="transport-button">
                    <SkipForward className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="player-timeline relative z-10" aria-label="Spotify playback position">
                <div className="player-timeline-times">
                  <span>{formatMediaTime(currentPosition)}</span>
                  <span>{mediaTimeline.duration ? `-${formatMediaTime(mediaTimeline.duration - currentPosition)}` : '--:--'}</span>
                </div>
                <input
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
                />
              </div>
            </article>

            <article className="surface-card soundboard-pane p-4 sm:p-5" aria-label="Soundboard">
              <div className="section-heading mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="section-icon icon-cyan"><Volume2 className="h-4 w-4" /></div>
                  <div><h2 className="section-title">Soundboard</h2></div>
                </div>
                <button type="button" className="launcher-edit-toggle" onClick={() => { setSoundboardEditing((editing) => !editing); setEditingSoundId(null); }} aria-pressed={soundboardEditing}>
                  {soundboardEditing ? <Check className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                  <span>{soundboardEditing ? 'Done' : 'Edit'}</span>
                </button>
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
                      <button type="button" className="soundboard-restore-button" onClick={() => restoreBuiltinSound(sound.id)} title={`Add ${sound.name} back to the soundboard`}>
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Add {sound.name}</span>
                      </button>
                    ) : !sound.builtin && editingSoundId === sound.id ? (
                      <div className="soundboard-edit-row">
                        <input autoFocus className="soundboard-edit-input" type="text" value={editingSoundName} maxLength={40} onChange={(event) => setEditingSoundName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveCustomSoundName(sound); if (event.key === 'Escape') setEditingSoundId(null); }} aria-label={`Edit ${sound.name} name`} />
                        <button type="button" className="soundboard-edit-action" onClick={() => saveCustomSoundName(sound)} disabled={!online || !editingSoundName.trim()} aria-label="Save sound name"><Check className="h-3.5 w-3.5" /></button>
                        <button type="button" className="soundboard-edit-action" onClick={() => setEditingSoundId(null)} aria-label="Cancel sound name edit"><X className="h-3.5 w-3.5" /></button>
                      </div>
                    ) : (
                      <>
                        <button type="button" className="soundboard-button" onClick={() => playSound({ ...sound, label: sound.name })} disabled={!online} title={`Play ${sound.name} on your PC`}>
                          <Play className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>{sound.name}</span>
                        </button>
                        {soundboardEditing && <div className="soundboard-actions">
                          {sound.builtin ? (
                            <button type="button" className="soundboard-edit-action soundboard-delete-action" onClick={() => removeBuiltinSound(sound.id)} aria-label={`Remove ${sound.name} from soundboard`} title={`Remove ${sound.name} from soundboard`}><Trash2 className="h-3 w-3" /></button>
                          ) : <>
                            <button type="button" className="soundboard-edit-action" onClick={() => { setEditingSoundId(sound.id); setEditingSoundName(sound.name); }} aria-label={`Edit ${sound.name}`} title={`Edit ${sound.name}`}><Pencil className="h-3 w-3" /></button>
                            <button type="button" className="soundboard-edit-action soundboard-delete-action" onClick={() => removeCustomSound(sound)} disabled={!online} aria-label={`Remove ${sound.name}`} title={`Remove ${sound.name}`}><Trash2 className="h-3 w-3" /></button>
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

            <article ref={volumeMixerRef} className="surface-card volume-mixer-pane p-4 sm:p-5">
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
                <TouchVolumePill label="Master output" target="master" value={volumes.master} onChange={handleVolume} colorClass="bg-[#b4ff00]/20" icon={Volume2} />
              </div>
            </article>
          </section>

          <aside ref={clockPaneRef} className="time-pane surface-card" aria-label="Local date and time">
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
            </div>
          </aside>

          <section className="shortcut-discord-stack flex min-w-0 flex-col gap-4" aria-label="Shortcuts, apps, and Discord controls">
            <div className="surface-card shortcut-panel flex min-w-0 flex-col p-4 sm:p-5 lg:p-6" aria-label={`${profile.label} shortcuts`}>
              <div className="section-heading mb-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="section-icon icon-cyan"><Shapes className="h-4 w-4" /></div>
                  <div className="min-w-0"><h2 className="section-title">Shortcuts</h2><p className="section-subtitle truncate">{profile.label} workspace</p></div>
                </div>
                <button type="button" className="shortcut-edit-button" onClick={() => openProfileEditor(profile)} aria-label={`Edit ${profile.label} app shortcuts`} title="Edit app shortcuts"><Pencil className="h-3.5 w-3.5" /></button>
              </div>
              <div className="macro-grid grid flex-1 content-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {profile.macros.slice(0, 3).map((macro, index) => {
                  const Icon = iconPack === 'phosphor' ? PHOSPHOR_MACRO_ICONS[macro.id] || macro.icon : macro.icon;
                  return (
                    <button
                      type="button"
                      key={macro.id}
                      onClick={(event) => {
                        fireMacro(macro);
                        // Clear the browser's pressed/focus styling after a pointer activation.
                        if (event.detail > 0) event.currentTarget.blur();
                      }}
                      className="macro-card group"
                      style={{ '--macro-delay': `${index * 35}ms` }}
                    >
                      <div className={`macro-icon ${macro.bg}`}><Icon className={`h-[18px] w-[18px] ${macro.color}`} {...(iconPack === 'phosphor' ? { weight: 'regular' } : {})} /></div>
                      <div className="min-w-0 flex-1 pr-4">
                        <div className="truncate text-sm font-semibold text-zinc-100">{macro.label}</div>
                        <div className="mt-1 truncate font-mono text-[11px] text-zinc-400">{macro.sub}</div>
                      </div>
                      <ChevronRight className="macro-arrow h-4 w-4" />
                    </button>
                  );
                })}
              </div>
            </div>

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
                  <button type="button" key={id} className="app-launcher-button" onClick={() => launcherEditing ? saveLauncherApps(launcherApps.filter((appId) => appId !== id)) : launchApp({ id, label })} disabled={!launcherEditing && !online} aria-label={launcherEditing ? `Remove ${label}` : `Open ${label} on your PC`} title={launcherEditing ? `Remove ${label}` : `Open ${label}`}>
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span>{label}</span>
                    {launcherEditing && <X className="launcher-remove-icon h-3 w-3" aria-hidden="true" />}
                  </button>
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
              <button type="button" className="launcher-edit-toggle" onClick={() => setLauncherEditing((editing) => !editing)} aria-pressed={launcherEditing}>
                {launcherEditing ? <Check className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                <span>{launcherEditing ? 'Done' : 'Edit'}</span>
              </button>
            </article>

            <article className="surface-card discord-panel p-4 sm:p-5 lg:p-6" aria-label="Discord voice controls">
              <div className="section-heading mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="section-icon icon-violet"><Headphones className="h-4 w-4" /></div>
                  <div><h2 className="section-title">Discord</h2><p className="section-subtitle">Desktop voice controls</p></div>
                </div>
                <span className={`tiny-label ${discordAvailable ? 'discord-ready' : ''}`}>{discordAvailable ? 'READY' : 'OFFLINE'}</span>
              </div>
              <div className="discord-controls grid grid-cols-2 gap-2">
                <button type="button" className={`discord-control-button ${discordMicMuted || discordDeafened ? 'discord-control-active' : ''}`} aria-pressed={discordMicMuted || discordDeafened || undefined} disabled={!online || !discordAvailable || Boolean(discordSelfVoice?.server_muted)} onClick={() => handleDiscord('mute', 'Discord · Toggle microphone mute')}>
                  <Mic className="h-4 w-4" /><span>{discordSelfVoice?.server_muted ? 'Server muted' : discordMicMuted === null ? 'Toggle mute' : discordMicMuted ? 'Unmute mic' : 'Mute mic'}</span>
                </button>
                <button type="button" className={`discord-control-button ${discordDeafened ? 'discord-control-active' : ''}`} aria-pressed={discordDeafened ?? undefined} disabled={!online || !discordAvailable || Boolean(discordSelfVoice?.server_deafened)} onClick={() => handleDiscord('deafen', 'Discord · Toggle deafen')}>
                  <Headphones className="h-4 w-4" /><span>{discordSelfVoice?.server_deafened ? 'Server deafened' : discordDeafened === null ? 'Toggle deafen' : discordDeafened ? 'Undeafen' : 'Deafen'}</span>
                </button>
              </div>
              <button
                type="button"
                className="discord-control-button mt-2 w-full"
                disabled={!online || !discordVoice.configured || !discordVoice.channel}
                onClick={() => handleDiscord('disconnect', 'Disconnecting from Discord voice')}
              >
                <PhoneOff className="h-4 w-4" />
                <span>{discordVoice.channel ? `Disconnect from ${discordVoice.channel}` : 'Disconnect from voice'}</span>
              </button>
              <div className="discord-voice-status" aria-live="polite">
                {!discordVoice.configured ? (
                  <p className="discord-empty-state">Set up the optional Discord bot to enable voice channel controls.</p>
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
            </article>
          </section>
        </div>
      </div>
    </main>
  );
}
