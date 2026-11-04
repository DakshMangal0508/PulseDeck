import { Capacitor } from '@capacitor/core';

const configuredApiBase = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
const API_BASE_STORAGE_KEY = 'pulsedeck-backend-url';
export const isNativeApp = Capacitor.isNativePlatform();

function readSavedApiBase() {
  try {
    return (window.localStorage.getItem(API_BASE_STORAGE_KEY) || '').trim().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function normalizeApiBase(value) {
  const parsed = new URL(value.trim());
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Use an HTTP or HTTPS address.');
  if (parsed.pathname !== '/') throw new Error('Enter the PC address only, without a path.');
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Enter only the PC address, without a username, password, query, or fragment.');
  return parsed.toString().replace(/\/+$/, '');
}

export let API_BASE = isNativeApp
  ? readSavedApiBase() || configuredApiBase
  : configuredApiBase || `${window.location.protocol}//${window.location.hostname}:8000`;

export function setApiBase(value) {
  const normalized = normalizeApiBase(value);
  try { window.localStorage.setItem(API_BASE_STORAGE_KEY, normalized); } catch { /* Keep the host for this app session. */ }
  API_BASE = normalized;
}

export function clearApiBase() {
  try { window.localStorage.removeItem(API_BASE_STORAGE_KEY); } catch { /* Continue with the in-memory reset. */ }
  API_BASE = '';
}

const TOKEN_KEY = 'pulsedeck-api-token';
const USERNAME_KEY = 'pulsedeck-account-username';

export function getApiToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY) || window.sessionStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function saveApiToken(token, remember = true) {
  try {
    if (remember) {
      window.localStorage.setItem(TOKEN_KEY, token.trim());
      window.sessionStorage.removeItem(TOKEN_KEY);
    } else {
      window.localStorage.removeItem(TOKEN_KEY);
      window.sessionStorage.setItem(TOKEN_KEY, token.trim());
    }
  } catch {
    // The session still works in browsers where local storage is disabled.
  }
}

export function saveAccountSession(token, username, remember = true) {
  saveApiToken(token, remember);
  try {
    const storage = remember ? window.localStorage : window.sessionStorage;
    const otherStorage = remember ? window.sessionStorage : window.localStorage;
    storage.setItem(USERNAME_KEY, username);
    otherStorage.removeItem(USERNAME_KEY);
  } catch { /* The session still works if local storage is unavailable. */ }
}

export function getAccountUsername() {
  try {
    return window.localStorage.getItem(USERNAME_KEY) || window.sessionStorage.getItem(USERNAME_KEY) || '';
  } catch {
    return '';
  }
}

export function clearAccountSession() {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USERNAME_KEY);
    window.sessionStorage.removeItem(TOKEN_KEY);
    window.sessionStorage.removeItem(USERNAME_KEY);
  } catch { /* Keep the in-memory logout state if local storage is unavailable. */ }
}

export async function authRequest(endpoint, body) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.detail || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function apiRequest(endpoint, { method = 'GET', body, timeoutMs = 8000 } = {}) {
  const token = getApiToken();
  if (!token) throw new Error('Sign in to control this PC');

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      method,
      headers: { 'X-API-Token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    if (!response.ok) {
      let message = `Request failed (${response.status})`;
      try {
        const data = await response.json();
        if (data.detail) message = data.detail;
      } catch { /* Keep the status message. */ }
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Host request timed out');
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}
