export const API_BASE = `${window.location.protocol}//${window.location.hostname}:8000`;
const TOKEN_KEY = 'pulsedeck-api-token';
const USERNAME_KEY = 'pulsedeck-account-username';

export function getApiToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function saveApiToken(token) {
  try {
    window.localStorage.setItem(TOKEN_KEY, token.trim());
  } catch {
    // The session still works in browsers where local storage is disabled.
  }
}

export function saveAccountSession(token, username) {
  saveApiToken(token);
  try {
    window.localStorage.setItem(USERNAME_KEY, username);
  } catch { /* The session still works if local storage is unavailable. */ }
}

export function getAccountUsername() {
  try {
    return window.localStorage.getItem(USERNAME_KEY) || '';
  } catch {
    return '';
  }
}

export function clearAccountSession() {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USERNAME_KEY);
  } catch { /* Keep the in-memory logout state if local storage is unavailable. */ }
}

export async function authRequest(endpoint, body) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || `Request failed (${response.status})`);
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
      throw new Error(message);
    }
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Host request timed out');
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}
