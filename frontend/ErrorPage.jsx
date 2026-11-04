import React from 'react';
import { AlertTriangle, ArrowLeft, Home, RefreshCw, ShieldAlert, WifiOff } from 'lucide-react';

const ERROR_STATES = {
  offline: {
    icon: WifiOff,
    title: 'PulseDeck host is offline',
    description: 'The page could not reach the PulseDeck backend. Check that the PC is awake and PulseDeck is running, then try again.',
    action: 'Try again',
  },
  unauthorized: {
    icon: ShieldAlert,
    title: 'Sign in again',
    description: 'This session is no longer valid. Sign in to PulseDeck and retry the action.',
    action: 'Open sign in',
  },
  forbidden: {
    icon: ShieldAlert,
    title: 'This action is not allowed',
    description: 'The current account or device does not have permission to do this. Sign in on the PulseDeck PC or check the connection settings.',
    action: 'Open PulseDeck',
  },
  expired: {
    icon: AlertTriangle,
    title: 'This link has expired',
    description: 'For your security, recovery and pairing links work once and expire after a short time. Request a fresh link or QR code and try again.',
    action: 'Open sign in',
  },
  invalid: {
    icon: AlertTriangle,
    title: 'The request could not be accepted',
    description: 'Check the information and try again. If this came from a link, make sure the complete link was opened.',
    action: 'Go back',
  },
  conflict: {
    icon: AlertTriangle,
    title: 'PulseDeck state changed',
    description: 'This action conflicts with the current account or device state. Refresh PulseDeck and try again.',
    action: 'Refresh',
  },
  limited: {
    icon: AlertTriangle,
    title: 'Please wait before trying again',
    description: 'PulseDeck temporarily limited requests to protect your account. Wait a moment, then retry.',
    action: 'Try again',
  },
  service: {
    icon: AlertTriangle,
    title: 'PulseDeck could not complete that action',
    description: 'The host or an external service returned an error. Check that the related app is running and configured, then retry.',
    action: 'Try again',
  },
  notFound: {
    icon: Home,
    title: 'This page does not exist',
    description: 'The address may be incorrect or the page may have moved.',
    action: 'Go to PulseDeck',
  },
  unexpected: {
    icon: AlertTriangle,
    title: 'PulseDeck hit an unexpected error',
    description: 'Reload the page to try again. If it keeps happening, note what you were doing and check the backend error log on the PC.',
    action: 'Reload PulseDeck',
  },
};

export function classifyDeckError(error) {
  if (error?.kind && ERROR_STATES[error.kind]) return error.kind;
  const status = Number(error?.status || error?.statusCode || 0);
  const message = String(error?.message || error || '').toLowerCase();
  if (/expired|already used|invalid.*link|pairing qr has expired/.test(message)) return 'expired';
  if (status === 401 || /sign in to control|token rejected|unauthorized/.test(message)) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 409) return 'conflict';
  if (status === 413) return 'invalid';
  if (status === 422 || status === 400) return 'invalid';
  if (status === 429) return 'limited';
  if (status >= 500) return 'service';
  if (error instanceof TypeError || /failed to fetch|network|offline|timed out|could not connect/.test(message)) return 'offline';
  return 'unexpected';
}

export default function ErrorPage({ kind, error, title, description, onRetry, homeHref = '/', signInHref = '/account', primaryHref, primaryLabel }) {
  const type = kind || classifyDeckError(error);
  const state = ERROR_STATES[type] || ERROR_STATES.unexpected;
  const Icon = state.icon;
  const isNotFound = type === 'notFound';
  const isAuth = type === 'unauthorized' || type === 'expired';
  const action = primaryHref
    ? { href: primaryHref, label: primaryLabel || state.action }
    : isNotFound || type === 'forbidden'
    ? { href: homeHref, label: title ? 'Go to PulseDeck' : state.action }
    : isAuth
      ? { href: signInHref, label: state.action }
      : { onClick: onRetry || (() => window.location.reload()), label: state.action };

  return (
    <main className="deck-shell error-page" data-theme="dark">
      <div className="deck-orb deck-orb-one" />
      <div className="deck-orb deck-orb-two" />
      <section className="error-card" role="alert">
        <div className="error-icon"><Icon aria-hidden="true" /></div>
        <p className="error-eyebrow">PULSEDECK · {type === 'offline' ? 'CONNECTION' : type === 'notFound' ? '404' : 'ERROR'}</p>
        <h1>{title || state.title}</h1>
        <p className="error-description">{description || state.description}</p>
        {error?.message && type === 'unexpected' && <details className="error-details"><summary>Technical details</summary><code>{error.message}</code></details>}
        <div className="error-actions">
          {action.href ? <a className="error-primary" href={action.href}>{action.label}</a> : <button className="error-primary" type="button" onClick={action.onClick}><RefreshCw aria-hidden="true" />{action.label}</button>}
          {!isNotFound && !isAuth && <a className="error-secondary" href={homeHref}><ArrowLeft aria-hidden="true" />Back to deck</a>}
        </div>
      </section>
    </main>
  );
}
