import React, { useState } from 'react';
import { LoaderCircle, Wifi } from 'lucide-react';
import { normalizeApiBase, setApiBase } from './api.js';

export default function NativeConnect({ onConnected }) {
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const connect = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const base = normalizeApiBase(address);
      const response = await fetch(`${base}/api/auth/status`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`PulseDeck responded with ${response.status}.`);
      setApiBase(base);
      onConnected();
    } catch (error) {
      setMessage(error instanceof TypeError
        ? 'Could not reach that PC. Check the address and make sure your phone and PC are on the same Wi-Fi.'
        : error.message || 'Could not connect to that PC.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main data-theme="dark" className="deck-shell flex min-h-screen items-center justify-center px-5 py-8 text-zinc-100">
      <section className="relative z-10 w-full max-w-md rounded-3xl border border-white/[0.08] bg-[#0a0b10]/90 p-7 shadow-2xl sm:p-9">
        <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-2xl border border-[#b4ff00]/20 bg-[#b4ff00]/[0.07] text-[#b4ff00]"><Wifi className="h-5 w-5" /></div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#b4ff00]">Connect your PC</p>
        <h1 className="mt-2 text-xl font-semibold text-white">Where is PulseDeck running?</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-400">Open PulseDeck on your Windows PC, sign in, and copy one of the local addresses from its Connection panel. Keep both devices on the same Wi-Fi.</p>
        <form className="mt-6 space-y-3" onSubmit={connect}>
          <label className="block text-xs font-medium text-zinc-300" htmlFor="backend-address">PC address</label>
          <input
            id="backend-address"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            required
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="http://192.168.1.25:8000"
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-[#b4ff00]/50"
          />
          {message && <p role="alert" className="text-xs leading-5 text-rose-300">{message}</p>}
          <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#b4ff00] px-4 py-3 text-sm font-semibold text-[#11130a] transition hover:bg-[#c8ff41] disabled:cursor-wait disabled:opacity-60">
            {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {busy ? 'Connecting…' : 'Connect to PC'}
          </button>
        </form>
        <p className="mt-5 text-[11px] leading-5 text-zinc-500">Your PC address is saved on this phone. You can change it later from the Connection panel. Local connections use HTTP, so only connect over a trusted Wi-Fi network.</p>
      </section>
    </main>
  );
}
