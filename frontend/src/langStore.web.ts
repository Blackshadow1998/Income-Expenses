// Language preference ('th' | 'en'), read synchronously because texts are picked at import time.
const KEY = 'lang';

export function loadLangPref(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Saves the choice and reloads so every screen is rebuilt in the new language. */
export function saveLangPref(pref: string, title: string, message: string) {
  try {
    localStorage.setItem(KEY, pref);
  } catch {}
  window.location.reload();
}
