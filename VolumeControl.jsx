import React from 'react';
import { Volume2, VolumeX } from 'lucide-react';

function TouchVolumePill({ label, target, value, onChange, colorClass, icon: Icon }) {
  return (
    <div
      className="volume-control group relative flex h-12 w-full select-none items-center overflow-hidden px-3.5 focus-within:ring-2 focus-within:ring-[#b4ff00]/60"
    >
      <div
        className={`pointer-events-none absolute inset-y-0 left-0 transition-all duration-100 ${colorClass}`}
        style={{ width: `${value ?? 0}%` }}
      />
      <div className="pointer-events-none relative z-10 flex w-full items-center justify-between">
        <div className="flex items-center gap-2.5">
          {value === 0 ? <VolumeX className="h-4 w-4 text-zinc-400" /> : <Icon className="h-4 w-4 text-white/90" />}
          <span className="text-[11px] font-semibold tracking-tight text-white/90">{label}</span>
        </div>
        <span className="font-mono text-[10px] font-semibold tabular-nums text-white/75">{value == null ? 'N/A' : `${value}%`}</span>
      </div>
      <input
        aria-label={`${label} volume`}
        aria-valuetext={value == null ? 'Unavailable' : `${value}%`}
        type="range"
        min="0"
        max="100"
        step="1"
        value={value ?? 0}
        disabled={value == null}
        onChange={(event) => onChange(target, Number(event.target.value))}
        className="volume-range absolute inset-0 z-20 h-full w-full cursor-ew-resize disabled:cursor-not-allowed"
      />
    </div>
  );
}

export default TouchVolumePill;
