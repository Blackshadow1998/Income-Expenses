import { Alert, Appearance, Platform } from 'react-native';
import type { CategoryCode } from './api';
import { loadThemePref, saveThemePref } from './themeStore';

export const MONTHS_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];
export const MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

export const CATEGORY_ICONS: Record<CategoryCode, string> = {
  income: '💰',
  expense: '💸',
  lend: '🤝',
  borrow: '🏦',
  lend_return: '↩️',
  borrow_repay: '💳',
};

// Theme: chosen once at startup (styles are built at import time); changing it reloads the app.
export type ThemePref = 'system' | 'light' | 'dark';
const stored = loadThemePref();
export const THEME_PREF: ThemePref = stored === 'light' || stored === 'dark' ? stored : 'system';
export const IS_DARK = THEME_PREF === 'dark' || (THEME_PREF === 'system' && Appearance.getColorScheme() === 'dark');
export const setThemePref = (pref: ThemePref) => saveThemePref(pref);

/**
 * Earthy colours, one family per category pair: in sage / out brick, lend ochre + its return teal,
 * borrow plum + its repayment dusty rose. Dark mode uses lighter shades so they read on espresso.
 */
export const CATEGORY_COLORS: Record<CategoryCode, string> = IS_DARK
  ? { income: '#7fae6f', expense: '#dc6f5f', lend: '#d9a04e', borrow: '#9a88c8', lend_return: '#5fa9a0', borrow_repay: '#c97f9c' }
  : { income: '#4d7c4a', expense: '#b4483b', lend: '#c27c2c', borrow: '#6d5a9c', lend_return: '#3f7f78', borrow_repay: '#a65a7a' };

/** Soft backgrounds behind each category's icon. */
export const CATEGORY_TINTS: Record<CategoryCode, string> = IS_DARK
  ? { income: '#222b1d', expense: '#3a221d', lend: '#372a18', borrow: '#2a2435', lend_return: '#1b2c29', borrow_repay: '#35222b' }
  : { income: '#e8f0e3', expense: '#f7e4df', lend: '#f8ecd9', borrow: '#ece7f4', lend_return: '#e0efec', borrow_repay: '#f5e4eb' };

/** Gradients for the coloured header cards (expo-linear-gradient colour lists): warm brown to caramel. */
export const GRADIENTS = {
  primary: ['#5c3d2e', '#8b5e3c', '#c08552'] as const,
  night: ['#2b1d16', '#5c3d2e', '#8b5e3c'] as const,
};

/** Soft card shadow; boxShadow works on web, iOS and Android. */
export const SHADOW = { boxShadow: IS_DARK ? '0px 6px 20px rgba(0, 0, 0, 0.4)' : '0px 6px 20px rgba(59, 47, 42, 0.07)' } as const;

// Warm minimal: cream paper, brown accent.
const LIGHT = {
  bg: '#faf6f0',
  card: '#ffffff',
  input: '#fffdf9',
  subtle: '#f6f0e7', // read-only boxes, table headers
  track: '#efe6da', // progress bar background
  skeleton: '#ebe2d6',
  dangerSoft: '#fbebe7', // delete buttons
  text: '#3b2f2a',
  muted: '#8a7a6d',
  border: '#efe5d9',
  primary: '#8b5e3c',
  primarySoft: '#f4e9dd',
  primaryBorder: '#e6d3bf', // outline buttons
  dangerBorder: '#f1c8c0',
  in: '#4d7c4a',
  out: '#b4483b',
  pending: '#a16207', // slips waiting for confirmation
  pendingBg: '#fff8ec',
  pendingBorder: '#e5c07b',
};

// Espresso dark with a caramel accent.
const DARK: typeof LIGHT = {
  bg: '#16120f',
  card: '#211b17',
  input: '#1b1612',
  subtle: '#2a221d',
  track: '#352b24',
  skeleton: '#352b24',
  dangerSoft: '#3a221d',
  text: '#f1e9df',
  muted: '#b3a495',
  border: '#33291f',
  primary: '#b07a4a', // dark enough for white text on buttons, light enough for links on the cards
  primarySoft: '#3a2b1f',
  primaryBorder: '#4a3a2c',
  dangerBorder: '#5a2e27',
  in: '#8fbf7f',
  out: '#e58a7c',
  pending: '#e9b562',
  pendingBg: '#251f19',
  pendingBorder: '#6e5530',
};

export const COLORS = IS_DARK ? DARK : LIGHT;

/** 1234567.5 -> "1,234,567.50" (own implementation: Intl support varies on Hermes). */
export function money(n: number): string {
  const sign = n < 0 ? '-' : '';
  const [int, dec] = Math.abs(n).toFixed(2).split('.');
  return `${sign}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec}`;
}

export const pad2 = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export const currentMonth = () => toISODate(new Date()).slice(0, 7);

/** "2026-11" -> "พฤศจิกายน 2569" (Buddhist year) */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS_FULL[m - 1]} ${y + 543}`;
}

/** "2026-11-06" -> "6 พ.ย. 2569" */
export function dateLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS_SHORT[m - 1]} ${y + 543}`;
}

export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

export function isValidDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/** Alert.alert is a no-op on react-native-web, so fall back to window.confirm there. */
export function confirmAsync(title: string, message: string, okText = 'ลบ'): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'ยกเลิก', style: 'cancel', onPress: () => resolve(false) },
      { text: okText, style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}

export function showError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  if (Platform.OS === 'web') window.alert(`เกิดข้อผิดพลาด: ${msg}`);
  else Alert.alert('เกิดข้อผิดพลาด', msg);
}

export const ACCOUNT_TYPE_COLORS: Record<string, string> = {
  savings: '#16a34a',
  salary: '#2563eb',
  credit_card: '#dc2626',
  investment: '#9333ea',
  payment: '#ea580c',
};

/** "กสิกรไทย (KBank)" + "บัญชีหลัก" -> "กสิกรไทย · บัญชีหลัก" (falls back to the type name). */
export function shortAccountLabel(a: { bank_name: string; name: string; type_name: string }): string {
  return `${a.bank_name.replace(/\s*\(.*\)$/, '')} · ${a.name || a.type_name}`;
}

/** Simple message box that works on web (Alert.alert is a no-op there) and native. */
export function showInfo(title: string, message: string) {
  if (Platform.OS === 'web') window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}
