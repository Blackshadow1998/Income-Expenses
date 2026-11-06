// Web: expo-secure-store has no web support, so the session token is kept in localStorage.
// The PIN still has to be entered to unlock the data, and the server locks idle sessions.
const KEY = 'auth_token';

export async function loadToken(): Promise<string | null> {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export async function saveToken(token: string) {
  try {
    localStorage.setItem(KEY, token);
  } catch {}
}

export async function clearToken() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
