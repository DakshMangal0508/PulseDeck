import React, { Component } from 'react';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import PulseDeck from './App.jsx';
import AccountPage from './AccountPage.jsx';
import ProfilePage from './ProfilePage.jsx';
import ErrorPage from './ErrorPage.jsx';
import { API_BASE, saveAccountSession } from './api.js';
import './style.css';

function AppEntry() {
  const pairingCode = new URLSearchParams(window.location.hash.slice(1)).get('pair');
  const accountHash = new URLSearchParams(window.location.hash.slice(1));
  const accountPath = window.location.pathname.replace(/\/+$/, '') === '/account';
  const accountView = new URLSearchParams(window.location.search).get('view');
  const recoveryLink = accountHash.has('recover') || accountHash.has('verify-email') || new URLSearchParams(window.location.search).get('recovery') === 'setup';
  const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/';
  const dashboardPath = normalizedPath === '/' || normalizedPath === '/index.html';
  const [pairStatus, setPairStatus] = useState(() => pairingCode ? 'pairing' : 'ready');
  const [pairError, setPairError] = useState('');
  const pairingRequest = useRef(null);

  useEffect(() => {
    if (!pairingCode) return undefined;
    window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
    let active = true;
    if (!pairingRequest.current) {
      pairingRequest.current = fetch(`${API_BASE}/api/auth/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: pairingCode }),
      }).then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || 'Phone pairing failed');
        return data;
      });
    }
    pairingRequest.current
      .then((data) => {
        saveAccountSession(data.token, data.username, true);
        if (active) setPairStatus('ready');
      })
      .catch((error) => {
        if (active) {
          setPairError(`${error.message}. Refresh the QR on the PC and scan again.`);
          setPairStatus('error');
        }
      });
    return () => { active = false; };
  }, []);

  if (pairStatus === 'pairing' || pairStatus === 'error') {
    if (pairStatus === 'error') {
      const kind = /expired|already used/i.test(pairError) ? 'expired' : /fetch|network|connect/i.test(pairError) ? 'offline' : 'service';
      return <ErrorPage kind={kind} error={new Error(pairError)} title="Could not pair this phone" description={pairError} primaryHref="/account" primaryLabel="Open sign in" />;
    }
    return (
      <main className="deck-shell flex min-h-screen items-center justify-center px-5 text-zinc-100" data-theme="dark">
        <section className="relative z-10 w-full max-w-sm rounded-3xl border border-white/[0.08] bg-[#0a0b10]/90 p-7 text-center shadow-2xl">
          <h1 className="text-sm font-bold tracking-[0.2em] text-white">PULSE<span className="brand-accent" style={{ color: '#b4ff00' }}>DECK</span></h1>
          <p className="mt-4 text-sm text-zinc-300">Signing you in…</p>
        </section>
      </main>
    );
  }

  if (accountView === 'profile' && !recoveryLink) return <ProfilePage />;
  if (accountPath || accountView === 'signin' || recoveryLink) return <AccountPage />;
  if (dashboardPath) return <PulseDeck />;
  return <ErrorPage kind="notFound" />;
}

class AppErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <ErrorPage kind="unexpected" error={this.state.error} title="PulseDeck couldn’t render" description="A browser error stopped this screen from loading. Reload PulseDeck to try again." />;
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <AppEntry />
    </AppErrorBoundary>
  </React.StrictMode>,
);
