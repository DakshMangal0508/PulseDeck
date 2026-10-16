export const API_BASE = `${window.location.protocol}//${window.location.hostname}:8000`;
const TOKEN_KEY = 'pulsedeck-api-token';

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

export async function apiRequest(endpoint, { method = 'GET', body } = {}) {
  const token = getApiToken();
  if (!token) throw new Error('Enter the Host API token to connect');

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
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
