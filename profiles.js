import { SkipForward, SkipBack, Volume2, Layers, Sliders, Gamepad2, Terminal, Sparkles, Crop, Sun, Contrast, Eye, Copy, Clipboard, Video, Zap, GitBranch, Lock, Check } from 'lucide-react';

const PROFILES = {
  gaming: {
    id: 'gaming',
    label: 'Gaming',
    app: 'Valorant.exe',
    matchApps: ['valorant.exe', 'fc26.exe', 'fc27.exe', 'b1-win64-shipping.exe'],
    icon: Gamepad2,
    accent: 'from-violet-500/20 via-fuchsia-500/10 to-transparent',
    macros: [
      { id: 'clip_60s', label: 'Save Clip', sub: 'Alt + F10', shortcut: 'alt+f10', icon: Video, color: 'text-rose-400', bg: 'bg-rose-500/10 border-rose-500/20' },
      { id: 'audio_duck', label: 'Duck Music', sub: 'Spotify 15%', shortcut: 'duck_spotify', icon: Volume2, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
      { id: 'nvidia_overlay', label: 'Stats HUD', sub: 'Alt + R', shortcut: 'alt+r', icon: Zap, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
      { id: 'screenshot', label: 'Capture', sub: 'Win+PrtSc', shortcut: 'windows+print screen', icon: Eye, color: 'text-sky-400', bg: 'bg-sky-500/10 border-sky-500/20' },
      { id: 'lock_pc', label: 'Lock PC', sub: 'Win + L', shortcut: 'windows+l', icon: Lock, color: 'text-zinc-300', bg: 'bg-white/5 border-white/10' },
    ]
  },
  photo: {
    id: 'photo',
    label: 'Lightroom',
    app: 'Lightroom.exe',
    matchApps: ['lightroom.exe', 'photoshop.exe'],
    icon: Sliders,
    accent: 'from-sky-500/20 via-cyan-500/10 to-transparent',
    macros: [
      { id: 'lr_radial', label: 'Radial Mask', sub: 'Shift + M', shortcut: 'shift+m', icon: Sun, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
      { id: 'lr_linear', label: 'Linear Mask', sub: 'M', shortcut: 'm', icon: Layers, color: 'text-sky-400', bg: 'bg-sky-500/10 border-sky-500/20' },
      { id: 'lr_crop', label: '4:5 Crop', sub: 'R', shortcut: 'r', icon: Crop, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
      { id: 'lr_bw', label: 'B&W Mix', sub: 'V', shortcut: 'v', icon: Contrast, color: 'text-zinc-200', bg: 'bg-white/10 border-white/20' },
      { id: 'lr_copy', label: 'Copy Grade', sub: 'Ctrl+Shift+C', shortcut: 'ctrl+shift+c', icon: Copy, color: 'text-violet-400', bg: 'bg-violet-500/10 border-violet-500/20' },
      { id: 'lr_paste', label: 'Paste Grade', sub: 'Ctrl+Shift+V', shortcut: 'ctrl+shift+v', icon: Clipboard, color: 'text-fuchsia-400', bg: 'bg-fuchsia-500/10 border-fuchsia-500/20' },
    ]
  },
  dev: {
    id: 'dev',
    label: 'Dev & Code',
    app: 'Code.exe',
    matchApps: ['code.exe', 'windowsterminal.exe', 'pycharm64.exe'],
    icon: Terminal,
    accent: 'from-emerald-500/20 via-teal-500/10 to-transparent',
    macros: [
      { id: 'dev_term', label: 'Terminal', sub: 'Ctrl + `', shortcut: 'ctrl+`', icon: Terminal, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
      { id: 'dev_undo', label: 'Undo', sub: 'Ctrl + Z', shortcut: 'ctrl+z', icon: SkipBack, color: 'text-zinc-300', bg: 'bg-white/5 border-white/10' },
      { id: 'dev_redo', label: 'Redo', sub: 'Ctrl+Shift+Z', shortcut: 'ctrl+shift+z', icon: SkipForward, color: 'text-zinc-300', bg: 'bg-white/5 border-white/10' },
      { id: 'dev_git', label: 'Source Ctrl', sub: 'Ctrl+Shift+G', shortcut: 'ctrl+shift+g', icon: GitBranch, color: 'text-sky-400', bg: 'bg-sky-500/10 border-sky-500/20' },
      { id: 'dev_cmd', label: 'Cmd Palette', sub: 'Ctrl+Shift+P', shortcut: 'ctrl+shift+p', icon: Sparkles, color: 'text-violet-400', bg: 'bg-violet-500/10 border-violet-500/20' },
      { id: 'dev_save', label: 'Save All', sub: 'Ctrl + S', shortcut: 'ctrl+s', icon: Check, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
    ]
  }
};

export default PROFILES;
