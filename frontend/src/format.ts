import { Alert, Platform } from 'react-native';
import type { CategoryCode } from './api';

export const MONTHS_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];
export const MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

export const CATEGORY_COLORS: Record<CategoryCode, string> = {
  income: '#16a34a',
  expense: '#dc2626',
  lend: '#ea580c',
  borrow: '#2563eb',
  lend_return: '#0d9488',
  borrow_repay: '#7c3aed',
};

export const CATEGORY_ICONS: Record<CategoryCode, string> = {
  income: '💰',
  expense: '💸',
  lend: '🤝',
  borrow: '🏦',
  lend_return: '↩️',
  borrow_repay: '💳',
};

/** Light backgrounds behind each category's icon. */
export const CATEGORY_TINTS: Record<CategoryCode, string> = {
  income: '#dcfce7',
  expense: '#fee2e2',
  lend: '#ffedd5',
  borrow: '#dbeafe',
  lend_return: '#ccfbf1',
  borrow_repay: '#ede9fe',
};

/** Gradients for the coloured header cards (expo-linear-gradient colour lists). */
export const GRADIENTS = {
  primary: ['#4338ca', '#6d28d9', '#a21caf'] as const,
  night: ['#1e1b4b', '#4338ca', '#7c3aed'] as const,
};

/** Soft card shadow; boxShadow works on web, iOS and Android. */
export const SHADOW = { boxShadow: '0px 6px 20px rgba(30, 27, 75, 0.07)' } as const;

export const COLORS = {
  bg: '#f4f5fb',
  card: '#ffffff',
  text: '#1f2937',
  muted: '#6b7280',
  border: '#eceef5',
  primary: '#4f46e5',
  primarySoft: '#eef0ff',
  in: '#16a34a',
  out: '#dc2626',
  pending: '#b45309', // slips waiting for confirmation
  pendingBg: '#fffbeb',
  pendingBorder: '#fbbf24',
};

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
