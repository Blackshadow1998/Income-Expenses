// Theme preference ('system' | 'light' | 'dark'), read synchronously because styles are built at import time.
const KEY = 'theme';

export function loadThemePref(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Saves the choice and reloads so every stylesheet is rebuilt with the new palette. */
export function saveThemePref(pref: string) {
  try {
    localStorage.setItem(KEY, pref);
  } catch {}
  window.location.reload();
}
