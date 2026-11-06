import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Activity, Check, KeyRound, LoaderCircle, Smartphone, X } from 'lucide-react';
import { apiRequest, authRequest, clearAccountSession, getApiToken, saveAccountSession } from './api.js';
import SpringButton from './SpringButton.jsx';

const accountItemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 340, damping: 28 } },
};

export default function AccountPage() {
  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  const emailVerificationToken = hashParams.get('verify-email');
  const initialRecoveryToken = hashParams.get('recover');
  const recoverySetupRequested = new URLSearchParams(window.location.search).get('recovery') === 'setup';
  const [accountConfigured, setAccountConfigured] = useState(null);
  const [canCreateAccount, setCanCreateAccount] = useState(false);
  const [canResetPassword, setCanResetPassword] = useState(false);
  const [emailRecoveryConfigured, setEmailRecoveryConfigured] = useState(false);
  const [recoveryEmailVerified, setRecoveryEmailVerified] = useState(false);
  const [recoveryEmailMasked, setRecoveryEmailMasked] = useState('');
  const [flow, setFlow] = useState(initialRecoveryToken ? 'email-reset' : recoverySetupRequested ? 'setup-email' : 'signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [email, setEmail] = useState('');
  const [recoveryIdentifier, setRecoveryIdentifier] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryRequestSent, setRecoveryRequestSent] = useState(false);
  const [emailVerificationPending, setEmailVerificationPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [hostStatus, setHostStatus] = useState('searching');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (emailVerificationToken) {
      window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
      authRequest('/api/auth/recovery/verify-email', { token: emailVerificationToken })
        .then(() => {
          setMessage('Recovery email verified. Account recovery is ready.');
          setRecoveryEmailVerified(true);
          if (getApiToken()) {
            apiRequest('/api/status').then(() => {
              setLeaving(true);
              window.setTimeout(() => window.location.replace('/'), 360);
            }).catch(() => {});
          }
        })
        .catch((error) => setMessage(error.message || 'Could not verify the recovery email.'));
    }

    let active = true;
    const existingToken = getApiToken();
    let checkedSession = !existingToken;
    const checkHost = async () => {
      try {
        const status = await authRequest('/api/auth/status');
        if (!active) return;
        setHostStatus('connected');
        setAccountConfigured(Boolean(status.account_configured));
        setCanCreateAccount(Boolean(status.can_create_account));
        setCanResetPassword(Boolean(status.can_reset_password));
        setEmailRecoveryConfigured(Boolean(status.email_recovery_configured));
        setRecoveryEmailVerified(Boolean(status.recovery_email_verified));
        if (!checkedSession) {
          checkedSession = true;
          if (existingToken) {
            const sessionValid = await apiRequest('/api/status').then(() => true).catch(() => false);
            if (!active) return;
            if (sessionValid && recoverySetupRequested) {
              try {
                const recoveryStatus = await apiRequest('/api/auth/recovery/status');
                if (!active) return;
                setRecoveryEmailVerified(Boolean(recoveryStatus.email_verified));
                setRecoveryEmailMasked(recoveryStatus.email_masked || '');
              } catch (error) {
                if (!active) return;
                setMessage(`Could not load recovery settings: ${error.message}. The sign-in is still active; restart PulseDeck and try again.`);
              }
            } else if (sessionValid) {
              if (!initialRecoveryToken && !emailVerificationToken) window.location.replace('/');
            } else {
              clearAccountSession();
              if (recoverySetupRequested) setMessage('Your PulseDeck session has expired. Sign in again, then open Recovery email from Connection.');
            }
          }
        }
      } catch (error) {
        if (!active) return;
        setHostStatus('offline');
        if (!checkedSession) setMessage(error.message || 'Searching for PulseDeck host…');
      }
    };
    checkHost();
    const timer = window.setInterval(checkHost, 4000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const submitAccount = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      if ((flow === 'local-reset' || flow === 'email-reset' || creatingAccount) && password !== confirmPassword) throw new Error('The passwords do not match.');
      if (flow === 'request-reset') {
        await authRequest('/api/auth/recovery/request', { identifier: recoveryIdentifier });
        setRecoveryRequestSent(true);
      } else if (flow === 'setup-email') {
        await apiRequest('/api/auth/recovery/email', { method: 'POST', body: { email: recoveryEmail } });
        setEmailVerificationPending(true);
      } else {
        const endpoint = flow === 'email-reset' ? '/api/auth/recovery/complete' : flow === 'local-reset' ? '/api/auth/reset' : accountConfigured ? '/api/auth/login' : '/api/auth/register';
        const body = flow === 'email-reset'
          ? { token: initialRecoveryToken, password }
          : { username, password, ...(creatingAccount && email ? { email } : {}) };
        const data = await authRequest(endpoint, body);
        if (creatingAccount && data.email_verification_required) {
          saveAccountSession(data.token, data.username, true);
          setEmailVerificationPending(true);
        } else {
          saveAccountSession(data.token, data.username, true);
          setLeaving(true);
          window.setTimeout(() => window.location.replace('/'), 360);
        }
      }
    } catch (error) {
      setMessage(error.message || 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };

  const creatingAccount = accountConfigured === false;
  const canSubmit = accountConfigured === true || (creatingAccount && canCreateAccount);

  return (
    <main className="deck-shell flex min-h-screen flex-col items-center justify-center px-4 py-8 text-zinc-100 sm:py-12" data-theme="dark">
      <div className="deck-orb deck-orb-one" />
      <div className="deck-orb deck-orb-two" />
      <motion.section className="account-card relative z-10 mx-auto w-full max-w-md rounded-3xl border border-white/[0.08] bg-[#0a0b10]/90 p-6 shadow-2xl sm:p-8"
        initial={{ opacity: 0, y: 24, scale: 0.975, filter: 'blur(8px)' }}
        animate={leaving ? { opacity: 0, y: -18, scale: 0.985, filter: 'blur(3px)' } : { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
        transition={{ type: 'spring', stiffness: 240, damping: 24, mass: 0.9 }}>
        <motion.div className="mb-7 flex items-center gap-3" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14, duration: 0.36 }}>
          <div className="brand-mark"><Activity className="h-5 w-5" /></div>
          <div>
            <div className="account-brand-line">
              <h1 className="text-sm font-bold tracking-[0.2em] text-white">PULSE<span className="brand-accent" style={{ color: '#ff6033' }}>DECK</span></h1>
              <span className="account-secure-tag"><KeyRound /> SECURE ACCESS</span>
            </div>
            <p className="account-subtitle mt-1 text-[11px]">{flow === 'local-reset' || flow === 'email-reset' ? 'Reset your password' : flow === 'request-reset' ? 'Account recovery' : flow === 'setup-email' ? 'Recovery email' : creatingAccount ? 'Set up this PC' : 'Sign in to PulseDeck'}</p>
          </div>
        </motion.div>

        {busy && message === 'Pairing your phone…' ? (
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 text-sm text-zinc-300">Pairing your phone…</div>
        ) : (canSubmit || ['request-reset', 'email-reset', 'setup-email'].includes(flow)) ? (
          <>
          {emailVerificationPending ? (
            <motion.div className="account-reset-notice" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <Check />
              <p>Check your email{email ? ` (${email})` : ''} and open the PulseDeck verification link to finish setting up password recovery.</p>
            </motion.div>
          ) : recoveryRequestSent ? (
            <motion.div className="account-reset-notice" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <Check />
              <p>If that account has a verified recovery email, a password reset link is on its way. The link expires in 30 minutes.</p>
              <button type="button" onClick={() => { setFlow('signin'); setRecoveryRequestSent(false); }}>Back to sign in</button>
            </motion.div>
          ) : flow === 'request-reset' && !emailRecoveryConfigured ? (
            <motion.div className="account-reset-notice" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <KeyRound />
              <p>Email recovery has not been configured on this PulseDeck host.</p>
              {canResetPassword && <button type="button" onClick={() => { setFlow('local-reset'); setMessage(''); }}>Reset locally on this PC</button>}
              <button type="button" onClick={() => setFlow('signin')}>Back to sign in</button>
            </motion.div>
          ) : flow === 'setup-email' && !emailRecoveryConfigured ? (
            <motion.div className="account-reset-notice" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <KeyRound /><p>Email recovery has not been configured on this PulseDeck host. Add SMTP settings to the backend first.</p>
              <button type="button" onClick={() => setFlow('signin')}>Back to sign in</button>
            </motion.div>
          ) : flow === 'setup-email' && !getApiToken() ? (
            <motion.div className="account-reset-notice" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <KeyRound /><p>Sign in on this device before adding a recovery email.</p>
              <button type="button" onClick={() => setFlow('signin')}>Back to sign in</button>
            </motion.div>
          ) : (
          <motion.form className="account-form space-y-4" onSubmit={submitAccount} initial="hidden" animate="visible" variants={{ hidden: {}, visible: { transition: { delayChildren: 0.12, staggerChildren: 0.06 } } }}>
            {creatingAccount && flow === 'signin' && <p className="text-sm leading-relaxed text-zinc-400">Create one PulseDeck account on this PC. You’ll use it to sign in directly or pair your phone with the QR code.</p>}
            {flow === 'local-reset' && <p className="text-xs leading-relaxed text-zinc-400">Choose a new password. This will sign out other connected devices.</p>}
            {flow === 'email-reset' && <p className="text-xs leading-relaxed text-zinc-400">Choose a new password. This one-time email link will expire after use.</p>}
            {flow === 'setup-email' && <p className="text-xs leading-relaxed text-zinc-400">We’ll email you a verification link before enabling account recovery.</p>}
            {flow === 'setup-email' && recoveryEmailVerified && recoveryEmailMasked && <p className="text-xs text-emerald-300">Verified recovery email on file: {recoveryEmailMasked}</p>}
            {flow === 'request-reset' && <p className="text-xs leading-relaxed text-zinc-400">Enter your PulseDeck username or recovery email. If it matches a verified address, we’ll send a reset link.</p>}
            {flow === 'request-reset' && !recoveryEmailVerified && !canResetPassword && <p className="text-[10px] leading-relaxed text-zinc-500">If no recovery email is verified, sign in on the PC and add one from Connection settings.</p>}
            {flow === 'signin' || flow === 'local-reset' ? <motion.label variants={accountItemVariants} className="block space-y-1.5">
              <span className="text-xs font-medium text-zinc-300">Username</span>
              <input className="token-input h-11 w-full" type="text" autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} />
            </motion.label> : null}
            {flow === 'request-reset' && <motion.label variants={accountItemVariants} className="block space-y-1.5">
              <span className="text-xs font-medium text-zinc-300">Username or recovery email</span>
              <input className="token-input h-11 w-full" type="text" autoComplete="username" minLength={3} maxLength={254} required value={recoveryIdentifier} onChange={(event) => setRecoveryIdentifier(event.target.value)} />
            </motion.label>}
            {flow === 'setup-email' && <motion.label variants={accountItemVariants} className="block space-y-1.5">
              <span className="text-xs font-medium text-zinc-300">Recovery email</span>
              <input className="token-input h-11 w-full" type="email" autoComplete="email" maxLength={254} required value={recoveryEmail} onChange={(event) => setRecoveryEmail(event.target.value)} />
            </motion.label>}
            {creatingAccount && flow === 'signin' && emailRecoveryConfigured && <motion.label variants={accountItemVariants} className="block space-y-1.5">
              <span className="text-xs font-medium text-zinc-300">Recovery email <span className="text-zinc-500">(optional)</span></span>
              <input className="token-input h-11 w-full" type="email" autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} />
            </motion.label>}
            {(flow === 'signin' || flow === 'local-reset' || flow === 'email-reset') && <motion.label variants={accountItemVariants} className="block space-y-1.5">
              <span className="text-xs font-medium text-zinc-300">{flow === 'signin' ? 'Password' : 'New password'}</span>
              <input className="token-input h-11 w-full" type="password" autoComplete={flow === 'signin' ? (creatingAccount ? 'new-password' : 'current-password') : 'new-password'} minLength={flow === 'signin' && !creatingAccount ? undefined : 10} maxLength={256} required value={password} onChange={(event) => setPassword(event.target.value)} />
              {(flow !== 'signin' || creatingAccount) && <span className="block text-[10px] text-zinc-500">Use at least 10 characters.</span>}
            </motion.label>}
            {(flow === 'local-reset' || flow === 'email-reset' || (creatingAccount && flow === 'signin')) && <motion.label variants={accountItemVariants} className="block space-y-1.5">
              <span className="text-xs font-medium text-zinc-300">Confirm password</span>
              <input className="token-input h-11 w-full" type="password" autoComplete="new-password" minLength={10} maxLength={256} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
            </motion.label>}
            <SpringButton variants={accountItemVariants} type="submit" className="account-submit-button flex h-11 w-full items-center justify-center rounded-xl px-4 text-sm font-semibold text-white transition disabled:cursor-wait disabled:opacity-60" disabled={busy || leaving || (flow === 'setup-email' && !emailRecoveryConfigured)}>
              {busy ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" />Please wait…</> : flow === 'request-reset' ? 'Send reset link' : flow === 'setup-email' ? 'Send verification link' : flow === 'local-reset' || flow === 'email-reset' ? 'Reset password' : creatingAccount ? 'Create account' : 'Sign in'}
            </SpringButton>
            {flow === 'signin' && accountConfigured && <button type="button" className="account-forgot-button" onClick={() => { setFlow(emailRecoveryConfigured ? 'request-reset' : canResetPassword ? 'local-reset' : 'request-reset'); setConfirmPassword(''); setMessage(''); }}>Forgot password?</button>}
            {flow === 'request-reset' && canResetPassword && !recoveryEmailVerified && <button type="button" className="account-forgot-button" onClick={() => { setFlow('local-reset'); setMessage(''); }}>No verified email? Reset locally on this PC</button>}
            {flow !== 'signin' && <button type="button" className="account-forgot-button" onClick={() => { setFlow('signin'); setMessage(''); setConfirmPassword(''); }}>Back to sign in</button>}
          </motion.form>
          )}
          </>
        ) : accountConfigured === false ? (
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 text-sm leading-relaxed text-zinc-300">
            <p>Set up PulseDeck on the PC once.</p>
            <p className="mt-2 text-xs text-zinc-500">Create the account and sign in on the PC. Then open Connection and scan its pairing QR with your phone camera to sign in here without entering a password.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 text-sm leading-relaxed text-zinc-300">
            <p className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-[#b4ff00]" />Sign in with your PulseDeck username and password.</p>
            <p className="mt-3 flex items-center gap-2 text-xs text-zinc-500"><Smartphone className="h-4 w-4" />Or scan the QR code shown on the PC.</p>
          </div>
        )}

        <AnimatePresence mode="wait">{message && <motion.p key={message} className="mt-4 rounded-lg border border-red-400/20 bg-red-400/[0.06] p-3 text-xs leading-relaxed text-red-200" role="alert" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.22 }}>{message}</motion.p>}</AnimatePresence>
        <motion.div className={`account-host-status ${hostStatus}`} role="status" aria-live="polite" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.55, duration: 0.35 }}>
          {hostStatus === 'searching' ? <LoaderCircle className="animate-spin" /> : hostStatus === 'connected' ? <Check /> : <X />}
          <span>{hostStatus === 'searching' ? 'Searching for PulseDeck host…' : hostStatus === 'connected' ? 'Host connected · local network' : 'PulseDeck host offline · retrying'}</span>
        </motion.div>
      </motion.section>
    </main>
  );
}
