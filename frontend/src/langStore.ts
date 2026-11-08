import * as SecureStore from 'expo-secure-store';
import { Alert } from 'react-native';

// Language preference ('th' | 'en'), read synchronously because texts are picked at import time.
const KEY = 'lang';

export function loadLangPref(): string | null {
  try {
    return SecureStore.getItem(KEY);
  } catch {
    return null;
  }
}

/** Native apps pick the new language up the next time they start. */
export function saveLangPref(pref: string, title: string, message: string) {
  try {
    SecureStore.setItem(KEY, pref);
  } catch {}
  Alert.alert(title, message);
}
