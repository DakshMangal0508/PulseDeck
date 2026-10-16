import React, { useState, useEffect, useRef } from 'react';
import { apiRequest, getApiToken, saveApiToken } from './api.js';
import PROFILES from './profiles.js';
import TouchVolumePill from './VolumeControl.jsx';
import {
  Activity, CalendarDays, Check, ChevronDown, ChevronRight, Clock3, Moon as MoonIcon,
  Headphones, Mic, Pause, Play, RefreshCw, Shapes, SkipBack, SkipForward, Smartphone,
  Sun as SunIcon, Users, Volume2, Wifi,
} from 'lucide-react';
import {
  ArrowClockwise, ArrowCounterClockwise, Check as PhosphorCheck, CircleHalf,
  ClipboardText, Copy as PhosphorCopy, Crop as PhosphorCrop, Eye as PhosphorEye,
  GameController, GitBranch as PhosphorGitBranch, Lightning, LockKey, SlidersHorizontal,
  Sparkle, SpeakerHigh, Stack, Sun as PhosphorSun, TerminalWindow, VideoCamera,
} from '@phosphor-icons/react';

const VIEWPORTS = ['landscape', 'portrait', 'fullscreen'];
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
  const [activeProfile, setActiveProfile] = useState('photo');
  const [autoSwitch, setAutoSwitch] = useState(true);
  const [viewportMode, setViewportMode] = useState('fullscreen');
  const [showConnection, setShowConnection] = useState(false);
  const [theme, setTheme] = useState(() => {
    try { return window.localStorage.getItem('pulsedeck-theme') === 'light' ? 'light' : 'dark'; }
    catch { return 'dark'; }
  });
  const [iconPack, setIconPack] = useState(() => {
    try { return window.localStorage.getItem('pulsedeck-icon-pack') === 'phosphor' ? 'phosphor' : 'lucide'; }
    catch { return 'lucide'; }
  });
  const [clockNow, setClockNow] = useState(() => new Date());
  const [isPlaying, setIsPlaying] = useState(null);
  const [track, setTrack] = useState({ title: 'Waiting for Spotify', artist: 'Open Spotify on your PC', artwork: '' });
  const [mediaTimeline, setMediaTimeline] = useState({ position: 0, duration: 0, seekMin: 0, seekMax: 0, seekable: false, updatedAt: Date.now() });
  const [activeDesktopApp, setActiveDesktopApp] = useState('Desktop');
  const [online, setOnline] = useState(false);
  const [discordAvailable, setDiscordAvailable] = useState(false);
  const [discordVoice, setDiscordVoice] = useState({ configured: false, connection: 'disabled', guild: null, channel: null, members: [] });
  const [toast, setToast] = useState('Connecting to PC…');
  const [volumes, setVolumes] = useState({ apps: [], master: null });
  const [apiToken, setApiToken] = useState(getApiToken);
  const volumeTimers = useRef({});
  const pendingVolumes = useRef({});
  const volumeRevisions = useRef({});
  const pendingPlayback = useRef(null);
  const pendingSeek = useRef(null);
  const seekTimer = useRef(null);

  const profile = PROFILES[activeProfile];
  const isPortrait = viewportMode === 'portrait';
  const isCompact = isPortrait;
  const layoutClass = isCompact
    ? 'grid-cols-1'
    : 'lg:grid-cols-[minmax(280px,0.9fr)_minmax(175px,0.55fr)_minmax(0,1.4fr)]';
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
  const discordMicMuted = discordSelfVoice ? discordSelfVoice.self_muted || discordSelfVoice.server_muted : null;
  const discordDeafened = discordSelfVoice ? discordSelfVoice.self_deafened || discordSelfVoice.server_deafened : null;

  useEffect(() => {
    let active = true;
    let inFlight = false;
    const fetchStatus = async () => {
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
          setActiveDesktopApp(data.active_app);
          if (autoSwitch) {
            const matched = Object.values(PROFILES).find((item) => item.matchApps.includes(data.active_app.toLowerCase()));
            if (matched) setActiveProfile(matched.id);
          }
        }
      } catch (error) {
        if (!active) return;
        setOnline(false);
        setDiscordAvailable(false);
        setDiscordVoice((current) => ({ ...current, connection: 'host-offline', guild: null, channel: null, members: [] }));
        const tokenRejected = /401|invalid or missing api token|token rejected/i.test(error?.message || '');
        setToast(!apiToken
          ? 'Add your host token to connect'
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
  }, [autoSwitch, apiToken]);

  useEffect(() => () => {
    Object.values(volumeTimers.current).forEach(clearTimeout);
    clearTimeout(seekTimer.current);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setClockNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { window.localStorage.setItem('pulsedeck-theme', theme); } catch { /* Keep the in-memory theme. */ }
  }, [theme]);

  useEffect(() => {
    try { window.localStorage.setItem('pulsedeck-icon-pack', iconPack); } catch { /* Keep the in-memory icon pack. */ }
  }, [iconPack]);

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
    triggerBackend('/api/discord', { action });
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

  const frameWidth = viewportMode === 'landscape' ? 'max-w-[1120px]' : viewportMode === 'portrait' ? 'max-w-[480px]' : 'max-w-[1440px]';

  return (
    <main data-theme={theme} className={`deck-shell min-h-screen overflow-hidden px-3 py-4 text-zinc-100 sm:px-6 sm:py-6 lg:px-10 lg:py-8 ${viewportMode === 'landscape' ? 'landscape-preview' : ''}`}>
      <div className="deck-orb deck-orb-one" />
      <div className="deck-orb deck-orb-two" />
      <div className={`relative mx-auto flex min-h-[calc(100vh-2rem)] w-full flex-col ${frameWidth}`}>
        <header className="mb-5 flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.07] pb-5 sm:mb-7 sm:pb-6">
          <div className="flex items-center gap-3">
            <div className="brand-mark"><Activity className="h-5 w-5" /></div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold tracking-[0.2em] text-white">PULSE<span className="text-cyan-300">DECK</span></h1>
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
            <label className="icon-pack-control" title="Choose the shortcut icon pack">
              <Shapes className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="sr-only">Shortcut icon pack</span>
              <select aria-label="Shortcut icon pack" value={iconPack} onChange={(event) => setIconPack(event.target.value)}>
                <option value="lucide">Lucide</option>
                <option value="phosphor">Phosphor</option>
              </select>
            </label>
            <button
              type="button"
              className="icon-button theme-toggle"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
            </button>
            <div className="hidden items-center gap-1 rounded-xl border border-white/[0.08] bg-white/[0.025] p-1 lg:flex">
              <Smartphone className="mx-1 h-3.5 w-3.5 text-zinc-500" />
              {VIEWPORTS.map((mode) => (
                <button
                  type="button"
                  key={mode}
                  onClick={() => setViewportMode(mode)}
                  className={`view-mode-button rounded-lg px-2.5 py-1.5 text-[10px] capitalize transition ${viewportMode === mode ? 'view-mode-selected' : ''}`}
                >
                  {mode}
                </button>
              ))}
            </div>
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
          <div className="flex min-w-[190px] flex-1 items-center gap-2 sm:max-w-[380px]">
            <label htmlFor="host-api-token" className="sr-only">Host API token</label>
            <input
              id="host-api-token"
              type="password"
              autoComplete="off"
              aria-label="Host API token"
              value={apiToken}
              onChange={(event) => {
                const value = event.target.value;
                setApiToken(value);
                saveApiToken(value);
              }}
              placeholder="Paste host token"
              className="token-input min-w-0 flex-1"
            />
            <span className="hidden whitespace-nowrap text-[10px] text-zinc-600 sm:inline">Saved in browser</span>
          </div>
        </section>}

        <nav className="mb-5 flex items-center gap-1.5 overflow-x-auto pb-1 sm:mb-7" aria-label="Control profiles">
          <span className="mr-2 hidden text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600 sm:inline">Workspace</span>
          {Object.values(PROFILES).map((item) => {
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
          <span className="ml-auto hidden items-center gap-1.5 whitespace-nowrap text-[10px] text-zinc-600 md:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-300/70" /> Focus: {activeDesktopApp}
          </span>
        </nav>

        <div className={`deck-layout grid flex-1 gap-4 lg:gap-5 ${layoutClass}`}>
          <section className="flex min-w-0 flex-col gap-4 lg:gap-5" aria-label="Media and audio controls">
            <article className="surface-card player-card">
              {track.artwork && <div className="player-art-backdrop" style={{ backgroundImage: `url("${track.artwork}")` }} />}
              <div className="player-heading relative z-10 flex items-center justify-between">
                <div className="eyebrow"><span className={`status-led ${isPlaying ? 'is-online' : ''}`} /> NOW PLAYING</div>
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

            <article className="surface-card p-4 sm:p-5">
              <div className="section-heading mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="section-icon icon-cyan"><Volume2 className="h-4 w-4" /></div>
                  <div><h2 className="section-title">Audio mix</h2><p className="section-subtitle">Adjust each Windows audio level</p></div>
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
                <TouchVolumePill label="Master output" target="master" value={volumes.master} onChange={handleVolume} colorClass="bg-cyan-300/20" icon={Volume2} />
              </div>
            </article>
          </section>

          <aside className="time-pane surface-card" aria-label="Local date and time">
            <div className="time-pane-label"><Clock3 className="h-3.5 w-3.5" /> LOCAL TIME</div>
            <div className="time-center">
              <div className="clock-orbit" style={{ '--clock-sweep': `${clockNow.getSeconds() * 6}deg` }}>
                <div className="time-readout" aria-live="off">
                  <span>{clockTime}</span>
                  <span className="time-seconds">:{clockSeconds}</span>
                </div>
              </div>
              <div className="time-period">24-HOUR FORMAT</div>
            </div>
            <div className="time-date-block">
              <div className="time-rule" />
              <div className="time-date-icon"><CalendarDays className="h-4 w-4" /></div>
              <div className="time-weekday">{clockDate.split(',')[0]}</div>
              <div className="time-date">{clockDate.includes(',') ? clockDate.slice(clockDate.indexOf(',') + 2) : clockDate}</div>
              <div className="time-footer">FROM THIS DEVICE</div>
            </div>
          </aside>

          <section className="shortcut-discord-stack flex min-w-0 flex-col gap-3" aria-label="Shortcuts and Discord controls">
            <div className="surface-card shortcut-panel flex min-w-0 flex-col p-4 sm:p-5 lg:p-6" aria-label={`${profile.label} shortcuts`}>
              <div className={`macro-grid grid flex-1 content-start gap-3 ${isPortrait ? 'grid-cols-2' : 'sm:grid-cols-2 xl:grid-cols-3'}`}>
                {profile.macros.map((macro, index) => {
                  const Icon = iconPack === 'phosphor' ? PHOSPHOR_MACRO_ICONS[macro.id] || macro.icon : macro.icon;
                  return (
                    <button
                      type="button"
                      key={macro.id}
                      onClick={() => fireMacro(macro)}
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
              <div className="mt-4 flex items-center justify-between border-t border-white/[0.07] pt-4 text-[10px] text-zinc-600">
                <span>{profile.macros.length} shortcuts available</span>
                <span className="flex items-center gap-1.5"><Check className="h-3 w-3 text-emerald-400" />Local controls</span>
              </div>
            </div>

            <article className="surface-card discord-panel p-4 sm:p-5 lg:p-6" aria-label="Discord voice controls">
              <div className="section-heading mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="section-icon icon-violet"><Headphones className="h-4 w-4" /></div>
                  <div><h2 className="section-title">Discord</h2><p className="section-subtitle">Desktop voice controls</p></div>
                </div>
                <span className={`tiny-label ${discordAvailable ? 'discord-ready' : ''}`}>{discordAvailable ? 'READY' : 'OFFLINE'}</span>
              </div>
              <div className="discord-controls grid grid-cols-2 gap-2">
                <button type="button" className={`discord-control-button ${discordMicMuted ? 'discord-control-active' : ''}`} aria-pressed={discordMicMuted ?? undefined} disabled={!online || !discordAvailable || Boolean(discordSelfVoice?.server_muted)} onClick={() => handleDiscord('mute', 'Discord · Toggle microphone mute')}>
                  <Mic className="h-4 w-4" /><span>{discordSelfVoice?.server_muted ? 'Server muted' : discordMicMuted === null ? 'Toggle mute' : discordMicMuted ? 'Unmute mic' : 'Mute mic'}</span><kbd>Ctrl+Shift+M</kbd>
                </button>
                <button type="button" className={`discord-control-button ${discordDeafened ? 'discord-control-active' : ''}`} aria-pressed={discordDeafened ?? undefined} disabled={!online || !discordAvailable || Boolean(discordSelfVoice?.server_deafened)} onClick={() => handleDiscord('deafen', 'Discord · Toggle deafen')}>
                  <Headphones className="h-4 w-4" /><span>{discordSelfVoice?.server_deafened ? 'Server deafened' : discordDeafened === null ? 'Toggle deafen' : discordDeafened ? 'Undeafen' : 'Deafen'}</span><kbd>Ctrl+Shift+D</kbd>
                </button>
              </div>
              <p className="discord-keybind-help">For background use, add these actions in Discord Settings → Keybinds.</p>
              <div className="discord-voice-status" aria-live="polite">
                {!discordVoice.configured ? (
                  <p className="discord-empty-state">Set up the optional Discord bot in README to see your voice channel and members.</p>
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
                          <span className="min-w-0 flex-1 truncate">{member.name}{member.is_self && <span className="ml-1.5 text-[8px] font-semibold uppercase tracking-wider text-cyan-300">You</span>}</span>
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
        <footer className="mt-6 flex flex-wrap items-center justify-between gap-2 px-1 text-[10px] text-zinc-700">
          <span>PulseDeck <span className="mx-1 text-zinc-800">/</span> Personal control surface</span>
          <span>Host status updates every few seconds</span>
        </footer>
      </div>
    </main>
  );
}
