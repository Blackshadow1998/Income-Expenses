import * as SecureStore from 'expo-secure-store';
import { Alert } from 'react-native';

// Theme preference ('system' | 'light' | 'dark'), read synchronously because styles are built at import time.
const KEY = 'theme';

export function loadThemePref(): string | null {
  try {
    return SecureStore.getItem(KEY);
  } catch {
    return null;
  }
}

/** Native apps pick the new palette up the next time they start. */
export function saveThemePref(pref: string) {
  try {
    SecureStore.setItem(KEY, pref);
  } catch {}
  Alert.alert('เปลี่ยนธีมแล้ว', 'ปิดแล้วเปิดแอปใหม่เพื่อใช้ธีมใหม่');
}
