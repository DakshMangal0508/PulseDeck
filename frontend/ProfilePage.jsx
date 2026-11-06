import React, { useEffect, useRef, useState } from 'react';
import { Activity, ArrowLeft, Camera, Check, LoaderCircle, LogOut, Mail, Phone, UserRound, X } from 'lucide-react';
import { apiRequest, clearAccountSession, getApiToken, updateAccountUsername } from './api.js';

const emptyProfile = { username: '', email: '', recovery_email: '', recovery_email_verified: false, email_recovery_configured: false, display_name: '', phone_number: '', profile_photo: null };

export default function ProfilePage() {
  const [profile, setProfile] = useState(emptyProfile);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const fileInput = useRef(null);

  useEffect(() => {
    let active = true;
    if (!getApiToken()) {
      window.location.replace('/?view=signin');
      return () => { active = false; };
    }
    apiRequest('/api/account/profile')
      .then((data) => { if (active) setProfile({ ...emptyProfile, ...data }); })
      .catch((reason) => {
        if (!active) return;
        if (reason.status === 401) {
          clearAccountSession();
          window.location.replace('/?view=signin');
        } else setError(reason.message || 'Could not load your account details.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const update = (key, value) => setProfile((current) => ({ ...current, [key]: value }));

  const choosePhoto = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Choose a PNG, JPEG, or WebP image.');
      return;
    }
    if (file.size > 1024 * 1024) {
      setError('Choose an image smaller than 1 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { update('profile_photo', String(reader.result)); setError(''); setNotice(''); };
    reader.onerror = () => setError('Could not read that image. Please try another one.');
    reader.readAsDataURL(file);
  };

  const save = async (event) => {
    event.preventDefault();
    setSaving(true); setError(''); setNotice('');
    try {
      const saved = await apiRequest('/api/account/profile', {
        method: 'POST',
        body: { username: profile.username, display_name: profile.display_name, email: profile.email, phone_number: profile.phone_number, profile_photo: profile.profile_photo },
      });
      setProfile({ ...emptyProfile, ...saved });
      updateAccountUsername(saved.username);
      setNotice('Your account details are saved.');
    } catch (reason) {
      setError(reason.message || 'Could not save your account details.');
      if (reason.status === 401) { clearAccountSession(); window.location.replace('/?view=signin'); }
    } finally { setSaving(false); }
  };

  const initials = (profile.display_name || profile.username || '?').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const signOut = () => { clearAccountSession(); window.location.replace('/?view=signin'); };

  return (
    <main className="deck-shell min-h-screen px-4 py-8 text-zinc-100 sm:px-6" data-theme="dark">
      <div className="profile-page mx-auto w-full max-w-3xl">
        <header className="profile-page-header">
          <a href="/" className="profile-back-link"><ArrowLeft /> <span>Back to PulseDeck</span></a>
          <button type="button" className="profile-signout" onClick={signOut}><LogOut /> <span>Sign out</span></button>
        </header>

        <section className="profile-card">
          <div className="profile-title-row">
            <div className="brand-mark"><Activity className="h-5 w-5" /></div>
            <div><h1>My account</h1><p>Manage the details connected to your PulseDeck account.</p></div>
          </div>

          {loading ? <div className="profile-loading"><LoaderCircle className="animate-spin" /> Loading your account…</div> : (
            <form onSubmit={save}>
              <div className="profile-photo-row">
                <div className="profile-avatar" aria-label="Profile photo">
                  {profile.profile_photo ? <img src={profile.profile_photo} alt="Your profile" /> : initials || <UserRound />}
                </div>
                <div className="profile-photo-copy"><strong>Profile photo</strong><span>Add a photo so it’s easy to recognize your account.</span>
                  <div className="profile-photo-actions">
                    <button type="button" onClick={() => fileInput.current?.click()}><Camera /> {profile.profile_photo ? 'Change photo' : 'Add photo'}</button>
                    {profile.profile_photo && <button type="button" className="profile-remove-photo" onClick={() => update('profile_photo', null)}><X /> Remove</button>}
                  </div>
                  <input ref={fileInput} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={choosePhoto} />
                </div>
              </div>

              <div className="profile-fields">
                <label className="profile-field"><span>Display name</span><input autoComplete="name" maxLength={80} value={profile.display_name} onChange={(event) => update('display_name', event.target.value)} placeholder="Your name" /></label>
                <label className="profile-field"><span>Username</span><input autoComplete="username" maxLength={254} required value={profile.username} onChange={(event) => update('username', event.target.value)} /><small>Used to sign in. Choose any name that isn’t already in use.</small></label>
                <label className="profile-field"><span>Account email</span><div className="profile-input-icon"><Mail /><input type="email" autoComplete="email" maxLength={254} value={profile.email} onChange={(event) => update('email', event.target.value)} placeholder="you@example.com" /></div><small>Your contact email is saved to your account. It is separate from sign-in and recovery.</small></label>
                <label className="profile-field"><span>Phone number</span><div className="profile-input-icon"><Phone /><input type="tel" autoComplete="tel" maxLength={32} value={profile.phone_number} onChange={(event) => update('phone_number', event.target.value)} placeholder="Add your phone number" /></div><small>Optional. This is saved to your PulseDeck profile.</small></label>
              </div>

              {error && <p className="profile-message is-error" role="alert">{error}</p>}
              {notice && <p className="profile-message is-success" role="status"><Check />{notice}</p>}
              <footer className="profile-form-footer">{profile.email_recovery_configured ? <a href="/?recovery=setup">Manage recovery email</a> : <span className="profile-recovery-unavailable">Email recovery isn’t set up on this PC.</span>}<button type="submit" disabled={saving}>{saving ? <LoaderCircle className="animate-spin" /> : <Check />}{saving ? 'Saving…' : 'Save changes'}</button></footer>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
